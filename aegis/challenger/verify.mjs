// Aegis Challenger 验证器（自包含包 —— 整目录拷到 proposer 之外的机器运行，与 proposer 零共享代码）
//
// 5 层独立重推导（L1–L5，对每一层都可单独说"不"）：
//   L1 策略认证   收据 guardrailHash 必须等于 keccak("guardrail-v1", challenger 自持策略哈希)
//                 —— "这笔决策声称使用的策略，必须恰好是我独立审过并持有的这一份"
//   L2 独立护栏   自持 normalize + 注入模式表 + blocklist，独立重跑护栏
//   L3 独立 PACE  白名单 / 单笔限额 / 日限（dailySpent 由 agent 从 vault 链上读取）
//   L4 算术绑定   重算 executionHash / pdrHash / digest；决策原文的执行字段必须是
//                 链上 executionHash 的 preimage —— transcript 伪造直接 mismatch
//   L5 目标层     （SOA-lite，原文携带 objective+签名时启用）用户对目标 u 的 EIP-191
//                 签名验证 + 执行动作对 u 的 ε-最优性检查。目标演进方向不可验证（T1），
//                 但"给定目标后是否按目标执行"可验证 —— 崩溃点从"执行者"移到"目标制定"。
//
// 失败设计（fail-closed）：任何一层不通过 → response=0。
// 无原文不签名：transcript 拉取失败 → response=0（"no transcript, no signature"）。
import { keccak256, toUtf8Bytes, AbiCoder } from "ethers";
import { checkObjective } from "./objective.mjs";

const abi = AbiCoder.defaultAbiCoder();
const ZERO32 = "0x" + "00".repeat(32);

// ---------- 自持规范化（与 proposer 同口径避免假性分歧；规则本身可更严格） ----------
const INVISIBLE = /[\u200B-\u200D\u2060\uFEFF]/g;

function normalize(input) {
  let s = String(input).replace(INVISIBLE, "");
  s = s.toLowerCase();
  const map = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "$": "s", "@": "a" };
  s = s.replace(/[01345$@]/g, (c) => map[c] ?? c);
  return s.trim();
}

// ---------- 自持策略哈希（字段顺序固定，与链上 guardrailHash 口径一致） ----------
export function policyHash(policy) {
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

/// challenger 认可的 guardrailHash：治理侧 setGuardrailHash 必须设成这个值（policy-attest.mjs）
export function attestedGuardrailHash(policy) {
  return keccak256(abi.encode(["string", "bytes32"], ["guardrail-v1", policyHash(policy)]));
}

/// 决策原文哈希（与 orchestrator bindTranscript 的编码严格一致）。
/// transcript: { command, marketData, target, amount(string), data }
export function computeTranscriptHash(transcript) {
  return keccak256(
    abi.encode(
      ["string", "string", "address", "uint256", "bytes"],
      [transcript.command ?? "", transcript.marketData ?? "", transcript.target, BigInt(transcript.amount ?? "0"), transcript.data || "0x"]
    )
  );
}

// ---------- L1 策略认证 ----------
function layer1_policy(policy, receipt) {
  const expected = attestedGuardrailHash(policy);
  if (receipt.guardrailHash !== expected) {
    return { ok: false, reason: "policy_not_attested", expected, got: receipt.guardrailHash };
  }
  return { ok: true, expected };
}

// ---------- L2 独立护栏 ----------
// normalize 的 leet folding 会把 "a11" 折成 "aii"、把 "1gn0re" 折成 "ignore"，
// 于是 a11/aii 这类折叠产物让 /ignore (all )?previous/ 漏判（curl 验证过：
// "1gn0re a11 prev10us" -> "ignore aii previous"，正则不匹配）。
// 因此在模式里同时接受折叠产物（aii/ali/…），确保混淆注入仍被拦。
const INJECTION_PATTERNS = [
  /ignore (a[il1]+ )?previous/,   // all / aii（1->i 折叠产物）/ ali
  /disregard .*instruction/,
  /you are now/,
  /system prompt/,
  /urgent.*(swap|transfer|send) (a[il1]+|everything)/,
];

function layer2_guardrail(policy, transcript) {
  const t = normalize(`${transcript.command ?? ""} ${transcript.marketData ?? ""}`);
  const reasons = [];
  for (const re of INJECTION_PATTERNS) if (re.test(t)) reasons.push("injection_pattern");
  for (const b of policy.blocklist) if (t.includes(normalize(b))) reasons.push(`blocklist:${b}`);
  if (/(airdrop|空投)/.test(t) && /(swap|换成|transfer)/.test(t)) reasons.push("suspicious_social_engineering");
  return reasons;
}

// ---------- L3 独立 PACE ----------
function layer3_pace(policy, transcript, dailySpent) {
  if (!policy.whitelist.map((x) => String(x).toLowerCase()).includes(String(transcript.target).toLowerCase())) {
    return "target_not_whitelisted";
  }
  if (BigInt(transcript.amount) > BigInt(policy.perTxLimit)) return "exceeds_per_tx_limit";
  if (dailySpent !== null && dailySpent !== undefined) {
    if (BigInt(dailySpent) + BigInt(transcript.amount) > BigInt(policy.dailyLimit)) return "exceeds_daily_limit";
  }
  return null;
}

// ---------- L4 算术绑定 ----------
function layer4_arithmetic(transcript, receipt, agentId) {
  const mismatches = [];
  // 心跳收据 executionHash 恒为 0x00…0（无执行体可绑定），跳过 preimage/PDR 检查
  const isHeartbeat = receipt.executionHash === ZERO32;

  // 4a) 决策原文的执行字段必须是链上 executionHash 的 preimage
  // 4b) PDR 算术
  let expectedExec = ZERO32;
  if (!isHeartbeat) {
    expectedExec = keccak256(
      abi.encode(["address", "uint256", "bytes"], [transcript.target, transcript.amount, transcript.data || "0x"])
    );
    if (expectedExec !== receipt.executionHash) mismatches.push("executionHash_mismatch");
    const expectedPdr = keccak256(abi.encode(["bytes32", "bytes32", "bool"], [expectedExec, receipt.guardrailHash, true]));
    if (expectedPdr !== receipt.pdrHash) mismatches.push("pdrHash_mismatch");
  }

  // 4c) 收据摘要算术（digest 为链上锚点；prev 由原文提供，但被 4c 反向锚定：
  //     proposer 若谎报 prev/任何字段，重算 digest 必与链上 digest 不符）
  if (receipt.digest && receipt.digest !== ZERO32) {
    const expectedDigest = keccak256(
      abi.encode(
        ["uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32", "bytes32"],
        [agentId, receipt.pdrHash, receipt.guardrailHash, receipt.executionHash, receipt.blockHeight, receipt.blockHash, receipt.prev, receipt.nonce]
      )
    );
    if (expectedDigest !== receipt.digest) mismatches.push("digest_mismatch");
  }

  return { mismatches, expectedExec };
}

// ---------- 主入口 ----------
/// policy      challenger 自持策略（challenger-policy.json）
/// transcript  决策原文（orchestrator GET /api/decision/:receiptHash）
/// receipt     链上直读的收据（latestReceipt struct + prev）
/// dailySpent  当日已花费（从 vault 读；null = 未配置 vault，跳过日限并标注）
export function verifyDecision({ policy, transcript, receipt, dailySpent = null, agentId = 1 }) {
  const layers = {};

  const l1 = layer1_policy(policy, receipt);
  layers["1_policy"] = l1.ok ? "pass" : `fail:${l1.reason}`;
  if (!l1.ok) return { agree: false, response: 0, layers, mismatches: [l1.reason], expectedGuardrailHash: l1.expected };

  const gReasons = layer2_guardrail(policy, transcript);
  layers["2_guardrail"] = gReasons.length === 0 ? "pass" : `fail:${gReasons.join(",")}`;
  if (gReasons.length) {
    return { agree: false, response: 0, layers, mismatches: ["challenger_blocks_decision:" + gReasons.join(",")] };
  }

  const pReject = layer3_pace(policy, transcript, dailySpent);
  layers["3_pace"] = pReject ? `fail:${pReject}` : dailySpent === null ? "pass(daily skipped)" : "pass";
  if (pReject) return { agree: false, response: 0, layers, mismatches: ["challenger_policy_reject:" + pReject] };

  const l4 = layer4_arithmetic(transcript, receipt, agentId);
  layers["4_arithmetic"] = l4.mismatches.length === 0 ? "pass" : `fail:${l4.mismatches.join(",")}`;

  // L5 目标层（SOA-lite）：原文携带 objective+objectiveSignature 时启用。
  // 未携带 = proposer 未走 SOA 流程 → 该层缺席（如实标注，不假装验证过）。
  // 时间源：优先链上收据 timestamp（不可伪造）；缺失则 null → deadline 检查 fail-closed。
  const objMismatches = [];
  if (transcript.objective || transcript.objectiveSignature) {
    const o = checkObjective({
      objective: transcript.objective,
      signature: transcript.objectiveSignature,
      action: { target: transcript.target, amount: transcript.amount },
      policy,
      timeSeconds: receipt.timestamp ?? null,
    });
    layers["5_objective"] = o.ok ? "pass" : `fail:${o.reasons.join(",")}`;
    for (const r of o.reasons) objMismatches.push("challenger_objective_reject:" + r);
  }

  const mismatches = [...l4.mismatches, ...objMismatches];
  return {
    agree: mismatches.length === 0,
    response: mismatches.length === 0 ? 100 : 0,
    layers,
    mismatches,
    expectedExec: l4.expectedExec,
  };
}
