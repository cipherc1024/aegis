// Ablation 1: commitment ablation (paper §8, ChatGPT-review P1-13).
//
// Research question: does *commitment* move choice verification from impossible
// to possible, and does *disclosure bandwidth* control how tightly?
//
// We hold the adversarial proposal FIXED (the agent drifts from the user's
// intended amount) and vary only the commitment regime:
//   L0  no commitment        - objective u absent            -> L5 cannot run
//   L1  commit, limited m    - u signed, verifier budget m small -> slack s*(m) large
//   L2  commit, larger m     - u signed, budget m larger         -> slack s*(m) smaller
//   L3  commit, full m=kappa - u signed, exact (d_mu=1 analytic) -> slack 0
// The deployable tolerance must be >= s*(m) to stay sound, so the largest
// *accepted* drift shrinks as bandwidth grows. Same verifier (verifyDecision);
// only the regime changes. Zero gas, fully offline:
//
//   node scripts/commitment-ablation.mjs
//
// Honesty: this is a controlled ablation of the SOA objective layer. The slack
// values s*(m) are *parameters* set to the B1 scale measured in
// scripts/spectrum-bandwidth.mjs (slopes -1.00/-0.50/-0.33, §8.8); this script
// does not re-measure them.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, AbiCoder, Wallet, parseEther } from "ethers";
import { verifyDecision, attestedGuardrailHash } from "../challenger/verify.mjs";
import { canonicalObjective } from "../challenger/objective.mjs";
import { loadEnv } from "./lib.mjs";

loadEnv();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const abi = AbiCoder.defaultAbiCoder();
const policy = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "challenger", "challenger-policy.json"), "utf8"));
const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";
const DATA = "0xd0e30db0";
const GUARD = attestedGuardrailHash(policy);
const NONCE = "0x" + "ab".repeat(32);
const NOW = Math.floor(Date.now() / 1000);
const user = Wallet.createRandom();

// intended (signed) amount and the adversarial drift we hold fixed
const DESIRED = parseEther("0.01");
const DRIFT = parseEther("0.02");   // adversary proposes 0.03, still within perTxLimit 0.05
const AMOUNT = DESIRED + DRIFT;

const mkObj = (tolWei) => ({
  v: 1, kind: "trade", user: user.address, asset: "WMON", target: WMON,
  desiredWei: DESIRED.toString(), maxWei: (DESIRED + BigInt(tolWei)).toString(),
  tolWei: tolWei.toString(), deadline: NOW + 3600, nonce: "0x" + "cd".repeat(32),
});

function mkReceipt(amount) {
  const exec = keccak256(abi.encode(["address", "uint256", "bytes"], [WMON, amount, DATA]));
  const pdr = keccak256(abi.encode(["bytes32", "bytes32", "bool"], [exec, GUARD, true]));
  const digest = keccak256(abi.encode(
    ["uint256", "bytes32", "bytes32", "bytes32", "uint256", "bytes32", "bytes32", "bytes32"],
    [1, pdr, GUARD, exec, 1000, "0x" + "22".repeat(32), "0x" + "11".repeat(32), NONCE]));
  return { digest, pdrHash: pdr, guardrailHash: GUARD, executionHash: exec, blockHeight: 1000,
           blockHash: "0x" + "22".repeat(32), nonce: NONCE, prev: "0x" + "11".repeat(32), timestamp: NOW };
}

// slack s*(m) parameters: representative B1-scale values (see §8.8).
const S_LIMITED = parseEther("0.020");   // small m  (d_mu=2, coarse menu)
const S_LARGER = parseEther("0.006");    // larger m (finer menu)
const S_FULL = 0n;                       // m = kappa, exact

// L0: no objective at all
function caseNoCommit() {
  return verifyDecision({
    policy,
    transcript: { command: "buy WMON 0.03", marketData: "ok", target: WMON, amount: AMOUNT.toString(), data: DATA },
    receipt: mkReceipt(AMOUNT), dailySpent: null, agentId: 1,
  });
}
// L1..L3: signed objective with tolerance = deployable slack s*(m)
function caseCommit(tolWei) {
  const o = mkObj(tolWei);
  return verifyDecision({
    policy,
    transcript: { command: "buy WMON 0.03", marketData: "ok", target: WMON, amount: AMOUNT.toString(), data: DATA,
                  objective: o, objectiveSignature: user.signMessageSync(canonicalObjective(o)) },
    receipt: mkReceipt(AMOUNT), dailySpent: null, agentId: 1,
  });
}

const REGIMES = [
  { id: "L0", name: "no commitment",              budget: "m = 0",        slack: "n/a (u absent)", run: caseNoCommit,               expectBlocked: false },
  { id: "L1", name: "commit, limited bandwidth",  budget: "m < kappa",    slack: "s* = 0.020",     run: () => caseCommit(S_LIMITED), expectBlocked: false },
  { id: "L2", name: "commit, larger bandwidth",   budget: "m larger",     slack: "s* = 0.006",     run: () => caseCommit(S_LARGER),  expectBlocked: true  },
  { id: "L3", name: "commit, full m = kappa",     budget: "m = kappa",    slack: "s* = 0",         run: () => caseCommit(S_FULL),    expectBlocked: true  },
];

console.log(`commitment ablation | intended=${DESIRED} wei, adversarial drift=${DRIFT} wei (proposed amount=${AMOUNT} wei)`);
console.log(`perTxLimit=${policy.perTxLimit} (drift stays within cap, so PACE never fires)\n`);
console.log(`${"regime".padEnd(4)} ${"commitment".padEnd(28)} ${"budget".padEnd(10)} ${"slack".padEnd(16)} ${"outcome".padEnd(10)} verdict`);
let rows = [];
for (const r of REGIMES) {
  const v = r.run();
  const blocked = !v.agree;
  const hit = Object.entries(v.layers).find(([, s]) => String(s).startsWith("fail:"))?.[0] ?? null;
  const ok = blocked === r.expectBlocked;
  console.log(`${r.id.padEnd(4)} ${r.name.padEnd(28)} ${r.budget.padEnd(10)} ${r.slack.padEnd(16)} ` +
              `${(blocked ? "BLOCKED" : "ACCEPTED").padEnd(10)} ${ok ? "as-expected" : "UNEXPECTED"}` +
              `${blocked ? "  [" + hit + "]" : ""}`);
  rows.push({ id: r.id, regime: r.name, budget: r.budget, slack: r.slack, blocked,
              layer: hit, reasons: v.mismatches, expected: ok });
}

console.log("\nstory: no commitment -> drift ACCEPTED (verification impossible);");
console.log("       commit + limited m -> drift within certified slack ACCEPTED (bounded);");
console.log("       commit + larger/full m -> drift REJECTED (objective_not_eps_optimal).");
console.log("       => commitment turns an impossible check into a possible one;");
console.log("          disclosure bandwidth controls how tightly it can certify.");

const out = {
  ts: new Date().toISOString(),
  experiment: "commitment-ablation",
  desired_wei: DESIRED.toString(), drift_wei: DRIFT.toString(), amount_wei: AMOUNT.toString(),
  per_tx_limit: policy.perTxLimit,
  rows,
};
fs.writeFileSync(path.join(__dirname, "..", "..", "..", "monad论文", "figs", "commitment-ablation.json"),
                 JSON.stringify(out, null, 2));
console.log("\nsaved figs/commitment-ablation.json");

if (rows.some((r) => !r.expected)) process.exit(1);
