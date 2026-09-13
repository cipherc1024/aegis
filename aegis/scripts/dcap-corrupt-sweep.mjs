// 余额 + 坏 quote 位置扫描（全 view 调用，零成本）：定位 V4 verifier 的完整性盲区
import { Contract, Interface, keccak256, AbiCoder } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const provider = wallet.provider;
const bal = await provider.getBalance(wallet.address);
console.log("balance:", (Number(bal) / 1e18).toFixed(5), "MON");

const fs = await import("node:fs");
const params = JSON.parse(fs.readFileSync("tee/d4e2e/params.json", "utf8"));
const quote = "0x" + fs.readFileSync("tee/d4e2e/quote.hex", "utf8").trim().replace(/^0x/, "");
const DCAP_GATE = "0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F";
const gate = new Contract(DCAP_GATE, new Interface([
  "function check(bytes rawQuote, bytes32 expectedDigest) view returns (bool verified, bool bound)",
]), provider);

// 语义摘要（prev=0，与 D5 quote 绑定一致）
const semantic = keccak256(AbiCoder.defaultAbiCoder().encode(
  ["uint256", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
  [1, params.pdrHash, params.guardrailHash, params.executionHash, params.nonce, "0x" + "00".repeat(32)]
));

const base = await gate.check(quote, semantic);
console.log("\nbaseline (original quote):", base);
if (!base[0] || !base[1]) { console.log("baseline must be (true,true) — aborting"); process.exit(0); }

// 位置扫描：翻转一个 nibble，看 verifier 是否捕获
const positions = [
  [40, "quote header"],
  [120, "report_mac 区"],
  [400, "report 体"],
  [800, "tee_data/report_data 区"],
  [1200, "report 体尾部/QE 区"],
  [2000, "QE report 区"],
  [3000, "QE 签名区"],
  [4000, "cert 链区"],
  [quote.length - 2000, "cert 链区(尾-2000)"],
  [quote.length - 1000, "cert 链区(尾-1000)"],
  [quote.length - 200, "cert 链区(尾-200)"],
  [quote.length - 100, "cert 链区(尾-100)"],
  [quote.length - 20, "尾部 padding"],
];

console.log("\n位置扫描（flip 1 nibble → check）:");
let caught = 0, missed = 0;
for (const [pos, label] of positions) {
  const corrupt = quote.slice(0, pos) + (quote[pos] === "f" ? "0" : "f") + quote.slice(pos + 1);
  try {
    const [v, b] = await gate.check(corrupt, semantic);
    const detected = !(v && b);
    console.log(`${detected ? "CAUGHT" : "MISSED"}  pos=${pos} (${label})  verified=${v} bound=${b}`);
    detected ? caught++ : missed++;
  } catch (e) {
    console.log(`CAUGHT  pos=${pos} (${label})  revert: ${(e.reason || e.shortMessage).slice(0, 50)}`);
    caught++;
  }
}
console.log(`\nsweep: ${caught} caught / ${missed} missed`);
