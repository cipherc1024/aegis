// 定位 in-TEE agent 的 guardrailHash 与链上 agentGuardrailHash 的分叉点。
// 纯只读：只调 view 函数，零 gas。
//
// 结论（2026-09-18 实测）：agent.mjs 从 env 构造 policy 时对 whitelist 做了
// .toLowerCase()，而 challenger-policy.json 里存的是 checksum 大小写混合的地址。
// attestedGuardrailHash 对 whitelist 做 JSON.stringify 后 keccak —— 大小写敏感，
// 故两侧必然不等。本脚本把分叉字段逐一定位并给出修复口径。
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
const app = mkdtempSync(join(tmpdir(), "aegis-hashchk-"));
untarGz(Buffer.from(pick("MODULES_B64"), "base64"), app);
symlinkSync(join(ROOT, "node_modules"), join(app, "node_modules"), "junction");

const { attestedGuardrailHash, policyHash } = await import(pathToFileURL(join(app, "challenger", "verify.mjs")).href);
const { runGuardrail } = await import(pathToFileURL(join(app, "tee-runtime", "runtime.mjs")).href);

const repoEnv = readFileSync(join(ROOT, ".env"), "utf8");
const g = (n) => {
  const m = repoEnv.match(new RegExp("^" + n + "=(.*)$", "m"));
  return m ? m[1].trim().replace(/^["']|["']$/g, "") : undefined;
};

// A) 链上认证所用的那份（= challenger-policy.json 原样）
const cp = JSON.parse(readFileSync(join(ROOT, "challenger", "challenger-policy.json"), "utf8"));

// B) agent.mjs 从 .env 构造出的那份（逐字复刻 agent.mjs 的构造逻辑）
const envPolicy = {
  agentId: 1,
  whitelist: g("WHITELIST").split(",").map((x) => x.toLowerCase()).filter(Boolean),
  perTxLimit: g("PER_TX_LIMIT"),
  dailyLimit: cp.dailyLimit, // .env 无此项，用策略值补
  maxSlippageBps: cp.maxSlippageBps,
  blocklist: g("BLOCKLIST").split(",").map((x) => x.trim()).filter(Boolean),
  allowedAssets: cp.allowedAssets,
};

const rpc = g("MONAD_TESTNET_RPC");
const registry = g("REGISTRY");
const provider = new JsonRpcProvider(rpc, 10143);
const reg = new Contract(registry, ["function agentGuardrailHash(uint256) view returns (bytes32)"], provider);
const onchain = (await reg.agentGuardrailHash(1)).toLowerCase();

console.log("链上 agentGuardrailHash        =", onchain);
console.log("");
console.log("A) challenger-policy.json 原样  =", attestedGuardrailHash(cp), attestedGuardrailHash(cp).toLowerCase() === onchain ? "  <= 链上认证的就是这份" : "");
console.log("B) agent.mjs 从 .env 构造       =", attestedGuardrailHash(envPolicy));

// 逐字段二分：只把 whitelist 换成小写，其余保持策略原值
const onlyLower = { ...cp, whitelist: cp.whitelist.map((x) => x.toLowerCase()) };
console.log("");
console.log("分叉定位：");
console.log("  policyHash(原样)          =", policyHash(cp));
console.log("  policyHash(whitelist 小写) =", policyHash(onlyLower));
console.log("  => 仅 whitelist 大小写差异就改变 policyHash:",
  policyHash(cp) !== policyHash(onlyLower) ? "YES（根因）" : "NO");

console.log("");
console.log("A 与 B 是否相等:", attestedGuardrailHash(cp).toLowerCase() === attestedGuardrailHash(envPolicy).toLowerCase() ? "YES" : "*** NO ***");
console.log("链上 与 B 是否相等:", onchain === attestedGuardrailHash(envPolicy).toLowerCase() ? "YES" : "*** NO（B 必 revert）***");

const gr = runGuardrail("buy WMON 0.01", cp);
console.log("\nrunGuardrail(策略原样).guardrailHash =", gr.guardrailHash);
console.log("与链上一致:", gr.guardrailHash.toLowerCase() === onchain ? "YES" : "NO");
