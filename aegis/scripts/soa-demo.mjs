// Aegis SOA-lite 演示 —— 签署目标（draft-then-sign）与意图漂移拦截
//
// 场景（论文 §8.1 攻击族「意图漂移」的工程对应）：
//   起草（LLM）→ 用户签署目标 u（期望金额 ± ε）→ agent 提议执行 →
//   ① 诚实执行（金额 = 期望值）→ 通过
//   ② 意图漂移（被注入的 agent 想多买 2×）→ challenger L5 拒绝（objective_not_eps_optimal）
//   ③ 目标被篡改（签完改字段）→ 签名失效 → 拒绝（objective_bad_signature）
//   ④ 目标过期（deadline 已过）→ 拒绝（objective_expired）
//
// 运行（零 gas，dry-run 路径）：
//   node scripts/soa-demo.mjs                     # orchestrator 在跑则走 HTTP，否则本地重放
//   node scripts/soa-demo.mjs --command "buy WMON 0.01"
//   node scripts/soa-demo.mjs --onchain           # 真实上链（消耗 gas；诚实路径一笔）
import { JsonRpcProvider, FallbackProvider, Wallet, keccak256, AbiCoder } from "ethers";
import { loadEnv } from "./lib.mjs";
import { draftObjective, assetMap, llmMeta, DATA_DEFAULT } from "../orchestrator/pipeline.mjs";
import { canonicalObjective, objectiveHash, checkObjective } from "../tee-runtime/objective.mjs";
import { verifyDecision, attestedGuardrailHash } from "../challenger/verify.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const abi = AbiCoder.defaultAbiCoder();
const ZERO32 = "0x" + "00".repeat(32);
const ORCH = (process.env.ORCH_URL || "http://localhost:8787").replace(/\/$/, "");
const policy = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "challenger", "challenger-policy.json"), "utf8"));

const args = process.argv.slice(2);
const argVal = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const COMMAND = argVal("--command", process.env.TRUSTED_CMD || "buy WMON 0.01");
const MARKET = argVal("--marketData", "WMON wrap: official canonical contract, depth ok");
const ONCHAIN = args.includes("--onchain");

const WHITELIST = (process.env.WHITELIST || "").split(",").map((x) => x.trim()).filter(Boolean);
const ASSETS = assetMap(WHITELIST);

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${extra ? "  | " + extra : ""}`);
  ok ? pass++ : fail++;
};

async function serverUp() {
  try {
    const r = await fetch(`${ORCH}/api/status?agentId=1`, { signal: AbortSignal.timeout(2500) });
    return r.ok;
  } catch { return false; }
}

/// 实时模型偶发返回非 JSON（已知特性：管线 fail-closed 拒绝）→ 退避重试，不改变安全语义
async function withRetry(fn, ok, tries = 4, delayMs = 2500) {
  let last;
  for (let i = 1; i <= tries; i++) {
    last = await fn();
    if (ok(last)) return last;
    const why = last?.reason ?? last?.kind ?? last?.decision ?? "unknown";
    console.log(`  … 第 ${i}/${tries} 次未通过（${String(why).slice(0, 60)}）→ 退避重试（模型非 JSON 属 fail-closed，非放行）`);
    if (i < tries) await new Promise((r) => setTimeout(r, delayMs));
  }
  return last;
}

/// 起草：orchestrator 在跑 → HTTP（与生产同路径）；否则本地调用同一管线（零 gas）
async function draft() {
  const isUp = await serverUp();
  if (isUp) {
    const r = await fetch(`${ORCH}/api/objective/draft`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command: COMMAND, marketData: MARKET }),
      signal: AbortSignal.timeout(90000),
    });
    const j = await r.json();
    return { via: "orchestrator HTTP", draft: j.draft, kind: j.kind, reason: j.reason, steps: j.steps, llm: j.llm };
  }
  const d = await draftObjective({ trustedCommand: COMMAND, marketData: MARKET, assets: ASSETS });
  return { via: "本地管线（无 orchestrator）", draft: d.draft, kind: d.kind, reason: d.reason, steps: d.steps, llm: llmMeta() };
}

/// 离线重放判据（与 orchestrator 提交路径同口径）：构造自洽收据 → challenger 完整重推导
function offlineVerdict({ objective, signature, amount, data, timeSeconds, command = COMMAND, marketData = MARKET }) {
  const target = objective.target;
  const execHash = keccak256(abi.encode(["address", "uint256", "bytes"], [target, amount, data || "0x"]));
  const guard = attestedGuardrailHash(policy);
  const pdr = keccak256(abi.encode(["bytes32", "bytes32", "bool"], [execHash, guard, true]));
  const proposerCheck = checkObjective({ objective, signature, action: { target, amount }, policy, timeSeconds });
  const verdict = verifyDecision({
    policy,
    transcript: { command, marketData, target, amount: amount.toString(), data, objective, objectiveSignature: signature },
    receipt: { digest: null, pdrHash: pdr, guardrailHash: guard, executionHash: execHash, blockHeight: 0, blockHash: ZERO32, nonce: ZERO32, prev: ZERO32, timestamp: timeSeconds },
    dailySpent: null,
    agentId: 1,
  });
  return { proposerCheck, verdict };
}

async function submitViaServer({ objective, signature, amount }) {
  const body = {
    command: COMMAND,
    marketData: MARKET,
    objective,
    objectiveSignature: signature,
    dryRun: !ONCHAIN,
  };
  // 显式金额 = 模拟"agent 提议的执行动作"；target 必须随草案一致传递
  //（不传 target 时 orchestrator 会回落到 WHITELIST[0]，会让 target_mismatch 掩盖真实结论）
  if (amount !== undefined) {
    body.amount = amount.toString();
    body.target = objective.target;
  }
  if (ONCHAIN) body.execute = true;
  const r = await fetch(`${ORCH}/api/agent/command?agentId=1`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(180000),
  });
  return r.json();
}

// ---------- 主流程 ----------
const pk = process.env.SOA_USER_PK;
if (!pk) {
  console.error("缺 SOA_USER_PK（aegis/.env）—— 「用户」角色私钥，只签名、不需要资金");
  process.exit(1);
}
const user = new Wallet(pk);
const now = () => Math.floor(Date.now() / 1000);

console.log(`[soa-demo] command: ${COMMAND}`);
console.log(`[soa-demo] user:    ${user.address}`);

// 1) 起草（模型偶发非 JSON → 退避重试；连续失败则如实终止）
const d = await withRetry(draft, (x) => x.kind === "objective");
console.log(`[soa-demo] draft via ${d.via} (llm=${d.llm?.mode ?? "?"})`);
if (d.kind !== "objective") {
  console.error(`[soa-demo] 起草失败：${d.kind}/${d.reason ?? ""} —— 演示终止（fail-closed，不猜）`);
  process.exit(1);
}
const objective = { ...d.draft, user: user.address };
const signature = await user.signMessage(canonicalObjective(objective));
console.log(`[soa-demo] objective: asset=${objective.asset} desired=${objective.desiredWei} wei  max=${objective.maxWei} wei  tol=${objective.tolWei} wei`);
console.log(`[soa-demo] objectiveHash: ${objectiveHash(objective)}`);
console.log(`[soa-demo] signature: ${signature.slice(0, 26)}…`);
console.log(`[soa-demo] canonical: ${canonicalObjective(objective)}`);

const desired = BigInt(objective.desiredWei);
const data = objective.asset === "WMON" ? "0xd0e30db0" : DATA_DEFAULT;
const isUp = await serverUp();
if (!isUp) console.log("[soa-demo] orchestrator 未启动 → 案例走本地重放（同判据，零 gas）");
// 模型偶发非 JSON → 管线 fail-closed 返回 refused_by_pipeline。该拒绝不是对目标的裁决，
// 重试是一次全新的评估，不改变安全语义（连续失败则该用例如实显示 fail-closed 拒绝）。
const submitRetry = (args) => withRetry(() => submitViaServer(args), (x) => x.decision !== "refused_by_pipeline");

console.log("\n① 诚实执行（金额 = 签署期望值）");
if (isUp) {
  const j = await submitRetry({ objective, signature });
  check("approved（含 5_objective=pass）", j.decision === "approved_preview" || j.decision === "approved_onchain", JSON.stringify(j.challenger?.layers ?? j.error ?? j.decision));
  if (ONCHAIN) {
    const ex = j.execution || {};
    check("全链执行（executeTrade 上链）", ex.status === "executed", `receipt=${j.txHash ?? "?"} exec=${ex.txHash ?? "-"} vaultBal=${ex.vaultBalance ?? "-"}`);
  }
} else {
  const { proposerCheck, verdict } = offlineVerdict({ objective, signature, amount: desired, data, timeSeconds: now() });
  check("proposer 预检 pass", proposerCheck.ok, JSON.stringify(proposerCheck.reasons));
  check("challenger L5 pass", verdict.agree && verdict.layers["5_objective"] === "pass", JSON.stringify(verdict.layers));
}

console.log("\n② 意图漂移（被注入的 agent 提议 2× 金额）");
if (isUp) {
  const j = await submitRetry({ objective, signature, amount: desired * 2n });
  check("rejected_by_objective", j.decision === "rejected_by_objective", JSON.stringify(j.reasons ?? j.error ?? j.decision));
} else {
  const { proposerCheck, verdict } = offlineVerdict({ objective, signature, amount: desired * 2n, data, timeSeconds: now() });
  check("proposer 预检拒绝", !proposerCheck.ok, JSON.stringify(proposerCheck.reasons));
  check("challenger L5 拒绝", !verdict.agree && verdict.mismatches.join(",").includes("objective_not_eps_optimal"), verdict.mismatches.join(","));
}

console.log("\n③ 目标被篡改（签完把 max 改大）");
const tampered = { ...objective, maxWei: (desired * 5n).toString() };
if (isUp) {
  const j = await submitRetry({ objective: tampered, signature });
  check("rejected_by_objective", j.decision === "rejected_by_objective", JSON.stringify(j.reasons ?? j.error ?? j.decision));
} else {
  const { proposerCheck, verdict } = offlineVerdict({ objective: tampered, signature, amount: desired, data, timeSeconds: now() });
  check("proposer 预检拒绝", !proposerCheck.ok, JSON.stringify(proposerCheck.reasons));
  check("challenger L5 拒绝", !verdict.agree && verdict.mismatches.join(",").includes("objective_bad_signature"), verdict.mismatches.join(","));
}

console.log("\n④ 目标过期（deadline 已过）");
const expired = { ...objective, deadline: now() - 60, nonce: "0x" + "ee".repeat(32) };
const expiredSig = await user.signMessage(canonicalObjective(expired)); // 签名有效，只是过期
if (isUp) {
  const j = await submitRetry({ objective: expired, signature: expiredSig });
  check("rejected_by_objective", j.decision === "rejected_by_objective", JSON.stringify(j.reasons ?? j.error ?? j.decision));
} else {
  const { proposerCheck, verdict } = offlineVerdict({ objective: expired, signature: expiredSig, amount: desired, data, timeSeconds: now() });
  check("proposer 预检拒绝", !proposerCheck.ok, JSON.stringify(proposerCheck.reasons));
  check("challenger L5 拒绝", !verdict.agree && verdict.mismatches.join(",").includes("objective_expired"), verdict.mismatches.join(","));
}

console.log(`\n[soa-demo] ${pass} pass / ${fail} fail   （路径：${isUp ? (ONCHAIN ? "orchestrator HTTP + 真实上链" : "orchestrator HTTP（dry-run，零 gas）") : "本地重放，零 gas"}）`);
if (fail) process.exit(1);
