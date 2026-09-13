// 部署 quote 服务 CVM（Phala Cloud，tdx.small ≈ $0.06/小时，用户已授权常驻）
// 用法：node deploy-quote-cvm.mjs
// 产物：CVM aegis-quote 运行 quote-server.mjs（POST /quote → 真 TDX quote）
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const code = fs.readFileSync(path.join(process.cwd(), "tee", "intee", "quote-server.mjs"), "utf8");
const appB64 = Buffer.from(code).toString("base64");
fs.writeFileSync(path.join(process.cwd(), "tee", "quote", "app.b64"), appB64);
console.log("quote-server.mjs bytes:", code.length, "→ app.b64");

const envArg = `APP_B64=${appB64}`;
console.log("deploying CVM aegis-quote (tdx.small) ...");
try {
  const out = execSync(
    `phala deploy -c tee/quote/docker-compose.yml -n aegis-quote -t tdx.small --wait -e "${envArg}"`,
    { cwd: process.cwd(), encoding: "utf8", timeout: 480000, maxBuffer: 10 * 1024 * 1024 }
  );
  console.log(out);
} catch (e) {
  console.log("deploy stdout:", (e.stdout || "").slice(-2000));
  console.log("deploy stderr:", (e.stderr || "").slice(-2000));
  process.exit(1);
}
console.log("== get CVM info ==");
const info = execSync("phala cvms get aegis-quote -j", { encoding: "utf8", timeout: 60000, maxBuffer: 10 * 1024 * 1024 });
console.log(info.slice(0, 3000));
