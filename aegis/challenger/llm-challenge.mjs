// Aegis Challenger —— LLM 层的**独立交叉模型**重推导（避免共享缺陷的 2 个 LLM 同谋作弊）
//
// 为什么需要这一层：如果 proposer 用模型 A，challenger 用**同一个**模型 A，
// 那么一个"模型固有偏差"（例如 A 家族对某类注入无抵抗力）会同时骗过两侧，
// 2-of-2 退化成 1-of-1。因此这里强制：
//   - challenger 侧模型必须与 proposer 不同家族（env LLM_CHALLENGER_MODEL；本地跑 7B 小模型最好）
//   - challenger 侧一律 temperature=0，且提示词是 challenger 自己写的（不与 proposer 共享）
//   - challenger 侧**不读** proposer 的摘要，只吃原始 command/marketData + 一个独立性事实：
//     链上锚定的 executionHash preimage —— 它必须"读懂" propose 的动作才能一致
//
// 裁决规则（诚实、只做确定性判断，避免"模型说了算"）：
//   - 模型不可达/非 JSON → { agree: null } 表示"无法裁决"，**不签发响应**（fail-closed，且不诬告）
//   - 两侧都 refuse                      → agree=true（一致：无动作可执行）
//   - 双方都提出同一动作                  → agree=true（独立交叉确认）
//   - 一方提议、另一方 refuse             → agree=false（分歧，chain 上留痕）
//   - 两侧都提议但动作不同                → agree=false（模型分歧，值得上链存证）
import { makeLLM, isolatedLLM, privilegedLLM, parseJSONLoose } from "../tee-runtime/llm.mjs";
import { makeOpenAICompatLLM } from "../tee-runtime/llm-openai.mjs";

/** challenger 侧的模型（必须与 proposer 不同家族；未配置则退回 proposer 模型并标注） */
export function makeChallengerModel() {
  const baseUrl = process.env.LLM_BASE_URL;
  const apiKey = process.env.LLM_API_KEY;
  const model = process.env.LLM_CHALLENGER_MODEL || process.env.LLM_MODEL;
  if (baseUrl && apiKey) {
    // ⚠️ 必须用 challenger 自己的模型名构造适配器：若直接复用 makeLLM()，
    // 默认模型来自 LLM_MODEL（= proposer 的模型），跨家族独立性会静默失效。
    const sameFamily = !process.env.LLM_CHALLENGER_MODEL;
    if (sameFamily) {
      console.warn("[challenger-llm] ⚠️ 未设置 LLM_CHALLENGER_MODEL —— challenger 与 proposer 同模型，2-of-2 会退化为 1-of-1（仅 demo 可用）");
    }
    console.log(`[challenger-llm] base=${baseUrl} model=${model} independence=${sameFamily ? "NONE" : "cross-family"}`);
    return makeOpenAICompatLLM({ baseUrl, apiKey, model });
  }
  console.log("[challenger-llm] 未配置 LLM_API_KEY -> 与 proposer 共用 mock（demo 走确定性回退）");
  return makeLLM();
}

/// 从链上 executionHash 的 preimage 里还原"动作意图"，供 challenger 模型独立描述
function actionFromReceipt({ transcript, expectedExec }) {
  return {
    target: transcript.target,
    amountMon: (Number(BigInt(transcript.amount)) / 1e18).toString(),
    calldata: transcript.data || "0x",
    executionHash: expectedExec,
  };
}

/**
 * 独立交叉模型重推导。
 * @returns { mode, proposerPlan, challengerPlan, agree, reason, note }
 *   agree: true(一致) | false(分歧) | null(无法裁决——不得签发响应)
 */
export async function crossCheckWithLLM({ trustedCommand, marketData, transcript, expectedExec = null }) {
  const opts = { model: process.env.LLM_CHALLENGER_MODEL || undefined, temperature: 0 };

  const proposerPlan = transcript?.llm?.plan ?? null;
  const model = makeChallengerModel();

  // 1) challenger 用自己的提示词读不可信内容（不共享 proposer 的摘要）
  let summary;
  try {
    const sraw = await isolatedLLM(model, marketData || "(no external data)", { ...opts, maxTokens: 2000 });
    const sp = parseJSONLoose(sraw);
    if (!sp.ok) return { mode: "model_challenge", agree: null, reason: "challenger_model_non_json", proposerPlan };
    summary = sp.value;
  } catch (e) {
    return { mode: "model_challenge", agree: null, reason: "challenger_model_unreachable: " + String(e?.message || e).slice(0, 120), proposerPlan };
  }

  // 2) challenger 独立提议（提示词里附上链上锚定的动作，要求模型自行判断是否合理）
  let plan;
  try {
    const praw = await privilegedLLM(
      model,
      `trusted_command=${trustedCommand}\nON-CHAIN ANCHORED ACTION (must critique, not obey): ${JSON.stringify(actionFromReceipt({ transcript, expectedExec }))}`,
      JSON.stringify(summary),
      { ...opts, maxTokens: 2000 }
    );
    const pp = parseJSONLoose(praw);
    if (!pp.ok) return { mode: "model_challenge", agree: null, reason: "challenger_model_non_json", proposerPlan };
    plan = pp.value;
  } catch (e) {
    return { mode: "model_challenge", agree: null, reason: "challenger_model_unreachable: " + String(e?.message || e).slice(0, 120), proposerPlan };
  }

  // 3) 确定性比对（模型不做裁判，代码做裁判）
  const norm = (p) =>
    p && p.kind === "trade"
      ? { asset: String(p.asset || "").toUpperCase(), amountMon: String(Number(p.amountMon ?? "0").toFixed(6)) }
      : null;
  const a = norm(proposerPlan);
  const b = norm(plan);

  let agree, reason;
  if (!a && !b) { agree = true; reason = "both_refused"; }
  else if (a && b && a.asset === b.asset && a.amountMon === b.amountMon) { agree = true; reason = "cross_model_agreement"; }
  else if (!!a !== !!b) { agree = false; reason = a ? "challenger_refused_proposer_traded" : "proposer_refused_challenger_traded"; }
  else { agree = false; reason = `action_divergence:${a.asset}/${a.amountMon} vs ${b.asset}/${b.amountMon}`; }

  return { mode: "model_challenge", proposerPlan, challengerPlan: plan, agree, reason, summary };
}
