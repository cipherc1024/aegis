// Aegis SOA-lite —— 用户签署目标的验证器（challenger 侧独立实现）
//
// 论文背景（新原语提案 §4 SOA / 定理 T3）：LLM 只当求解者；"选择"的判据是用户签署的目标
// c_u = H(u)（draft-then-sign：LLM 起草、用户签名）。进入验证闭包的是【签名】，不是 LLM。
// 本层验证三件事：
//   1) 目标完整性 + 用户签名（EIP-191 personal_sign over canonical JSON）
//   2) 目标对策略的可满足性（u 的 argmax 必须在菜单内可达）
//   3) 已执行动作相对 u 的 ε-最优性 —— 对本系统 u = -|amount - desired|，
//      即"执行金额必须落在用户签署的期望值 ± ε 内"，而不是仅仅"没过 PACE 上限"
//
// ⚠️ 与 tee-runtime/objective.mjs（proposer 侧）是【两套独立实现】，判据必须逐字节一致：
//     改任一侧都要重跑 scripts/parity-check.mjs（口径漂移 = 假性分歧）。
//
// 诚实边界（写进 limitations）：u 当前为单变量（金额维度）——受真实路径限制
// （WMON wrap 只有金额一个自由度）；目标重放（签名目标在 deadline 内可复用为长期授权）
// 待 ReceiptRegistry 增加 objectiveCommit 字段后由链上锚定解决（论文 §4 增量的合约版）。
import { keccak256, toUtf8Bytes, verifyMessage } from "ethers";

const ADDR_RE = /^0x[0-9a-f]{40}$/;
const HEX32_RE = /^0x[0-9a-f]{64}$/;

/// 规范化目标：固定字段顺序 + 小写地址 + 十进制 wei 字符串
/// ⚠️ 两侧实现必须产出逐字节相同的字符串（签名/验签都以此为准）
export function canonicalObjective(o) {
  return JSON.stringify({
    v: Number(o.v),
    kind: String(o.kind),
    user: String(o.user).toLowerCase(),
    asset: String(o.asset).toUpperCase(),
    target: String(o.target).toLowerCase(),
    desiredWei: BigInt(o.desiredWei).toString(),
    maxWei: BigInt(o.maxWei).toString(),
    tolWei: BigInt(o.tolWei).toString(),
    deadline: Number(o.deadline),
    nonce: String(o.nonce).toLowerCase(),
  });
}

/// 目标摘要（演示/证据用；签名对象是 canonical 字符串本身）
export function objectiveHash(o) {
  return keccak256(toUtf8Bytes(canonicalObjective(o)));
}

/// 单变量效用 u(a) = -|a.amount - desired|；菜单外（target 不符/超 max）记 -∞。
/// 返回 null 表示"菜单外"（不可比），否则返回 bigint 效用（≤ 0，0 = 恰好期望值）。
export function evalU(objective, action) {
  if (String(action.target).toLowerCase() !== String(objective.target).toLowerCase()) return null;
  const amount = BigInt(action.amount);
  if (amount > BigInt(objective.maxWei)) return null;
  const desired = BigInt(objective.desiredWei);
  return amount > desired ? desired - amount : amount - desired;
}

/// 主入口：返回 { ok, reasons[] }
/// - objective / signature：来自 transcript（orchestrator 存证的决策原文）
/// - action：{ target, amount }（transcript 里的执行字段）
/// - policy：challenger 自持策略（可满足性检查用）
/// - timeSeconds：链上时间优先（receipt.timestamp）；null = 无时间源（deadline>0 时 fail-closed）
export function checkObjective({ objective, signature, action, policy, timeSeconds = null }) {
  // 1) 字段完整性（任一缺失/畸形 → 拒绝，不做任何猜测）
  let desired, max, tol;
  try {
    if (!objective || Number(objective.v) !== 1 || String(objective.kind) !== "trade") {
      return { ok: false, reasons: ["objective_bad_fields"] };
    }
    if (!ADDR_RE.test(String(objective.user).toLowerCase())) return { ok: false, reasons: ["objective_bad_fields"] };
    if (!ADDR_RE.test(String(objective.target).toLowerCase())) return { ok: false, reasons: ["objective_bad_fields"] };
    if (!HEX32_RE.test(String(objective.nonce).toLowerCase())) return { ok: false, reasons: ["objective_bad_fields"] };
    desired = BigInt(objective.desiredWei);
    max = BigInt(objective.maxWei);
    tol = BigInt(objective.tolWei);
    if (desired < 0n || max < 0n || tol < 0n || desired > max) return { ok: false, reasons: ["objective_bad_fields"] };
  } catch {
    return { ok: false, reasons: ["objective_bad_fields"] };
  }

  // 2) 用户签名（EIP-191）：伪造/篡改任一字段都会让签名失效
  let signer = null;
  try { signer = verifyMessage(canonicalObjective(objective), String(signature || "")); } catch { signer = null; }
  if (!signer || signer.toLowerCase() !== String(objective.user).toLowerCase()) {
    return { ok: false, reasons: ["objective_bad_signature"] };
  }

  // 3) 执行动作必须落在签署目标内（target 精确匹配 + 金额不超签署上限）
  const reasons = [];
  if (String(action.target).toLowerCase() !== String(objective.target).toLowerCase()) reasons.push("objective_target_mismatch");
  if (BigInt(action.amount) > max) reasons.push("objective_exceeds_max");

  // 4) 期限：链上时间优先；deadline=0 视为无期限；无时间源时 fail-closed
  if (Number(objective.deadline) > 0) {
    if (timeSeconds === null || timeSeconds === undefined) reasons.push("objective_time_unknown");
    else if (Number(timeSeconds) > Number(objective.deadline)) reasons.push("objective_expired");
  }

  // 5) 可满足性：u 的 argmax（amount=desired）必须在菜单内可达
  if (desired > BigInt(policy.perTxLimit)) reasons.push("objective_unsatisfiable");

  // 6) ε-最优性：|执行金额 - 期望金额| ≤ tol（菜单内唯一的"选择"自由度 = 金额）
  const dev = BigInt(action.amount) > desired ? BigInt(action.amount) - desired : desired - BigInt(action.amount);
  if (dev > tol) reasons.push(`objective_not_eps_optimal:dev=${dev}`);

  return { ok: reasons.length === 0, reasons };
}
