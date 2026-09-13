// Aegis TEE 运行时核心（确定性部分）
// - 类型化交易意图 (typed intent)
// - PACE 确定性策略验证器 -> PDR
// - 护栏管线（输入规范化 + 注入启发式 + 黑名单）-> guardrailHash
// - 收据哈希：executionHash / semanticDigest（与链上 ReceiptRegistry 对齐）
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
  const pdrHash = keccak256(
    abi.encode(["bytes32", "bytes32", "bytes32", "bool"], [intent.intentHash, ph, intent.intentHash, true])
  );
  return { approved: true, reason: "ok", pdrHash, policyHash: ph, checks };
}

// ---------- 收据哈希（与链上对齐） ----------
// 链上 AegisVault: keccak256(abi.encode(target, amount, data))
export function computeExecutionHash(target, amount, data) {
  return keccak256(abi.encode(["address", "uint256", "bytes"], [target, amount, data]));
}

// 链上 ReceiptRegistry.semanticDigest: keccak256(abi.encode(agentId, pdrHash, guardrailHash, executionHash, nonce, prev))
export function computeSemanticDigest(agentId, pdrHash, guardrailHash, executionHash, nonce, prev) {
  return keccak256(
    abi.encode(
      ["uint256", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
      [agentId, pdrHash, guardrailHash, executionHash, nonce, prev]
    )
  );
}
