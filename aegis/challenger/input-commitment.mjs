// M2 挑战者侧：输入承诺层（共识提交输入 regime）
//
// 与 verifyDecision 的关系：本模块是**独立新增层**，不改动 verify.mjs 的 L1–L5
// （parity 不变量不受影响）。只在「输入来自链上承诺源」regime 下启用：
// 输入 x = CommittedOracle 的链上观测，proposer 在决策原文中声明 inputRoot，
// challenger 直接读链比对——x ∈ T 由共识保证（公开承诺源 ⇒ 无需 TEE 信任，论文 §4.6 注）。
//
// 拒绝语义（新增，供 L1–L5 拒绝语义表扩展）：
//   input_commitment_mismatch  原文声明的 inputRoot ≠ 链上 commitRoot（伪造/代换输入）
//   input_root_missing         原文未声明 inputRoot（committed regime 下为必需字段）
//   stale_input                观测过旧（与链上 MAX_BLOCK_AGE=100 同口径）
//   no_committed_input         链上无该资产观测
import { keccak256, AbiCoder } from "ethers";

const abi = AbiCoder.defaultAbiCoder();

/// 链下重算承诺根——与 CommittedOracle.postObservation 的 stateHash 同式
/// （stateHash = keccak256(assetId, price, blockNumber)）。challenger 也可不走 oracle
/// 的 commitRoot getter，而从 ObservationPosted 事件日志独立重取 (price, blockNumber)
/// 后自行重算——后者是更强的独立路径（不经过合约 view，直接读日志）。
export function computeInputRoot(assetId, price, blockNumber) {
  return keccak256(abi.encode(["bytes32", "uint256", "uint256"], [assetId, BigInt(price), BigInt(blockNumber)]));
}

/// 输入承诺层判定。
/// @param transcript  决策原文；committed regime 要求含 inputRoot 字段
/// @param committedRoot  链上承诺根（读链或从事件重算）
/// @param observationBlock / currentBlock  新鲜性判定用块高；缺省则跳过 stale 检查
export function verifyInputCommitment({ transcript, committedRoot, observationBlock = null, currentBlock = null, maxBlockAge = 100 }) {
  const reasons = [];
  const claimed = transcript?.inputRoot ?? null;
  const ZERO32 = "0x" + "00".repeat(32);
  if (!committedRoot || committedRoot === ZERO32) reasons.push("no_committed_input");
  if (!claimed) reasons.push("input_root_missing");
  else if (committedRoot && committedRoot !== ZERO32 && claimed.toLowerCase() !== committedRoot.toLowerCase())
    reasons.push("input_commitment_mismatch");
  if (observationBlock != null && currentBlock != null && currentBlock - observationBlock > maxBlockAge)
    reasons.push("stale_input");
  return { agree: reasons.length === 0, reasons };
}
