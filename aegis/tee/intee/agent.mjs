// 在 TEE 内运行的自治 Agent：决策 -> get_quote(semanticDigest||nonce) -> 链上 submitReceiptWithQuote
//
// ⚠️ 口径（2026-09-16 修正）：本文件曾是**独立手写的第二实现**，其 guardrailHash 用
//    keccak256("guardrail-v1") 硬编码——与链上 agentGuardrailHash（= attestedGuardrailHash(policy)）
//    永远不相等，故其收据在 `_submit` 的 guardrail 校验处必然 revert；
//    其 norm 也缺 leet 折叠，与 challenger L2 判据不一致。
//    现改为**直接复用仓库模块**（tee-runtime/runtime.mjs 的 normalize/runGuardrail/paceVerify +
//    challenger/verify.mjs 的 attestedGuardrailHash），从根上消灭第三条口径。
//    部署进 CVM 时需一并携带这些模块（见 docker-compose.yml 的 ATTEST 步骤）。
//    另外：本文件**不在 parity-check 的覆盖范围内**，改动此处后应同时跑
//    `node scripts/parity-check.mjs` 与 `node challenger/selftest.mjs` 确认口径未漂移。
import { JsonRpcProvider, Wallet, Contract, keccak256, AbiCoder } from "ethers";
import { DstackClient } from "@phala/dstack-sdk";
import { runGuardrail, paceVerify, computeExecutionHash } from "../../tee-runtime/runtime.mjs";
import { attestedGuardrailHash } from "../../challenger/verify.mjs";

const abi = AbiCoder.defaultAbiCoder();
const e = process.env;

// ---- 策略对象（字段集须与 challenger/challenger-policy.json 同口径）----
// ⚠️ policyHash 取 JSON 字段全集：缺 allowedAssets / maxSlippageBps 会算出与链上
//    agentGuardrailHash 不同的值（challenger/verify.mjs:34-45）。
const policy = {
  agentId: Number(e.AGENT_ID),
  whitelist: (e.WHITELIST || e.TARGET || "").split(",").map((x) => x.toLowerCase()).filter(Boolean),
  perTxLimit: e.PER_TX_LIMIT,
  dailyLimit: e.DAILY_LIMIT || e.PER_TX_LIMIT,
  maxSlippageBps: Number(e.MAX_SLIPPAGE_BPS ?? 0),
  blocklist: (e.BLOCKLIST || "").split(",").map((x) => x.trim()).filter(Boolean),
  allowedAssets: (e.ALLOWED_ASSETS || "MON").split(",").map((x) => x.trim()).filter(Boolean),
};

// PACE 的限额比较是 BigInt(x) 直接抛异常（非 fail-closed），故先在边界处挡住
if (!e.PER_TX_LIMIT || !e.DAILY_LIMIT) {
  console.log("CONFIG_ERROR=PER_TX_LIMIT/DAILY_LIMIT 必须显式给出（不设默认，避免与链上策略静默分叉）");
  process.exit(1);
}
if (!/^\d+$/.test(e.PER_TX_LIMIT) || !/^\d+$/.test(e.DAILY_LIMIT)) {
  console.log("CONFIG_ERROR=PER_TX_LIMIT/DAILY_LIMIT 必须是十进制 wei 字符串");
  process.exit(1);
}

// ---- 1) 护栏（复用 runtime.mjs：零宽/leet 折叠 + 注入模式 + blocklist）----
const text = (e.TRUSTED_CMD || "") + " " + (e.MARKET_DATA || "");
const g = runGuardrail(text, policy);
const guardrailHash = attestedGuardrailHash(policy);
console.log("GUARDRAIL_HASH=" + guardrailHash + " RUNTIME_GUARDRAIL_HASH=" + g.guardrailHash);
console.log("NORMALIZED=" + g.normalized);
if (!g.allowed) { console.log("DECISION=blocked_by_guardrail " + JSON.stringify(g.reasons)); process.exit(0); }

// ---- 2) PACE 确定性策略验证（复用 runtime.mjs）----
const target = e.TARGET;
const amount = BigInt(e.AMOUNT);
const data = e.DATA || "0x";

// executionHash 复用 runtime 实现（= 链上 AegisVault: keccak(target, value, data)）
const executionHash = computeExecutionHash(target, amount, data);
// ⚠️ paceVerify 的 intent 形状取自 buildIntent 的产物：除 target/amount/slippageBps 外
//    还必须带 intentHash（它要拿它算 pdrHash）。这里显式喂 executionHash —— 即链上口径
//    （intentHash 在链上被定义为等于 executionHash），而不是 buildIntent 那套更宽的语义
//    （buildIntent 的 intentHash = keccak(kind,target,amount,data,slippage)，见 runtime.mjs:105-113）。
const p = paceVerify({ target, amount, slippageBps: 0, intentHash: executionHash }, policy, { dailySpent: BigInt(e.DAILY_SPENT || 0) });
if (!p.approved) { console.log("DECISION=rejected_by_policy " + p.reason); process.exit(0); }

const pdrHash = keccak256(abi.encode(["bytes32", "bytes32", "bool"], [executionHash, guardrailHash, true]));
console.log("PDR_HASH=" + pdrHash + " EXECUTION_HASH=" + executionHash);

// ---- 3) prev + nonce + semanticDigest ----
const REG_ABI = [
  "function lastReceiptHash(uint256) view returns (bytes32)",
  "function semanticDigest(uint256,bytes32,bytes32,bytes32,bytes32,bytes32) view returns (bytes32)",
  "function submitReceiptWithQuote(uint256,bytes32,bytes32,bytes32,bytes32,uint256,bytes32,bool,bytes)",
];
const provider = new JsonRpcProvider(e.RPC, 10143);
const wallet = new Wallet(e.PK, provider);
const agentId = BigInt(e.AGENT_ID);
const reg = new Contract(e.REGISTRY, REG_ABI, wallet);

const prev = await reg.lastReceiptHash(agentId);
const nonce = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const semantic = await reg.semanticDigest(agentId, pdrHash, guardrailHash, executionHash, nonce, prev);
console.log("PREV=" + prev);
console.log("SEMANTIC=" + semantic);

// ---- 4) TEE 生成绑定 semantic 的 quote ----
const dc = new DstackClient("/var/run/dstack.sock");
const rd = Buffer.from((semantic + nonce.slice(2)).replace(/^0x/, ""), "hex");
const q = await dc.getQuote(new Uint8Array(rd));
const quote = q.quote.startsWith("0x") ? q.quote : "0x" + q.quote;
console.log("QUOTE_BYTES=" + (quote.length - 2) / 2);

// ---- 5) 提交到链上（任何人可代提交；此处由 TEE 内钱包直接提交）----
const n = await provider.getBlockNumber();
const blk = await provider.getBlock(n);
const tx = await reg.submitReceiptWithQuote(agentId, pdrHash, guardrailHash, executionHash, nonce, n, blk.hash, false, quote);
const r = await tx.wait();
console.log("SUBMIT_TX=" + tx.hash + " STATUS=" + r.status + " GAS=" + r.gasUsed.toString());
console.log("NEW_LAST_RECEIPT_HASH=" + (await reg.lastReceiptHash(agentId)));
console.log("DECISION=approved_onchain");
