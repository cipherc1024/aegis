// Phase 2 部署：新 ReceiptRegistry（transcript 绑定 + MAX_BLOCK_AGE=100）+ setup + 新 AegisVaultQuorum
// setup：guardrail=challenger 认证值 / DcapGate 挂已有链上 gate / TEE 授权
// 旧 registry（0x91482e…）与新 vault（0x60F9…）作废为历史 demo 证据（链上仍可查）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv, getWallet, deploy } from "./lib.mjs";
import { attestedGuardrailHash } from "../challenger/verify.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();
loadEnv(path.join(__dirname, "..", "challenger", ".env"));
const wallet = getWallet();

const DCAP_GATE = "0xAe58a4F6DD3E281082193D4766f11d5F3Dfc66F".replace("082193", "0812193"); // 链上已有
const VALIDATION = process.env.VALIDATION || "0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa";
const AGENT_ID = 1n;

// challenger 自持策略 → 认证 guardrailHash（challenger 独立验证 L1 的锚点）
const policy = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "challenger", "challenger-policy.json"), "utf8"));
const GUARD = attestedGuardrailHash(policy);

const bal = await wallet.provider.getBalance(wallet.address);
console.log("deployer:", wallet.address, "balance:", (Number(bal) / 1e18).toFixed(4), "MON");
console.log("attested guardrail:", GUARD);

console.log("== 1/3 deploy ReceiptRegistry v2 ==");
const reg = await deploy(wallet, "ReceiptRegistry", [wallet.address], "artifacts/contracts/ReceiptRegistry.sol");
const regAddr = await reg.getAddress();

console.log("== 2/3 setup: guardrail + dcapGate + TEE ==");
await (await reg.setGuardrailHash(AGENT_ID, GUARD)).wait();
console.log("  guardrail set:", GUARD.slice(0, 18) + "...");
await (await reg.setDcapGate(DCAP_GATE)).wait();
console.log("  dcapGate set:", DCAP_GATE);
await (await reg.authorizeTEE(AGENT_ID, wallet.address)).wait();
console.log("  TEE authorized:", wallet.address);

console.log("== 3/3 deploy AegisVaultQuorum v2 ==");
const vault = await deploy(wallet, "AegisVaultQuorum", [regAddr, AGENT_ID, wallet.address, wallet.address, VALIDATION], "artifacts/contracts/AegisVaultQuorum.sol");
const vaultAddr = await vault.getAddress();

console.log("\n=== 部署完成 ===");
console.log("REGISTRY     =", regAddr);
console.log("QUORUM_VAULT =", vaultAddr);
console.log("guardrail    =", GUARD, "(challenger attested)");
console.log("更新 aegis/.env 的 REGISTRY / QUORUM_VAULT 与 challenger/.env.example");
process.exit(0);
