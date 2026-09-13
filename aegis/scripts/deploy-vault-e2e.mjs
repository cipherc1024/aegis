// ② Vault 执行闭环 + 心跳：部署 AegisVault，提交交易收据 -> executeTrade；再心跳
import fs from "node:fs";
import { ContractFactory, Contract, keccak256, toUtf8Bytes, AbiCoder, parseEther } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const provider = wallet.provider;
const REGISTRY = "0xee3C795a8F5f3Bd3Cc0DEDFF23c785888eEd2c6E";
const TARGET = "0x000000000000000000000000000000000000bEEF";
const GUARD = keccak256(toUtf8Bytes("guardrail-v1"));
const abiCoder = AbiCoder.defaultAbiCoder();
const agentId = 1n;

const regAbi = JSON.parse(fs.readFileSync("artifacts/contracts/ReceiptRegistry.sol/ReceiptRegistry.json", "utf8")).abi;
const vaultAbi = JSON.parse(fs.readFileSync("artifacts/contracts/AegisVault.sol/AegisVault.json", "utf8")).abi;
const reg = new Contract(REGISTRY, regAbi, wallet);

console.log("balance:", (await provider.getBalance(wallet.address)).toString());

// 1) 部署 Vault（demo 用 wallet 同时充当 owner 与 TEE）
const Vault = new ContractFactory(vaultAbi, JSON.parse(fs.readFileSync("artifacts/contracts/AegisVault.sol/AegisVault.json", "utf8")).bytecode, wallet);
const vault = await Vault.deploy(REGISTRY, agentId, wallet.address, wallet.address);
await vault.waitForDeployment();
const vaultAddr = await vault.getAddress();
console.log("AegisVault:", vaultAddr);

// 2) 授权 TEE + 配置 Vault
await (await reg.authorizeTEE(agentId, wallet.address)).wait();
await (await vault.deposit({ value: parseEther("0.5") })).wait();
await (await vault.setTarget(TARGET, true)).wait();
await (await vault.setLimits(parseEther("1"), parseEther("5"))).wait();
console.log("configured vault (deposit 0.5 MON, whitelist target, limits)");

// 3) 提交一张【交易】收据（onlyTEE 回退路径），执行哈希绑定 executeTrade 的 calldata
const amount = parseEther("0.1");
const data = "0xdeadbeef";
const execHash = keccak256(abiCoder.encode(["address", "uint256", "bytes"], [TARGET, amount, data]));
async function submit(isHeartbeat) {
  const n = await provider.getBlockNumber();
  const blk = await provider.getBlock(n);
  const nc = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const pdr = keccak256(toUtf8Bytes("pdr-" + nc));
  await (await reg.submitReceipt(agentId, pdr, GUARD, isHeartbeat ? "0x" + "00".repeat(32) : execHash, nc, n, blk.hash, isHeartbeat)).wait();
  return n;
}
await submit(false);
console.log("trade receipt submitted; isTradeFresh:", await reg.isTradeFresh(agentId));

// 4) 执行交易（Vault 校验 latestExecutionHash + isTradeFresh）
const tx = await vault.executeTrade(TARGET, amount, data);
const r = await tx.wait();
console.log("executeTrade tx:", tx.hash, "status:", r.status, "gas:", r.gasUsed.toString());
console.log("target.call ok (EOA call returns true)");

// 5) 心跳收据 -> isAlive 恢复
await submit(true);
console.log("heartbeat submitted; isAlive(60):", await reg.isAlive(agentId, 60n));

console.log("\nVAULT=" + vaultAddr);
