// 打印 dcap 入口/验证器的相关函数签名
import fs from "node:fs";
const OUT = process.env.DCAP_OUT || "vendor/dcap-repo/evm/out";   // 相对 aegis/ 工作目录；可用 DCAP_OUT 覆盖
for (const n of ["AutomataDcapAttestationFee", "AttestationEntrypointBase", "V4QuoteVerifier"]) {
  const p = `${OUT}/${n}.sol/${n}.json`;
  if (!fs.existsSync(p)) { console.log("missing", n); continue; }
  const abi = JSON.parse(fs.readFileSync(p, "utf8")).abi;
  console.log("=== " + n + " ===");
  for (const e of abi) {
    if (e.type === "function" && /verify|fee|QuoteVerifier/i.test(e.name)) {
      const ins = e.inputs.map((x) => x.type + (x.components ? "(" + x.components.map((c) => c.type + " " + c.name).join(", ") + ")" : " " + x.name)).join(", ");
      const outs = e.outputs.map((x) => x.type).join(",");
      console.log(`  ${e.name}(${ins}) -> (${outs}) [${e.stateMutability}]`);
    }
  }
}
// Header struct for verifyQuote
const v4 = JSON.parse(fs.readFileSync(`${OUT}/V4QuoteVerifier.sol/V4QuoteVerifier.json`, "utf8")).abi;
const vq = v4.find((e) => e.name === "verifyQuote");
console.log("=== V4QuoteVerifier.verifyQuote inputs ===");
console.log(JSON.stringify(vq.inputs, null, 1));
