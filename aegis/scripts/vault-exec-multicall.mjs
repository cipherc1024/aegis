// 用 Multicall3 原子化「提交交易收据 + executeTrade」，消除两笔交易间的块间隔
import fs from "node:fs";
import { Contract, Interface, keccak256, toUtf8Bytes, AbiCoder, parseEther } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const provider = wallet.provider;
const REGISTRY = "0x91482e67998a01C0A33Fe12ec01A6A43177A7181";
const VAULT = process.env.VAULT || "0x0CB00eb81Bc975554bFcC3c1d4A6636663428B0B";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const TARGET = "0x000000000000000000000000000000000000bEEF";
const GUARD = keccak256(toUtf8Bytes("guardrail-v1"));
const coder = AbiCoder.defaultAbiCoder();

const regAbi = JSON.parse(fs.readFileSync("artifacts/contracts/ReceiptRegistry.sol/ReceiptRegistry.json", "utf8")).abi;
const vaultAbi = JSON.parse(fs.readFileSync("artifacts/contracts/AegisVault.sol/AegisVault.json", "utf8")).abi;
const regIface = new Interface(regAbi);
const vaultIface = new Interface(vaultAbi);

const amount = parseEther("0.1");
const data = "0xdeadbeef";
const execHash = keccak256(coder.encode(["address", "uint256", "bytes"], [TARGET, amount, data]));

const n = await provider.getBlockNumber();
const blk = await provider.getBlock(n);
const nonce = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const pdr = keccak256(toUtf8Bytes("pdr-" + nonce));

const call1 = regIface.encodeFunctionData("submitReceipt", [1n, pdr, GUARD, execHash, nonce, n, blk.hash, false]);
const call2 = vaultIface.encodeFunctionData("executeTrade", [TARGET, amount, data]);

const mcAbi = [
  "function aggregate3((address target, bool allowFailure, bytes callData)[] calls) payable returns ((bool success, bytes returnData)[])",
];
const mc = new Contract(MULTICALL3, mcAbi, wallet);

// 先 staticCall 诊断内层错误
const probe = await mc.aggregate3.staticCall([
  { target: REGISTRY, allowFailure: true, callData: call1 },
  { target: VAULT, allowFailure: true, callData: call2 },
]);
const errIface = new Interface(["error Error(string)"]);
probe.forEach((res, i) => {
  const ok = res[0] ?? res.success;
  const data = res[1] ?? res.returnData;
  let reason = "";
  try {
    reason = errIface.parseError(data)?.args?.[0] ?? data.slice(0, 10);
  } catch {
    reason = data.slice(0, 10);
  }
  console.log(`call${i} (${i === 0 ? "submitReceipt" : "executeTrade"}):`, ok ? "ok" : "REVERT " + reason);
});

const tx = await mc.aggregate3([
  { target: REGISTRY, allowFailure: false, callData: call1 },
  { target: VAULT, allowFailure: false, callData: call2 },
]);
console.log("multicall tx:", tx.hash);
const r = await tx.wait();
console.log("status:", r.status, "gas:", r.gasUsed.toString(), "block:", r.blockNumber);

const rec = await reg.lastTradeReceipt(1n);
console.log("stored executionHash:", rec.executionHash);
console.log("delta:", r.blockNumber - Number(rec.blockHeight));
console.log("isTradeFresh now:", await reg.isTradeFresh(1n));
