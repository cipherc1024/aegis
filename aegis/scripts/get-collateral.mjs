// 拉取 quote 对应的 DCAP collateral（PCK 证书 / TCB Info / QE Identity）并存文件
// 用法: node scripts/get-collateral.mjs tee/quote.hex tee/collateral.json
import fs from "node:fs";
import { getCollateral, PHALA_PCCS_URL } from "@phala/dcap-qvl";

function readText(p) {
  const r = fs.readFileSync(p);
  if (r.length >= 2 && r[0] === 0xff && r[1] === 0xfe) return r.toString("utf16le").replace(/^\uFEFF/, "");
  if (r.length >= 3 && r[0] === 0xef && r[1] === 0xbb && r[2] === 0xbf) return r.subarray(3).toString("utf8");
  return r.toString("utf8");
}

const [, , quoteFile = "tee/quote.hex", outFile = "tee/collateral.json"] = process.argv;
const hex = readText(quoteFile).trim().replace(/^0x/, "");
const quote = Buffer.from(hex, "hex");
console.log(`quote bytes: ${quote.length}, PCCS: ${PHALA_PCCS_URL}`);

const collateral = await getCollateral(PHALA_PCCS_URL, quote);
fs.writeFileSync(outFile, JSON.stringify(collateral, null, 2));

const keys = Object.keys(collateral ?? {});
console.log(`wrote ${outFile}; top-level keys: ${JSON.stringify(keys)}`);
