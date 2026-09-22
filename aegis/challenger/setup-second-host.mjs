#!/usr/bin/env node
// ============================================================================
// Aegis 第二台机器（challenger）一键配置脚本
// ----------------------------------------------------------------------------
// 用法（在 challenger/ 目录内运行）：
//   node setup-second-host.mjs                 # 生成/读取钱包 + 写 .env + 自测 + 打印下一步
//   node setup-second-host.mjs --interactive   # 交互式：问 A 的地址与金库地址，然后自测并可选启动
//   node setup-second-host.mjs --orch-url http://192.168.1.23:8787 --vault 0x... --run
//   node setup-second-host.mjs --print-address  # 只打印本机 challenger 地址（发给 A）
// 幂等：可重复运行；已存在的 CHALLENGER_PK 不会被覆盖。
// 私钥只写本机 .env，绝不外传。
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
// 注意：'ethers' 在确保依赖后再**动态 import**（见下方 step 1），
// 这样首次运行（还没 npm install）不会因缺包直接崩溃。

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(__dirname, ".env");
const ENV_EXAMPLE = path.join(__dirname, ".env.example");
const args = process.argv.slice(2);
const has = (f) => args.includes("--" + f);
const argVal = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const log = (...a) => console.log(...a);
const line = () => log("─".repeat(64));

function readEnv() {
  const m = {};
  if (fs.existsSync(ENV)) {
    for (const l of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
      const x = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
      if (x) m[x[1]] = x[2];
    }
  }
  return m;
}
function writeEnv(m) {
  let lines = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8").split(/\r?\n/) : [];
  const seen = new Set();
  lines = lines.map((l) => {
    const x = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=/);
    if (x && m[x[1]] !== undefined) { seen.add(x[1]); return `${x[1]}=${m[x[1]]}`; }
    return l;
  });
  for (const [k, v] of Object.entries(m)) if (!seen.has(k)) lines.push(`${k}=${v}`);
  fs.writeFileSync(ENV, lines.join("\n").replace(/\n+$/, "") + "\n");
}
function run(cmd, argv, opts = {}) {
  // Windows 上直接 spawn "npm.cmd" 在较新 Node 会抛 EINVAL（安全补丁后需 shell:true）
  const isWin = process.platform === "win32";
  if (cmd === "npm" && isWin) {
    // 合成单条命令避免 DEP0190 警告；shell:true 解决 npm.cmd 的 EINVAL
    return spawnSync(["npm.cmd", ...argv].join(" "), { cwd: __dirname, encoding: "utf8", shell: true, ...opts });
  }
  return spawnSync(cmd, argv, { cwd: __dirname, encoding: "utf8", ...opts });
}
function networkHints() {
  if (process.platform === "win32") {
    log("  · 在 A 上找 IP：PowerShell 运行  ipconfig  → 看“IPv4 地址”（如 192.168.1.23）");
    log("  · 若 B 连不上：在 A 用**管理员** PowerShell 运行：");
    log('    New-NetFirewallRule -DisplayName "Aegis 8787" -Direction Inbound -LocalPort 8787 -Protocol TCP -Action Allow');
  } else {
    log("  · 在 A 上找 IP：运行  ip addr  （或 ifconfig）→ 看 inet 地址");
    log("  · 若 B 连不上：确认 A 的 8787 端口未被防火墙拦截");
  }
}

log("");
line();
log("  Aegis 第二台机器（challenger）一键配置");
line();

// 0) Node 版本 + 目录体检
const major = Number(process.versions.node.split(".")[0]);
log(`[0/5] Node ${process.version}  (${process.platform}/${os.arch()})`);
if (major < 20) { log("  ✗ 需要 Node >= 20，请先安装 LTS：https://nodejs.org/"); process.exit(1); }
if (/^[a-zA-Z]:\\/.test(__dirname) && !/^[cC]:\\/.test(__dirname)) {
  log("  ⚠️ 当前目录不在 C 盘（在 " + __dirname.slice(0, 2) + "）——微信/U盘/网盘目录里 npm install 容易失败。");
  log("     请先把整个 challenger 文件夹拷到 C 盘任意目录（如 C:\\challenger）再运行本脚本。");
}

// 1) 依赖（先装依赖，再动态 import ethers）
const nmEthers = path.join(__dirname, "node_modules", "ethers");
if (!fs.existsSync(nmEthers)) {
  log("[1/5] 安装依赖：npm install （首次约 1–3 分钟）...");
  const r = run("npm", ["install"]);
  if (r.status !== 0) {
    log("  ✗ npm install 失败（exit=" + r.status + "）。常见原因：");
    if (r.error) log("     spawn error: " + r.error.message);
    log("     · 目录在微信/U盘/网盘里 → 本脚本会自动拷到 C 盘再跑；若仍失败请手动拷到 C:\\aegis\\challenger；");
    log("     · 网络不通 → 换网络，或先设镜像： npm config set registry https://registry.npmmirror.com");
    log("     stderr 片段：\n" + String(r.stderr || r.stdout || "").slice(-500));
    process.exit(1);
  }
} else {
  log("[1/5] 依赖已存在，跳过 npm install");
}
let Wallet;
try { ({ Wallet } = await import("ethers")); }
catch { log("  ✗ 无法加载 ethers（依赖未装好）。请在本目录运行： npm install"); process.exit(1); }

// 2) .env + 钱包
if (!fs.existsSync(ENV) && fs.existsSync(ENV_EXAMPLE)) fs.copyFileSync(ENV_EXAMPLE, ENV);
const env = readEnv();

let address;
if (!env.CHALLENGER_PK) {
  const w = Wallet.createRandom();
  env.CHALLENGER_PK = w.privateKey;
  address = w.address;
  log("[2/5] 已生成**独立** challenger 钱包（私钥只写入本机 .env）");
} else {
  try { address = new Wallet(env.CHALLENGER_PK).address; log("[2/5] 已存在 challenger 钱包，沿用"); }
  catch { log("  ✗ 现有 CHALLENGER_PK 非法，请手工检查 .env"); process.exit(1); }
}

// 合并命令行参数
if (argVal("orch-url")) env.ORCH_URL = argVal("orch-url");
if (argVal("vault")) env.VAULT = argVal("vault");
if (argVal("registry")) env.REGISTRY = argVal("registry");
if (argVal("validation")) env.VALIDATION = argVal("validation");
env.MONAD_TESTNET_RPC ||= "https://testnet-rpc.monad.xyz";
env.AGENT_ID ||= "1";
env.RECORD_REJECT ||= "false";
env.MODEL_CHALLENGE ||= "false";
writeEnv(env);

line();
log("  ★ 本机 challenger 地址（把它发给 A，A 用 CHALLENGER_ADDR= 这个值去授权）：");
log("      " + address);
line();
if (has("print-address")) { process.exit(0); }

// 3) 交互式补 ORCH_URL / VAULT
const interactive = has("interactive") || (args.length === 0 && process.stdin.isTTY);
if (interactive) {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  log("请填写两台机器怎么连（可留空，稍后再用 --orch-url 指定）：");
  const url = (await rl.question(`  A 的 orchestrator 地址（当前 ${env.ORCH_URL || "未设置"}）: `)).trim();
  if (url) env.ORCH_URL = url;
  const vault = (await rl.question(`  A 部署打印的 QUORUM_VAULT 地址（当前 ${env.VAULT || "未设置"}）: `)).trim();
  if (vault) env.VAULT = vault;
  rl.close();
  writeEnv(env);
}
log(`[配置] ORCH_URL = ${env.ORCH_URL || "(未设置)"}`);
log(`[配置] VAULT    = ${env.VAULT || "(未设置)"}`);
log(`[配置] REGISTRY = ${env.REGISTRY || "(默认)"}  VALIDATION = ${env.VALIDATION || "(默认)"}`);

// 4) 自测
log("");
log("[3/5] 运行自测 selftest.mjs（零 gas，应 17/17）...");
const st = run(process.execPath, ["selftest.mjs"]);
const out = (st.stdout || "");
const ok17 = /17 pass \/ 0 fail/.test(out);
const tail = out.trim().split(/\r?\n/).filter(Boolean).slice(-1)[0] || "";
log("  " + tail);
if (!ok17) {
  log("  ✗ 自测未通过 17/17——先解决再继续（检查 Node 版本 / npm install）。");
  process.exit(1);
}
log("  ✓ 自测通过：本机可独立完成 L1–L5 重推导。");

// 5) 启动
if (has("run")) {
  log("");
  log("[4/5] 启动 challenger-agent（常驻轮询，Ctrl+C 退出）...");
  run(process.execPath, ["challenger-agent.mjs"], { stdio: "inherit" });
} else {
  log("");
  log("[4/5] （未加 --run）如需开始裁判，运行：  node challenger-agent.mjs");
}

// 下一步提示
log("");
line();
log("  下一步");
line();
if (!env.ORCH_URL || !env.VAULT) {
  log("  ① 把上面的 challenger 地址发给 A；让 A 把它写进 aegis/.env 的 CHALLENGER_ADDR 并部署/授权。");
  log("  ② 拿到 A 的 IP 与 QUORUM_VAULT 后，在本机运行：");
  log("       node setup-second-host.mjs --orch-url http://<A的IP>:8787 --vault <QUORUM_VAULT> --run");
} else {
  log("  配置齐全：运行 `node setup-second-host.mjs --run` 或 `node challenger-agent.mjs` 开始裁判。");
}
log("");
log("  网络排查：");
networkHints();
log("");
line();
log("  别忘了：去 https://faucet.monad.xyz 给上面那个地址领一点 testnet MON（提交背书要用）。");
line();
