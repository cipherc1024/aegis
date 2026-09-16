// 诊断：逐步复刻 orchestrator 的写路径，定位 "could not coalesce error"。
// 只读探测为主，最后一步才发交易（会花 gas）。
import { loadEnv, getWallet, attach } from "./lib.mjs";
loadEnv();
const wallet = getWallet();

const AGENT_ID = 1n;
const REGISTRY = process.env.REGISTRY || "0x4622D041696942dC873a8A5E54f1e1ca9669c90B";
const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";

const reg = await attach(wallet, "ReceiptRegistry", REGISTRY, "artifacts/contracts/ReceiptRegistry.sol");

const step = async (name, fn) => {
  process.stdout.write(name.padEnd(38));
  try {
    const v = await fn();
    console.log("OK", v === undefined ? "" : v);
    return v;
  } catch (e) {
    console.log("FAIL:", String(e?.shortMessage || e?.message || e).slice(0, 160));
    return undefined;
  }
};

await step("agentTEE(1)", async () => await reg.agentTEE(AGENT_ID));
await step("agentGuardrailHash(1)", async () => await reg.agentGuardrailHash(AGENT_ID));
await step("lastReceiptHash(1)", async () => await reg.lastReceiptHash(AGENT_ID));
await step("dcapGate", async () => await reg.dcapGate());
await step("wallet balance", async () => (await wallet.provider.getBalance(wallet.address)).toString());
await step("estimate submitReceipt", async () => {
  const n = await wallet.provider.getBlockNumber();
  const b = await wallet.provider.getBlock(n);
  const nonce = "0x" + "33".repeat(32);
  const z = "0x" + "00".repeat(32);
  const g = await reg.submitReceipt.estimateGas(
    AGENT_ID, "0x" + "11".repeat(32), await reg.agentGuardrailHash(AGENT_ID), z, nonce, n, b.hash, true
  );
  return g.toString();
});
process.exit(0);
