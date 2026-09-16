// 对抗 TEE 仿真 · 单入口（论文 §8.2 的三腿编排）
//
// 实验问题：attestation 都视为完全有效（最坏情形授权）时，"attestation-valid but
// backdoored" 的三条链路是否仍被拦下？——Thm T5 必要性的实验对应。
//
// 三条腿（与论文 §8.2 一一对应，攻击面互不重叠）：
//   腿1 离线语义腿 —— proposer 自持放宽版策略 / 超限 / 白名单外目标提交收据
//        （attack-family 的策略 π 格，L1/L3 拦截）
//   腿2 链上腿     —— 真实有效 TDX quote + guardrailHash ≠ registry 认证值
//        （D6-A6，链上 revert `Guardrail mismatch`；默认引用 documented 运行）
//   腿3 仲裁腿     —— proposer 篡改执行字节/digest → challenger L4 重推导发现
//        （attack-family 的执行绑定格 + quorum 闸门 `No challenger quorum`）
//
// 运行：
//   node scripts/tee-adversary-sim.mjs            # 零 gas（腿2/腿3 的链上证据引用 documented 运行）
//   node scripts/tee-adversary-sim.mjs --live     # 腿2 改为真实上链（d6-negative，需 RPC + ~0.15 MON）
//
// 诚实边界：attestation 固定为"有效"是最坏情形假设（对防御者不利），不是"模拟被攻破的
// TDX"；真机静态腐化不可模拟，亦不需要（必要性论证只要求此方向）。
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const LIVE = process.argv.includes("--live");

const run = (script, args = []) =>
  spawnSync(process.execPath, [path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  });

// attack-family 输出行形如 "      判定=BLOCKED  拦截层=1_policy      期望=1_policy"
const parseVerdicts = (out) =>
  [...out.matchAll(/判定=(BLOCKED|ACCEPTED)\s+拦截层=(\S+)/g)].map((m) => ({
    blocked: m[1] === "BLOCKED", layer: m[2],
  }));

let legsFailed = 0;
const leg = (name, ok, detail) => {
  legsFailed += ok ? 0 : 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  | " + detail : ""}`);
};

console.log("=== 对抗 TEE 仿真（attestation 视为有效 + 策略后门）===\n");

// ---------- 腿1+腿3 的离线部分：attack-family（零 gas） ----------
console.log("[腿1/腿3 离线部分] node scripts/attack-family.mjs（零 gas）");
const af = run("attack-family.mjs");
console.log(af.stdout.trim().split("\n").filter((l) => /^OK|^FAIL|attack-family:|expectations:/.test(l)).join("\n"));
if (af.status !== 0) {
  console.error(af.stderr);
  process.exit(1);
}
const verdicts = parseVerdicts(af.stdout);
const policyRows = verdicts.filter((v) => v.blocked && (v.layer === "1_policy" || v.layer === "3_pace"));
const tamperRows = verdicts.filter((v) => v.blocked && v.layer === "4_arithmetic");
const boundaryRows = verdicts.filter((v) => !v.blocked);

console.log("\n[腿1] 离线语义腿：attestation 有效 + 放宽版策略（L1/L3 拦截）");
leg("策略后门被拦", policyRows.length >= 3, `${policyRows.length} 行 BLOCKED @ L1/L3（policy_not_attested / exceeds_per_tx_limit / target_not_whitelisted）`);
leg("L1 是承重墙（attestation 只证『哪个环境产生了决策』，不证『策略是用户的』）",
  policyRows.some((v) => v.layer === "1_policy"), "policy_not_attested 命中");

console.log("\n[腿3 离线部分] 仲裁腿：篡改执行字节/digest（challenger L4 重推导）");
leg("篡改被独立重推导发现", tamperRows.length >= 2, `${tamperRows.length} 行 BLOCKED @ L4（executionHash_mismatch / digest_mismatch）`);
console.log("        （生产路径：challenger 上链 response=0 → VaultQuorum 闸门拒绝，见下）");

// ---------- 腿2：链上 D6-A6 ----------
console.log("\n[腿2] 链上腿：真实有效 quote + guardrailHash ≠ registry 认证值");
if (LIVE) {
  console.log("  --live：真实上链重跑 d6-negative（fresh ReceiptRegistry，~0.15 MON gas）…");
  const d6 = run("d6-negative.mjs");
  const d6out = d6.stdout;
  const a6 = /A6[^\n]*|Guardrail mismatch/.exec(d6out)?.[0] ?? "(A6 行未找到)";
  console.log(d6out.trim().split("\n").filter((l) => /PASS|FAIL/.test(l)).join("\n"));
  leg("D6-A6 真实上链 revert `Guardrail mismatch`", d6.status === 0 && /Guardrail mismatch/.test(d6out), a6);
} else {
  // 零 gas：引用 documented 运行（2026-09-12，dcap-verifier/STATUS.md），并核对该记录在库
  const status = fs.readFileSync(path.join(ROOT, "dcap-verifier", "STATUS.md"), "utf8");
  const a6line = status.split("\n").find((l) => l.includes("A6") && l.includes("Guardrail mismatch"));
  leg("D6-A6 documented 证据在库（revert `Guardrail mismatch`）", Boolean(a6line),
    a6line?.trim() ?? "STATUS.md 未找到 A6 行");
  console.log("        （真实上链重跑：node scripts/tee-adversary-sim.mjs --live，需 RPC + ~0.15 MON）");
}

// ---------- 腿3 的链上部分：quorum 闸门（documented） ----------
console.log("\n[腿3 链上部分] quorum 闸门：无 challenger 背书 → executeTrade revert");
const status = fs.readFileSync(path.join(ROOT, "dcap-verifier", "STATUS.md"), "utf8");
const qline = status.split("\n").find((l) => l.includes("No challenger quorum"));
leg("『No challenger quorum』documented 证据在库（场景1 revert + TradeExecuted 事件扫描 = 0）",
  Boolean(qline), qline?.trim() ?? "STATUS.md 未找到 quorum 行");

// ---------- R1 设计边界（如实呈现，不藏） ----------
console.log("\n[设计边界·如实呈现] 未提交参照物格（输入 x）");
leg("输入代换 ACCEPTED = R1 不可能性（设计边界，非防御失败）", boundaryRows.length === 1,
  `${boundaryRows.length} 行 ACCEPTED（闭包内谓词只验证『给定 x 的决策』，不验证 x 本身）`);

// ---------- 结论 ----------
console.log("\n=== 结论 ===");
console.log(`attestation 完全有效的前提下：策略后门 ${policyRows.length} 行全被 L1/L3 拦下；`
  + `篡改 ${tamperRows.length} 行全被 challenger L4 发现（链上腿 = revert Guardrail mismatch，`
  + `仲裁腿 = response=0 → No challenger quorum）；唯一放行格 = 输入 x（R1 设计边界）。`);
console.log(`tee-adversary-sim: ${legsFailed === 0 ? "ALL LEGS PASS" : legsFailed + " leg(s) FAILED"}`);
process.exit(legsFailed === 0 ? 0 : 1);
