// 一次性收据索引器（批量+超时版）：getLogs 严格限 100 块（-32614），JSON-RPC batch + fetch 超时
// 运行: node scripts/index-receipts.mjs   （在 aegis/ 目录）
import fs from "node:fs";
import { AbiCoder, Interface } from "ethers";

const EVENT_SIG = "ReceiptSubmitted(uint256 indexed agentId, bytes32 indexed receiptHash, uint256 blockHeight, bytes32 executionHash, bytes32 pdrHash, bytes32 guardrailHash, bytes32 nonce, bytes32 quoteHash, bool isHeartbeat)";
const TOPIC0 = new Interface([`event ${EVENT_SIG}`]).getEvent("ReceiptSubmitted").topicHash;

const RPC = process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz";
const REGISTRY = process.env.REGISTRY || "0x4622D041696942dC873a8A5E54f1e1ca9669c90B"; // v2（旧 v1 已废弃）
const AGENT_ID = 1;
const WINDOW = 100; // RPC 硬限制
const BATCH = 30;
const MAX_SCAN = 700000; // ~2.4 天 @300ms
const TOPIC_AGENT = "0x" + "00".repeat(31) + "01";

const abi = AbiCoder.defaultAbiCoder();
const IFACE = new Interface([
  "function lastReceiptHash(uint256) view returns (bytes32)",
  "function latestReceiptBlock(uint256) view returns (uint256)",
]);
const latestStruct = new Interface([
  "function latestReceipt(uint256) view returns (bytes32 digest, bytes32 pdrHash, bytes32 guardrailHash, bytes32 executionHash, uint256 blockHeight, bytes32 blockHash, uint256 submitBlock, bytes32 nonce, bytes32 quoteHash, bool isHeartbeat, uint256 timestamp)",
]);

const rpc = async (body) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(RPC, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(20000) });
      if (r.ok) return r.json();
    } catch {}
    await new Promise((res) => setTimeout(res, 300 * (attempt + 1)));
  }
  return null; // 批次失败容忍
};

const latestBn = parseInt((await rpc({ jsonrpc: "2.0", id: 1, method: "eth_blockNumber", params: [] })).result, 16);
const lastHash = (await rpc({ jsonrpc: "2.0", id: 2, method: "eth_call", params: [{ to: REGISTRY, data: IFACE.encodeFunctionData("lastReceiptHash", [AGENT_ID]) }, "latest"] })).result;
const lastBlock = Number(abi.decode(["bytes32", "bytes32", "bytes32", "bytes32", "uint256"], (await rpc({ jsonrpc: "2.0", id: 3, method: "eth_call", params: [{ to: REGISTRY, data: latestStruct.encodeFunctionData("latestReceipt", [AGENT_ID]) }, "latest"] })).result)[4]);
console.log("latest:", latestBn, "lastReceiptBlock:", lastBlock, "lastReceiptHash:", lastHash.slice(0, 18) + "…");

const to = Math.min(latestBn, lastBlock + WINDOW);
const from = Math.max(0, to - MAX_SCAN);
const windows = [];
for (let s = from; s < to; s += WINDOW) windows.push([s, Math.min(s + WINDOW - 1, to - 1)]);
console.log("windows:", windows.length, "batches:", Math.ceil(windows.length / BATCH));

const receipts = [];
let errors = 0;
const t0 = Date.now();
for (let i = 0; i < windows.length; i += BATCH) {
  const chunk = windows.slice(i, i + BATCH);
  const batch = chunk.map(([s, e], j) => ({
    jsonrpc: "2.0",
    id: i + j,
    method: "eth_getLogs",
    params: [{ address: REGISTRY, topics: [TOPIC0, TOPIC_AGENT], fromBlock: "0x" + s.toString(16), toBlock: "0x" + e.toString(16) }],
  }));
  const res = await rpc(batch);
  if (!res || !Array.isArray(res)) { errors += chunk.length; continue; }
  const byId = new Map(res.map((x) => [x.id, x]));
  for (let j = 0; j < chunk.length; j++) {
    const x = byId.get(i + j);
    const logs = x?.result;
    if (!Array.isArray(logs)) { errors++; continue; }
    for (const log of logs) {
      const [blockHeight, , , , , , isHeartbeat] = abi.decode(["uint256", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32", "bool"], log.data);
      receipts.push({ receiptHash: log.topics[2], blockHeight: Number(blockHeight), isHeartbeat: Boolean(isHeartbeat), txHash: log.transactionHash });
    }
  }
  if ((i / BATCH) % 5 === 0) console.log(`progress: ${i + BATCH}/${windows.length} found=${receipts.length} err=${errors} ${(Date.now() - t0) / 1000}s`);
}

receipts.sort((a, b) => b.blockHeight - a.blockHeight);
fs.writeFileSync(
  "orchestrator/receipts-cache.json",
  JSON.stringify({ updatedAt: new Date().toISOString(), agentId: AGENT_ID, registry: REGISTRY, scannedTo: latestBn, receipts }, null, 2)
);
console.log(`indexed ${receipts.length} receipts (window errors: ${errors}) in ${((Date.now() - t0) / 1000).toFixed(1)}s -> orchestrator/receipts-cache.json`);
