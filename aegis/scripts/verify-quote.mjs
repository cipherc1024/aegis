// 离链验证 Phala TEE attestation quote（D1）
// 用法: node scripts/verify-quote.mjs <attestation.json | quote.hex>
import fs from "node:fs";
import { getCollateralAndVerify, Quote } from "@phala/dcap-qvl";

function extractQuoteHex(raw) {
  const trimmed = raw.trim();
  if (trimmed.startsWith("{")) {
    const j = JSON.parse(trimmed);
    const candidates = [
      j.quote,
      j.quote_hex,
      j.raw_quote,
      j.attestation?.quote,
      j.data?.quote,
      j.app_certificates?.[0]?.quote,
    ];
    const q = candidates.find((x) => typeof x === "string" && x.length > 100);
    if (!q) throw new Error("no quote field found in JSON (looked for quote / quote_hex / raw_quote)");
    return q;
  }
  return trimmed; // 视作原始 hex
}

const file = process.argv[2];
if (!file) {
  console.error("usage: node scripts/verify-quote.mjs <attestation.json | quote.hex>");
  process.exit(1);
}

// 兼容 PowerShell 的 UTF-16LE 输出与 UTF-8(BOM)
function readText(path) {
  const raw = fs.readFileSync(path);
  if (raw.length >= 2 && raw[0] === 0xff && raw[1] === 0xfe) {
    return raw.toString("utf16le").replace(/^\uFEFF/, "");
  }
  if (raw.length >= 3 && raw[0] === 0xef && raw[1] === 0xbb && raw[2] === 0xbf) {
    return raw.subarray(3).toString("utf8");
  }
  return raw.toString("utf8");
}

const raw = readText(file);
const hex = extractQuoteHex(raw).replace(/^0x/, "");
const buf = Buffer.from(hex, "hex");
console.log(`quote bytes: ${buf.length}`);

try {
  const q = Quote.parse(buf);
  console.log("quote header:", JSON.stringify({ version: q.header?.version, teeType: q.header?.teeType }));
  const rd = q.report?.report_data ?? q.reportData;
  if (rd) console.log("report_data:", Buffer.from(rd).toString("hex"));
} catch (e) {
  console.log("Quote.parse warning:", e.message);
}

const result = await getCollateralAndVerify(buf);
console.log("=== verification result ===");
console.log(
  JSON.stringify(
    { status: result.status, advisory_ids: result.advisory_ids, ppid: result.ppid },
    null,
    2
  )
);
