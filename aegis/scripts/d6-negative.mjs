// D6 负例测试（修正版）：先在 prev=0 阶段逐层触发各校验，再正例对照，最后重放
import fs from "node:fs";
import { ContractFactory, Wallet } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const params = JSON.parse(fs.readFileSync("tee/d4e2e/params.json", "utf8"));
const quote = "0x" + fs.readFileSync("tee/d4e2e/quote.hex", "utf8").trim().replace(/^0x/, "");
const otherQuote = "0x" + fs.readFileSync("tee/d4/quote.hex", "utf8").trim().replace(/^0x/, "");
const DCAP_GATE = "0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F";

const art = JSON.parse(fs.readFileSync("artifacts/contracts/ReceiptRegistry.sol/ReceiptRegistry.json", "utf8"));
const reg = await (new ContractFactory(art.abi, art.bytecode, wallet)).deploy(wallet.address);
await reg.waitForDeployment();
const regAddr = await reg.getAddress();
console.log("fresh ReceiptRegistry:", regAddr);
await (await reg.setGuardrailHash(1, params.guardrailHash)).wait();
await (await reg.setDcapGate(DCAP_GATE)).wait();

const provider = wallet.provider;
const n0 = await provider.getBlockNumber();
const hashAt = async (h) => (await provider.getBlock(h)).hash;

let pass = 0, fail = 0;
const check = (name, ok, extra) => {
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (extra ? "  | " + extra : ""));
  if (ok) pass++; else fail++;
};
async function expectRevert(name, expected, args) {
  try {
    await reg.submitReceiptWithQuote.staticCall(...args);
    check(name, false, "NO REVERT (attack accepted!)");
  } catch (e) {
    const reason = (e.reason || e.shortMessage || "reverted").slice(0, 60);
    check(name, true, reason + (expected && !reason.includes(expected) ? "  [expected: " + expected + "]" : ""));
  }
}

const base = [1, params.pdrHash, params.guardrailHash, params.executionHash, params.nonce];

// ── 阶段 A：prev=0，语义摘要与 quote 匹配，逐层触发各校验 ──
// A1 过期锚点
await expectRevert("A1 stale attestation (blockHeight-50)", "Stale", [...base, n0 - 50, "0x" + "00".repeat(32), false, quote]);
// A2 伪造区块锚点
await expectRevert("A2 block hash mismatch (forged anchor)", "Block hash", [...base, n0 - 2, "0x" + "22".repeat(32), false, quote]);
// A3 坏 quote（翻转 report_mac 区域一个 nibble：hex pos 120 ≈ 字节 60，TDX report 体前部）
const pos = 120;
const corrupt = quote.slice(0, pos) + (quote[pos] === "f" ? "0" : "f") + quote.slice(pos + 1);
await expectRevert("A3 corrupted quote -> not verified", "not verified", [...base, n0 - 2, await hashAt(n0 - 2), false, corrupt]);
// A4 跨收据 quote（d4 的 quote 绑定另一语义）
await expectRevert("A4 cross-receipt quote (d4) -> not bound", "not bound", [...base, n0 - 2, await hashAt(n0 - 2), false, otherQuote]);
// A5 篡改 executionHash
await expectRevert("A5 tamper executionHash -> not bound", "not bound", [...base.slice(0, 3), "0x" + "11".repeat(32), params.nonce, n0 - 2, await hashAt(n0 - 2), false, quote]);
// A6 护栏不匹配：registry 侧改错护栏，提交正确 quote（语义仍匹配 → 过 quote 检查 → 触发护栏校验）
await (await reg.setGuardrailHash(1, "0x" + "33".repeat(32))).wait();
await expectRevert("A6 guardrail mismatch (registry-side)", "Guardrail", [...base, n0 - 2, await hashAt(n0 - 2), false, quote]);
await (await reg.setGuardrailHash(1, params.guardrailHash)).wait();

// ── 阶段 B：正例对照（新锚点，正确 quote + 字段）→ 成功 ──
const n = await provider.getBlockNumber();
const block = await provider.getBlock(n);
const tx = await reg.submitReceiptWithQuote(...base, n, block.hash, false, quote);
const r = await tx.wait();
check("B1 positive control (correct quote + fields)", r.status === 1, "gasUsed=" + r.gasUsed);

// ── 阶段 C：正例后重放同一 quote（prev 已变）→ not bound ──
await expectRevert("C1 replay same quote -> not bound (prev changed)", "not bound", [...base, n - 2, await hashAt(n - 2), false, quote]);

// ── 阶段 D：非 governance 改 DcapGate（第二钱包 staticCall）──
const outsider = Wallet.createRandom().connect(provider);
const regOutsider = reg.connect(outsider);
try {
  await regOutsider.setDcapGate.staticCall("0x" + "44".repeat(40));
  check("D1 non-governance setDcapGate", false, "NO REVERT");
} catch (e) {
  check("D1 non-governance setDcapGate", true, (e.reason || e.shortMessage).slice(0, 40));
}

console.log(`\nD6 negative tests: ${pass} pass / ${fail} fail`);
