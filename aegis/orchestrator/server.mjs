// Aegis Orchestrator（零依赖）：链上状态/收据/事件流 + 写侧（决策管线 → 上链 → 决策原文存证）
// 角色分离：本进程只当 proposer —— 链上 validation 一律由独立 challenger 进程
//（challenger/challenger-agent.mjs，部署在另一台机器）完成；本进程仅提供决策原文
// GET /api/decision/:digest 与离线预览，不持有 challenger 私钥。
// 运行: node orchestrator/server.mjs   （在 aegis/ 目录）
import http from "node:http";
import fs from "node:fs";
import { JsonRpcProvider, FallbackProvider, Wallet, Contract, keccak256, toUtf8Bytes, AbiCoder } from "ethers";
import { verifyDecision, attestedGuardrailHash } from "../challenger/verify.mjs";
import { checkObjective as objectivePrecheck, objectiveHash } from "../tee-runtime/objective.mjs";
import { runLLMPipeline, draftObjective, llmMeta, DATA_DEFAULT, assetMap } from "./pipeline.mjs";

// ---- env（零依赖加载，不覆盖已有） ----
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const PORT = Number(process.env.ORCH_PORT || 8787);
const RPC_LIST = [
  process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz",
  "https://rpc.ankr.com/monad_testnet",
];
// v2 部署（与 challenger-agent.mjs / .env.example 一致；旧 v1 0x91482e67… 已废弃，勿用）
const REGISTRY = process.env.REGISTRY || "0x4622D041696942dC873a8A5E54f1e1ca9669c90B";
const PER_TX_LIMIT = BigInt(process.env.PER_TX_LIMIT || "50000000000000000"); // 0.05 MON
const WHITELIST = (process.env.WHITELIST || "0x000000000000000000000000000000000000beef").split(",").map((x) => x.toLowerCase());
const BLOCKLIST = (process.env.BLOCKLIST || "evil.com,attacker,drain,ignore previous").split(",").filter(Boolean);
const TRUSTED_CMD = process.env.TRUSTED_CMD || "buy USDC 0.01";
// 单笔上限：链上合约可执行的最大金额（cap）与对外展示的「评审可试输入」上限分开。
// 原因：LLM 端点延迟常在 20-40s 甚至超时，demo 需要更小的默认金额
// 以压低失败代价；但 δ 的边界必须与链上合约一致，否则超限负例会失效。
const DEMO_MAX_MON = Number(process.env.DEMO_MAX_MON || "0.1");

// ---- 双 LLM（proposer 侧，见 orchestrator/pipeline.mjs；LLM 输出只是不可信输入） ----
// 模型端点若只在校园网/内网可达，则 orchestrator 必须与模型同网段运行（见 README 信任边界）。

const provider = new FallbackProvider(
  RPC_LIST.map((url) => ({ provider: new JsonRpcProvider(url, 10143, { staticNetwork: true, pollingInterval: 300 }), priority: 1, weight: 1, stallTimeout: 2500 })),
  10143,
  { quorum: 1, cacheTimeout: -1 }
);

const READ_ABI = [
  "function latestReceipt(uint256) view returns (bytes32 digest, bytes32 pdrHash, bytes32 guardrailHash, bytes32 executionHash, uint256 blockHeight, bytes32 blockHash, uint256 submitBlock, bytes32 nonce, bytes32 quoteHash, bool isHeartbeat, uint256 timestamp)",
  "function lastReceiptHash(uint256) view returns (bytes32)",
  "function isTradeFresh(uint256) view returns (bool)",
  "function isAlive(uint256,uint256) view returns (bool)",
  "function agentGuardrailHash(uint256) view returns (bytes32)",
  "event ReceiptSubmitted(uint256 indexed agentId, bytes32 receiptHash, uint256 blockHeight, bool isHeartbeat)",
];
const WRITE_ABI = [
  ...READ_ABI,
  "function agentTEE(uint256) view returns (address)",
  "function authorizeTEE(uint256,address)",
  "function submitReceipt(uint256,bytes32,bytes32,bytes32,bytes32,uint256,bytes32,bool)",
  "function submitReceiptWithQuote(uint256,bytes32,bytes32,bytes32,bytes32,uint256,bytes32,bool,bytes)",
  "function bindTranscript(uint256,bytes32,bytes32,string)",
  "function governance() view returns (address)",
];
const reg = new Contract(REGISTRY, READ_ABI, provider);

const wallet = process.env.MONAD_TESTNET_PK ? new Wallet(process.env.MONAD_TESTNET_PK, provider) : null;
const regWrite = wallet ? new Contract(REGISTRY, WRITE_ABI, wallet) : null;
// vault 读侧：日限预检与链上 executeTrade 同口径（QUORUM_VAULT 未配置或读失败时跳过预检，链上仍强制）
const QUORUM_VAULT = process.env.QUORUM_VAULT || "";
const vaultRead = QUORUM_VAULT
  ? new Contract(QUORUM_VAULT, ["function dailyLimit() view returns (uint256)", "function dailySpent(uint256) view returns (uint256)"], provider)
  : null;
// vault 写侧：execute 流程（proposer=TEE 钱包调用 executeTrade；AGENTS 待办#1）
const vaultWrite = wallet && QUORUM_VAULT
  ? new Contract(QUORUM_VAULT, ["function executeTrade(address,uint256,bytes)"], wallet)
  : null;
const valRead = new Contract(process.env.VALIDATION || "0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa", [
  "function getValidationStatus(bytes32) view returns (address,uint256,uint8,bytes32,string,uint256)",
], provider);

// ---- 角色分离：本进程只当 proposer。链上 validation 一律由独立 challenger 进程
//      （challenger/challenger-agent.mjs，部署在另一台机器）完成；本进程不持有 challenger 私钥。
// challenger 自持策略（与 challenger/ 打包同源；attest 见 challenger/policy-attest.mjs）
const CHALLENGER_POLICY = JSON.parse(fs.readFileSync(new URL("../challenger/challenger-policy.json", import.meta.url), "utf8"));

// ---- 决策原文存证：独立 challenger 经 GET /api/decision/:digest 拉取（拉不到 = fail-closed 拒绝） ----
const decisions = new Map();
// 交易在途窗口：trade 收据已上链但 challenger 未背书/未执行完的期间，心跳不得插入——
// 否则 lastReceiptHash 被心跳顶掉，executeTrade 的 quorum 钩子会读到未验证的心跳 digest
// → revert "No challenger quorum"（金库 fail-closed，资金安全，但交易作废需重跑）。
// 时间自愈：异常路径无需清理，窗口自然过期。
let tradePendingUntil = 0;
const DECISIONS_FILE = "orchestrator/decisions.jsonl";
try {
  for (const line of fs.readFileSync(DECISIONS_FILE, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    try { const d = JSON.parse(line); if (d.receiptDigest) decisions.set(d.receiptDigest, d); } catch {}
  }
} catch {}
function recordDecision(t) {
  decisions.set(t.receiptDigest, t);
  try { fs.appendFileSync(DECISIONS_FILE, JSON.stringify(t) + "\n"); } catch {}
}

const abi = AbiCoder.defaultAbiCoder();

// ---- 读侧 ----
async function status(agentId) {
  const [bn, r, fresh, alive] = await Promise.all([
    provider.getBlockNumber(),
    reg.latestReceipt(agentId),
    reg.isTradeFresh(agentId),
    reg.isAlive(agentId, 60n),
  ]);
  return {
    online: true,
    currentBlock: bn,
    lastReceiptBlock: Number(r.blockHeight),
    fresh,
    alive,
    receiptHash: r.digest,
    guardrailHash: r.guardrailHash,
    executionHash: r.executionHash,
    // 让 Dashboard 能显示"当前这条链跑的是什么模型、是否真跨家族"
    llm: llmMeta(),
    agentId: Number(agentId),
  };
}

async function receipts(agentId) {
  const out = [];
  const seen = new Set();
  // 1) 缓存（scripts/index-receipts.mjs 产物；getLogs 限 100 块，深历史走索引器）
  try {
    if (fs.existsSync("orchestrator/receipts-cache.json")) {
      const cache = JSON.parse(fs.readFileSync("orchestrator/receipts-cache.json", "utf8"));
      if (cache.agentId === Number(agentId)) {
        for (const r of cache.receipts) {
          const key = String(r.receiptHash);
          if (!seen.has(key)) { seen.add(key); out.push(r); }
        }
      }
    }
  } catch {}
  // 2) 实时尾扫（最近 2000 块，20×100 窗口）
  try {
    const latest = await provider.getBlockNumber();
    for (let s = Math.max(0, latest - 2000); s < latest; s += 100) {
      try {
        const logs = await reg.queryFilter(reg.filters.ReceiptSubmitted(agentId), s, Math.min(s + 99, latest));
        for (const l of logs) {
          const item = { receiptHash: l.args.receiptHash, blockHeight: Number(l.args.blockHeight), isHeartbeat: l.args.isHeartbeat, txHash: l.transactionHash };
          const key = String(item.receiptHash);
          if (!seen.has(key)) { seen.add(key); out.push(item); }
        }
      } catch {}
    }
  } catch {}
  return out.sort((a, b) => b.blockHeight - a.blockHeight);
}

// ---- 决策管线（镜像 in-TEE 闭环：护栏 → PACE → 摘要） ----
const ZERO32 = "0x" + "00".repeat(32);
// 注意：这里是 orchestrator 侧的**预览**实现（与链上/收据无关）；真正的裁决由
// challenger 用自己的 verify.mjs 独立重推导。两者口径必须一致，改任一侧都要跑
// `node challenger/policy-attest.mjs` 看是否漂移。
// ⚠️ 必须与 challenger/verify.mjs 的 normalize() 完全同口径（含 leetspeak folding）：
// 两侧口径不一致会让 challenger 因 L2 拒绝、而 proposer 预览放行 —— 制造假性分歧，
// 也会让 proposer 的自我预检失去意义。改这里务必同步改 challenger 并重跑 policy-attest。
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "$": "s", "@": "a" };
const norm = (s) =>
  String(s)
    .replace(/[\u200B-\u200D\u2060\uFEFF]/g, "")
    .toLowerCase()
    .replace(/[01345$@]/g, (c) => LEET[c] ?? c)
    .trim();

function runGuardrail(text, blocklist) {
  // ⚠️ 先规范化 text 再匹配：否则零宽字符/大小写混淆可绕过 blocklist
  // （例如 "ev\u200Bil.com" 不含子串 "evil.com"，但去零宽后就是它）
  const t = norm(text);
  const reasons = [];
  // 模式需容忍 leet 折叠产物（"a11" -> "aii"）—— 必须与 challenger/verify.mjs 的
  // INJECTION_PATTERNS 保持同口径，否则混淆注入会漏判且两侧结论漂移。
  if (/ignore (a[il1]+ )?previous/.test(t)) reasons.push("injection_pattern");
  if (/(airdrop|空投)/.test(t) && /(swap|换成|transfer)/.test(t)) reasons.push("suspicious_social_engineering");
  for (const b of blocklist) if (t.includes(norm(b))) reasons.push("blocklist:" + b);
  return reasons;
}

function paceVerify({ target, amount, data }) {
  if (!WHITELIST.includes(String(target).toLowerCase())) return "target_not_whitelisted";
  if (amount > PER_TX_LIMIT) return "exceeds_per_tx_limit";
  // 评审可试入口的额外闸门（比链上 cap 更紧）：避免一次失败的 demo 就把 vault 掏空
  if (Number(amount) / 1e18 > DEMO_MAX_MON) return "exceeds_demo_cap";
  return null;
}

function buildReceiptFields({ agentId, type, target, amount, data, guardrailHash, prev, nonce }) {
  const executionHash = type === "heartbeat" ? ZERO32 : keccak256(abi.encode(["address", "uint256", "bytes"], [target, amount, data || "0x"]));
  const intentHash = executionHash;
  const pdrHash = keccak256(abi.encode(["bytes32", "bytes32", "bool"], [intentHash, guardrailHash, true]));
  const semantic = keccak256(abi.encode(["uint256", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"], [agentId, pdrHash, guardrailHash, executionHash, nonce, prev]));
  return { executionHash, pdrHash, semantic };
}

// 资产 → 白名单地址（与 vault 的 WHITELIST env / challenger 策略必须一致；未知资产一律拒绝）
const ASSETS = assetMap(WHITELIST);

async function command(agentId, body) {
  const type = body.type === "heartbeat" ? "heartbeat" : "trade";
  if (type === "heartbeat" && Date.now() < tradePendingUntil) {
    return { decision: "heartbeat_deferred", reason: "trade_pending_challenger", dryRun: body.dryRun !== false };
  }
  const dryRun = body.dryRun !== false;
  const trustedCommand = body.command || TRUSTED_CMD;
  const marketData = body.marketData || "";
  // SOA-lite：用户签署的目标（可选）。携带时进入 L5 目标层；不携带则该层缺席（如实标注）
  const objective = body.objective || null;
  const objectiveSignature = body.objectiveSignature || null;

  // 1) 护栏（对可信指令与外部内容；注入模式 + blocklist）
  const reasons = runGuardrail(`${trustedCommand} ${marketData}`, BLOCKLIST);
  if (reasons.length) return { decision: "blocked_by_guardrail", reasons, dryRun };

  // 2) 意图来源：双 LLM（默认）或显式指定（body.target/body.amount，用于脚本与负例测试）
  let target, amount, data, llmTrace = null;
  const explicit = body.target !== undefined || body.amount !== undefined;
  if (type === "heartbeat") {
    target = String(body.target || WHITELIST[0]);
    amount = 0n;
    data = "0x";
  } else if (explicit) {
    target = String(body.target || WHITELIST[0]);
    amount = BigInt(body.amount ?? "10000000000000000");
    data = body.data || DATA_DEFAULT;
  } else {
    // 双 LLM 管线：这里的输出是【不可信输入】，下面第 2.5 步的 δ 才是判据
    const p = await runLLMPipeline({ trustedCommand, marketData, assets: ASSETS });
    llmTrace = { mode: llmMeta().mode, steps: p.steps, plan: p.plan ?? null };
    if (p.kind !== "intent") {
      return { decision: "refused_by_pipeline", stage: p.stage, reason: p.reason, llm: llmTrace, dryRun };
    }
    target = p.target;
    amount = p.amount;
    data = p.data;
  }

  // 2.5) PACE 确定性策略验证（δ）——LLM 无论如何输出，都在这里被裁决
  let vaultDaily = null;
  if (type !== "heartbeat") {
    const reject = paceVerify({ target, amount, data });
    if (reject) return { decision: "rejected_by_policy", reason: reject, dryRun, llm: llmTrace };
    // 日限预检（与 vault 链上口径一致；读失败则跳过——链上 executeTrade 仍强制执行）
    if (vaultRead) {
      try {
        const blk = await provider.getBlock("latest");
        const today = Math.floor(blk.timestamp / 86400);
        const [dailyLimit, spentToday] = await Promise.all([vaultRead.dailyLimit(), vaultRead.dailySpent(BigInt(today))]);
        vaultDaily = { dailyLimit, spentToday };
        if (amount > dailyLimit - spentToday) {
          return { decision: "rejected_by_policy", reason: "exceeds_daily_limit", dryRun, dailyLimit: dailyLimit.toString(), spentToday: spentToday.toString(), llm: llmTrace };
        }
      } catch { /* vault 不可读，跳过预检 */ }
    }
  }

  // 2.6) SOA-lite 目标层预检（仅当调用方携带签署目标时启用）：与 challenger L5 同判据
  //（tee-runtime/objective.mjs 与 challenger/objective.mjs 两套独立实现，口径由
  //  scripts/parity-check.mjs 守）。放在 PACE 之后：层序与 challenger 一致（PACE 优先）。
  // 这里用本地时钟；challenger 用链上收据 timestamp 独立重做（见 verify.mjs L5）。
  if (type !== "heartbeat" && (objective || objectiveSignature)) {
    const oc = objectivePrecheck({
      objective,
      signature: objectiveSignature,
      action: { target, amount },
      policy: CHALLENGER_POLICY,
      timeSeconds: Math.floor(Date.now() / 1000),
    });
    if (!oc.ok) return { decision: "rejected_by_objective", reasons: oc.reasons, dryRun, llm: llmTrace };
  }

  // 3) 链上状态：prev + 治理登记的护栏哈希
  // RPC 后端是负载均衡池，偶发命中滞后后端返回陈旧值（2026-09-15 实测有后端落后 ~39k 块）；
  // prev 是 digest 预计算与 challenger L4 反向锚定的关键输入，读到旧值会白烧一笔 gas，
  // 故读两次求一致（不一致则以最新一次为准再读，最多 5 次）。
  const onChainGuardrail = await reg.agentGuardrailHash(agentId);
  let prev = await reg.lastReceiptHash(agentId);
  for (let i = 0; i < 4; i++) {
    const again = await reg.lastReceiptHash(agentId);
    if (String(again).toLowerCase() === String(prev).toLowerCase()) break;
    prev = again;
  }
  if (onChainGuardrail === ZERO32) {
    return { decision: "error", reason: "guardrail not registered on-chain (governance must setGuardrailHash first)", dryRun };
  }

  // 4) 摘要（fresh nonce 防重放）
  const nonce = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const fields = buildReceiptFields({ agentId: Number(agentId), type, target, amount, data, guardrailHash: onChainGuardrail, prev, nonce });

  if (dryRun || !wallet) {
  // challenger 离线预览（零 gas）：独立 challenger 进程将对这笔决策说什么
  // 时间源说明：dry-run 无链上收据，只能用本地时钟；真实路径 challenger 一律用
  // 链上收据 timestamp（见 verify.mjs L5）——两者只在 deadline 边界秒级窗口有别。
  const nowSec = Math.floor(Date.now() / 1000);
  const previewVerdict = verifyDecision({
    policy: CHALLENGER_POLICY,
    transcript: { command: trustedCommand, marketData, target, amount: amount.toString(), data, ...(objective ? { objective, objectiveSignature } : {}) },
    receipt: { pdrHash: fields.pdrHash, guardrailHash: onChainGuardrail, executionHash: fields.executionHash, blockHeight: 0, blockHash: ZERO32, nonce, digest: null, prev, timestamp: nowSec },
    dailySpent: vaultDaily ? vaultDaily.spentToday : null,
    agentId: Number(agentId),
  });
  return {
    decision: "approved_preview",
    dryRun: true,
    type,
    target,
    amount: amount.toString(),
    ...fields,
    prev,
    onChainGuardrail,
    hasSigner: !!wallet,
    llm: llmTrace ? { ...llmTrace, ...llmMeta() } : { mode: "explicit", note: "调用方显式指定 target/amount（跳过 LLM）" },
    challenger: {
      agree: previewVerdict.agree,
      response: previewVerdict.response,
      layers: previewVerdict.layers,
      mismatches: previewVerdict.mismatches,
      attestedGuardrailHash: attestedGuardrailHash(CHALLENGER_POLICY),
      note: "on-chain validation 由独立 challenger 进程/机器完成（proposer 不代签）",
    },
  };
}

  // 5) 上链：确保 agentTEE 授权 → 提交（quote 路径优先，onlyTEE 回退）→ transcript 绑定
  tradePendingUntil = Date.now() + 60000; // 在途窗口自愈；正常完成在下方 return 前清零
  const teeAddr = await regWrite.agentTEE(agentId);
  if (teeAddr.toLowerCase() !== wallet.address.toLowerCase()) {
    const authTx = await regWrite.authorizeTEE(agentId, wallet.address);
    await authTx.wait();
  }
  const n = await provider.getBlockNumber();
  const blk = await provider.getBlock(n);
  let tx, quoteInfo = null;
  const quoteUrl = (process.env.QUOTE_URL || "").trim().replace(/\/$/, "");
  if (quoteUrl && type !== "heartbeat") {
    // quote 路径：CVM 生成绑定 semantic digest 的 TDX quote → submitReceiptWithQuote
    //（链上 DCAP 验真 + report_data 绑定本收据；任何人可代提交）
    const res = await fetch(`${quoteUrl}/quote`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reportData: fields.semantic }),
      signal: AbortSignal.timeout(20000), // 坑 #5：fetch 必须带超时
    });
    if (!res.ok) throw new Error(`quote service HTTP ${res.status}`);
    const q = await res.json();
    if (!q.quote) throw new Error("quote service returned no quote");
    quoteInfo = { bytes: (q.quote.length - 2) / 2 };
    tx = await regWrite.submitReceiptWithQuote(agentId, fields.pdrHash, onChainGuardrail, fields.executionHash, nonce, n, blk.hash, false, q.quote);
  } else {
    // 回退：onlyTEE 路径（QUOTE_URL 未配置或心跳）
    tx = await regWrite.submitReceipt(agentId, fields.pdrHash, onChainGuardrail, fields.executionHash, nonce, n, blk.hash, type === "heartbeat");
  }
  const r = await tx.wait();
  // 收据 digest 由合约字段唯一决定，客户端可预计算。tx.wait() 后立即读 lastReceiptHash
  // 可能命中滞后节点（FallbackProvider quorum=1）拿到旧值，曾导致 bindTranscript
  // 假失败 "Not latest receipt"（2026-09-15 实测）。轮询对齐最多 ~5s，正常情况零延迟。
  const expectedDigest = keccak256(abi.encode(
    ["uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32", "bytes32"],
    [agentId, fields.pdrHash, onChainGuardrail, fields.executionHash, n, blk.hash, prev, nonce]
  ));
  let receiptDigest = expectedDigest;
  for (let i = 0; i < 8; i++) {
    const seen = await regWrite.lastReceiptHash(agentId);
    if (String(seen).toLowerCase() === expectedDigest.toLowerCase()) { receiptDigest = seen; break; }
    if (i === 7) throw new Error(`lastReceiptHash 未对齐：chain=${seen} expected=${expectedDigest}（RPC 滞后或并发提交？）`);
    await new Promise((res) => setTimeout(res, 700));
  }

  // 5a) transcript 绑定：决策原文哈希锚到收据（challenger 验证依据；伪造原文必 mismatch）
  // 携带签署目标时，URI 字段改为 aegis://objective/<objectiveHash>：目标摘要随
  // TranscriptBound 事件上链留痕（零合约改动；事件可被任何人索引核对）
  let transcriptHashVal = ZERO32;
  if (type !== "heartbeat") {
    transcriptHashVal = keccak256(abi.encode(
      ["string", "string", "address", "uint256", "bytes"],
      [trustedCommand, marketData, target, amount, data || "0x"]
    ));
    const uri = objective ? `aegis://objective/${objectiveHash(objective)}` : "aegis://orchestrator/decision";
    const bindTx = await regWrite.bindTranscript(agentId, receiptDigest, transcriptHashVal, uri);
    await bindTx.wait();
  }

  // 5b) 决策原文存证（独立 challenger 经 GET /api/decision/:digest 拉取；拉不到 = fail-closed 拒绝）
  const transcript = {
    receiptDigest,
    type,
    command: trustedCommand,
    marketData,
    target,
    amount: amount.toString(),
    data,
    guardrailHash: onChainGuardrail,
    pdrHash: fields.pdrHash,
    executionHash: fields.executionHash,
    nonce,
    blockHeight: n,
    blockHash: blk.hash,
    prev,
    // SOA-lite：签署目标随原文存证（challenger L5 据此验证签名与 ε-最优性）
    ...(objective ? { objective, objectiveSignature, objectiveHash: objectiveHash(objective) } : {}),
    // LLM 决策轨迹（隔离摘要 + 特权输出）随原文存证：challenger 据此判断
    // "模型多经常提出需被 δ 拦截的动作"（论文 §6 语义分歧度量），也便于审计复现
    ...(llmTrace ? { llm: llmTrace } : {}),
    ts: Date.now(),
  };
  // 演示：篡改对外提供的决策原文 → challenger 以链上 executionHash 锚定，
  // preimage 不符 → executionHash_mismatch → response=0 → executeTrade 被金库拒绝
  if (body.tamperTranscript) {
    transcript.amount = (amount + 1n).toString();
    transcript.tampered = true;
  }
  recordDecision(transcript);

  // 6) challenger 预览（离线）：链上 validation 由独立 challenger 进程/机器完成 —— proposer 不代签
  // timestamp 用提交时取的链上块时间（与 challenger 读到的收据 timestamp 同源，秒级接近）
  const verdict = verifyDecision({
    policy: CHALLENGER_POLICY,
    transcript,
    receipt: { digest: receiptDigest, pdrHash: fields.pdrHash, guardrailHash: onChainGuardrail, executionHash: fields.executionHash, blockHeight: n, blockHash: blk.hash, nonce, prev, timestamp: blk.timestamp },
    dailySpent: vaultDaily ? vaultDaily.spentToday : null,
    agentId: Number(agentId),
  });

  // 7) execute 流程（AGENTS 待办#1）：body.execute=true 时等待独立 challenger 链上背书
  //    （response≥100）→ 调用 AegisVaultQuorum.executeTrade（onlyTEE）→ 金库真实转账
  let execution = null;
  if (body.execute && type !== "heartbeat" && vaultWrite) {
    // 等待窗须 < 链上 MAX_BLOCK_AGE（100 块 ≈ 30s @300ms）：isTradeFresh 从收据提交块起算，
    // 慢 challenger 拖过 30s 后 executeTrade 会因 "No fresh trade receipt" revert——白烧 gas。
    const WAIT_MS = Number(process.env.CHALLENGER_WAIT_MS || 20000);
    const deadline = Date.now() + WAIT_MS;
    let response = 0;
    while (Date.now() < deadline) {
      await new Promise((res) => setTimeout(res, 3000));
      try {
        const st = await valRead.getValidationStatus(receiptDigest);
        response = Number(st[2]);
        if (response >= 100) break;
      } catch { /* 轮询失败继续等 */ }
    }
    if (response < 100) {
      execution = { status: "timeout_waiting_challenger", challengerResponse: response, waitedMs: WAIT_MS };
    } else {
      try {
        const execTx = await vaultWrite.executeTrade(target, amount, data || "0x");
        const execR = await execTx.wait();
        const balAfter = await provider.getBalance(QUORUM_VAULT);
        execution = { status: "executed", txHash: execTx.hash, gasUsed: execR.gasUsed.toString(), vaultBalance: balAfter.toString() };
      } catch (e) {
        execution = { status: "execute_failed", error: String(e?.shortMessage || e?.message || e) };
      }
    }
  }

  tradePendingUntil = 0;
  return {
    decision: "approved_onchain",
    dryRun: false,
    type,
    txHash: tx.hash,
    status: r.status,
    gasUsed: r.gasUsed.toString(),
    ...(quoteInfo ? { quote: quoteInfo, submitPath: "submitReceiptWithQuote (DCAP verified)" } : { submitPath: "submitReceipt (onlyTEE fallback)" }),
    transcriptHash: transcriptHashVal,
    newLastReceiptHash: receiptDigest,
    challenger: {
      agree: verdict.agree,
      response: verdict.response,
      layers: verdict.layers,
      mismatches: verdict.mismatches,
      note: "独立 challenger 进程将拉取决策原文并上链 validation（本进程不代签）",
    },
    ...(execution ? { execution } : {}),
    ...(llmTrace ? { llm: llmTrace } : {}),
    ...fields,
    prev,
  };
}

// ---- HTTP ----
// CORS：本进程持有 proposer 私钥且 /api/agent/command 是可写端点（可选真实上链），
// 不能允许任意源跨站调用（浏览器里任何一个页面都能打到 localhost:8787）。
// 默认只放行本地 dashboard；dashboard 生产路径走 Next 同源 rewrite（不经 CORS），
// 此白名单主要服务本地 dev（:3000）。需要别的源用 ALLOWED_ORIGINS 显式加白。
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000,http://127.0.0.1:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

function corsFor(origin) {
  const base = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    Vary: "Origin",
  };
  // 无 Origin = 非浏览器调用（curl / 服务端），不需要 ACAO；命中白名单才回显
  if (origin && ALLOWED_ORIGINS.includes(origin)) return { ...base, "Access-Control-Allow-Origin": origin };
  return base;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const agentId = BigInt(url.searchParams.get("agentId") || "1");
  const cors = corsFor(req.headers.origin);
  const send = (code, body) =>
    res.writeHead(code, { "Content-Type": "application/json", ...cors }).end(JSON.stringify(body));

  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();

  try {
    if (url.pathname === "/api/status") return send(200, await status(agentId));
    if (url.pathname === "/api/receipts") return send(200, await receipts(agentId));

    // 统一入口的配置快照：前端据此渲染"链路当前长什么样"，无需硬编码地址/模型名。
    // 只暴露公开信息（链路地址、模型名、策略边界），绝不返回任何私钥或 API key。
    if (url.pathname === "/api/config" && req.method === "GET") {
      return send(200, {
        agentId: Number(agentId),
        chain: { chainId: 10143, name: "Monad testnet" },
        contracts: {
          receiptRegistry: REGISTRY,
          validationRegistry: process.env.VALIDATION || null,
          vaultQuorum: QUORUM_VAULT || null,
          quoteService: (process.env.QUOTE_URL || "").trim() || null,
        },
        policy: {
          whitelist: WHITELIST,
          perTxLimitMon: Number(PER_TX_LIMIT) / 1e18,
          demoMaxMon: DEMO_MAX_MON,
          blocklist: BLOCKLIST,
          trustedCommand: TRUSTED_CMD,
        },
        trustBoundary: {
          devices: [
            { role: "proposer", name: "Proposer 机器（本机）", holds: ["MONAD_TESTNET_PK"], note: "双 LLM 管线 + 确定性 δ 预览；持有 TEE 私钥，可提交收据" },
            { role: "challenger", name: "Challenger 机器（独立）", holds: ["CHALLENGER_PK"], note: "不共享代码、独立钱包上链 validation；可选 L5 跨家族模型层（默认关闭）" },
            { role: "tee", name: "Phala CVM（TDX）", holds: [], note: "实时生成绑定 digest 的 TDX quote，链上 DCAP 验真" },
          ],
          llmPlacement: "proposer",
        },
      });
    }

    // 机器可读的确定性裁决（δ）评测入口：脚本/CI/Dashboard 用同一批用例打两套实现，
    // 断言 proposer 预览与 challenger 重推导的"拒/放"结论一致（口径漂移即失败）。
    if (url.pathname === "/api/verify" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let b = {};
      try { b = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: "invalid JSON body" }); }
      const cmd = b.command || TRUSTED_CMD;
      const md = b.marketData || "";

      // 未显式给 target/amount 时，走与 /api/agent/command 完全相同的解析路径
      // （否则同一输入在 /api/verify 与 /api/agent/command 会得到不同 target，
      //  Dashboard 会出现"verify 拒绝、command 放行"的自相矛盾展示）。
      // data 也必须取 pipeline 解析值：verify 验证的字节必须等于执行的字节。
      let target, amount, data, resolvedBy;
      if (b.target !== undefined || b.amount !== undefined) {
        target = String(b.target || WHITELIST[0]).toLowerCase();
        amount = BigInt(b.amount ?? "0");
        data = b.data || DATA_DEFAULT;
        resolvedBy = "explicit";
      } else {
        const p = await runLLMPipeline({ trustedCommand: cmd, marketData: md, assets: ASSETS });
        if (p.kind !== "intent") {
          return send(200, {
            command: cmd, marketData: md, resolvedBy: "pipeline",
            proposer: { verdict: "reject", guardrail: [], pace: `refused_by_pipeline:${p.stage}` },
            challenger: null, agree: null,
            note: `pipeline refused before δ: ${p.reason}`,
          });
        }
        target = String(p.target).toLowerCase();
        amount = p.amount;
        data = p.data;
        resolvedBy = "pipeline";
      }

      const guardrail = runGuardrail(`${cmd} ${md}`, BLOCKLIST);
      const pace = paceVerify({ target, amount, data });
      const proposerVerdict = guardrail.length || pace ? "reject" : "accept";

      // challenger 侧：用其自持策略在本地跑同一套独立实现（只读、零 gas、不签名）
      let challengerVerdict = null;
      let challengerDetail = null;
      try {
        const nonce = "0x" + "11".repeat(32);
        const v = verifyDecision({
          policy: CHALLENGER_POLICY,
          transcript: { command: cmd, marketData: md, target, amount: amount.toString(), data },
          receipt: { pdrHash: ZERO32, guardrailHash: attestedGuardrailHash(CHALLENGER_POLICY), executionHash: ZERO32, blockHeight: 0, blockHash: ZERO32, nonce, digest: null, prev: ZERO32 },
          dailySpent: null,
          agentId: Number(agentId),
        });
        challengerVerdict = v.agree ? "accept" : "reject";
        challengerDetail = { layers: v.layers, mismatches: v.mismatches };
      } catch (e) {
        challengerDetail = { error: String(e?.message || e) };
      }

      return send(200, {
        input: { command: cmd, marketData: md, target, amount: amount.toString(), data },
        resolvedBy,
        proposer: { verdict: proposerVerdict, guardrail, pace },
        challenger: { verdict: challengerVerdict, ...challengerDetail },
        agree: challengerVerdict === null ? null : challengerVerdict === proposerVerdict,
      });
    }

    // 只读探针：看双 LLM 会提出什么 + δ 会不会放行（零 gas、不写链、不留痕）
    if (url.pathname === "/api/pipeline" && req.method === "GET") {
      const cmd = url.searchParams.get("command") || TRUSTED_CMD;
      const md = url.searchParams.get("marketData") || "";
      const p = await runLLMPipeline({ trustedCommand: cmd, marketData: md, assets: ASSETS });
      const out = { llm: llmMeta(), command: cmd, marketData: md, kind: p.kind, stage: p.stage, reason: p.reason, steps: p.steps };
      if (p.kind === "intent") {
        out.intent = { target: p.target, amount: p.amount.toString(), data: p.data };
        out.guardrail = runGuardrail(`${cmd} ${md}`, BLOCKLIST);
        out.pace = paceVerify({ target: p.target, amount: p.amount, data: p.data });
        out.deltaVerdict = out.guardrail.length === 0 && !out.pace ? "accept" : "reject";
      }
      return send(200, out);
    }

    // SOA-lite：目标草案（draft-then-sign 的 draft 半步，零 gas）。
    // 返回未签名目标草案；签名在任何涉及资金的地方之外完成（scripts/soa-sign.mjs 或钱包）。
    if (url.pathname === "/api/objective/draft" && req.method === "POST") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      let b = {};
      try { b = raw ? JSON.parse(raw) : {}; } catch { return send(400, { error: "invalid JSON body" }); }
      const cmd = b.command || TRUSTED_CMD;
      const md = b.marketData || "";
      const d = await draftObjective({ trustedCommand: cmd, marketData: md, assets: ASSETS });
      if (d.kind !== "objective") {
        return send(200, { kind: d.kind, stage: d.stage, reason: d.reason, llm: llmMeta(), steps: d.steps });
      }
      return send(200, {
        kind: "objective",
        command: cmd,
        marketData: md,
        asset: d.asset,
        target: d.target,
        draft: d.draft, // 未签名：user 字段待签署方填入
        llm: llmMeta(),
        steps: d.steps,
        note: "draft 尚未签名，无任何效力；签署流程：填入 user 字段 → EIP-191 签 canonical JSON → 随 /api/agent/command 提交",
      });
    }

    if (url.pathname.startsWith("/api/decision/") && req.method === "GET") {
      const hash = url.pathname.slice("/api/decision/".length).toLowerCase();
      const d = decisions.get(hash);
      return d
        ? send(200, { found: true, transcript: d })
        : send(404, { found: false, error: "no transcript for this receipt — challenger fails closed (no transcript, no signature)" });
    }

    if (url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", ...cors, "Cache-Control": "no-cache" });
      const tick = async () => {
        try {
          res.write(`event: status\ndata: ${JSON.stringify(await status(agentId))}\n\n`);
        } catch {
          /* ignore */
        }
      };
      tick();
      const id = setInterval(tick, 5000);
      req.on("close", () => clearInterval(id));
      return;
    }

    if (url.pathname === "/api/agent/command" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        return send(400, { error: "invalid JSON body" });
      }
      return send(200, await command(agentId, parsed));
    }

    send(404, { error: "not found" });
  } catch (e) {
    console.error("[orchestrator] request error:", e?.shortMessage || e?.message || e);
    send(500, { error: String(e?.shortMessage || e?.message || e) });
  }
});

server.listen(PORT, () =>
  console.log(`[orchestrator] http://localhost:${PORT}  rpc=${RPC_LIST[0]}(+${RPC_LIST.length - 1})  signer=${wallet ? wallet.address : "none(dryRun only)"}`)
);
