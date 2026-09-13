// 用真 quote（tee/quote.hex）调 V4QuoteVerifier.verifyQuote（view，不花 gas）
import fs from "node:fs";
import { Contract } from "ethers";
import { Quote } from "@phala/dcap-qvl";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const provider = wallet.provider;

const OUT = "C:/Users/12190/Desktop/本科二年级/Monad量化/aegis/vendor/dcap-repo/evm/out";
const abi = JSON.parse(fs.readFileSync(`${OUT}/V4QuoteVerifier.sol/V4QuoteVerifier.json`, "utf8")).abi;
const verifier = "0x0eb496471d638173cdF35bE6b0e54FE035289F1f"; // V4QuoteVerifier

const quotePath = process.argv[2] || "tee/quote.hex";
const hex = fs.readFileSync(quotePath, "utf8").trim().replace(/^0x/, "");
const q = hex.toLowerCase();
const slice = (a, b) => "0x" + q.slice(a * 2, b * 2);
console.log("quote file:", quotePath);

try {
  const parsed = Quote.parse(Buffer.from(q, "hex"));
  const rd = parsed.report?.report_data ?? parsed.reportData;
  if (rd) console.log("quote report_data:", Buffer.from(rd).toString("hex"));
} catch (e) {
  console.log("Quote.parse:", e.message);
}

const header = {
  version: parseInt(q.slice(0, 2), 16) + (parseInt(q.slice(2, 4), 16) << 8), // LE u16
  attestationKeyType: slice(2, 4),
  teeType: slice(4, 8),
  qeSvn: slice(8, 10),
  pceSvn: slice(10, 12),
  qeVendorId: slice(12, 28),
  userData: slice(28, 48),
};
console.log("header:", header);
console.log("quote bytes:", q.length / 2);

const c = new Contract(verifier, abi, provider);
try {
  const [success, output] = await c.verifyQuote(header, "0x" + q, 20);
  console.log("=== verifyQuote RESULT ===");
  console.log("success:", success);
  console.log("output:", output);
  const gas = await c.verifyQuote.estimateGas(header, "0x" + q, 20);
  console.log("estimateGas (verifyQuote):", gas.toString());
} catch (e) {
  console.log("=== verifyQuote REVERTED/ERROR ===");
  console.log(e.shortMessage || e.message);
}
