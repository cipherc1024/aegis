// Aegis Challenger Agent —— 独立进程（把整个 challenger/ 目录拷到 proposer 之外的机器运行）
// 自包含范围：确定性层 L1–L5（verify/objective/selftest 只依赖目录内文件 + ethers）。
// 可选交叉模型层（MODEL_CHALLENGE=true）需完整仓库（challenger/ 与 ../tee-runtime/ 同级）；
// 自包含部署保持默认 MODEL_CHALLENGE=false，该模块仅在显式开启时动态加载。
// 通信面：Monad 公共 RPC（读链+上链）+ orchestrator HTTP（拉决策原文，出站连接）。
// 无需开放入站端口；跨网段用任意一行隧道（如 cloudflared）即可。
// 循环：轮询链上最新收据 → 直读收据字段（不信 orchestrator）→ 拉原文（拉不到 = fail-closed 拒绝）
//       → 5 层独立重推导（L1–L5）→ 独立钱包上链 validationRequest + validationResponse。
// 用法：node challenger-agent.mjs [--once]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, FallbackProvider, Wallet, Contract } from "ethers";
import { verifyDecision, attestedGuardrailHash, computeTranscriptHash } from "./verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ONCE = process.argv.includes("--once");
const ZERO32 = "0x" + "00".repeat(32);
const ZERO_ADDR = "0x" + "0".repeat(40);

// ---- env：challenger/.env 优先，其次进程环境，最后上级 aegis/.env（本地测试用；不覆盖已有） ----
for (const f of [path.join(__dirname, ".env"), ".env", path.join(__dirname, "..", ".env")]) {
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}

const RPC_LIST = [
  process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz",
  "https://rpc.ankr.com/monad_testnet",
];
const REGISTRY = process.env.REGISTRY || "0x4622D041696942dC873a8A5E54f1e1ca9669c90B";
const VALIDATION = process.env.VALIDATION || "0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa";
const VAULT = process.env.VAULT || process.env.QUORUM_VAULT || ""; // 可选：读 dailySpent 做 L3 日限
const ORCH_URL = (process.env.ORCH_URL || "http://localhost:8787").replace(/\/$/, "");
const AGENT_ID = Number(process.env.AGENT_ID || 1);
const POLL_MS = Number(process.env.POLL_MS || 4000);
const RECORD_REJECT = process.env.RECORD_REJECT === "true"; // 拒绝也上链留证（demo 用）
// 可选交叉模型层：challenger 用自己的（不同家族）模型独立提议，代码比对两侧动作。
// 未配置（默认）时行为与 Phase 2 完全一致（纯确定性重推导，无模型参与）。
const MODEL_CHALLENGE = process.env.MODEL_CHALLENGE === "true";
// 交叉模型层用动态 import：llm-challenge.mjs 依赖 ../tee-runtime/，若静态 import，
// 自包含部署（只拷 challenger/）会在启动时 ERR_MODULE_NOT_FOUND——即使该层默认关闭。
// 显式开启但缺依赖时启动即退出（fail-closed，不静默降级）。
let crossCheckWithLLM = null;
if (MODEL_CHALLENGE) {
  try {
    ({ crossCheckWithLLM } = await import("./llm-challenge.mjs"));
  } catch (e) {
    console.error("[challenger] MODEL_CHALLENGE=true 需要完整仓库（challenger/ 与 tee-runtime/ 同级）；自包含部署请设 MODEL_CHALLENGE=false");
    process.exit(1);
  }
}

const provider = new FallbackProvider(
  RPC_LIST.map((url) => ({ provider: new JsonRpcProvider(url, 10143, { staticNetwork: true }), priority: 1, weight: 1, stallTimeout: 2500 })),
  10143,
  { quorum: 1, cacheTimeout: -1 }
);

const policy = JSON.parse(fs.readFileSync(path.join(__dirname, "challenger-policy.json"), "utf8"));
const attested = attestedGuardrailHash(policy);

const pk = process.env.CHALLENGER_PK;
if (!pk) {
  console.error("[challenger] 缺 CHALLENGER_PK —— 在本机生成独立 key（node gen-key.mjs），切勿复用 proposer 的任何 key");
  process.exit(1);
}
const wallet = new Wallet(pk, provider);

const reg = new Contract(REGISTRY, [
  "function latestReceipt(uint256) view returns (bytes32 digest, bytes32 pdrHash, bytes32 guardrailHash, bytes32 executionHash, uint256 blockHeight, bytes32 blockHash, uint256 submitBlock, bytes32 nonce, bytes32 quoteHash, bool isHeartbeat, uint256 timestamp)",
  "function lastReceiptHash(uint256) view returns (bytes32)",
  "function transcriptHash(bytes32) view returns (bytes32)",
], provider);
const val = new Contract(VALIDATION, [
  "function validationRequest(address,uint256,string,bytes32)",
  "function validationResponse(bytes32,uint8,string,bytes32,string)",
  "function getValidationStatus(bytes32) view returns (address,uint256,uint8,bytes32,string,uint256)",
], wallet);
const vault = VAULT ? new Contract(VAULT, ["function dailySpent(uint256) view returns (uint256)"], provider) : null;

// ---- 本地审计日志 + 已处理状态 ----
const STATE_FILE = path.join(__dirname, "challenger-state.json");
const LOG_FILE = path.join(__dirname, "challenger-log.jsonl");
const MAX_TRANSCRIPT_RETRIES = Number(process.env.MAX_TRANSCRIPT_RETRIES || 6); // 超过后才永久拒绝（竞态容忍窗口）
let state = { lastProcessed: null, retries: {} };
try { state = { ...state, ...JSON.parse(fs.readFileSync(STATE_FILE, "utf8")) }; } catch {}
function saveState() { try { fs.writeFileSync(STATE_FILE, JSON.stringify(state)); } catch {} }
function log(entry) {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...entry });
  console.log(line);
  try { fs.appendFileSync(LOG_FILE, line + "\n"); } catch {}
}

// RPC 间歇性抖动（坑 #4 变体）：FallbackProvider 后台轮询（tx.wait 内部重试）的
// 拒绝可能逃出 await 链 —— 不全局接管会直接杀死进程（validation 已上链但
// challenger 退出，demo 当场断线）。接管后记日志，下个 tick 继续轮询。
process.on("unhandledRejection", (e) => {
  log({ event: "unhandled_rejection", error: String(e?.shortMessage || e?.message || e).slice(0, 240) });
});

// ---- 拉决策原文（坑 #5：fetch 必须带超时） ----
async function fetchTranscript(digest) {
  const res = await fetch(`${ORCH_URL}/api/decision/${digest}`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) return null;
  const j = await res.json();
  return j.found ? j.transcript : null;
}

async function respond(digest, response, mismatches, extra = {}) {
  log({ event: "verdict", digest, response, mismatches, ...extra });
  try {
    const st = await val.getValidationStatus(digest);
    if (st[0] === ZERO_ADDR) {
      const req = await val.validationRequest(wallet.address, AGENT_ID, "ipfs://aegis-challenge", digest);
      await req.wait();
      log({ event: "validation_request", digest, tx: req.hash });
    } else if (st[0].toLowerCase() !== wallet.address.toLowerCase()) {
      log({ event: "skip", note: `request exists with other validator ${st[0]}` });
      return;
    }
    if (response > 0 || RECORD_REJECT) {
      const res = await val.validationResponse(digest, response, "ipfs://aegis-verdict", ZERO32, "challenger");
      const rr = await res.wait();
      log({ event: "validation_response", digest, response, tx: res.hash, status: rr.status });
    } else {
      log({ event: "reject_not_recorded", note: "RECORD_REJECT=false：拒绝不上链（作恶提案止步于互证）" });
    }
  } catch (e) {
    log({ event: "onchain_error", digest, error: String(e?.shortMessage || e?.message || e) });
  }
}

async function processReceipt(digest) {
  const r = await reg.latestReceipt(AGENT_ID);
  if (r.digest !== digest) { log({ event: "race", note: "latest changed mid-process, will retry" }); return; }
  log({ event: "receipt_seen", digest, executionHash: r.executionHash, blockHeight: Number(r.blockHeight), heartbeat: r.isHeartbeat });

  // 心跳收据：无执行体、无 transcript 绑定（bindTranscript 仅交易路径），不参与重推导。
  // 跳过而非走重试拒绝——重试 6 次只会白等 ~24s 再记一次无意义的 response=0。
  if (r.isHeartbeat) {
    log({ event: "heartbeat_skipped", digest, note: "no transcript by design — not a validation target" });
    state.lastProcessed = digest;
    saveState();
    return;
  }

  // 1) 拉决策原文（可重试 fail-closed：拉不到本轮不签名，超限才永久拒绝）
  let transcript;
  try { transcript = await fetchTranscript(digest); } catch { transcript = null; }
  if (!transcript) {
    const n = (state.retries[digest] ?? 0) + 1;
    state.retries[digest] = n;
    saveState();
    if (n < MAX_TRANSCRIPT_RETRIES) {
      log({ event: "transcript_retry", digest, attempt: n, note: "no transcript yet — not signing, will retry (fail-closed)" });
      return; // 不响应、不标记已处理 → 下轮重试
    }
    await respond(digest, 0, ["transcript_unavailable"], { note: `no transcript after ${n} attempts — permanent reject` });
    state.lastProcessed = digest;
    saveState();
    return;
  }

  // 2) 链上 transcript 绑定校验（Phase 2 核心）：决策原文必须与链上锚定一致
  const onchainTHash = await reg.transcriptHash(digest);
  if (onchainTHash === ZERO32) {
    // bindTranscript 可能尚未确认（竞态）——重试；超限才永久拒绝
    const n = (state.retries[digest] ?? 0) + 1;
    state.retries[digest] = n;
    saveState();
    if (n < MAX_TRANSCRIPT_RETRIES) {
      log({ event: "bind_retry", digest, attempt: n, note: "on-chain binding not confirmed yet — will retry" });
      return;
    }
    await respond(digest, 0, ["transcript_unbound"], { note: `on-chain transcriptHash unbound after ${n} attempts — permanent reject` });
    state.lastProcessed = digest;
    saveState();
    return;
  }
  const localTHash = computeTranscriptHash(transcript);
  if (localTHash !== onchainTHash) {
    await respond(digest, 0, ["transcript_onchain_mismatch"], { note: "transcript does not match on-chain binding — proposer provided fabricated decision", localTHash, onchainTHash });
    state.lastProcessed = digest;
    saveState();
    return;
  }
  log({ event: "transcript_bound_ok", digest, tHash: onchainTHash });

  // 3) L3 日限状态（可选；读失败则该层跳过并留痕——链上 vault 仍强制日限）
  let dailySpent = null;
  if (vault) {
    try {
      const blk = await provider.getBlock("latest");
      dailySpent = await vault.dailySpent(BigInt(Math.floor(blk.timestamp / 86400)));
    } catch { log({ event: "vault_read_failed", note: "daily-limit layer skipped" }); }
  }

  // 4) 四层独立重推导（收据字段直读自链上；prev 来自原文，被 digest 反向锚定：
  //    proposer 若谎报 prev，重算 digest 必与链上不符）
  const verdict = verifyDecision({
    policy,
    transcript,
    receipt: {
      digest: r.digest, pdrHash: r.pdrHash, guardrailHash: r.guardrailHash, executionHash: r.executionHash,
      blockHeight: r.blockHeight, blockHash: r.blockHash, nonce: r.nonce, prev: transcript.prev,
      timestamp: r.timestamp, // L5 目标层的时间源（链上时钟，不可伪造）
    },
    dailySpent,
    agentId: AGENT_ID,
  });

  // 5) 可选交叉模型层（默认关闭；叠加在 1–5 层确定性重推导之上，不改动其结论）。不可裁决（agree=null）→ 不签发、下轮重试。
  let llmChallenge = null;
  let response = verdict.response;
  let mismatches = [...verdict.mismatches];
  if (MODEL_CHALLENGE && verdict.agree) {
    llmChallenge = await crossCheckWithLLM({
      trustedCommand: transcript.command,
      marketData: transcript.marketData,
      transcript,
      expectedExec: verdict.expectedExec,
    });
    log({ event: "llm_cross_check", digest, agree: llmChallenge.agree, reason: llmChallenge.reason });
    if (llmChallenge.agree === null) {
      const n = (state.retries[digest] ?? 0) + 1;
      state.retries[digest] = n;
      saveState();
      if (n < MAX_TRANSCRIPT_RETRIES) {
        log({ event: "llm_retry", digest, attempt: n, note: "challenger model cannot adjudicate — not signing (fail-closed)" });
        return;
      }
      response = 0;
      mismatches.push("challenger_model_unavailable");
    } else if (llmChallenge.agree === false) {
      response = 0;
      mismatches.push("cross_model_divergence:" + llmChallenge.reason);
    }
  }

  // 6) 上链（独立钱包）
  await respond(digest, response, mismatches, {
    layers: verdict.layers,
    command: transcript.command,
    ...(llmChallenge ? { llmChallenge: { agree: llmChallenge.agree, reason: llmChallenge.reason } } : {}),
  });
  state.lastProcessed = digest;
  state.retries[digest] = 0;
  saveState();
}

let busy = false;
async function tick() {
  if (busy) return;
  busy = true;
  try {
    const digest = await reg.lastReceiptHash(AGENT_ID);
    if (digest !== ZERO32 && digest !== state.lastProcessed) await processReceipt(digest);
  } catch (e) {
    log({ event: "poll_error", error: String(e?.shortMessage || e?.message || e) });
  } finally {
    busy = false;
  }
}

// 跨家族独立性自检：同网关下，"不同模型名"未必是"不同后端"——
// 若两侧落到同一后端，一个家族盲区会同时骗过双方，2-of-2 退化为 1-of-1。
// 这里只能做名称层面的比对；后端是否真独立需靠实测指纹（见 scripts/probe-gateway.mjs）。
const _chModel = process.env.LLM_CHALLENGER_MODEL || process.env.LLM_MODEL || "(mock)";
const _prModel = process.env.LLM_MODEL || "(mock)";
const _crossFamily = Boolean(process.env.LLM_CHALLENGER_MODEL) && _chModel !== _prModel;

log({
  event: "start", address: wallet.address, attestedGuardrailHash: attested,
  registry: REGISTRY, validation: VALIDATION, orch: ORCH_URL, once: ONCE,
  modelChallenge: MODEL_CHALLENGE, llmModel: _chModel, proposerModel: _prModel,
  crossFamily: _crossFamily,
  ...(MODEL_CHALLENGE && !_crossFamily
    ? { warning: "⚠️ 未设置 LLM_CHALLENGER_MODEL（或与 proposer 同名）—— 2-of-2 会退化为 1-of-1" }
    : {}),
});
if (ONCE) {
  await tick();
  process.exit(0);
}
setInterval(tick, POLL_MS);
