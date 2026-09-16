// v4 部署：AegisVaultQuorum（含 challenger 验证者白名单 + 交易槽钩子）
//
// 为什么是 v4：v2（0xe6E24BB7…）缺 isTrustedValidator 白名单——ValidationRegistry 无需许可，
// 任何人可自证自答伪造 quorum；v3（0x3e5dDe45…）虽有白名单，但钩子仍读链头 lastReceiptHash，
// 心跳顶掉链头后每笔 executeTrade 都 revert "No challenger quorum"。
// v4 同时带上两项修复，且钩子改读 lastTradeReceipt（注册表既有 public getter，无需重部署 registry）。
//
// 幂等性：本脚本只部署 + 授权 + 设限额，不迁移资金。旧金库余额用 withdraw 单独处理。
// 用法：node scripts/deploy-v4.mjs
import { loadEnv, getWallet, deploy } from "./lib.mjs";
import { attestedGuardrailHash } from "../challenger/verify.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();
const wallet = getWallet();

const REGISTRY = process.env.REGISTRY || "0x4622D041696942dC873a8A5E54f1e1ca9669c90B";
const VALIDATION = process.env.VALIDATION || "0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa";
const AGENT_ID = 1n;
const TEE = wallet.address;
const OWNER = wallet.address;
const CHALLENGER = process.env.CHALLENGER_ADDR || "0x16e619c3d6625f4d6F583791A4C2351D65508a2c";

const policy = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "challenger", "challenger-policy.json"), "utf8")
);
const GUARD = attestedGuardrailHash(policy);

const bal = await wallet.provider.getBalance(wallet.address);
console.log("deployer    :", wallet.address);
console.log("balance     :", (Number(bal) / 1e18).toFixed(6), "MON");
console.log("registry    :", REGISTRY);
console.log("validation  :", VALIDATION);
console.log("challenger  :", CHALLENGER);
console.log("guardrail   :", GUARD);
console.log("");

if (Number(bal) / 1e18 < 0.8) {
  console.error(`余额不足：需 ≥0.8 MON（大合约部署实测约 0.78），当前 ${(Number(bal) / 1e18).toFixed(4)}`);
  process.exit(1);
}

console.log("== 部署 AegisVaultQuorum v4 ==");
const vault = await deploy(
  wallet,
  "AegisVaultQuorum",
  [REGISTRY, AGENT_ID, TEE, OWNER, VALIDATION],
  "artifacts/contracts/AegisVaultQuorum.sol"
);
const addr = await vault.getAddress();

// 校验构造参数真的落到了链上（不靠"部署成功"这句话）
const [vr, teeOn, ownerOn, agentOn] = await Promise.all([
  vault.validationRegistry(),
  vault.teeDerivedAddress(),
  vault.owner(),
  vault.agentId(),
]);
console.log("\n== 部署后链上复核 ==");
console.log("  validationRegistry :", vr, vr.toLowerCase() === VALIDATION.toLowerCase() ? "OK" : "MISMATCH");
console.log("  teeDerivedAddress  :", teeOn, teeOn.toLowerCase() === TEE.toLowerCase() ? "OK" : "MISMATCH");
console.log("  owner              :", ownerOn, ownerOn.toLowerCase() === OWNER.toLowerCase() ? "OK" : "MISMATCH");
console.log("  agentId            :", agentOn.toString(), agentOn === AGENT_ID ? "OK" : "MISMATCH");
const countBefore = await vault.trustedValidatorCount();
console.log("  trustedValidatorCount(初始):", countBefore.toString(), countBefore === 0n ? "OK（fail-closed）" : "MISMATCH");

console.log("\n== 授权 challenger ==");
const tx = await vault.setTrustedValidator(CHALLENGER, true);
console.log("  tx:", tx.hash);
await tx.wait();
const trusted = await vault.isTrustedValidator(CHALLENGER);
const countAfter = await vault.trustedValidatorCount();
console.log("  isTrustedValidator:", trusted, "count:", countAfter.toString());

console.log("\n=== 部署完成 ===");
console.log("QUORUM_VAULT =", addr);
console.log("\n后续（按序）：");
console.log("  1. 更新 aegis/.env 的 QUORUM_VAULT=" + addr);
console.log("  2. node scripts/whitelist-wmon.mjs        # 金库白名单加 WMON");
console.log("  3. 旧金库余额 withdraw 迁移（如有）");
console.log("  4. Tenderly 源码级重新验证");
console.log("  5. 全链 E2E 复跑");
process.exit(0);
