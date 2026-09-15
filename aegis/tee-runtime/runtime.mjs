// Aegis TEE 运行时核心（确定性部分）
// - 类型化交易意图 (typed intent)
// - PACE 确定性策略验证器 -> PDR
// - 护栏管线（输入规范化 + 注入启发式 + 黑名单）-> guardrailHash
// - 收据哈希：executionHash / semanticDigest（与链上 ReceiptRegistry 对齐）
//
// ⚠️ 定位（勿误用）：本模块是**演示路径**（run.mjs / agent.mjs / agent-demo.mjs）的确定性核心，
// 且被 parity-check.mjs、regime-cost.mjs 复用 guardrail/PACE 以守住口径——这两者的复用是刻意的。
// 但 **生产管线不走这里**：orchestrator/pipeline.mjs 自带 normalize + 护栏 + PACE + 目标层实现，
// 且其 intentHash 语义为 executionHash（本模块 buildIntent 的 intentHash 是更宽的 typed-intent 摘要，
// 两者不是同一个值）。因此本模块产出的 pdrHash 不能直接当作链上收据字段使用。
import { keccak256, toUtf8Bytes, AbiCoder } from "ethers";

const abi = AbiCoder.defaultAbiCoder();

// ---------- 类型化意图 ----------
export function buildIntent({ target, amount, data, slippageBps = 0, kind = "trade" }) {
  if (!target || amount === undefined || data === undefined) {
    throw new Error("intent missing fields");
  }
  const intentHash = keccak256(
    abi.encode(["string", "address", "uint256", "bytes", "uint256"], [kind, target, amount, data, slippageBps])
  );
  return { kind, target, amount, data, slippageBps, intentHash };
}

// ---------- 策略版本 ----------
export function policyHash(policy) {
  // 策略的可哈希化表示（字段顺序固定）
  const canon = JSON.stringify({
    agentId: policy.agentId,
    whitelist: policy.whitelist,
    perTxLimit: policy.perTxLimit,
    dailyLimit: policy.dailyLimit,
    maxSlippageBps: policy.maxSlippageBps,
    blocklist: policy.blocklist,
    allowedAssets: policy.allowedAssets,
  });
  return keccak256(toUtf8Bytes(canon));
}

// ---------- 护栏管线 ----------
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

export function normalize(input) {
  let s = String(input);
  s = s.replace(INVISIBLE, "");
  s = s.toLowerCase();
  // 常见 leetspeak 还原
  const map = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "$": "s", "@": "a" };
  s = s.replace(/[01345$@]/g, (c) => map[c] ?? c);
  return s.trim();
}

const INJECTION_PATTERNS = [
  /ignore (all )?previous/,
  /disregard .*instruction/,
  /you are now/,
  /system prompt/,
  /urgent.*(swap|transfer|send) (all|everything)/,
];

export function runGuardrail(input, policy) {
  const norm = normalize(input);
  const reasons = [];

  // 1) 提示注入启发式
  for (const re of INJECTION_PATTERNS) {
    if (re.test(norm)) reasons.push("injection_pattern");
  }
  // 2) 黑名单标的（如 $SCAM）
  for (const b of policy.blocklist) {
    if (norm.includes(normalize(b))) reasons.push(`blocklist:${b}`);
  }
  // 3) 关键词：绕过白名单的"空投/紧急"话术
  if (/(airdrop|空投)/.test(norm) && /(swap|换成|transfer)/.test(norm)) {
    reasons.push("suspicious_social_engineering");
  }

  const allowed = reasons.length === 0;
  const guardrailHash = keccak256(
    abi.encode(["string", "bytes32"], ["guardrail-v1", policyHash(policy)])
  );
  return { allowed, reasons, normalized: norm, guardrailHash };
}

// ---------- PACE 确定性策略验证器 ----------
// 输入：typed intent + 运行状态（已花费等）；输出：approve/reject + PDR
export function paceVerify(intent, policy, state = { dailySpent: 0n }) {
  const checks = [];
  const fail = (r) => {
    checks.push(r);
    return { approved: false, reason: r };
  };

  if (!policy.whitelist.map((x) => x.toLowerCase()).includes(intent.target.toLowerCase())) {
    return fail("target_not_whitelisted");
  }
  if (BigInt(intent.amount) > BigInt(policy.perTxLimit)) return fail("exceeds_per_tx_limit");
  const day = BigInt(state.dailySpent ?? 0);
  if (day + BigInt(intent.amount) > BigInt(policy.dailyLimit)) return fail("exceeds_daily_limit");
  if (Number(intent.slippageBps) > Number(policy.maxSlippageBps)) return fail("slippage_too_high");

  const ph = policyHash(policy);
  // ⚠️ pdrHash 口径必须与链上侧逐字节一致：
  //   - orchestrator/server.mjs buildReceiptFields：pdr = keccak(intentHash, guardrailHash, true)，
  //     其中 intentHash 在链上侧被**定义为等于 executionHash**；
  //   - challenger/verify.mjs layer4_arithmetic：expectedPdr 同式，intentHash 取 decision 原文重算的 executionHash。
  // 本模块的 typed intent 走的是另一套 buildIntent（intentHash = keccak(kind,target,amount,data,slippage)，
  // 语义更宽 ≠ executionHash），故这里只能与本模块自身口径自洽，**不能**直接喂给链上/bindTranscript。
  const pdrHash = keccak256(
    abi.encode(["bytes32", "bytes32", "bool"], [intent.intentHash, ph, true])
  );
  return { approved: true, reason: "ok", pdrHash, policyHash: ph, checks };
}

// ---------- 收据哈希（与链上对齐） ----------
// 链上 AegisVault: keccak256(abi.encode(target, amount, data))
export function computeExecutionHash(target, amount, data) {
  return keccak256(abi.encode(["address", "uint256", "bytes"], [target, amount, data]));
}

// 链上 ReceiptRegistry.semanticDigest: keccak256(abi.encode(agentId, pdrHash, guardrailHash, executionHash, nonce, prev))
// 注意：本函数是链上 **view** `semanticDigest` 的同名对照（DCAP quote 里 report_data 绑定的那个值），
// 参数里的 prev 是链上语义参数（哈希链前驱）。提交收据时链上落盘的 digest 另见 computeReceiptDigest。
export function computeSemanticDigest(agentId, pdrHash, guardrailHash, executionHash, nonce, prev) {
  return keccak256(
    abi.encode(
      ["uint256", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
      [agentId, pdrHash, guardrailHash, executionHash, nonce, prev]
    )
  );
}

// 收据摘要（链上 _submit 实际落盘的那个，ReceiptRegistry.sol:174-176）——比 semanticDigest
// 多 blockHeight / blockHash 两个绑定字段：
//   digest = keccak256(abi.encode(agentId, pdrHash, guardrailHash, executionHash,
//                                 blockHeight, blockHash, prev, nonce))
// challenger L4 用同一公式重算校验（verify.mjs:127-131）。
// ⚠️ 这是生产管线缺失的最后一环：orchestrator 在 receiptDigest() 里内联了同一公式，
// 本模块此前没有对应函数（已补齐，仅为对齐口径；orchestrator 未改）。
export function computeReceiptDigest(agentId, pdrHash, guardrailHash, executionHash, blockHeight, blockHash, prev, nonce) {
  return keccak256(
    abi.encode(
      ["uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32", "bytes32"],
      [agentId, pdrHash, guardrailHash, executionHash, blockHeight, blockHash, prev, nonce]
    )
  );
}
