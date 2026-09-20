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
//
// 多 agent 的金库寻址：合约里 agentId 是 immutable，一个金库只服务一个 agent
//（vault.agentId() 是权威判据，不是 env 里的数字）。故按 agent 分派：
//   QUORUM_VAULT_<agentId>  显式覆盖（部署第二个 agent 的金库后加进 .env）
//   QUORUM_VAULT            仅当链上 vault.agentId() 与该 agent 相符时才认
// 不做"猜地址"——未配置的 agent 一律如实返回 configured:false，前端显示"无金库"。
function vaultAddrFor(agentId) {
  const id = Number(agentId);
  const specific = process.env[`QUORUM_VAULT_${id}`];
  if (specific) return specific;
  if (!QUORUM_VAULT) return "";
  return id === DEFAULT_VAULT_AGENT_ID ? QUORUM_VAULT : "";
}
const QUORUM_VAULT = process.env.QUORUM_VAULT || "";
// 未在 .env 显式标注归属时，默认金库服务哪个 agent（v4 部署时 agentId=1）
const DEFAULT_VAULT_AGENT_ID = Number(process.env.VAULT_AGENT_ID || 1);
// 金库完整读 ABI：Dashboard 的 /funds、/vaults、/console 都从这份读回真实状态
const VAULT_ABI = [
  "function owner() view returns (address)",
  "function agentId() view returns (uint256)",
  "function registry() view returns (address)",
  "function validationRegistry() view returns (address)",
  "function teeDerivedAddress() view returns (address)",
  "function whitelistedTargets(address) view returns (bool)",
  "function perTxLimit() view returns (uint256)",
  "function dailyLimit() view returns (uint256)",
  "function dailySpent(uint256) view returns (uint256)",
  "function tradingFrozen() view returns (bool)",
  "function trustedValidatorCount() view returns (uint256)",
  "function isTrustedValidator(address) view returns (bool)",
];
const vaultRead = QUORUM_VAULT ? new Contract(QUORUM_VAULT, VAULT_ABI, provider) : null;
// vault 写侧：execute 流程（proposer=TEE 钱包调用 executeTrade；AGENTS 待办#1）
// + 治理写路径（/api/admin/*）：全部 onlyOwner=主钱包，需前端二次确认后才发
const vaultWrite = wallet && QUORUM_VAULT
  ? new Contract(
      QUORUM_VAULT,
      [
        "function executeTrade(address,uint256,bytes)",
        "function deposit() payable",
        "function withdraw(uint256)",
        "function setLimits(uint256,uint256)",
        "function setTarget(address,bool)",
        "function setTEE(address)",
        "function emergencyPause()",
        "function resumeTrading()",
        "function setTrustedValidator(address,bool)",
      ],
      wallet
    )
  : null;
// ERC-8004 身份注册表（自部署；permissionless register → 每个 agent 有独立 agentId）
const IDENTITY = process.env.IDENTITY || "0xC99D2957fdA1455E68dF2181A4bB97fd73081A74";
const IDENTITY_ABI = [
  "function lastId() view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function tokenURI(uint256) view returns (string)",
  "function agentWallet(uint256) view returns (address)",
  "function register(string agentURI) returns (uint256)",
];
const idRead = new Contract(IDENTITY, IDENTITY_ABI, provider);
const idWrite = wallet ? new Contract(IDENTITY, IDENTITY_ABI, wallet) : null;
const valRead = new Contract(process.env.VALIDATION || "0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa", [
  "function getValidationStatus(bytes32) view returns (address,uint256,uint8,bytes32,string,uint256)",
], provider);

// ---- 角色分离：本进程只当 proposer。链上 validation 一律由独立 challenger 进程
//      （challenger/challenger-agent.mjs，部署在另一台机器）完成；本进程不持有 challenger 私钥。
// challenger 自持策略（与 challenger/ 打包同源；attest 见 challenger/policy-attest.mjs）。
// 多 agent：challenger-policy-<id>.json 优先，回落 challenger-policy.json（当 id == 1）。
const POLICY_DIR = new URL("../challenger/", import.meta.url);
const policyCache = new Map();
function challengerPolicy(agentId = 1) {
  const id = Number(agentId);
  if (policyCache.has(id)) return policyCache.get(id);
  const files = [
    new URL(`challenger-policy-${id}.json`, POLICY_DIR),
    id === 1 ? new URL("challenger-policy.json", POLICY_DIR) : null,
  ].filter(Boolean);
  let pol = null;
  for (const f of files) {
    if (!fs.existsSync(f)) continue;
    pol = JSON.parse(fs.readFileSync(f, "utf8"));
    pol.__file = f.pathname.split("/").pop();
    break;
  }
  policyCache.set(id, pol);
  return pol;
}
const CHALLENGER_POLICY = challengerPolicy(1);

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
// 金库真实状态：Dashboard /funds、/vaults、/console 的唯一数据源。
// 余额与日限用量都必须从链上读（此前的 mock 数字一律作废）。
async function vaultState(agentId = 1) {
  const addr = vaultAddrFor(agentId);
  if (!addr) {
    return {
      configured: false,
      note: `agentId ${Number(agentId)} 无金库：AegisVaultQuorum 的 agentId 是 immutable，一个金库只服务一个 agent。部署后把地址写进 .env 的 QUORUM_VAULT_${Number(agentId)}。`,
    };
  }
  const vr = new Contract(addr, VAULT_ABI, provider);
  const [blk, owner, agentIdOnChain, tee, perTx, daily, frozen, tvCount] = await Promise.all([
    provider.getBlock("latest"),
    vr.owner(),
    vr.agentId(),
    vr.teeDerivedAddress(),
    vr.perTxLimit(),
    vr.dailyLimit(),
    vr.tradingFrozen(),
    vr.trustedValidatorCount(),
  ]);
  const today = Math.floor(blk.timestamp / 86400);
  const [spentToday, monBal] = await Promise.all([vr.dailySpent(BigInt(today)), provider.getBalance(addr)]);
  // 白名单标的逐个读余额：MON 读 vault 自身；ERC-20 读 token.balanceOf(vault)
  const targets = [];
  for (const [sym, token] of Object.entries(ASSETS)) {
    const a = String(token).toLowerCase();
    let balance = null, kind = "unknown";
    if (a === String(addr).toLowerCase()) {
      balance = monBal.toString();
      kind = "native";
    } else {
      try {
        const erc20 = new Contract(a, ["function balanceOf(address) view returns (uint256)", "function decimals() view returns (uint8)", "function symbol() view returns (string)"], provider);
        const [bal, dec, onchainSym] = await Promise.all([erc20.balanceOf(addr), erc20.decimals(), erc20.symbol()]);
        balance = bal.toString();
        kind = "erc20";
        targets.push({ symbol: onchainSym || sym, address: a, whitelisted: true, kind, balance, decimals: Number(dec) });
        continue;
      } catch {
        kind = "unreadable";
      }
    }
    targets.push({ symbol: sym, address: a, whitelisted: true, kind, balance, decimals: 18 });
  }
  // 对每个白名单地址读链上开关（白名单是 per-address bool，与 ASSETS 表可能不同步）
  for (const t of targets) {
    try { t.whitelisted = await vr.whitelistedTargets(t.address); } catch { t.whitelisted = null; }
  }
  return {
    configured: true,
    address: addr,
    owner,
    agentId: Number(agentIdOnChain),
    teeDerivedAddress: tee,
    frozen,
    balanceMon: monBal.toString(),
    balanceMonHuman: Number(monBal) / 1e18,
    perTxLimit: perTx.toString(),
    dailyLimit: daily.toString(),
    dailySpentToday: spentToday.toString(),
    dailyRemaining: (daily - spentToday > 0n ? daily - spentToday : 0n).toString(),
    dailyWindowDay: today,
    trustedValidatorCount: Number(tvCount),
    targets,
  };
}

/**
 * 金库清单（/vaults）：对每个已注册 agent 给出"有没有金库"的结论。
 *
 * 链上没有"按 agentId 查金库"的索引——AddressRegistry 之类不存在，金库地址
 * 只在部署 tx 里。故只能拿我们知道的候选地址逐个读它的 `agentId()` immutable
 * 回比（地址归谁由链上说了算，不由 .env 说了算）。候选 = .env 里配置的
 * QUORUM_VAULT 与所有 QUORUM_VAULT_<n>。
 */
async function vaultList() {
  const idState = await identityState();
  const candidates = [];
  if (QUORUM_VAULT) candidates.push({ source: "QUORUM_VAULT", address: QUORUM_VAULT });
  for (const [k, v] of Object.entries(process.env)) {
    const m = k.match(/^QUORUM_VAULT_(\d+)$/);
    if (m && v) candidates.push({ source: k, address: v, declaredAgentId: Number(m[1]) });
  }
  // 去重（同一地址可能同时以两种方式配置）
  const seen = new Set();
  const uniq = candidates.filter((c) => {
    const lc = c.address.toLowerCase();
    if (seen.has(lc)) return false;
    seen.add(lc);
    return true;
  });

  const rows = [];
  const unrouted = [];
  for (const a of idState.agents) {
    const match = uniq.find((c) => c.declaredAgentId === a.agentId);
    let vault = null;
    if (match) {
      vault = { address: match.address, source: match.source };
    } else {
      // 未显式声明归属时，逐个候选读链上 agentId 回比
      for (const c of uniq) {
        if (c.declaredAgentId !== undefined) continue;
        try {
          const v = new Contract(c.address, VAULT_ABI, provider);
          const onchainAgentId = Number(await v.agentId());
          if (onchainAgentId === a.agentId) { vault = { address: c.address, source: c.source }; break; }
          unrouted.push({ address: c.address, source: c.source, onchainAgentId, seenForAgentId: a.agentId });
        } catch { /* 非金库地址/读失败：跳过 */ }
      }
    }
    let state = null;
    if (vault) {
      // 读失败与"没有金库"是两回事：前者是 RPC 抖动/限流（金库确实存在），后者是
      // 事实。若把读失败也渲染成 vault:null，页面会显示"无金库"——那是编造结论。
      // 故这里把读失败做成一个 distinction 字段，前端据此显示"读取失败"而非"无金库"。
      try {
        state = await vaultState(a.agentId);
      } catch (e) {
        state = { configured: false, readError: String(e?.shortMessage || e?.message || e) };
      }
    }
    rows.push({
      ...a,
      vault: vault ? { ...vault, ...(state?.configured ? state : {}), configured: !!state?.configured, readError: state?.readError ?? null } : null,
      vaultNote: vault
        ? (state?.readError ? `金库地址已匹配，但状态读取失败：${state.readError}` : state?.note ?? null)
        : "未配置金库（合约 agentId immutable → 每个 agent 需独立部署一个 AegisVaultQuorum）",
    });
  }
  // 去重：同一个候选地址会对着每个 agent 各读一次
  const unroutedUniq = [];
  const unroutedSeen = new Set();
  for (const u of unrouted) {
    const key = `${u.address.toLowerCase()}#${u.onchainAgentId}`;
    if (unroutedSeen.has(key)) continue;
    unroutedSeen.add(key);
    unroutedUniq.push(u);
  }
  return {
    scan: {
      candidates: uniq.map((c) => ({ source: c.source, address: c.address, declaredAgentId: c.declaredAgentId ?? null })),
      unroutedCandidates: unroutedUniq,
      note: "链上无 agentId→vault 索引；本清单靠「读候选地址的 agentId() 回比」得出。未列出的金库地址无法被本进程发现。",
    },
    lastId: idState.lastId,
    vaults: rows,
  };
}

// 身份注册表：/market、/create、/vaults 共用。permissionless register 意味着
// agentId 会真实增长；这里如实返回全部（含非本团队注册的）。
async function identityState(limit = 50) {
  const lastId = Number(await idRead.lastId());
  const agents = [];
  for (let i = 1; i <= Math.min(lastId, limit); i++) {
    try {
      const [owner, uri, wal] = await Promise.all([idRead.ownerOf(BigInt(i)), idRead.tokenURI(BigInt(i)), idRead.agentWallet(BigInt(i))]);
      agents.push({ agentId: i, owner, agentWallet: wal, tokenURI: uri });
    } catch {
      agents.push({ agentId: i, owner: null, agentWallet: null, tokenURI: null, note: "unreadable" });
    }
  }
  return { lastId, agents };
}

/**
 * 执行统计（/api/exec-stats）：把收据流聚合成"这套系统实际做了什么"的计数。
 *
 * 与"策略回测"的区别必须说清：回测要的是**假想的收益曲线**（需要价格数据 +
 * 历史行情重放），本系统不产生，链上也没有价格字段。这里统计的是**执行事实**——
 * 提交了多少收据、多少笔交易收到了 challenger 的独立背书、背书是同意(100)还是
 * 拒绝(0)。这些都是链上可逐笔核对的，不是估算。
 *
 * validation 状态直读 ValidationRegistry.getValidationStatus(receiptDigest)：
 * requestHash 就是收据 digest（见 AegisVaultQuorum._preExecutionHook 口径）。
 */
async function execStats(agentId = 1) {
  const id = Number(agentId);
  const list = await receipts(id); // 复用索引器 + 尾扫的同一份数据，不另开扫描路径
  const rows = [];
  for (const r of list) {
    let validation = null;
    try {
      // requestHash = 收据 digest（与 AegisVaultQuorum 钩子同口径）。索引器/尾扫
      // 目前只带 receiptHash —— ReceiptRegistry 的 ReceiptSubmitted 事件第一个
      // data word 就是 digest，故 receiptHash 即 digest。
      // 返回序（**不是** response,status）：(validator, agentId, response,
      // responseHash, tag, lastUpdate)。response 是 uint8 的 0/100 裁决值
      //（≥100 放行，见 AegisVaultQuorum.MIN_RESPONSE），agentId 是链上记账的
      // agentId；未被请求过的 requestHash 返回全零（validator=0,response=0）。
      const st = await valRead.getValidationStatus(r.receiptHash);
      const validator = String(st[0]);
      const response = Number(st[2]);
      const requested = validator !== "0x0000000000000000000000000000000000000000";
      validation = {
        validator,
        agentId: Number(st[1]),
        response,
        tag: String(st[4]),
        /** 有人对该 requestHash 发过 validationRequest（否则链上查无此请求） */
        requested,
        /** 已裁决 = 有请求且 response 非零 */
        responded: requested && response > 0,
      };
    } catch {
      validation = null; // 读失败如实置 null，不假装"未验证"
    }
    rows.push({ ...r, validation });
  }
  const trades = rows.filter((r) => !r.isHeartbeat);
  const responded = trades.filter((r) => r.validation?.responded);
  const agreed = responded.filter((r) => r.validation.response >= 100);
  const rejected = responded.filter((r) => r.validation.response < 100);
  return {
    agentId: id,
    receiptsTotal: rows.length,
    heartbeats: rows.length - trades.length,
    tradesSubmitted: trades.length,
    validated: responded.length,
    agreed: agreed.length,
    rejected: rejected.length,
    // 有收据但 challenger 尚未背书：可能是"在途"，也可能是"读不到状态"。两者
    // 都是"未完成背书"，合计数不区分；逐行的 validation 字段可区分（null=读失败）。
    pendingValidation: trades.length - responded.length,
    firstBlock: rows.length ? Math.min(...rows.map((r) => r.blockHeight)) : null,
    lastBlock: rows.length ? Math.max(...rows.map((r) => r.blockHeight)) : null,
    note:
      "这是执行事实的计数（链上可逐笔核对），不是收益回测。本系统不产生收益率/回撤/胜率——" +
      "那需要价格数据管道，链上没有价格字段。validation 状态直读 ValidationRegistry。" +
      "requestHash = 收据 digest（与 AegisVaultQuorum 钩子同口径）。",
    rows,
  };
}
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

// 实时尾扫结果的内存缓存。尾扫本身很贵：20 个 100 块窗口串行 ≈12s（实测 432ms/窗口），
// 而扫最近 2000 块通常命中 0 条 —— 若在每个 /api/receipts 请求里同步跑，端到端要 10–14s，
// 前端 30s 超时一旦抖动就落空，页面显示"离线"（缓存里明明有收据）。
// 故改为：请求只读这份缓存（立即返回），尾扫由 refreshTail() 在后台按 TTL 刷新。
let tailCache = [];      // 最近一次尾扫命中的收据
let tailAt = 0;          // 上次刷新时刻
let tailBusy = false;    // 防止并发刷新叠加
const TAIL_TTL_MS = Number(process.env.RECEIPTS_TAIL_TTL_MS || "60000");
const TAIL_SPAN = 2000;  // 尾扫覆盖的块数（与旧行为一致）

async function refreshTail(agentId) {
  if (tailBusy) return;
  const now = Date.now();
  if (now - tailAt < TAIL_TTL_MS) return;
  tailBusy = true;
  try {
    const found = [];
    const latest = await provider.getBlockNumber();
    for (let s = Math.max(0, latest - TAIL_SPAN); s < latest; s += 100) {
      try {
        const logs = await reg.queryFilter(reg.filters.ReceiptSubmitted(agentId), s, Math.min(s + 99, latest));
        for (const l of logs) {
          found.push({ receiptHash: l.args.receiptHash, blockHeight: Number(l.args.blockHeight), isHeartbeat: l.args.isHeartbeat, txHash: l.transactionHash });
        }
      } catch {}
    }
    tailCache = found;
    tailAt = Date.now();
  } catch {
    // 刷失败就保留旧缓存，不把端点打成离线
  } finally {
    tailBusy = false;
  }
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
  // 2) 尾扫缓存（不阻塞：本次请求用旧值，后台按 TTL 刷新）
  for (const r of tailCache) {
    const key = String(r.receiptHash);
    if (!seen.has(key)) { seen.add(key); out.push(r); }
  }
  void refreshTail(agentId);
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

// ⚠️ 本表必须与 challenger/verify.mjs 的 INJECTION_PATTERNS 逐条一致。
// 模式需容忍 leet 折叠产物（"a11" -> "aii"）——否则混淆注入会漏判且两侧结论漂移。
// scripts/parity-check.mjs 对每条模式都有一个用例（injection-* 前缀），少一条就会 DIFF。
const INJECTION_PATTERNS = [
  /ignore (a[il1]+ )?previous/,   // all / aii（1->i 折叠产物）/ ali
  /disregard .*instruction/,
  /you are now/,
  /system prompt/,
  /urgent.*(swap|transfer|send) (a[il1]+|everything)/,
];

function runGuardrail(text, blocklist) {
  // ⚠️ 先规范化 text 再匹配：否则零宽字符/大小写混淆可绕过 blocklist
  // （例如 "ev\u200Bil.com" 不含子串 "evil.com"，但去零宽后就是它）
  const t = norm(text);
  const reasons = [];
  for (const re of INJECTION_PATTERNS) if (re.test(t)) reasons.push("injection_pattern");
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

// ---- 治理写路径（/api/admin/*）----
// 本进程已持有 owner 私钥（= TEE = proposer = 部署者），Dashboard 的治理按钮直接复用它。
// 防护面：仅 ALLOWED_ORIGINS 白名单（浏览器侧）+ 本机可达（listen 未绑定外部网卡）。
// 所有动钱/改权限的调用都要求 body.confirm === true；不带 confirm 时只做 dryRun：
// 返回目标地址、calldata、预估 gas、gas 价格与预估费用，不广播任何交易。
const OPS = {
  deposit: { label: "金库注资（MON）", build: (v, b) => ({ args: [], overrides: { value: BigInt(b.amount) } }) },
  withdraw: { label: "金库提取（MON）", build: (v, b) => ({ args: [BigInt(b.amount)] }) },
  "set-limits": { label: "设置 PACE 限额", build: (v, b) => ({ args: [BigInt(b.perTx), BigInt(b.daily)] }) },
  "set-target": { label: "白名单标的开关", build: (v, b) => ({ args: [b.target, b.allowed === true] }) },
  pause: { label: "紧急暂停交易", build: () => ({ args: [] }) },
  resume: { label: "恢复交易", build: () => ({ args: [] }) },
  "trusted-validator": { label: "challenger 验证者白名单", build: (v, b) => ({ args: [b.validator, b.trusted === true] }) },
  "set-tee": { label: "更换 TEE 地址", build: (v, b) => ({ args: [b.tee] }) },
};
// 治理侧把「被认证的 guardrailHash」设上链。这是策略变更的最后一环：
// 本进程只负责把 hash 发上链，hash 由 challenger 自持策略文件算得
//（attestedGuardrailHash，见 challenger/verify.mjs）——即"认证"发生在 challenger 侧，
// 不是在本进程里凭空造一个 hash。故本 op 的输入是 policyHash 来源而非任意 bytes32。
const REGISTRY_WRITE_ABI = [
  "function agentGuardrailHash(uint256) view returns (bytes32)",
  "function setGuardrailHash(uint256,bytes32)",
];

// 把 agentId 的「链上 guardrailHash」对齐到 challenger 自持策略文件算出的值。
// 语义要点（前端必须如实呈现，别把它说成"改策略"）：
//   本操作**不修改任何策略内容**——它只是把"challenger 已经按 N 号策略文件计算出的 hash"
//   写进 ReceiptRegistry。真正的策略内容在 challenger/challenger-policy-<id>.json，
//   改那个文件需要人（或另一个进程）去改，本进程只读不写。
// 因此本 op 的合法输入 = 策略文件的当前内容；若链上已等于该值则拒绝发交易（幂等）。
async function attestGuardrailOp(body) {
  if (!wallet) return { error: "no signer configured (MONAD_TESTNET_PK unset)" };
  const aid = Number(body.agentId ?? DEFAULT_VAULT_AGENT_ID);
  const pol = challengerPolicy(aid);
  if (!pol) {
    return { error: `agentId ${aid} 无 challenger 策略文件（challenger-policy-${aid}.json）`, hint: "先创建策略文件；没有策略文件的 agent，challenger 会跳过它、不签发 validation。" };
  }
  const attested = attestedGuardrailHash(pol);
  const regW = new Contract(REGISTRY, REGISTRY_WRITE_ABI, provider);
  const onChain = await regW.agentGuardrailHash(aid);
  const inSync = String(attested).toLowerCase() === String(onChain).toLowerCase();

  if (inSync && body.confirm === true) {
    return { error: "链上 guardrailHash 已等于该策略文件的认证值，无需交易（幂等）", hint: `attested=${attested}` };
  }
  const fn = regW.connect(wallet).setGuardrailHash;
  const args = [aid, attested];
  const gas = await fn.estimateGas(...args);
  const fee = await provider.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const preview = {
    op: "attest-guardrail",
    label: `认证 agentId ${aid} 的策略哈希`,
    target: REGISTRY,
    signer: wallet.address,
    args: [String(aid), attested],
    value: "0",
    gasLimit: gas.toString(),
    gasPrice: gasPrice.toString(),
    estimatedFeeMon: Number(gas * gasPrice) / 1e18,
    signerBalanceMon: Number(await provider.getBalance(wallet.address)) / 1e18,
    policyFile: pol.__file,
    attestedGuardrailHash: attested,
    onChainGuardrailHash: onChain,
    inSync,
    sideEffects: [
      "只写 ReceiptRegistry 的 agentGuardrailHash —— 不改动任何策略内容（策略内容在 challenger 侧文件里）",
      inSync
        ? "链上已是该值：确认后会因合约拒绝而 revert（本进程已在下发前拦截）"
        : "新收据将携带新 guardrailHash；旧收据的 guardrailHash 仍是旧值，不影响历史收据的链上可核验性",
      "challenger 的 L1 层以此值为权威：链上与策略文件不一致时，challenger 拒绝该 agent 的所有收据",
    ],
  };
  if (body.confirm !== true) return { dryRun: true, preview, note: "未广播。确认请带 confirm:true。" };
  const tx = await fn(...args);
  const r = await tx.wait();
  const after = await regW.agentGuardrailHash(aid);
  return { dryRun: false, preview, txHash: tx.hash, status: r.status, gasUsed: r.gasUsed.toString(), onChainGuardrailHash: after };
}

async function adminOp(op, body) {
  // 特例：认证 guardrailHash 写的是 ReceiptRegistry，不是金库，故不走 vaultWrite 分支，
  // 也不在 OPS 表里（OPS 的 build 语义是"金库 calldata 参数"）。
  if (op === "attest-guardrail") return attestGuardrailOp(body);
  const spec = OPS[op];
  if (!spec) return { error: `unknown admin op: ${op}`, available: [...Object.keys(OPS), "attest-guardrail"] };
  if (!vaultWrite) return { error: "vault write not available (QUORUM_VAULT unset or no signer)" };
  // 非浏览器调用者（脚本）不在 ALLOWED_ORIGINS 防护内，这里额外要求显式 confirm。
  // 所有 op 都对应链上 onlyOwner —— 除 owner 私钥持有者外任何人调用都会 revert。
  let call;
  try {
    call = spec.build(vaultWrite, body);
    // 参数校验前置：BigInt()/地址解析失败在这里就返回 400，不进 estimateGas
    if (!Array.isArray(call.args)) throw new Error("args must be an array");
  } catch (e) {
    return { error: `bad params: ${String(e?.message || e)}` };
  }
  const fnName = { pause: "emergencyPause", resume: "resumeTrading", "set-tee": "setTEE", "trusted-validator": "setTrustedValidator", "set-target": "setTarget", "set-limits": "setLimits" }[op] || op;
  const fn = vaultWrite.getFunction(fnName);
  // estimateGas 也可能是 revert 的来源（例如合约里的 "No change" 幂等拒绝）——
  // 把它当参数错误回 400，不要让 500 堆栈盖住合约已经说清楚的原因。
  let gas;
  try {
    gas = await fn.estimateGas(...call.args, ...(call.overrides ? [call.overrides] : []));
  } catch (e) {
    const reason = e?.revert?.args?.[0] || e?.shortMessage || e?.message || String(e);
    return { error: `estimateGas failed: ${reason}`, op, hint: "若为 \"No change\"，说明链上状态已与请求一致，无需重发。" };
  }
  const fee = await provider.getFeeData();
  const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  const preview = {
    op,
    label: spec.label,
    target: QUORUM_VAULT,
    signer: wallet.address,
    args: call.args.map((x) => (typeof x === "bigint" ? x.toString() : x)),
    value: call.overrides?.value?.toString() ?? "0",
    gasLimit: gas.toString(),
    gasPrice: gasPrice.toString(),
    estimatedFeeMon: Number(gas * gasPrice) / 1e18,
    signerBalanceMon: Number(await provider.getBalance(wallet.address)) / 1e18,
  };
  if (body.confirm !== true) return { dryRun: true, preview, note: "未广播。确认请带 confirm:true 重发同一请求。" };
  const tx = await fn(...call.args, ...(call.overrides ? [call.overrides] : []));
  const r = await tx.wait();
  const after = await vaultState();
  return { dryRun: false, preview, txHash: tx.hash, status: r.status, gasUsed: r.gasUsed.toString(), vault: after };
}

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
    // 执行统计（收据流聚合 + 链上 validation 状态）。与"收益回测"无关，见函数注释。
    if (url.pathname === "/api/exec-stats") return send(200, await execStats(agentId));
    // 金库真实状态（/funds、/vaults、/console 的唯一数据源；余额/限额/用量全部链上读回）
    if (url.pathname === "/api/vault" && req.method === "GET") return send(200, await vaultState(agentId));
    // 全 agent 的金库清单：谁有金库、谁只有身份（链上读回比得出）
    if (url.pathname === "/api/vaults" && req.method === "GET") return send(200, await vaultList());
    // 身份注册表真实读数（/market、/create）
    if (url.pathname === "/api/agents" && req.method === "GET") return send(200, await identityState());
    // 策略核对：本地 challenger 策略文件 vs 链上已认证 guardrailHash（只读，零 gas）
    if (url.pathname === "/api/policy" && req.method === "GET") {
      const pol = challengerPolicy(Number(agentId));
      if (!pol) {
        return send(200, {
          agentId: Number(agentId),
          policy: null,
          policyFile: null,
          attestedGuardrailHash: null,
          onChainGuardrailHash: await reg.agentGuardrailHash(agentId),
          inSync: false,
          registry: REGISTRY,
          note: `该 agent 尚无 challenger 策略文件（challenger-policy-${agentId}.json）—— challenger 会跳过它，不签发 validation`,
        });
      }
      const attested = attestedGuardrailHash(pol);
      const onChain = await reg.agentGuardrailHash(agentId);
      return send(200, {
        agentId: Number(agentId),
        policy: pol,
        policyFile: pol.__file,
        attestedGuardrailHash: attested,
        onChainGuardrailHash: onChain,
        inSync: String(attested).toLowerCase() === String(onChain).toLowerCase(),
        registry: REGISTRY,
        note: "inSync=false 时 challenger 会因 L1 拒绝所有收据（链上哈希是唯一权威）",
      });
    }

    // 统一入口的配置快照：前端据此渲染"链路当前长什么样"，无需硬编码地址/模型名。
    // 只暴露公开信息（链路地址、模型名、策略边界），绝不返回任何私钥或 API key。
    if (url.pathname === "/api/config" && req.method === "GET") {
      return send(200, {
        agentId: Number(agentId),
        chain: { chainId: 10143, name: "Monad testnet" },
        contracts: {
          receiptRegistry: REGISTRY,
          identityRegistry: IDENTITY,
          validationRegistry: process.env.VALIDATION || null,
          vaultQuorum: vaultAddrFor(agentId) || null,
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
            { role: "challenger", name: "Challenger 机器（独立）", holds: ["CHALLENGER_PK"], note: "独立钱包上链 validation；verify.mjs 只依赖 ethers + 自己的 objective.mjs（单向零依赖，反向有一处复用见文档）；可选跨家族模型层默认关闭（非 L5，L5 专指目标层）" },
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

    // 治理写路径：POST /api/admin/<op>。不带 confirm:true 时只回预估（零 gas），
    // 带 confirm:true 才广播。Dashboard 用 ConfirmTx 弹窗展示 preview 后再发。
    if (url.pathname.startsWith("/api/admin/") && req.method === "POST") {
      const op = url.pathname.slice("/api/admin/".length);
      let body = "";
      for await (const chunk of req) body += chunk;
      let parsed = {};
      try { parsed = body ? JSON.parse(body) : {}; } catch { return send(400, { error: "invalid JSON body" }); }
      const out = await adminOp(op, parsed);
      return send(out.error ? 400 : 200, out);
    }

    // 注册新 agent：IdentityRegistry.register 是 permissionless 的，任何人都能注册。
    // 注意：注册只产生身份，不产生金库——每个 agent 需要独立部署一个 AegisVaultQuorum
    //（合约里 agentId 是 immutable），且需要独立的 TEE 测量（当前单 CVM 架构做不到）。
    if (url.pathname === "/api/agents" && req.method === "POST") {
      if (!idWrite) return send(400, { error: "no signer configured (MONAD_TESTNET_PK unset)" });
      let body = "";
      for await (const chunk of req) body += chunk;
      let b = {};
      try { b = body ? JSON.parse(body) : {}; } catch { return send(400, { error: "invalid JSON body" }); }
      const name = String(b.name || "").trim();
      if (!name) return send(400, { error: "name required" });
      const uri =
        b.agentURI ||
        `data:application/json;base64,${Buffer.from(
          JSON.stringify({ name, description: b.description || "", registeredAt: new Date().toISOString(), registry: REGISTRY })
        ).toString("base64")}`;
      const gas = await idWrite.register.estimateGas(uri);
      const fee = await provider.getFeeData();
      const gasPrice = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
      const preview = {
        op: "register-agent",
        label: `注册 agent「${name}」`,
        target: IDENTITY,
        signer: wallet.address,
        args: [uri],
        value: "0",
        gasLimit: gas.toString(),
        gasPrice: gasPrice.toString(),
        estimatedFeeMon: Number(gas * gasPrice) / 1e18,
        signerBalanceMon: Number(await provider.getBalance(wallet.address)) / 1e18,
        // 注册只写 ERC-8004 身份表；金库/TEE 测量/挑战者策略是另外三件事，
        // 前端必须把这三项如实列成"待办"而不是假装已经具备。
        sideEffects: [
          "写入 ERC-8004 IdentityRegistry（permissionless，仅产生身份）",
          "不产生金库 —— 需独立部署 AegisVaultQuorum（合约 agentId immutable）",
          "不产生 TEE 测量 —— challenger 需要该 agent 的 challenger-policy-<id>.json 才会签发 validation",
        ],
      };
      if (b.confirm !== true) return send(200, { dryRun: true, preview, note: "未广播。确认请带 confirm:true。" });
      const tx = await idWrite.register(uri);
      const r = await tx.wait();
      const idState = await identityState();
      const newId = idState.lastId;
      return send(200, {
        dryRun: false,
        preview,
        txHash: tx.hash,
        status: r.status,
        gasUsed: r.gasUsed.toString(),
        identity: idState,
        newAgentId: newId,
        nextSteps: [
          `部署 AegisVaultQuorum(agentId=${newId}, ...) 并把地址写进 .env 的 QUORUM_VAULT_${newId}`,
          `创建 challenger/challenger-policy-${newId}.json（否则 challenger 跳过该 agent，不签发 validation）`,
          `以新 agentId 跑 challenger/policy-attest.mjs --execute 上链认证 guardrailHash`,
        ],
      });
    }

    send(404, { error: "not found" });
  } catch (e) {
    console.error("[orchestrator] request error:", e?.shortMessage || e?.message || e);
    if (e?.errors) for (const sub of e.errors) console.error("  [provider]", sub?.provider?.url || sub?.provider || "?", "→", sub?.error?.shortMessage || sub?.error?.message || sub?.error || sub);
    if (e?.info) console.error("  [info]", JSON.stringify(e.info)?.slice(0, 1200));
    if (e?.cause) console.error("  [cause]", e.cause?.shortMessage || e.cause?.message || String(e.cause));
    console.error("  [stack]", String(e?.stack || "").split("\n").slice(0, 6).join("\n"));
    send(500, { error: String(e?.shortMessage || e?.message || e) });
  }
});

server.listen(PORT, () =>
  console.log(`[orchestrator] http://localhost:${PORT}  rpc=${RPC_LIST[0]}(+${RPC_LIST.length - 1})  signer=${wallet ? wallet.address : "none(dryRun only)"}`)
);
