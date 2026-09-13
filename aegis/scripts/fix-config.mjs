import fs from "node:fs";
import { Contract } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const REGISTRY = "0x91482e67998a01C0A33Fe12ec01A6A43177A7181";
const VAULT = "0x0CB00eb81Bc975554bFcC3c1d4A6636663428B0B";
const regAbi = JSON.parse(fs.readFileSync("artifacts/contracts/ReceiptRegistry.sol/ReceiptRegistry.json", "utf8")).abi;
const vaultAbi = JSON.parse(fs.readFileSync("artifacts/contracts/AegisVault.sol/AegisVault.json", "utf8")).abi;
const reg = new Contract(REGISTRY, regAbi, wallet);
const vault = new Contract(VAULT, vaultAbi, wallet);

console.log("agentTEE[1]:", await reg.agentTEE(1n));
console.log("vault.tee:", await vault.teeDerivedAddress());
console.log("vault.owner:", await vault.owner());
console.log("gov:", await reg.governance());
console.log("guardrail[1]:", await reg.agentGuardrailHash(1n));

await (await reg.authorizeTEE(1, wallet.address)).wait();
await (await vault.setTEE(wallet.address)).wait();
console.log("configured agentTEE + vault TEE ->", wallet.address);
console.log("agentTEE[1] now:", await reg.agentTEE(1n));
console.log("vault.tee now:", await vault.teeDerivedAddress());
