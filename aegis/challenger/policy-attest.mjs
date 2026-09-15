// 从 challenger 自持策略计算"被认证的 guardrailHash"，并由治理侧设置上链。
// 默认只打印（零 gas）；--execute 才发 setGuardrailHash 交易（治理钱包 = 主钱包）。
// 策略变更流程：改 challenger-policy.json → 通知 proposer 重跑本脚本 --execute。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, FallbackProvider, Wallet, Contract } from "ethers";
import { attestedGuardrailHash } from "./verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
for (const f of [path.join(__dirname, ".env"), path.join(__dirname, "..", ".env"), ".env"]) {
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  }
}

const policy = JSON.parse(fs.readFileSync(path.join(__dirname, "challenger-policy.json"), "utf8"));
const attested = attestedGuardrailHash(policy);
const AGENT_ID = Number(process.env.AGENT_ID || 1);
const REGISTRY = process.env.REGISTRY || "0x4622D041696942dC873a8A5E54f1e1ca9669c90B";

console.log("challenger attested guardrailHash:", attested);

// orchestrator env 与策略文件一致性检查（防两侧口径漂移）
const envBlocklist = (process.env.BLOCKLIST || "").split(",").filter(Boolean).sort().join(",");
const envWhitelist = (process.env.WHITELIST || "").split(",").map((x) => x.toLowerCase()).sort().join(",");
const policyBlocklist = [...policy.blocklist].sort().join(",");
const policyWhitelist = [...policy.whitelist].map((x) => x.toLowerCase()).sort().join(",");
if (envBlocklist !== policyBlocklist) console.warn("⚠️ BLOCKLIST env 与策略文件不一致：env=", envBlocklist, " policy=", policyBlocklist);
if (envWhitelist !== policyWhitelist) console.warn("⚠️ WHITELIST env 与策略文件不一致：env=", envWhitelist, " policy=", policyWhitelist);

const provider = new FallbackProvider(
  [
    { provider: new JsonRpcProvider(process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz", 10143, { staticNetwork: true }), priority: 1, weight: 1, stallTimeout: 2500 },
    { provider: new JsonRpcProvider("https://rpc.ankr.com/monad_testnet", 10143, { staticNetwork: true }), priority: 1, weight: 1, stallTimeout: 2500 },
  ],
  10143,
  { quorum: 1, cacheTimeout: -1 }
);
const reg = new Contract(REGISTRY, [
  "function agentGuardrailHash(uint256) view returns (bytes32)",
  "function setGuardrailHash(uint256,bytes32)",
], provider);

const cur = await reg.agentGuardrailHash(AGENT_ID);
console.log("on-chain current      :", cur, cur === attested ? "(已认证 ✓)" : "(未认证 —— 独立 challenger 将拒绝所有收据，需 --execute 设置)");

if (process.argv.includes("--execute")) {
  if (cur === attested) { console.log("已是认证值，无需交易"); process.exit(0); }
  if (!process.env.MONAD_TESTNET_PK) { console.error("缺 MONAD_TESTNET_PK（治理钱包）"); process.exit(1); }
  const wallet = new Wallet(process.env.MONAD_TESTNET_PK, provider);
  const tx = await reg.connect(wallet).setGuardrailHash(AGENT_ID, attested);
  const r = await tx.wait();
  console.log("setGuardrailHash tx:", tx.hash, "status:", r.status, "gas:", r.gasUsed.toString());
}
