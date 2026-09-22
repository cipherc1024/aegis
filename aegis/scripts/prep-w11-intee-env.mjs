// 为 in-TEE E2E 准备一套自洽的 CVM 环境变量（零成本、零上链）。
//
// 背景：agent.mjs 的 policy 完全由 env 构造，其 guardrailHash 必须等于
// 链上 agentGuardrailHash（= attestedGuardrailHash(challenger-policy.json)）。
// 而 .env 里缺 DAILY_LIMIT / ALLOWED_ASSETS / MAX_SLIPPAGE_BPS，
// 直接照搬会 CONFIG_ERROR 退出（DAILY_LIMIT 无默认值，刻意如此）。
//
// 本脚本把"链上认证策略"作为唯一真值源，反推出 CVM 该用的 env，
// 并在打印前自校验 guardrailHash 与链上一致，不一致就 FAIL。
// 输出：只写 stdout（含 PK 时由调用方决定怎么用），不落盘。
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { JsonRpcProvider, Contract } from "ethers";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envText = readFileSync(join(ROOT, ".env.intee"), "utf8");
const pick = (n) => envText.match(new RegExp("^" + n + "=(.*)$", "m"))[1].trim();

function untarGz(buf, dest) {
  const tar = gunzipSync(buf);
  let off = 0;
  while (off + 512 <= tar.length) {
    const h = tar.subarray(off, off + 512);
    if (h.every((b) => b === 0)) break;
    const name = h.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const size = parseInt(h.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8);
    const type = String.fromCharCode(h[156]);
    const ds = off + 512;
    if (type === "0" || type === "\0") {
      const p = join(dest, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, tar.subarray(ds, ds + size));
    }
    off = ds + Math.ceil(size / 512) * 512;
  }
}
const app = mkdtempSync(join(tmpdir(), "aegis-prep-"));
untarGz(Buffer.from(pick("MODULES_B64"), "base64"), app);
symlinkSync(join(ROOT, "node_modules"), join(app, "node_modules"), "junction");

const { attestedGuardrailHash } = await import(pathToFileURL(join(app, "challenger", "verify.mjs")).href);
const { runGuardrail, paceVerify, computeExecutionHash } = await import(
  pathToFileURL(join(app, "tee-runtime", "runtime.mjs")).href
);

// ---- 唯一真值源：链上认证的那份策略 ----
const cp = JSON.parse(readFileSync(join(ROOT, "challenger", "challenger-policy.json"), "utf8"));
const repoEnv = readFileSync(join(ROOT, ".env"), "utf8");
const g = (n) => {
  const m = repoEnv.match(new RegExp("^" + n + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
};

const registry = g("REGISTRY");
const rpc = g("MONAD_TESTNET_RPC");

// ---- 用链上值反推 CVM env ----
const target = g("WHITELIST").split(",")[1].trim(); // WMON（Phase 4 起的主路径）
const amount = "10000000000000000"; // 0.01 MON
const data = "0xd0e30db0"; // WMON deposit()
const agentId = cp.agentId;

const cvmEnv = {
  RPC: rpc,
  REGISTRY: registry,
  AGENT_ID: String(agentId),
  TARGET: target,
  AMOUNT: amount,
  DATA: data,
  PER_TX_LIMIT: cp.perTxLimit,
  DAILY_LIMIT: cp.dailyLimit,
  MAX_SLIPPAGE_BPS: String(cp.maxSlippageBps),
  WHITELIST: cp.whitelist.join(","),
  ALLOWED_ASSETS: cp.allowedAssets.join(","),
  BLOCKLIST: cp.blocklist.join(","),
  TRUSTED_CMD: "buy WMON 0.01",
  MARKET_DATA: "WMON spot 1.00 MON, depth ok",
  DAILY_SPENT: "0",
};

// agent.mjs 里 env->policy 的构造（逐字复刻）
const policy = {
  agentId: Number(cvmEnv.AGENT_ID),
  whitelist: cvmEnv.WHITELIST.split(",").map((x) => x.trim()).filter(Boolean),
  perTxLimit: cvmEnv.PER_TX_LIMIT,
  dailyLimit: cvmEnv.DAILY_LIMIT,
  maxSlippageBps: Number(cvmEnv.MAX_SLIPPAGE_BPS),
  blocklist: cvmEnv.BLOCKLIST.split(",").map((x) => x.trim()).filter(Boolean),
  allowedAssets: cvmEnv.ALLOWED_ASSETS.split(",").map((x) => x.trim()).filter(Boolean),
};

const h = attestedGuardrailHash(policy);
console.log("CVM policy 的 guardrailHash =", h);

const provider = new JsonRpcProvider(rpc, 10143);
const reg = new Contract(registry, ["function agentGuardrailHash(uint256) view returns (bytes32)"], provider);
const onchain = await reg.agentGuardrailHash(agentId);
console.log("链上 agentGuardrailHash    =", onchain);
const hashOk = h.toLowerCase() === onchain.toLowerCase();
console.log("guardrailHash 一致:", hashOk ? "YES" : "*** NO ***");

// ---- 预演三关，确认这笔会走到"该上链"而不是被前置拦掉 ----
const text = cvmEnv.TRUSTED_CMD + " " + cvmEnv.MARKET_DATA;
const gr = runGuardrail(text, policy);
const execHash = computeExecutionHash(target, BigInt(amount), data);
const pv = paceVerify({ target, amount: BigInt(amount), slippageBps: 0, intentHash: execHash }, policy, {
  dailySpent: BigInt(cvmEnv.DAILY_SPENT),
});
console.log("\n预演：");
console.log("  L2 护栏 allowed =", gr.allowed, gr.allowed ? "" : JSON.stringify(gr.reasons));
console.log("  L3 PACE  approved =", pv.approved, pv.approved ? "" : pv.reason);
console.log("  executionHash =", execHash);

const allOk = hashOk && gr.allowed && pv.approved;
console.log("\nRESULT=" + (allOk ? "PASS 这笔在 CVM 内应能走到 submitReceiptWithQuote" : "FAIL 有前置关卡会拦下"));
console.log("\n--- CVM 需要设置的环境变量（不含 PK，PK 请另行 export）---");
for (const [k, v] of Object.entries(cvmEnv)) console.log(k + "=" + v);
