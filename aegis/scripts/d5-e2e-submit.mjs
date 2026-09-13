// D5 现场 E2E：部署 ReceiptRegistry，挂真实 DcapGate，用真 quote 提交收据
import fs from "node:fs";
import { ContractFactory } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const params = JSON.parse(fs.readFileSync("tee/d4e2e/params.json", "utf8"));
const quote = "0x" + fs.readFileSync("tee/d4e2e/quote.hex", "utf8").trim().replace(/^0x/, "");
const DCAP_GATE = "0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F";

const art = JSON.parse(
  fs.readFileSync("artifacts/contracts/ReceiptRegistry.sol/ReceiptRegistry.json", "utf8")
);
const factory = new ContractFactory(art.abi, art.bytecode, wallet);
const reg = await factory.deploy(wallet.address);
console.log("deploy tx:", reg.deploymentTransaction().hash);
await reg.waitForDeployment();
const addr = await reg.getAddress();
console.log("ReceiptRegistry:", addr);

await (await reg.setGuardrailHash(1, params.guardrailHash)).wait();
await (await reg.setDcapGate(DCAP_GATE)).wait();
console.log("configured guardrail + dcapGate");

const provider = wallet.provider;
const n = await provider.getBlockNumber();
const block = await provider.getBlock(n);
console.log("anchor block:", n, block.hash);

const tx = await reg.submitReceiptWithQuote(
  1,
  params.pdrHash,
  params.guardrailHash,
  params.executionHash,
  params.nonce,
  n,
  block.hash,
  false,
  quote
);
console.log("submit tx:", tx.hash);
const r = await tx.wait();
console.log("status:", r.status, "gasUsed:", r.gasUsed.toString());

console.log("lastReceiptHash:", await reg.lastReceiptHash(1));
const rec = await reg.lastTradeReceipt(1);
console.log("stored executionHash:", rec.executionHash);
console.log("expected executionHash:", params.executionHash);
