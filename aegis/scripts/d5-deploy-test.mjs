// D5: 部署 DcapGate，用 D4 的真 quote 验证"链上验 quote + report_data 绑定"
import fs from "node:fs";
import { Contract } from "ethers";
import { loadEnv, getWallet, deploy } from "./lib.mjs";

loadEnv();
const wallet = getWallet();

const VERIFIER = "0x0eb496471d638173cdF35bE6b0e54FE035289F1f"; // V4QuoteVerifier
const TCB_EVAL = 20;

const gate = await deploy(wallet, "DcapGate", [VERIFIER, TCB_EVAL]);
const gateAddr = await gate.getAddress();

const quote = "0x" + fs.readFileSync("tee/d4/quote.hex", "utf8").trim().replace(/^0x/, "");
const expectedDigest = "0xf3e1510c1b804eba6da267ab8e5fa0c0bba9214b047d6ed4e2f36d36a46eb3ea"; // D4 的 digest
const wrongDigest = "0x" + "11".repeat(32);

console.log("=== check(quote, expectedDigest) ===");
console.log(await gate.check(quote, expectedDigest));
console.log("=== check(quote, wrongDigest) ===");
console.log(await gate.check(quote, wrongDigest));
console.log("=== reportDataDigest(quote) ===");
console.log(await gate.reportDataDigest(quote));

// 再测一个非本网络生成的 quote（旧 D1 quote）应 verified=true 但 bound=false
if (fs.existsSync("tee/quote.hex")) {
  const q1 = "0x" + fs.readFileSync("tee/quote.hex", "utf8").trim();
  console.log("=== check(D1 quote, expectedDigest) [expect verified=true,bound=false] ===");
  try {
    console.log(await gate.check(q1, expectedDigest));
  } catch (e) {
    console.log("err:", e.shortMessage || e.message);
  }
}
