// 只读状态快照：registry 头/交易槽 + v3 金库 + WMON 持仓。
import { loadEnv, getWallet, attach } from "./lib.mjs";
loadEnv();
const wallet = getWallet();

const REGISTRY = "0x4622D041696942dC873a8A5E54f1e1ca9669c90B";
const V3 = "0x3e5dDe45ec9c6F6A929CDF7B1FA9EC35dB3eBa19";
const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";

const reg = await attach(wallet, "ReceiptRegistry", REGISTRY, "artifacts/contracts/ReceiptRegistry.sol");
const vault = await attach(wallet, "AegisVaultQuorum", V3, "artifacts/contracts/AegisVaultQuorum.sol");

const head = await reg.lastReceiptHash(1n);
let tradeDigest = "(方法不存在)";
try {
  tradeDigest = await reg.latestTradeDigest(1n);
} catch {
  tradeDigest = "(revert: 该 registry 无此方法)";
}
const rec = await reg.latestReceipt(1n);
console.log("registry head      :", head);
console.log("registry tradeSlot :", tradeDigest);
console.log("head == tradeSlot  :", head === String(tradeDigest));
console.log("latest isHeartbeat :", rec.isHeartbeat);
console.log("latest submitBlock :", rec.submitBlock.toString());
console.log("latest executionHash:", rec.executionHash);
console.log("latestReceipt guardrail:", rec.guardrailHash);

const bal = await wallet.provider.getBalance(V3);
console.log("\nv3 MON balance     :", bal.toString(), `(${(Number(bal) / 1e18).toFixed(4)})`);
console.log("perTx/daily        :", (await vault.perTxLimit()).toString(), "/", (await vault.dailyLimit()).toString());
console.log("agentId            :", (await vault.agentId()).toString());
process.exit(0);
