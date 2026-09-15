// 链上 quorum E2E：proposer 收据 → challenger 互证 → AegisVaultQuorum.executeTrade
// 场景：① 无验证 → revert "No challenger quorum" ② challenger 同意 → 执行成功
// ⚠️ v1 时代脚本：下方地址为已废弃的 v1 合约；且脚本会改写 registry 的 agentGuardrailHash，
//    切勿对着 v2 生产地址（0x4622D041… / 0xe6E24BB7…）跑——会破坏现网 challenger 认证。
import { loadEnv, getWallet, deploy } from "./lib.mjs";
import { JsonRpcProvider, Contract } from "ethers";

loadEnv();
const wallet = getWallet();
const challenger = new (await import("ethers")).Wallet(process.env.CHALLENGER_PK, wallet.provider);

const REGISTRY = "0x91482e67998a01C0A33Fe12ec01A6A43177A7181";
const VALIDATION = "0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa";
const QUORUM_VAULT = "0x60F9F1FBa953ce5CD9c8805CD4858eFf35BcB20a";
const AGENT_ID = 1n;
const GUARD = "0x" + "11".repeat(32); // 需与链上 agentGuardrailHash 一致，下方治理设置

const reg = new Contract(REGISTRY, [
  "function submitReceipt(uint256,bytes32,bytes32,bytes32,bytes32,uint256,bytes32,bool)",
  "function lastReceiptHash(uint256) view returns (bytes32)",
  "function latestExecutionHash(uint256) view returns (bytes32)",
  "function agentGuardrailHash(uint256) view returns (bytes32)",
  "function setGuardrailHash(uint256,bytes32)",
  "function authorizeTEE(uint256,address)",
  "function agentTEE(uint256) view returns (address)",
  "function computeDigest(uint256,bytes32,bytes32,bytes32,uint256,bytes32,bytes32,bytes32) view returns (bytes32)",
  "event ReceiptSubmitted(uint256,bytes32,bytes32,bytes32,bytes32,bytes32,uint256,bytes32,bool)",
], wallet);

const val = new Contract(VALIDATION, [
  "function validationRequest(address,uint256,string,bytes32)",
  "function validationResponse(bytes32,uint8,string,bytes32,string)",
  "function getValidationStatus(bytes32) view returns (address,uint256,uint8,bytes32,string,uint256)",
], challenger);

const vault = new Contract(QUORUM_VAULT, [
  "function setTarget(address,bool)",
  "function setLimits(uint256,uint256)",
  "function deposit() payable",
  "function executeTrade(address,uint256,bytes)",
  "function balance() view returns (uint256)",
], wallet);

console.log("== setup: guardrail + TEE + target + limits + deposit ==");
const curGuard = await reg.agentGuardrailHash(AGENT_ID);
if (curGuard !== GUARD) {
  await (await reg.setGuardrailHash(AGENT_ID, GUARD)).wait();
  console.log("  guardrail set:", GUARD.slice(0, 10));
}
const curTEE = await reg.agentTEE(AGENT_ID);
if (curTEE.toLowerCase() !== wallet.address.toLowerCase()) {
  await (await reg.authorizeTEE(AGENT_ID, wallet.address)).wait();
  console.log("  tee authorized:", wallet.address);
}
const mock = await deploy(wallet, "MockTarget", [], "artifacts/contracts/mocks/MockTarget.sol");
await (await vault.setTarget(await mock.getAddress(), true)).wait();
await (await vault.setLimits(100000000000000000n, 1000000000000000000n)).wait();
const curBal = await wallet.provider.getBalance(QUORUM_VAULT);
if (curBal === 0n) {
  await (await vault.deposit({ value: 500000000000000000n })).wait();
  console.log("  vault funded");
}

async function propose(execHash) {
  const n = await wallet.provider.getBlockNumber();
  const blk = await wallet.provider.getBlock(n);
  const nonce = "0x" + [...crypto.getRandomValues(new Uint8Array(32))].map(b => b.toString(16).padStart(2, "0")).join("");
  await (await reg.submitReceipt(AGENT_ID, "0x" + "22".repeat(32), GUARD, execHash, nonce, n, blk.hash, false)).wait();
  return await reg.lastReceiptHash(AGENT_ID);
}

const data = (await new Contract(await mock.getAddress(), ["function ping(uint256)"], wallet.provider).interface.encodeFunctionData("ping", [7]));
const amount = 10000000000000000n; // 0.01 MON
const execHash = "0x" + [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode("x")))].map(b => b.toString(16).padStart(2, "0")).join("");
const execHashPadded = (await import("ethers")).keccak256((await import("ethers")).AbiCoder.defaultAbiCoder().encode(["address","uint256","bytes"], [await mock.getAddress(), amount, data]));

console.log("== scenario 1: receipt WITHOUT challenger validation → executeTrade must revert ==");
const d1 = await propose(execHashPadded);
try {
  await (await vault.executeTrade(await mock.getAddress(), amount, data)).wait();
  console.log("  FAIL: executed without quorum!");
} catch (e) {
  console.log("  PASS reverted:", (e.reason || e.message).slice(0, 60));
}

console.log("== scenario 2: challenger agrees → executeTrade succeeds ==");
await (await val.validationRequest(challenger.address, AGENT_ID, "ipfs://aegis-challenge", d1)).wait();
await (await val.validationResponse(d1, 100, "ipfs://aegis-verdict", "0x" + "00".repeat(32), "challenger")).wait();
const st = await val.getValidationStatus(d1);
console.log("  validation response:", st[2].toString(), "validator:", st[0].slice(0, 10));
const tx = await vault.executeTrade(await mock.getAddress(), amount, data);
const r = await tx.wait();
console.log("  executeTrade status:", r.status, "gas:", r.gasUsed.toString());
console.log("  vault balance after:", (await wallet.provider.getBalance(QUORUM_VAULT)).toString(), "(executeTrade 不带 value，余额不动)");
console.log("== E2E DONE ==");
process.exit(0);
