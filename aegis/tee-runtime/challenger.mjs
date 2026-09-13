// Challenger Agent：独立重推导并挑战 proposer 的收据（互证）
// 诚实边界：challenger 用自己的护栏/PACE 实现重推导决策语义，
// 并验证收据摘要算术；完整独立链上回溯（prev 链回放）为后续工作。
import { keccak256, toUtf8Bytes, AbiCoder } from "ethers";

const abi = AbiCoder.defaultAbiCoder();

// challenger 自持的规范化（刻意不 import runtime.mjs —— 与 proposer 零共享代码）
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

function chNormalize(input) {
  let s = String(input);
  s = s.replace(INVISIBLE, "");
  s = s.toLowerCase();
  // 与 proposer 同口径的 leetspeak 还原（规范化口径一致避免假性分歧；策略本身可更严格）
  const map = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "$": "s", "@": "a" };
  s = s.replace(/[01345$@]/g, (c) => map[c] ?? c);
  return s.trim();
}

export function challengerGuardrail(text, blocklist) {
  const t = chNormalize(text);
  const reasons = [];
  if (/ignore (all )?previous|disregard/.test(t)) reasons.push("injection_pattern");
  for (const b of blocklist) if (t.includes(chNormalize(b))) reasons.push("blocklist:" + b);
  return reasons;
}

export function challengerPace({ target, amount, data, whitelist, perTxLimit }) {
  if (!whitelist.includes(String(target).toLowerCase())) return "target_not_whitelisted";
  if (amount > perTxLimit) return "exceeds_per_tx_limit";
  return null;
}

/// receipt: { pdrHash, guardrailHash, executionHash, blockHeight, blockHash, nonce, digest, prev }
/// inputs:  { command, marketData, target, amount, data, blocklist, whitelist, perTxLimit, agentId }
export function challengeReceipt({ receipt, inputs }) {
  const mismatches = [];

  // 1) 独立重推导护栏（challenger 自己的 blocklist 可更严格）
  const reasons = challengerGuardrail(`${inputs.command} ${inputs.marketData}`, inputs.blocklist);
  if (reasons.length) {
    return { agree: false, mismatches: ["challenger_blocks_decision:" + reasons.join(",")], response: 0 };
  }

  // 2) 独立重推导 PACE
  const reject = challengerPace(inputs);
  if (reject) return { agree: false, mismatches: ["challenger_policy_reject:" + reject], response: 0 };

  // 3) 重推导 executionHash / pdrHash
  const expectedExec = keccak256(abi.encode(["address", "uint256", "bytes"], [inputs.target, inputs.amount, inputs.data || "0x"]));
  if (expectedExec !== receipt.executionHash) mismatches.push("executionHash_mismatch");
  const expectedPdr = keccak256(abi.encode(["bytes32", "bytes32", "bool"], [expectedExec, receipt.guardrailHash, true]));
  if (expectedPdr !== receipt.pdrHash) mismatches.push("pdrHash_mismatch");

  // 4) 收据摘要算术（含 prev 链 + 锚点）；digest=null（dryRun 预览）时跳过
  let expectedDigest = null;
  if (receipt.digest) {
    expectedDigest = keccak256(
      abi.encode(
        ["uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32", "bytes32"],
        [inputs.agentId, receipt.pdrHash, receipt.guardrailHash, receipt.executionHash, receipt.blockHeight, receipt.blockHash, receipt.prev, receipt.nonce]
      )
    );
    if (expectedDigest !== receipt.digest) mismatches.push("digest_mismatch");
  }

  return {
    agree: mismatches.length === 0,
    mismatches,
    response: mismatches.length === 0 ? 100 : 0,
    expectedExec,
    expectedDigest,
  };
}
