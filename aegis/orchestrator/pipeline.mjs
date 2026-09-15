// Aegis Proposer 决策管线（可独立 import —— 不启动 HTTP 服务、不连链）
//
// 这是"LLM 提议 → 确定性 δ 裁决"的那一半。抽成独立模块的原因是：
//   - scripts/llm-divergence.mjs 需要在零副作用下直接调用它做度量
//   - orchestrator/server.mjs 在它之上加链上提交与原文存证
//
// 信任边界（务必照此口径讲）：本模块跑在 proposer 侧（TEE 之外）。
// 其输出是【不可信输入】；判据是下面的 δ（护栏 + PACE），
// 并由独立 challenger 用自己的代码 + 自己的模型重新推导。详见 tee-runtime/llm.mjs 注释。
import { isolatedLLM, privilegedLLM, parseJSONLoose, makeLLM, draftObjectiveLLM } from "../tee-runtime/llm.mjs";
import { monToWei } from "../tee-runtime/objective.mjs";

// 进程级单例：orchestrator 与脚本共享同一个适配器实例
let _llm = null;
export function llm() {
  if (!_llm) _llm = makeLLM();
  return _llm;
}

export function llmMeta() {
  const live = Boolean(process.env.LLM_API_KEY && process.env.LLM_BASE_URL);
  const challengerModel = process.env.LLM_CHALLENGER_MODEL || null;
  return {
    base: process.env.LLM_BASE_URL || null,
    model: process.env.LLM_MODEL || null,
    challengerModel,
    // 跨家族才是真 2-of-2：同一网关若把不同模型名路由到同一后端，
    // 或两侧用同一模型，一个家族盲区会同时骗过双方，quorum 退化为 1-of-1。
    // 因此这里显式暴露该结论，供 Dashboard 与答辩时如实展示。
    crossFamily: live ? Boolean(challengerModel && challengerModel !== process.env.LLM_MODEL) : false,
    mode: live ? "live" : "mock",
  };
}

// 交易 calldata 默认值（mock 路径用；WMON 真实路径走 WMON_DEPOSIT）
export const DATA_DEFAULT = process.env.TRADE_DATA || "0xdeadbeef";

// deepseek-flash 等推理模型：reasoning 与答案共享 max_tokens 预算，预算过小会被
// 截断成空 content（2026-09-15 实测 300 → 1/5 截断，fail-closed 误拒）
const LLM_MAX_TOKENS = 2000;

// 官方 canonical WMON（docs.monad.xyz testnet 页 canonical 地址，
// 2026-09-14 链上核实：codeLen=3249、name/symbol/decimals 全部读回正确）。
// 重置后的 testnet 无法核实任何第三方 DEX router（Uniswap 全系未部署、
// Kuru 无法核实），故"真实协议交互"路径以 WMON wrap 为准。
export const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";
// WETH9 deposit() selector：原生 MON 1:1 → WMON，任何真实 swap 的第一步
export const WMON_DEPOSIT = "0xd0e30db0";

/// 资产 → 白名单地址（与 vault WHITELIST env / challenger 策略必须一致；未知资产一律拒绝）
export function assetMap(whitelist) {
  return { USDC: whitelist[0], WMON: WMON };
}

/**
 * 双 LLM 决策管线（proposer 侧）。
 * @returns { kind:"intent", target, amount, data, plan, steps, summary }
 *        | { kind:"refuse", stage, reason, steps, plan? }
 * 绝不抛异常：模型不可达/非 JSON 一律 fail-closed（返回 refuse）。
 */
export async function runLLMPipeline({ trustedCommand, marketData, assets, opts = {} }) {
  const steps = [];
  const model = opts.model ? null : llm(); // 允许注入模型（度量脚本用）
  const engine = opts.model || model;
  const fail = (stage, reason, extra = {}) => ({ kind: "refuse", stage, reason, steps, ...extra });
  const callOpts = { ...(opts.callOpts || {}) };

  // 1) 隔离 LLM：不可信内容只被"读"，不被"执行"（无工具权限）
  let summaryRaw;
  try {
    summaryRaw = await isolatedLLM(engine, marketData || "(no external data)", { maxTokens: LLM_MAX_TOKENS, ...callOpts });
  } catch (e) {
    return fail("isolated_llm", "isolated_llm_unreachable: " + String(e?.message || e).slice(0, 160));
  }
  const summaryParsed = parseJSONLoose(summaryRaw);
  if (!summaryParsed.ok) return fail("isolated_llm", "isolated_llm_non_json (fail-closed)");
  const summary = summaryParsed.value;
  steps.push({ stage: "isolated_llm", facts: summary.relevant_facts ?? [], suspicious: summary.suspicious ?? [] });

  // 2) 特权 LLM：只吃「可信指令 + 隔离摘要」，产出 typed intent（严格 JSON）
  let planRaw;
  try {
    planRaw = await privilegedLLM(engine, trustedCommand, JSON.stringify(summary), { maxTokens: LLM_MAX_TOKENS, ...callOpts });
  } catch (e) {
    return fail("privileged_llm", "privileged_llm_unreachable: " + String(e?.message || e).slice(0, 160));
  }
  const planParsed = parseJSONLoose(planRaw);
  if (!planParsed.ok) return fail("privileged_llm", "privileged_llm_non_json (fail-closed)");
  const plan = planParsed.value;
  steps.push({ stage: "privileged_llm", plan });

  if (plan.kind !== "trade") return fail("privileged_llm", plan.reason || "model_refused", { plan });
  if (!plan.asset || plan.amountMon === undefined) return fail("privileged_llm", "plan_missing_fields", { plan });

  // 3) 解析资产与金额（未知资产直接拒绝：不猜、不兜底）
  const asset = String(plan.asset).toUpperCase();
  const target = (assets || {})[asset];
  if (!target) return fail("resolve_asset", `unknown_asset:${asset}`, { plan });
  let amount;
  try {
    const n = Number(plan.amountMon);
    if (!Number.isFinite(n) || n < 0) throw new Error("bad");
    amount = BigInt(Math.round(n * 1e18));
  } catch {
    return fail("resolve_asset", "bad_amountMon", { plan });
  }

  // WMON = 真实协议交互路径（官方 canonical 合约 deposit()）；
  // 其余资产保持 mock calldata（等待已验证流动性的 router）。
  const data = asset === "WMON" ? WMON_DEPOSIT : DATA_DEFAULT;

  return { kind: "intent", target, amount, data, plan, steps, summary };
}

/**
 * SOA-lite 目标草案（draft-then-sign 的 draft 半步）：LLM 起草【目标】，不产出指令。
 * 输出是未签名草案：user 字段留空（由签署方填入自己的地址后签名）、
 * target/deadline/nonce/tol 由本函数补齐（deadline 以起草时刻为基准）。
 * 签名后的目标进入验证闭包（challenger L5）；未签名的草案没有任何效力。
 * @returns { kind:"objective", asset, target, draft, steps, summary }
 *        | { kind:"refuse", stage, reason, steps, plan? }
 */
export async function draftObjective({ trustedCommand, marketData, assets, opts = {} }) {
  const steps = [];
  const engine = opts.model || llm();
  const fail = (stage, reason, extra = {}) => ({ kind: "refuse", stage, reason, steps, ...extra });
  const callOpts = { ...(opts.callOpts || {}) };

  // 1) 隔离 LLM：外部内容只被"读"，不被"执行"
  let summaryRaw;
  try {
    summaryRaw = await isolatedLLM(engine, marketData || "(no external data)", { maxTokens: LLM_MAX_TOKENS, ...callOpts });
  } catch (e) {
    return fail("isolated_llm", "isolated_llm_unreachable: " + String(e?.message || e).slice(0, 160));
  }
  const summaryParsed = parseJSONLoose(summaryRaw);
  if (!summaryParsed.ok) return fail("isolated_llm", "isolated_llm_non_json (fail-closed)");
  const summary = summaryParsed.value;
  steps.push({ stage: "isolated_llm", facts: summary.relevant_facts ?? [], suspicious: summary.suspicious ?? [] });

  // 2) 目标起草 LLM：只吃「可信指令」
  let raw;
  try {
    raw = await draftObjectiveLLM(engine, trustedCommand, { maxTokens: LLM_MAX_TOKENS, ...callOpts });
  } catch (e) {
    return fail("objective_llm", "objective_llm_unreachable: " + String(e?.message || e).slice(0, 160));
  }
  const parsed = parseJSONLoose(raw);
  if (!parsed.ok) return fail("objective_llm", "objective_llm_non_json (fail-closed)");
  const plan = parsed.value;
  steps.push({ stage: "objective_llm", plan });

  if (plan.kind !== "trade") return fail("objective_llm", plan.reason || "model_refused", { plan });
  const asset = String(plan.asset || "").toUpperCase();
  const target = (assets || {})[asset];
  if (!target) return fail("resolve_asset", `unknown_asset:${asset}`, { plan });
  const desiredWei = monToWei(plan.desiredMon);
  const maxWei = monToWei(plan.maxMon ?? plan.desiredMon);
  if (desiredWei === null || maxWei === null || desiredWei <= 0n || maxWei < desiredWei) {
    return fail("objective_llm", "bad_objective_amounts", { plan });
  }

  const tolWei = BigInt(process.env.SOA_TOL_WEI || "1000000000000000"); // 默认 0.001 MON
  const deadlineSec = Number(process.env.SOA_DEADLINE_SEC || 3600);
  const nonce = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const draft = {
    v: 1,
    kind: "trade",
    // user 由签署方填入（起草者不决定签名者是谁）
    asset,
    target,
    desiredWei: desiredWei.toString(),
    maxWei: maxWei.toString(),
    tolWei: tolWei.toString(),
    deadline: deadlineSec > 0 ? Math.floor(Date.now() / 1000) + deadlineSec : 0,
    nonce,
  };
  return { kind: "objective", asset, target, draft, steps, summary };
}
