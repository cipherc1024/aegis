// Aegis Orchestrator（零依赖）：链上状态/收据/验证/事件流 + 写侧（决策管线 → 上链）
// 运行: node orchestrator/server.mjs   （在 aegis/ 目录）
import http from "node:http";
import fs from "node:fs";
import { JsonRpcProvider, FallbackProvider, Wallet, Contract, keccak256, toUtf8Bytes, AbiCoder } from "ethers";
import { challengeReceipt, challengerGuardrail, challengerPace } from "../tee-runtime/challenger.mjs";

// ---- env（零依赖加载，不覆盖已有） ----
if (fs.existsSync(".env")) {
  for (const line of fs.readFileSync(".env", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

const PORT = Number(process.env.ORCH_PORT || 8787);
const RPC_LIST = [
  process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz",
  "https://rpc.ankr.com/monad_testnet",
];
const REGISTRY = process.env.REGISTRY || "0x91482e67998a01C0A33Fe12ec01A6A43177A7181";
const PER_TX_LIMIT = BigInt(process.env.PER_TX_LIMIT || "50000000000000000"); // 0.05 MON
const WHITELIST = (process.env.WHITELIST || "0x000000000000000000000000000000000000beef").split(",").map((x) => x.toLowerCase());
const BLOCKLIST = (process.env.BLOCKLIST || "evil.com,attacker,drain,ignore previous").split(",").filter(Boolean);
const CHALLENGER_BLOCKLIST = (process.env.CHALLENGER_BLOCKLIST || "evil.com,attacker,drain,ignore previous,scam,drainer").split(",").filter(Boolean);
const TRUSTED_CMD = process.env.TRUSTED_CMD || "buy USDC 0.01";

const provider = new FallbackProvider(
  RPC_LIST.map((url) => ({ provider: new JsonRpcProvider(url, 10143, { staticNetwork: true, pollingInterval: 300 }), priority: 1, weight: 1, stallTimeout: 2500 })),
  10143,
  { quorum: 1, cacheTimeout: -1 }
);

const READ_ABI = [
  "function latestReceipt(uint256) view returns (bytes32 digest, bytes32 pdrHash, bytes32 guardrailHash, bytes32 executionHash, uint256 blockHeight, bytes32 blockHash, uint256 submitBlock, bytes32 nonce, bytes32 quoteHash, bool isHeartbeat, uint256 timestamp)",
  "function lastReceiptHash(uint256) view returns (bytes32)",
  "function isTradeFresh(uint256) view returns (bool)",
  "function isAlive(uint256,uint256) view returns (bool)",
  "function agentGuardrailHash(uint256) view returns (bytes32)",
  "event ReceiptSubmitted(uint256 indexed agentId, bytes32 receiptHash, uint256 blockHeight, bool isHeartbeat)",
];
const WRITE_ABI = [
  ...READ_ABI,
  "function agentTEE(uint256) view returns (address)",
  "function authorizeTEE(uint256,address)",
  "function submitReceipt(uint256,bytes32,bytes32,bytes32,bytes32,uint256,bytes32,bool)",
  "function governance() view returns (address)",
];
const reg = new Contract(REGISTRY, READ_ABI, provider);

const wallet = process.env.MONAD_TESTNET_PK ? new Wallet(process.env.MONAD_TESTNET_PK, provider) : null;
const regWrite = wallet ? new Contract(REGISTRY, WRITE_ABI, wallet) : null;
// challenger：独立钱包（验证者）；未配置则只做离线重推导
const VALIDATION = process.env.VALIDATION || "0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa";
const challengerWallet = process.env.CHALLENGER_PK ? new Wallet(process.env.CHALLENGER_PK, provider) : null;
const valWrite = challengerWallet
  ? new Contract(VALIDATION, ["function validationRequest(address,uint256,string,bytes32)", "function validationResponse(bytes32,uint8,string,bytes32,string)"], challengerWallet)
  : null;

// vault 读侧：日限预检与链上 executeTrade 同口径（QUORUM_VAULT 未配置或读失败时跳过预检，链上仍强制）
const QUORUM_VAULT = process.env.QUORUM_VAULT || "";
const vaultRead = QUORUM_VAULT
  ? new Contract(QUORUM_VAULT, ["function dailyLimit() view returns (uint256)", "function dailySpent(uint256) view returns (uint256)"], provider)
  : null;

const abi = AbiCoder.defaultAbiCoder();

// ---- 读侧 ----
async function status(agentId) {
  const [bn, r, fresh, alive] = await Promise.all([
    provider.getBlockNumber(),
    reg.latestReceipt(agentId),
    reg.isTradeFresh(agentId),
    reg.isAlive(agentId, 60n),
  ]);
  return {
    online: true,
    currentBlock: bn,
    lastReceiptBlock: Number(r.blockHeight),
    fresh,
    alive,
    receiptHash: r.digest,
    guardrailHash: r.guardrailHash,
    executionHash: r.executionHash,
  };
}

async function receipts(agentId) {
  const out = [];
  const seen = new Set();
  // 1) 缓存（scripts/index-receipts.mjs 产物；getLogs 限 100 块，深历史走索引器）
  try {
    if (fs.existsSync("orchestrator/receipts-cache.json")) {
      const cache = JSON.parse(fs.readFileSync("orchestrator/receipts-cache.json", "utf8"));
      if (cache.agentId === Number(agentId)) {
        for (const r of cache.receipts) {
          const key = String(r.receiptHash);
          if (!seen.has(key)) { seen.add(key); out.push(r); }
        }
      }
    }
  } catch {}
  // 2) 实时尾扫（最近 2000 块，20×100 窗口）
  try {
    const latest = await provider.getBlockNumber();
    for (let s = Math.max(0, latest - 2000); s < latest; s += 100) {
      try {
        const logs = await reg.queryFilter(reg.filters.ReceiptSubmitted(agentId), s, Math.min(s + 99, latest));
        for (const l of logs) {
          const item = { receiptHash: l.args.receiptHash, blockHeight: Number(l.args.blockHeight), isHeartbeat: l.args.isHeartbeat, txHash: l.transactionHash };
          const key = String(item.receiptHash);
          if (!seen.has(key)) { seen.add(key); out.push(item); }
        }
      } catch {}
    }
  } catch {}
  return out.sort((a, b) => b.blockHeight - a.blockHeight);
}

// ---- 决策管线（镜像 in-TEE 闭环：护栏 → PACE → 摘要） ----
const ZERO32 = "0x" + "00".repeat(32);
const norm = (s) => String(s).replace(/[\u200B-\u200D\u2060\uFEFF]/g, "").toLowerCase();

function runGuardrail(text, blocklist) {
  const reasons = [];
  if (/ignore (all )?previous|disregard/.test(text)) reasons.push("injection_pattern");
  for (const b of blocklist) if (text.includes(norm(b))) reasons.push("blocklist:" + b);
  return reasons;
}

function paceVerify({ target, amount, data }) {
  if (!WHITELIST.includes(String(target).toLowerCase())) return "target_not_whitelisted";
  if (amount > PER_TX_LIMIT) return "exceeds_per_tx_limit";
  return null;
}

function buildReceiptFields({ agentId, type, target, amount, data, guardrailHash, prev, nonce }) {
  const executionHash = type === "heartbeat" ? ZERO32 : keccak256(abi.encode(["address", "uint256", "bytes"], [target, amount, data || "0x"]));
  const intentHash = executionHash;
  const pdrHash = keccak256(abi.encode(["bytes32", "bytes32", "bool"], [intentHash, guardrailHash, true]));
  const semantic = keccak256(abi.encode(["uint256", "bytes32", "bytes32", "bytes32", "bytes32", "bytes32"], [agentId, pdrHash, guardrailHash, executionHash, nonce, prev]));
  return { executionHash, pdrHash, semantic };
}

async function command(agentId, body) {
  const type = body.type === "heartbeat" ? "heartbeat" : "trade";
  const dryRun = body.dryRun !== false;
  const trustedCommand = body.command || TRUSTED_CMD;
  const marketData = body.marketData || "";

  // 1) 护栏（对可信指令与外部内容；注入模式 + blocklist）
  const reasons = runGuardrail(`${trustedCommand} ${marketData}`, BLOCKLIST);
  if (reasons.length) return { decision: "blocked_by_guardrail", reasons, dryRun };

  // 2) PACE 确定性策略验证
  const target = String(body.target || WHITELIST[0]);
  const amount = type === "heartbeat" ? 0n : BigInt(body.amount ?? "10000000000000000"); // 0.01 MON
  const data = body.data || "0xdeadbeef";
  if (type !== "heartbeat") {
    const reject = paceVerify({ target, amount, data });
    if (reject) return { decision: "rejected_by_policy", reason: reject, dryRun };
    // 日限预检（与 vault 链上口径一致；读失败则跳过——链上 executeTrade 仍强制执行）
    if (vaultRead) {
      try {
        const blk = await provider.getBlock("latest");
        const today = Math.floor(blk.timestamp / 86400);
        const [dailyLimit, spentToday] = await Promise.all([vaultRead.dailyLimit(), vaultRead.dailySpent(BigInt(today))]);
        if (amount > dailyLimit - spentToday) {
          return { decision: "rejected_by_policy", reason: "exceeds_daily_limit", dryRun, dailyLimit: dailyLimit.toString(), spentToday: spentToday.toString() };
        }
      } catch { /* vault 不可读，跳过预检 */ }
    }
  }

  // 3) 链上状态：prev + 治理登记的护栏哈希
  const [prev, onChainGuardrail] = await Promise.all([
    reg.lastReceiptHash(agentId),
    reg.agentGuardrailHash(agentId),
  ]);
  if (onChainGuardrail === ZERO32) {
    return { decision: "error", reason: "guardrail not registered on-chain (governance must setGuardrailHash first)", dryRun };
  }

  // 4) 摘要（fresh nonce 防重放）
  const nonce = "0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("hex");
  const fields = buildReceiptFields({ agentId: Number(agentId), type, target, amount, data, guardrailHash: onChainGuardrail, prev, nonce });

  if (dryRun || !wallet) {
  // challenger 离线预览（零 gas）：独立重推导会对这笔决策说什么
  const previewVerdict = challengeReceipt({
    receipt: { pdrHash: fields.pdrHash, guardrailHash: onChainGuardrail, executionHash: fields.executionHash, blockHeight: 0, blockHash: ZERO32, nonce, digest: null, prev },
    inputs: { agentId: Number(agentId), command: trustedCommand, marketData, target, amount, data, blocklist: CHALLENGER_BLOCKLIST, whitelist: WHITELIST, perTxLimit: PER_TX_LIMIT },
  });
  return {
    decision: "approved_preview",
    dryRun: true,
    type,
    target,
    amount: amount.toString(),
    ...fields,
    prev,
    onChainGuardrail,
    hasSigner: !!wallet,
    challenger: { agree: previewVerdict.agree, response: previewVerdict.response, mismatches: previewVerdict.mismatches, onchain: null, hasSigner: !!challengerWallet },
  };
}

  // 5) 上链：确保 agentTEE 授权（治理自授权）→ submitReceipt（onlyTEE 路径）
  const teeAddr = await regWrite.agentTEE(agentId);
  if (teeAddr.toLowerCase() !== wallet.address.toLowerCase()) {
    const authTx = await regWrite.authorizeTEE(agentId, wallet.address);
    await authTx.wait();
  }
  const n = await provider.getBlockNumber();
  const blk = await provider.getBlock(n);
  const tx = await regWrite.submitReceipt(agentId, fields.pdrHash, onChainGuardrail, fields.executionHash, nonce, n, blk.hash, type === "heartbeat");
  const r = await tx.wait();
  const receiptDigest = await regWrite.lastReceiptHash(agentId);

  // 6) challenger 互证：独立重推导 → 链上验证（requestHash 约定 = 收据 digest）
  const challengeInput = {
    agentId: Number(agentId),
    command: trustedCommand,
    marketData,
    target,
    amount,
    data,
    blocklist: CHALLENGER_BLOCKLIST,
    whitelist: WHITELIST,
    perTxLimit: PER_TX_LIMIT,
  };
  const receiptForChallenge = {
    pdrHash: fields.pdrHash,
    guardrailHash: onChainGuardrail,
    executionHash: fields.executionHash,
    blockHeight: n,
    blockHash: blk.hash,
    nonce,
    digest: receiptDigest,
    prev,
  };
  // tamper 演示：proposer 在收据里作弊（提交与决策输入不符的 executionHash），
  // challenger 独立重推导会立刻发现 executionHash_mismatch → response=0
  if (body.tamperExecHash) {
    receiptForChallenge.executionHash = ZERO32;
  }
  const verdict = challengeReceipt({ receipt: receiptForChallenge, inputs: challengeInput });
  let challengerOnchain = null;
  if (valWrite && (verdict.response > 0 || body.recordReject)) {
    // 同意 → 上链背书；拒绝 → 默认不上链（作恶提案止步于互证），body.recordReject=true 可上链作证据
    const reqTx = await valWrite.validationRequest(challengerWallet.address, agentId, "ipfs://aegis-challenge", receiptDigest);
    await reqTx.wait();
    const resTx = await valWrite.validationResponse(receiptDigest, verdict.response, "ipfs://aegis-verdict", "0x" + "00".repeat(32), "challenger");
    const resR = await resTx.wait();
    challengerOnchain = { requestTx: reqTx.hash, responseTx: resTx.hash, status: resR.status };
  }

  return {
    decision: "approved_onchain",
    dryRun: false,
    type,
    txHash: tx.hash,
    status: r.status,
    gasUsed: r.gasUsed.toString(),
    newLastReceiptHash: receiptDigest,
    challenger: {
      agree: verdict.agree,
      response: verdict.response,
      mismatches: verdict.mismatches,
      onchain: challengerOnchain,
      hasSigner: !!challengerWallet,
    },
    ...fields,
    prev,
  };
}

// ---- HTTP ----
const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const agentId = BigInt(url.searchParams.get("agentId") || "1");
  const send = (code, body) =>
    res.writeHead(code, { "Content-Type": "application/json", ...cors }).end(JSON.stringify(body));

  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();

  try {
    if (url.pathname === "/api/status") return send(200, await status(agentId));
    if (url.pathname === "/api/receipts") return send(200, await receipts(agentId));

    if (url.pathname === "/api/events") {
      res.writeHead(200, { "Content-Type": "text/event-stream", ...cors, "Cache-Control": "no-cache" });
      const tick = async () => {
        try {
          res.write(`event: status\ndata: ${JSON.stringify(await status(agentId))}\n\n`);
        } catch {
          /* ignore */
        }
      };
      tick();
      const id = setInterval(tick, 5000);
      req.on("close", () => clearInterval(id));
      return;
    }

    if (url.pathname === "/api/agent/command" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      let parsed = {};
      try {
        parsed = body ? JSON.parse(body) : {};
      } catch {
        return send(400, { error: "invalid JSON body" });
      }
      return send(200, await command(agentId, parsed));
    }

    send(404, { error: "not found" });
  } catch (e) {
    send(500, { error: String(e?.shortMessage || e?.message || e) });
  }
});

server.listen(PORT, () =>
  console.log(`[orchestrator] http://localhost:${PORT}  rpc=${RPC_LIST[0]}(+${RPC_LIST.length - 1})  signer=${wallet ? wallet.address : "none(dryRun only)"}`)
);
