// Vault 执行闭环（紧凑序列：提交交易收据后立刻 executeTrade，避免超过 MAX_BLOCK_AGE=8）
import fs from "node:fs";
import { Contract, keccak256, toUtf8Bytes, AbiCoder, parseEther } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const provider = wallet.provider;
const REGISTRY = "0x91482e67998a01C0A33Fe12ec01A6A43177A7181";
const VAULT = process.env.VAULT || "0x0CB00eb81Bc975554bFcC3c1d4A6636663428B0B";
const TARGET = "0x000000000000000000000000000000000000bEEF";
const GUARD = keccak256(toUtf8Bytes("guardrail-v1"));
const coder = AbiCoder.defaultAbiCoder();
const agentId = 1n;

const regAbi = JSON.parse(fs.readFileSync("artifacts/contracts/ReceiptRegistry.sol/ReceiptRegistry.json", "utf8")).abi;
const vaultAbi = JSON.parse(fs.readFileSync("artifacts/contracts/AegisVault.sol/AegisVault.json", "utf8")).abi;
const reg = new Contract(REGISTRY, regAbi, wallet);
const vault = new Contract(VAULT, vaultAbi, wallet);

const amount = parseEther("0.1");
const data = "0xdeadbeef";
const execHash = keccak256(coder.encode(["address", "uint256", "bytes"], [TARGET, amount, data]));

// 1) 提交交易收据（用最新区块做锚点）
const n = await provider.getBlockNumber();
const blk = await provider.getBlock(n);
const nonce = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const pdr = keccak256(toUtf8Bytes("pdr-" + nonce));
const t1 = await reg.submitReceipt(agentId, pdr, GUARD, execHash, nonce, n, blk.hash, false);
await t1.wait();
console.log("receipt tx:", t1.hash);

// 2) 立刻执行（不插入任何读取）
const t2 = await vault.executeTrade(TARGET, amount, data);
const r2 = await t2.wait();
console.log("executeTrade tx:", t2.hash, "status:", r2.status, "gas:", r2.gasUsed.toString());

// 3) 心跳（刷新 isAlive）
const n2 = await provider.getBlockNumber();
const blk2 = await provider.getBlock(n2);
const nonce2 = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const t3 = await reg.submitReceipt(agentId, keccak256(toUtf8Bytes("hb")), GUARD, "0x" + "00".repeat(32), nonce2, n2, blk2.hash, true);
await t3.wait();
console.log("heartbeat tx:", t3.hash, "isAlive:", await reg.isAlive(agentId, 60n));
console.log("vault balance:", (await provider.getBalance(VAULT)).toString());
