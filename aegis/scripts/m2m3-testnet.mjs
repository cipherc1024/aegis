// M2/M3 上链实测：部署 CommittedOracle / AtomicExecutor / AuditDraw，
// 采集真实 tx 哈希与 gas（论文 §8 的 A 级证据）。
//
//   M2: postObservation → executeAtomic（真 WMON wrap，原子读输入）→ 负例（假根 revert）
//   M3: commitDraw → 等 REVEAL_DELAY 块 → revealDraw → 事件索引 vs 链下重算逐值比对
//
// 运行：node scripts/m2m3-testnet.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { keccak256, AbiCoder, Contract } from "ethers";
import { loadEnv, getWallet, deploy } from "./lib.mjs";
import { computeInputRoot } from "../challenger/input-commitment.mjs";

loadEnv();
const wallet = getWallet();
const abi = AbiCoder.defaultAbiCoder();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541"; // 官方 canonical（链上核实过）
const ASSET_ID = keccak256(new TextEncoder().encode("WMON/MON"));
const PRICE = 1000000000000000000n;
const CAP = 50000000000000000n; // 0.05
const AMT = 10000000000000000n; // 0.01

const results = { date: new Date().toISOString().slice(0, 10), txs: {}, gas: {}, notes: [] };

// RPC 读滞后加固（记忆库：testnet RPC 读瞬时落后）：轮询直到条件满足
async function pollUntil(fn, what, tries = 30, gapMs = 1000) {
  for (let i = 0; i < tries; i++) {
    try { const v = await fn(); if (v) return v; } catch {}
    await new Promise((r) => setTimeout(r, gapMs));
  }
  throw new Error(`poll timeout: ${what}`);
}

async function recordTx(label, tx, note = "") {
  const rc = await tx.wait();
  results.txs[label] = `${tx.hash} @${rc.blockNumber}`;
  results.gas[label] = Number(rc.gasUsed);
  console.log(`  ${label}: ${tx.hash} @${rc.blockNumber}  gas=${rc.gasUsed}${note ? "  " + note : ""}`);
  return rc;
}

console.log("== 0. 部署三合约 ==");
const oracle = await deploy(wallet, "CommittedOracle", [], "artifacts/contracts/CommittedOracle.sol");
results.txs.deploy_CommittedOracle = oracle.deploymentTransaction().hash;
results.gas.deploy_CommittedOracle = Number((await oracle.deploymentTransaction().wait()).gasUsed);
console.log(`  gas=${results.gas.deploy_CommittedOracle}`);

const execC = await deploy(wallet, "AtomicExecutor",
  [await oracle.getAddress(), WMON, ASSET_ID, CAP], "artifacts/contracts/AtomicExecutor.sol");
results.txs.deploy_AtomicExecutor = execC.deploymentTransaction().hash;
results.gas.deploy_AtomicExecutor = Number((await execC.deploymentTransaction().wait()).gasUsed);
console.log(`  gas=${results.gas.deploy_AtomicExecutor}`);

const draw = await deploy(wallet, "AuditDraw", [], "artifacts/contracts/AuditDraw.sol");
results.txs.deploy_AuditDraw = draw.deploymentTransaction().hash;
results.gas.deploy_AuditDraw = Number((await draw.deploymentTransaction().wait()).gasUsed);
console.log(`  gas=${results.gas.deploy_AuditDraw}`);

const addrs = {
  CommittedOracle: await oracle.getAddress(),
  AtomicExecutor: await execC.getAddress(),
  AuditDraw: await draw.getAddress(),
  assetId: ASSET_ID, wmon: WMON,
};
fs.writeFileSync(path.join(__dirname, "m2m3-addresses.json"), JSON.stringify(addrs, null, 2));

console.log("\n== 1. M2：postObservation（治理按块锚喂价）==");
const postTx = await oracle.postObservation(ASSET_ID, PRICE);
const postRc = await recordTx("M2_postObservation", postTx);
const expectRoot = computeInputRoot(ASSET_ID, PRICE, postRc.blockNumber);
const chainRoot = await pollUntil(async () => {
  const r = await oracle.commitRoot(ASSET_ID);
  return r !== "0x" + "00".repeat(32) ? r : null;
}, "commitRoot 上链可读");
console.log(`  commitRoot=${chainRoot}  链下重算=${expectRoot}  一致=${chainRoot === expectRoot}`);
results.notes.push(`commitRoot==链下重算: ${chainRoot === expectRoot}`);

console.log("\n== 2. M2：executeAtomic（同一 tx 读 oracle + 真 WMON wrap 0.01）==");
const wmon = new Contract(WMON, ["function balanceOf(address) view returns (uint256)"], wallet.provider);
const balBefore = await wmon.balanceOf(await execC.getAddress());
const execTx = await execC.executeAtomic(AMT, chainRoot, { value: AMT });
const execRc = await recordTx("M2_executeAtomic", execTx);
const ev = execRc.logs.map((l) => { try { return execC.interface.parseLog(l); } catch { return null; } })
  .find((e) => e && e.name === "AtomicExecuted");
console.log(`  AtomicExecuted: price=${ev.args.price} obsBlock=${ev.args.obsBlock} amount=${ev.args.amountWei}`);
const balAfter = await pollUntil(async () => {
  const b = await wmon.balanceOf(await execC.getAddress());
  return b > balBefore ? b : null;
}, "WMON 余额增长");
console.log(`  executor WMON: ${balBefore} → ${balAfter}（真 wrap 落账）`);
results.notes.push(`executor WMON ${balBefore}→${balAfter}`);

console.log("\n== 3. M2 负例：伪造 expectedStateHash → 链上 revert 'input changed'（真实上链，status=0）==");
const fakeRoot = computeInputRoot(ASSET_ID, 1000000000000n, postRc.blockNumber); // 宣称价格 0.000001
try {
  const badTx = await execC.executeAtomic(AMT, fakeRoot, { value: AMT, gasLimit: 200000 });
  const badRc = await badTx.wait();
  console.log(`  意外成功？！ status=${badRc.status}`);
  results.notes.push("M2 负例意外成功（应 revert）——FAIL");
} catch (e) {
  const rc = e.receipt ?? e.info?.receipt;
  if (rc) {
    results.txs.M2_negative_fakeRoot = `${rc.hash} @${rc.blockNumber} (status=${rc.status})`;
    results.gas.M2_negative_fakeRoot = Number(rc.gasUsed);
    console.log(`  revert 已上链: ${rc.hash} @${rc.blockNumber} status=${rc.status} gas=${rc.gasUsed}`);
  } else {
    // 节点在广播前拒绝（eth_call 预检）：记录 revert reason，改用 staticCall 取证
    console.log(`  广播前预检拒绝（未上链）：${e.shortMessage ?? e.message}`);
    results.notes.push(`M2 负例由 RPC 预检拒绝（未消耗 gas）：${e.shortMessage ?? e.message}`);
    const reason = await execC.executeAtomic.staticCall(AMT, fakeRoot, { value: AMT }).then(
      () => "no-revert?!", (err) => err.shortMessage ?? err.message);
    console.log(`  staticCall 取证：${reason}`);
    results.txs.M2_negative_fakeRoot = `staticCall: ${reason}`;
  }
}

console.log("\n== 4. M3：commitDraw → revealDraw（链上承诺–揭示抽选）==");
const SEED = keccak256(new TextEncoder().encode(`m3-period-1-${Date.now()}`));
const COMMIT = keccak256(abi.encode(["bytes32"], [SEED]));
const commitTx = await draw.commitDraw(1, COMMIT);
const commitRc = await recordTx("M3_commitDraw", commitTx);
const anchorBlock = commitRc.blockNumber + 5;
await pollUntil(async () => {
  const bn = await wallet.provider.getBlockNumber();
  return bn >= anchorBlock ? bn : null;
}, `块高 >= ${anchorBlock}`, 60, 1000);
const anchorHash = (await wallet.provider.getBlock(anchorBlock)).hash;
console.log(`  锚块 ${anchorBlock} hash=${anchorHash}`);

const RC_COUNT = 1000, SAMPLE = 200;
const revealTx = await draw.revealDraw(1, SEED, RC_COUNT, SAMPLE);
const revealRc = await recordTx("M3_revealDraw", revealTx);
const dev = revealRc.logs.map((l) => { try { return draw.interface.parseLog(l); } catch { return null; } })
  .find((e) => e && e.name === "DrawRevealed");
const onchainIdx = dev.args.indices.map(BigInt);
const offIdx = [];
for (let i = 0; i < SAMPLE; i++) {
  const h = keccak256(abi.encode(["bytes32", "bytes32", "uint256", "uint256"], [SEED, anchorHash, 1n, BigInt(i)]));
  offIdx.push(BigInt(h) % BigInt(RC_COUNT));
}
const match = onchainIdx.length === offIdx.length && onchainIdx.every((v, i) => v === offIdx[i]);
console.log(`  抽选 ${SAMPLE}/${RC_COUNT}：链上事件索引 vs 链下重算 逐值一致=${match}`);
console.log(`  前 5 个索引: ${onchainIdx.slice(0, 5).join(", ")}`);
results.notes.push(`M3 抽选链上==链下重算: ${match}`);

fs.writeFileSync(path.join(__dirname, "m2m3-results.json"), JSON.stringify(results, null, 2));
console.log("\n== 汇总 ==");
for (const [k, v] of Object.entries(results.gas)) console.log(`  ${k}: ${v} gas`);
console.log(`结果已写入 scripts/m2m3-results.json / 地址 scripts/m2m3-addresses.json`);
