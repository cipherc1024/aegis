import fs from "node:fs";
import { Contract } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const provider = wallet.provider;
const REGISTRY = "0xee3C795a8F5f3Bd3Cc0DEDFF23c785888eEd2c6E";
const abi = JSON.parse(fs.readFileSync("artifacts/contracts/ReceiptRegistry.sol/ReceiptRegistry.json", "utf8")).abi;
const reg = new Contract(REGISTRY, abi, wallet);

const bn = await provider.getBlockNumber();
const rec = await reg.lastTradeReceipt(1n);
const latest = await reg.latestReceipt(1n);
console.log("current block:", bn);
console.log("lastTradeReceipt.blockHeight:", rec.blockHeight?.toString?.() ?? rec[4]?.toString());
console.log("lastTradeReceipt.submitBlock:", rec.submitBlock?.toString?.() ?? rec[6]?.toString());
console.log("lastTradeReceipt.executionHash:", rec.executionHash);
console.log("latestReceipt.blockHeight:", latest.blockHeight?.toString?.() ?? latest[4]?.toString());
console.log("latestReceipt.isHeartbeat:", latest.isHeartbeat ?? latest[9]);
console.log("isTradeFresh:", await reg.isTradeFresh(1n));
console.log("isAlive(60):", await reg.isAlive(1n, 60n));
console.log("MAX_BLOCK_AGE:", (await reg.MAX_BLOCK_AGE()).toString());
