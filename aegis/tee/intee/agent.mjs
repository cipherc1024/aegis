// 在 TEE 内运行的自治 Agent：决策 -> get_quote(semanticDigest||nonce) -> 链上 submitReceiptWithQuote
import { JsonRpcProvider, Wallet, Contract, keccak256, toUtf8Bytes, AbiCoder } from "ethers";
import { DstackClient } from "@phala/dstack-sdk";

const abi = AbiCoder.defaultAbiCoder();
const e = process.env;

// ---- 1) 护栏 ----
const norm = (s) => String(s).replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").toLowerCase();
const text = norm((e.TRUSTED_CMD || "") + " " + (e.MARKET_DATA || ""));
const reasons = [];
if (/ignore (all )?previous|disregard/.test(text)) reasons.push("injection_pattern");
for (const b of (e.BLOCKLIST || "").split(",").filter(Boolean)) if (text.includes(norm(b))) reasons.push("blocklist:" + b);
const guardrailHash = keccak256(toUtf8Bytes("guardrail-v1"));
console.log("GUARDRAIL_HASH=" + guardrailHash);
if (reasons.length) { console.log("DECISION=blocked_by_guardrail " + JSON.stringify(reasons)); process.exit(0); }

// ---- 2) PACE 确定性策略验证 ----
const target = e.TARGET;
const amount = BigInt(e.AMOUNT);
const data = e.DATA || "0x";
const wl = (e.WHITELIST || target).split(",").map((x) => x.toLowerCase());
if (!wl.includes(target.toLowerCase())) { console.log("DECISION=rejected_by_policy target_not_whitelisted"); process.exit(0); }
if (amount > BigInt(e.PER_TX_LIMIT)) { console.log("DECISION=rejected_by_policy exceeds_per_tx_limit"); process.exit(0); }
const intentHash = keccak256(abi.encode(["address", "uint256", "bytes"], [target, amount, data]));
const pdrHash = keccak256(abi.encode(["bytes32", "bytes32", "bool"], [intentHash, guardrailHash, true]));
const executionHash = keccak256(abi.encode(["address", "uint256", "bytes"], [target, amount, data]));
console.log("PDR_HASH=" + pdrHash + " EXECUTION_HASH=" + executionHash);

// ---- 3) prev + nonce + semanticDigest ----
const REG_ABI = [
  "function lastReceiptHash(uint256) view returns (bytes32)",
  "function semanticDigest(uint256,bytes32,bytes32,bytes32,bytes32,bytes32) view returns (bytes32)",
  "function submitReceiptWithQuote(uint256,bytes32,bytes32,bytes32,bytes32,uint256,bytes32,bool,bytes)",
];
const provider = new JsonRpcProvider(e.RPC, 10143);
const wallet = new Wallet(e.PK, provider);
const agentId = BigInt(e.AGENT_ID);
const reg = new Contract(e.REGISTRY, REG_ABI, wallet);

const prev = await reg.lastReceiptHash(agentId);
const nonce = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
const semantic = await reg.semanticDigest(agentId, pdrHash, guardrailHash, executionHash, nonce, prev);
console.log("PREV=" + prev);
console.log("SEMANTIC=" + semantic);

// ---- 4) TEE 生成绑定 semantic 的 quote ----
const dc = new DstackClient("/var/run/dstack.sock");
const rd = Buffer.from((semantic + nonce.slice(2)).replace(/^0x/, ""), "hex");
const q = await dc.getQuote(new Uint8Array(rd));
const quote = q.quote.startsWith("0x") ? q.quote : "0x" + q.quote;
console.log("QUOTE_BYTES=" + (quote.length - 2) / 2);

// ---- 5) 提交到链上（任何人可代提交；此处由 TEE 内钱包直接提交）----
const n = await provider.getBlockNumber();
const blk = await provider.getBlock(n);
const tx = await reg.submitReceiptWithQuote(agentId, pdrHash, guardrailHash, executionHash, nonce, n, blk.hash, false, quote);
const r = await tx.wait();
console.log("SUBMIT_TX=" + tx.hash + " STATUS=" + r.status + " GAS=" + r.gasUsed.toString());
console.log("NEW_LAST_RECEIPT_HASH=" + (await reg.lastReceiptHash(agentId)));
console.log("DECISION=approved_onchain");
