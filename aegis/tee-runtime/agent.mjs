// 完整 Agent 循环（TEE 内）：输入净化 -> 双 LLM 隔离 -> 护栏 -> PACE -> 收据
import { randomBytes } from "node:crypto";
import { makeLLM, isolatedLLM, privilegedLLM } from "./llm.mjs";
import {
  buildIntent,
  runGuardrail,
  paceVerify,
  computeExecutionHash,
  computeSemanticDigest,
} from "./runtime.mjs";

const TARGETS = { USDC: "0x000000000000000000000000000000000000bEEF" };

export async function runAgent({ trustedCommand, untrustedMarketData, policy, state, llm }) {
  const engine = llm || makeLLM();

  // 1) 隔离 LLM 处理不可信内容（无工具权限）
  const summary = await isolatedLLM(engine, untrustedMarketData);

  // 2) 特权 LLM 产出 typed intent
  const raw = await privilegedLLM(engine, trustedCommand, summary);
  const parsed = JSON.parse(raw);

  // 3) 护栏（对可信指令与外部内容）
  const g = runGuardrail(`${trustedCommand} ${untrustedMarketData}`, policy);
  if (!g.allowed) return { decision: "blocked_by_guardrail", reasons: g.reasons };

  // 4) 组装 typed intent -> PACE 确定性验证
  const target = TARGETS[parsed.asset];
  if (!target) return { decision: "unknown_asset", asset: parsed.asset };
  const amount = BigInt(Math.round(Number(parsed.amountMon) * 1e18));
  const intent = buildIntent({ target, amount: amount.toString(), data: "0xdeadbeef", slippageBps: 20 });

  const p = paceVerify(intent, policy, state);
  if (!p.approved) return { decision: "rejected_by_policy", reason: p.reason };

  // 5) 收据哈希
  const executionHash = computeExecutionHash(intent.target, intent.amount, intent.data);
  const nonce = "0x" + randomBytes(32).toString("hex");
  const prev = state.prev ?? "0x" + "00".repeat(32);
  const semanticDigest = computeSemanticDigest(policy.agentId, p.pdrHash, g.guardrailHash, executionHash, nonce, prev);

  return {
    decision: "approved",
    intent,
    guardrailHash: g.guardrailHash,
    pdrHash: p.pdrHash,
    executionHash,
    nonce,
    semanticDigest,
  };
}
