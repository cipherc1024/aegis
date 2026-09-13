// ③ ERC-8004：自部署三注册表 + Identity 注册 + 验证闭环 + 声誉反馈
import fs from "node:fs";
import { Contract, ContractFactory, Wallet, keccak256, toUtf8Bytes, parseEther } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const provider = wallet.provider;

const artifact = (n) => JSON.parse(fs.readFileSync(`artifacts/contracts/${n}.sol/${n}.json`, "utf8"));

// 1) 部署三注册表
const Identity = new ContractFactory(artifact("IdentityRegistry").abi, artifact("IdentityRegistry").bytecode, wallet);
const identity = await Identity.deploy();
await identity.waitForDeployment();
const identityAddr = await identity.getAddress();

const Reputation = new ContractFactory(artifact("ReputationRegistry").abi, artifact("ReputationRegistry").bytecode, wallet);
const reputation = await Reputation.deploy(identityAddr);
await reputation.waitForDeployment();
const repAddr = await reputation.getAddress();

const Validation = new ContractFactory(artifact("ValidationRegistry").abi, artifact("ValidationRegistry").bytecode, wallet);
const validation = await Validation.deploy(identityAddr);
await validation.waitForDeployment();
const valAddr = await validation.getAddress();

console.log("IdentityRegistry:", identityAddr);
console.log("ReputationRegistry:", repAddr);
console.log("ValidationRegistry:", valAddr);

// 2) 注册 Agent（agentURI = base64 内联注册文件，含 supportedTrust: tee-attestation）
const card = {
  type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
  name: "Aegis Alpha",
  description: "TEE-attested autonomous trading agent on Monad — every action carries a verifiable DCAP receipt.",
  services: [{ name: "web", endpoint: "https://aegis.example" }],
  x402Support: true,
  active: true,
  registrations: [{ agentId: 0, agentRegistry: `eip155:10143:${identityAddr}` }],
  supportedTrust: ["reputation", "validation", "tee-attestation"],
};
const agentURI = "data:application/json;base64," + Buffer.from(JSON.stringify(card)).toString("base64");
const regTx = await identity.register(agentURI);
const regR = await regTx.wait();
let agentId;
for (const log of regR.logs) {
  try {
    const p = identity.interface.parseLog(log);
    if (p?.name === "Registered") agentId = p.args.agentId;
  } catch {}
}
console.log("agentId:", agentId?.toString());

// 3) 验证闭环：Agent 请求 -> TEE 验证者背书（response=100, tag=tee-dcap）
const requestHash = keccak256(toUtf8Bytes("aegis-validation-" + Date.now()));
await (await validation.validationRequest(wallet.address, agentId, "ipfs://aegis-request-1", requestHash)).wait();
await (await validation.validationResponse(requestHash, 100, "ipfs://aegis-response-1", "0x" + "00".repeat(32), "tee-dcap")).wait();
const vs = await validation.getValidationStatus(requestHash);
console.log("validation response:", vs[2].toString(), "tag:", vs[4]);

// 4) 声誉反馈（需非 owner 的 clientAddress；生成并注资）
const client = Wallet.createRandom().connect(provider);
const fundTx = await wallet.sendTransaction({ to: client.address, value: parseEther("0.3") });
await fundTx.wait();
const repClient = reputation.connect(client);
try {
  const tx = await repClient.giveFeedback(agentId, 100n, 0, "successRate", "tee", "", "", "0x" + "00".repeat(32));
  const r = await tx.wait();
  console.log("giveFeedback tx:", tx.hash, "status:", r.status, "client:", client.address);
  const s = await reputation.getSummary(agentId, [client.address], "successRate", "");
  console.log("reputation summary: count=" + s[0] + " value=" + s[1] + " decimals=" + s[2]);
  } catch (e) {
    console.log("giveFeedback error:", JSON.stringify({
      short: e.shortMessage,
      reason: e.reason,
      code: e.code,
      err: e.error ? JSON.stringify(e.error).slice(0, 300) : undefined,
    }, null, 2));
  }

console.log("\nAGENT_ID=" + agentId + "\nIDENTITY=" + identityAddr + "\nREPUTATION=" + repAddr + "\nVALIDATION=" + valAddr);
