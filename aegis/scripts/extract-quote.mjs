// 从 Phala attestation JSON 抽出 TDX quote 到纯 hex 文件
// 用法: node scripts/extract-quote.mjs <attestation.json> <quote.hex>
import fs from "node:fs";

function readText(p) {
  const r = fs.readFileSync(p);
  if (r.length >= 2 && r[0] === 0xff && r[1] === 0xfe) return r.toString("utf16le").replace(/^\uFEFF/, "");
  if (r.length >= 3 && r[0] === 0xef && r[1] === 0xbb && r[2] === 0xbf) return r.subarray(3).toString("utf8");
  return r.toString("utf8");
}

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error("usage: node scripts/extract-quote.mjs <attestation.json> <quote.hex>");
  process.exit(1);
}

const j = JSON.parse(readText(input));
const q = j.app_certificates?.find((c) => c.quote)?.quote ?? j.quote;
if (!q) throw new Error("no quote found in attestation JSON");

const hex = q.replace(/^0x/, "");
fs.writeFileSync(output, hex);
console.log(`wrote ${output} bytes=${hex.length / 2}`);
