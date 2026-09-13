// ② 重部署（MAX_BLOCK_AGE=40）并走原子执行闭环
import fs from "node:fs";
import { ContractFactory, Contract, Interface, keccak256, toUtf8Bytes, AbiCoder, parseEther } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const provider = wallet.provider;
const OLD_VAULT = "0xd1A6df6614bdB78DA39f0d23CaC9E6B692FB67b1";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const DCAP_GATE = "0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F";
const TARGET = "0x000000000000000000000000000000000000bEEF";
const GUARD = keccak256(toUtf8Bytes("guardrail-v1"));
const coder = AbiCoder.defaultAbiCoder();

const regJson = JSON.parse(fs.readFileSync("artifacts/contracts/ReceiptRegistry.sol/ReceiptRegistry.json", "utf8"));
const vaultJson = JSON.parse(fs.readFileSync("artifacts/contracts/AegisVault.sol/AegisVault.json", "utf8"));

// 0) 撤回旧 Vault 里的 0.5 MON
const oldVault = new Contract(OLD_VAULT, vaultJson.abi, wallet);
try {
  const bal = await provider.getBalance(OLD_VAULT);
  if (bal > 0n) {
    await (await oldVault.withdraw(bal)).wait();
    console.log("withdrew from old vault:", bal.toString());
  }
} catch (e) {
  console.log("old vault withdraw skipped:", e.shortMessage || e.message);
}

// 1) 新 Registry
const Registry = new ContractFactory(regJson.abi, regJson.bytecode, wallet);
const reg = await Registry.deploy(wallet.address);
await reg.waitForDeployment();
const regAddr = await reg.getAddress();
await (await reg.setGuardrailHash(1, GUARD)).wait();
await (await reg.setDcapGate(DCAP_GATE)).wait();
await (await reg.authorizeTEE(1, wallet.address)).wait();
console.log("ReceiptRegistry:", regAddr, "MAX_BLOCK_AGE:", (await reg.MAX_BLOCK_AGE()).toString());

// 2) 新 Vault
const Vault = new ContractFactory(vaultJson.abi, vaultJson.bytecode, wallet);
const vault = await Vault.deploy(regAddr, 1, wallet.address, wallet.address);
await vault.waitForDeployment();
const vaultAddr = await vault.getAddress();
await (await vault.deposit({ value: parseEther("0.1") })).wait();
await (await vault.setTarget(TARGET, true)).wait();
await (await vault.setLimits(parseEther("1"), parseEther("5"))).wait();
console.log("AegisVault:", vaultAddr);

// 3) 原子：提交交易收据 + executeTrade
const amount = parseEther("0.1");
const data = "0xdeadbeef";
const execHash = keccak256(coder.encode(["address", "uint256", "bytes"], [TARGET, amount, data]));
const n = await provider.getBlockNumber();
const blk = await provider.getBlock(n);
const nonce = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const pdr = keccak256(toUtf8Bytes("pdr-" + nonce));
const call1 = new Interface(regJson.abi).encodeFunctionData("submitReceipt", [1n, pdr, GUARD, execHash, nonce, n, blk.hash, false]);
const call2 = new Interface(vaultJson.abi).encodeFunctionData("executeTrade", [TARGET, amount, data]);
const mc = new Contract(MULTICALL3, ["function aggregate3((address,bool,bytes)[]) payable returns ((bool,bytes)[])"], wallet);
const tx = await mc.aggregate3([
  { target: regAddr, allowFailure: false, callData: call1 },
  { target: vaultAddr, allowFailure: false, callData: call2 },
]);
const r = await tx.wait();
console.log("multicall status:", r.status, "gas:", r.gasUsed.toString());

// 4) 心跳
const n2 = await provider.getBlockNumber();
const blk2 = await provider.getBlock(n2);
const nc2 = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const t3 = await reg.submitReceipt(1, keccak256(toUtf8Bytes("hb")), GUARD, "0x" + "00".repeat(32), nc2, n2, blk2.hash, true);
await t3.wait();
console.log("heartbeat; isAlive(60):", await reg.isAlive(1, 60n));
console.log("todaySpent:", (await vault.dailySpent(BigInt(Math.floor(Date.now() / 86400000)))).toString());

console.log("\nREGISTRY=" + regAddr + "\nVAULT=" + vaultAddr);
