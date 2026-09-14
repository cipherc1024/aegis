// Aegis Orchestrator（零依赖）：链上状态/收据/事件流 + 写侧（决策管线 → 上链 → 决策原文存证）
// 角色分离：本进程只当 proposer —— 链上 validation 一律由独立 challenger 进程
//（challenger/challenger-agent.mjs，部署在另一台机器）完成；本进程仅提供决策原文
// GET /api/decision/:digest 与离线预览，不持有 challenger 私钥。
// 运行: node orchestrator/server.mjs   （在 aegis/ 目录）
import http from "node:http";
import fs from "node:fs";
import { JsonRpcProvider, FallbackProvider, Wallet, Contract, keccak256, toUtf8Bytes, AbiCoder } from "ethers";
import { verifyDecision, attestedGuardrailHash } from "../challenger/verify.mjs";
import { runLLMPipeline, llmMeta, DATA_DEFAULT, assetMap } from "./pipeline.mjs";

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
const REGISTRY = process.env.REGISTRY || "0x91482e67998a01C0A33Fe12ec01A6A43177A7181";
const PER_TX_LIMIT = BigInt(process.env.PER_TX_LIMIT || "50000000000000000"); // 0.05 MON
const WHITELIST = (process.env.WHITELIST || "0x000000000000000000000000000000000000beef").split(",").map((x) => x.toLowerCase());
const BLOCKLIST = (process.env.BLOCKLIST || "evil.com,attacker,drain,ignore previous").split(",").filter(Boolean);
const TRUSTED_CMD = process.env.TRUSTED_CMD || "buy USDC 0.01";
// 单笔上限：链上合约可执行的最大金额（cap）与对外展示的「评审可试输入」上限分开。
// 原因：校园网关的免费模型延迟常在 20-40s 甚至超时，demo 需要更小的默认金额
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
  const dryRun = body.dryRun !== false;
  const trustedCommand = body.command || TRUSTED_CMD;
  const marketData = body.marketData || "";

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

  // 3) 链上状态：prev + 治理登记的护栏哈希
  const [prev, onChainGuardrail] = await Promise.all([
    reg.lastReceiptHash(agentId),
    reg.agentGuardrailHash(agentId),
  ]);
  if (onChainGuardrail === ZERO32) {
    return { decision: "error", reason: "guardrail not registered on-chain (governance must setGuardrailHash first)", dryRun };
  }

  // 4) 摘要（fresh nonce 防重放）
  const nonce = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const fields = buildReceiptFields({ agentId: Number(agentId), type, target, amount, data, guardrailHash: onChainGuardrail, prev, nonce });

  if (dryRun || !wallet) {
  // challenger 离线预览（零 gas）：独立 challenger 进程将对这笔决策说什么
  const previewVerdict = verifyDecision({
    policy: CHALLENGER_POLICY,
    transcript: { command: trustedCommand, marketData, target, amount: amount.toString(), data },
    receipt: { pdrHash: fields.pdrHash, guardrailHash: onChainGuardrail, executionHash: fields.executionHash, blockHeight: 0, blockHash: ZERO32, nonce, digest: null, prev },
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
  const receiptDigest = await regWrite.lastReceiptHash(agentId);

  // 5a) transcript 绑定：决策原文哈希锚到收据（challenger 验证依据；伪造原文必 mismatch）
  let transcriptHashVal = ZERO32;
  if (type !== "heartbeat") {
    transcriptHashVal = keccak256(abi.encode(
      ["string", "string", "address", "uint256", "bytes"],
      [trustedCommand, marketData, target, amount, data || "0x"]
    ));
    const bindTx = await regWrite.bindTranscript(agentId, receiptDigest, transcriptHashVal, "aegis://orchestrator/decision");
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
  const verdict = verifyDecision({
    policy: CHALLENGER_POLICY,
    transcript,
    receipt: { digest: receiptDigest, pdrHash: fields.pdrHash, guardrailHash: onChainGuardrail, executionHash: fields.executionHash, blockHeight: n, blockHash: blk.hash, nonce, prev },
    dailySpent: vaultDaily ? vaultDaily.spentToday : null,
    agentId: Number(agentId),
  });

  // 7) execute 流程（AGENTS 待办#1）：body.execute=true 时等待独立 challenger 链上背书
  //    （response≥100）→ 调用 AegisVaultQuorum.executeTrade（onlyTEE）→ 金库真实转账
  let execution = null;
  if (body.execute && type !== "heartbeat" && vaultWrite) {
    const WAIT_MS = Number(process.env.CHALLENGER_WAIT_MS || 45000);
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
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const agentId = BigInt(url.searchParams.get("agentId") || "1");
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
            { role: "challenger", name: "Challenger 机器（独立）", holds: ["CHALLENGER_PK"], note: "不共享代码、不共享模型家族；独立钱包上链 validation" },
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
    send(500, { error: String(e?.shortMessage || e?.message || e) });
  }
});

server.listen(PORT, () =>
  console.log(`[orchestrator] http://localhost:${PORT}  rpc=${RPC_LIST[0]}(+${RPC_LIST.length - 1})  signer=${wallet ? wallet.address : "none(dryRun only)"}`)
);
