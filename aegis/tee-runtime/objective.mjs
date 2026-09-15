// Aegis SOA-lite —— 目标模块（proposer 侧实现：起草辅助 + 提交前自检）
//
// 论文背景（新原语提案 §4 SOA / T3）：LLM 只当求解者，用户签署目标 c_u = H(u)；
// 本侧职责：①（配合 orchestrator）起草目标草案；② 上链前自检——执行动作必须对签署目标
// ε-最优，否则直接拒发（省 gas），而不是等 challenger 打回。
//
// ⚠️ 与 challenger/objective.mjs 是【两套独立实现】，判据（含 canonical 字节与 reason 名）
//     必须一致；改任一侧都要重跑 scripts/parity-check.mjs。
import { keccak256, toUtf8Bytes, verifyMessage } from "ethers";

const ADDR = /^0x[0-9a-f]{40}$/;
const WORD32 = /^0x[0-9a-f]{64}$/;

/// 十进制 MON 字符串 → wei（最多 18 位小数）；非法输入返回 null（调用方 fail-closed）
export function monToWei(dec) {
  if (dec === undefined || dec === null) return null;
  const s = String(dec).trim();
  if (!/^\d+(\.\d{1,18})?$/.test(s)) return null;
  const [i, f = ""] = s.split(".");
  return BigInt(i) * 10n ** 18n + BigInt((f + "0".repeat(18)).slice(0, 18));
}

/// 规范化目标：固定字段顺序 + 小写地址 + 十进制 wei 字符串
/// （与 challenger/objective.mjs canonicalObjective 逐字节一致）
export function canonicalObjective(o) {
  const canon = {
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
  };
  return JSON.stringify(canon);
}

export function objectiveHash(o) {
  return keccak256(toUtf8Bytes(canonicalObjective(o)));
}

/// 提交前自检（proposer 侧；与 challenger L5 同判据——口径由 parity-check 守）
/// 返回 { ok, reasons[] }，reason 字符串与 challenger 侧一一对应
export function checkObjective({ objective, signature, action, policy, timeSeconds = null }) {
  const reasons = [];
  const reject = (r) => ({ ok: false, reasons: [r] });

  // 1) 字段完整性
  if (!objective || Number(objective.v) !== 1 || String(objective.kind) !== "trade") return reject("objective_bad_fields");
  if (!ADDR.test(String(objective.user).toLowerCase())) return reject("objective_bad_fields");
  if (!ADDR.test(String(objective.target).toLowerCase())) return reject("objective_bad_fields");
  if (!WORD32.test(String(objective.nonce).toLowerCase())) return reject("objective_bad_fields");
  let desired, max, tol;
  try {
    desired = BigInt(objective.desiredWei);
    max = BigInt(objective.maxWei);
    tol = BigInt(objective.tolWei);
  } catch {
    return reject("objective_bad_fields");
  }
  if (desired < 0n || max < 0n || tol < 0n || desired > max) return reject("objective_bad_fields");

  // 2) 用户签名
  let signer = null;
  try { signer = verifyMessage(canonicalObjective(objective), String(signature || "")); } catch { signer = null; }
  if (!signer || signer.toLowerCase() !== String(objective.user).toLowerCase()) return reject("objective_bad_signature");

  // 3) 动作 vs 目标
  if (String(action.target).toLowerCase() !== String(objective.target).toLowerCase()) reasons.push("objective_target_mismatch");
  const amt = BigInt(action.amount);
  if (amt > max) reasons.push("objective_exceeds_max");

  // 4) 期限
  if (Number(objective.deadline) > 0) {
    if (timeSeconds === null || timeSeconds === undefined) reasons.push("objective_time_unknown");
    else if (Number(timeSeconds) > Number(objective.deadline)) reasons.push("objective_expired");
  }

  // 5) 可满足性
  if (desired > BigInt(policy.perTxLimit)) reasons.push("objective_unsatisfiable");

  // 6) ε-最优性
  const deviation = amt > desired ? amt - desired : desired - amt;
  if (deviation > tol) reasons.push(`objective_not_eps_optimal:dev=${deviation}`);

  return { ok: reasons.length === 0, reasons };
}
