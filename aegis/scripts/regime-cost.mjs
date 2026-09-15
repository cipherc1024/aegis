// Aegis 谱系代价曲线（论文《新原语提案》T1 三分谱系 / T5 覆盖网的工程测量）—— 零 gas、全离线
//
// 测什么：
//  A) 各「验证制度」的实测单位代价（µs/次，本机）：
//       ① δ：护栏 + PACE（T1 功能性验证，κ=1）—— 与目标空间无关，恒定
//       ② SOA-lite 目标层：EIP-191 验签 + 单变量 ε-最优性 —— 与菜单规模无关，恒定
//       ③ 全菜单最优性（T2 公开目标）：验证「执行动作是菜单 argmax」需扫 N 点 —— 线性于 N
//  B) 覆盖网规模随维度 d 的增长（合成计算，明确标注「非实测」）：(D/ε)^d ——
//     解释为什么私有意图（T4/T5）不能用枚举验证，只能用 ε-松弛，且代价随维度爆炸。
//
// 结论（用于论文 §6/§8 与答辩）：
//  - 本系统的安全关键路径（δ + 目标层）代价恒定（O(1)），可放进任何共识/执行热路径；
//  - "最优性"验证的代价由【菜单结构】决定，而非由模型大小决定（LLM 只当 proposer 的意义）；
//  - ε-验证是私有意图的唯一可扩展出路：固定 ε 时覆盖率随 d 指数下降 → 只能是概率保证。
//
// 运行：node scripts/regime-cost.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, AbiCoder, Wallet } from "ethers";
import { verifyDecision, attestedGuardrailHash } from "../challenger/verify.mjs";
import { canonicalObjective, checkObjective } from "../challenger/objective.mjs";
import { runGuardrail, paceVerify, buildIntent } from "../tee-runtime/runtime.mjs";
import { loadEnv } from "./lib.mjs";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const abi = AbiCoder.defaultAbiCoder();
const policy = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "challenger", "challenger-policy.json"), "utf8"));
const ZERO32 = "0x" + "00".repeat(32);
const GUARD = attestedGuardrailHash(policy);
const WL0 = policy.whitelist[0];
const NOW = Math.floor(Date.now() / 1000);

/// 计时器：warmup 后再测，返回 µs/op 与 ops/s
async function bench(name, fn, iters) {
  for (let i = 0; i < Math.max(3, Math.floor(iters / 10)); i++) await fn(i);
  const t0 = performance.now();
  for (let i = 0; i < iters; i++) await fn(i);
  const dt = performance.now() - t0;
  const us = (dt * 1000) / iters;
  return { name, us, opsPerSec: 1e6 / us, iters };
}

// ---------- A) 实测 ----------
const CMD = "buy WMON 0.01";
const MD = "WMON wrap via official canonical contract; depth ok";

const benchGuardrail = await bench("δ: 护栏（normalize+注入+blocklist）", () => runGuardrail(`${CMD} ${MD}`, policy), 20000);
const intent = buildIntent({ target: WL0, amount: 10000000000000000n, data: "0x", slippageBps: 0 });
const benchPace = await bench("δ: PACE（白名单+限额）", () => paceVerify(intent, policy), 50000);

const user = Wallet.createRandom();
const obj = {
  v: 1, kind: "trade", user: user.address, asset: "MON", target: WL0,
  desiredWei: "10000000000000000", maxWei: "20000000000000000", tolWei: "1000000000000000",
  deadline: NOW + 3600, nonce: "0x" + "cd".repeat(32),
};
const sig = await user.signMessage(canonicalObjective(obj));
const benchObjVerify = await bench("L5: EIP-191 验签 + ε-检查", () => checkObjective({ objective: obj, signature: sig, action: { target: WL0, amount: 10000000000000000n }, policy, timeSeconds: NOW }), 3000);

// 仅 ε 检查（无签名验证）：用非法签名短路前不适用，改为直接手算偏离量做对照
const benchDev = await bench("（对照）手算 |amount−desired| ≤ tol", () => {
  const d = 10000000000000000n;
  return 10000000000000000n - d <= 1000000000000000n;
}, 100000);

// 完整 5 层离线重推导（含 L5）
const exec = keccak256(abi.encode(["address", "uint256", "bytes"], [WL0, 10000000000000000n, "0x"]));
const pdr = keccak256(abi.encode(["bytes32", "bytes32", "bool"], [exec, GUARD, true]));
const digest = keccak256(abi.encode(
  ["uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32", "bytes32"],
  [1, pdr, GUARD, exec, 1000, "0x" + "22".repeat(32), "0x" + "11".repeat(32), "0x" + "ab".repeat(32)]
));
const receipt = { digest, pdrHash: pdr, guardrailHash: GUARD, executionHash: exec, blockHeight: 1000, blockHash: "0x" + "22".repeat(32), nonce: "0x" + "ab".repeat(32), prev: "0x" + "11".repeat(32), timestamp: NOW };
const transcript = { command: CMD, marketData: MD, target: WL0, amount: "10000000000000000", data: "0x", objective: obj, objectiveSignature: sig };
const benchFull = await bench("完整重推导（L1–L5，含 1 次验签）", () => verifyDecision({ policy, transcript, receipt, dailySpent: null, agentId: 1 }), 2000);
const transcriptNoObj = { command: CMD, marketData: MD, target: WL0, amount: "10000000000000000", data: "0x" };
const benchFullNoObj = await bench("完整重推导（L1–L4，无目标层）", () => verifyDecision({ policy, transcript: transcriptNoObj, receipt, dailySpent: null, agentId: 1 }), 3000);

console.log("=== A) 实测：单次验证代价（本机 Node " + process.version + "）===");
for (const r of [benchGuardrail, benchPace, benchObjVerify, benchDev, benchFullNoObj, benchFull]) {
  console.log(`  ${r.name.padEnd(34)} ${r.us.toFixed(1).padStart(9)} µs/次   ${Math.round(r.opsPerSec).toLocaleString("en-US").padStart(10)} ops/s`);
}

// 全菜单最优性验证（T2 场景）：验证者要确认 executed 是 argmax → 必须扫完菜单
console.log("\n=== A2) 实测：全菜单最优性验证（扫 N 点，T2 公开目标场景）===");
const menuResults = [];
for (const N of [10, 100, 1000, 10000, 100000]) {
  const menu = Array.from({ length: N }, (_, i) => BigInt(i + 1) * 10n ** 15n); // 0.001 … N*0.001 MON
  const executed = 10n * 10n ** 15n;
  const r = await bench(`枚举 N=${N} 的最优性检查`, () => {
    let best = -1n, bestDev = null;
    let executedIsArgmax = false;
    for (const a of menu) {
      const dev = a > 10000000000000000n ? a - 10000000000000000n : 10000000000000000n - a;
      if (bestDev === null || dev < bestDev) { bestDev = dev; best = a; }
      if (a === executed) executedIsArgmax = dev === 0n;
    }
    return { best, executedIsArgmax };
  }, Math.max(20, Math.floor(200000 / N)));
  menuResults.push({ N, us: r.us });
  console.log(`  ${r.name.padEnd(34)} ${r.us.toFixed(1).padStart(9)} µs/次   ${Math.round(r.opsPerSec).toLocaleString("en-US").padStart(10)} ops/s`);
}
const perPoint = (menuResults.at(-1).us - menuResults[0].us) / (menuResults.at(-1).N - menuResults[0].N);
console.log(`  线性拟合：≈ ${(perPoint * 1000).toFixed(1)} ns/点（验证代价 ∝ 菜单规模，与模型大小无关）`);

// ---------- B) 合成：覆盖网规模 ----------
console.log("\n=== B) 合成（非实测）：ε-覆盖网规模 ≈ (D/ε)^d ===");
console.log("  含义：私有意图（T4/T5）无法枚举验证；用 ε-网覆盖动作空间时，格子数随维度指数增长。");
console.log("  取值：D = 单笔上限 0.05 MON（策略给定）；ε = 容差；d = 动作空间自由度（金额/滑点/时机/…）");
const D = 0.05;
const dimensionRows = [];
for (const eps of [0.01, 0.001, 0.0001]) {
  const R = Math.round(D / eps);
  const row = { eps, ratio: R, cells: {} };
  for (const d of [1, 2, 3, 5]) {
    const cells = Math.pow(R, d);
    row.cells[d] = cells;
  }
  dimensionRows.push(row);
  console.log(`  ε=${String(eps).padEnd(8)} D/ε=${String(R).padStart(5)}  →  d=1: ${row.cells[1].toExponential(2)}   d=2: ${row.cells[2].toExponential(2)}   d=3: ${row.cells[3].toExponential(2)}   d=5: ${row.cells[5].toExponential(2)} 格`);
}
console.log("  → 本系统 SOA-lite 取 d=1（金额单自由度，受真实路径 WMON wrap 限制）：覆盖网 = D/ε = 50 格，恒定可查；");
console.log("    若把 d 扩到滑点/时机/多资产，固定 ε 下覆盖率指数下降 → 验证退化为概率保证（论文 T5 的诚实边界）。");
