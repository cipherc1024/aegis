import fs from "node:fs";
import { Contract } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet(false);
const REGISTRY = process.env.R || "0x91482e67998a01C0A33Fe12ec01A6A43177A7181";
const VAULT = process.env.V || "0x0CB00eb81Bc975554bFcC3c1d4A6636663428B0B";
const regAbi = JSON.parse(fs.readFileSync("artifacts/contracts/ReceiptRegistry.sol/ReceiptRegistry.json", "utf8")).abi;
const vaultAbi = JSON.parse(fs.readFileSync("artifacts/contracts/AegisVault.sol/AegisVault.json", "utf8")).abi;
const reg = new Contract(REGISTRY, regAbi, wallet.provider);
const vault = new Contract(VAULT, vaultAbi, wallet.provider);

console.log("registry MAX_BLOCK_AGE:", (await reg.MAX_BLOCK_AGE()).toString());
console.log("lastReceiptHash:", await reg.lastReceiptHash(1n));
console.log("isTradeFresh:", await reg.isTradeFresh(1n));
console.log("isAlive(60):", await reg.isAlive(1n, 60n));
const rec = await reg.latestReceipt(1n);
console.log("latest blockHeight:", rec.blockHeight.toString(), "isHeartbeat:", rec.isHeartbeat);
console.log("vault balance:", (await wallet.provider.getBalance(VAULT)).toString());
