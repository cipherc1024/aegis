// D5 现场 E2E 准备：选定收据字段，算出 semanticDigest 与 report_data
import fs from "node:fs";
import { keccak256, toUtf8Bytes, AbiCoder, randomBytes } from "ethers";

const agentId = 1n;
const pdrHash = keccak256(toUtf8Bytes("pdr-d5e2e"));
const guardrailHash = keccak256(toUtf8Bytes("guardrail-v1"));
const executionHash = keccak256(toUtf8Bytes("exec-d5e2e"));
const nonce = "0x" + Buffer.from(randomBytes(32)).toString("hex");
const prev = "0x" + "00".repeat(32); // 第一张收据

const abi = AbiCoder.defaultAbiCoder();
const semanticDigest = keccak256(
  abi.encode(
    ["uint256", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"],
    [agentId, pdrHash, guardrailHash, executionHash, nonce, prev]
  )
);
const reportDataHex = (semanticDigest + nonce.slice(2)).replace(/^0x/, ""); // 64 bytes

const params = {
  agentId: agentId.toString(),
  pdrHash,
  guardrailHash,
  executionHash,
  nonce,
  prev,
  semanticDigest,
  reportDataHex,
};
fs.mkdirSync("tee/d4e2e", { recursive: true });
fs.writeFileSync("tee/d4e2e/params.json", JSON.stringify(params, null, 2));
console.log(JSON.stringify(params, null, 2));
