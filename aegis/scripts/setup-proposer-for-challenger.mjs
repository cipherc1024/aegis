#!/usr/bin/env node
// ============================================================================
// Aegis 第一台机器（proposer）一键接入第二台机器（challenger）
// ----------------------------------------------------------------------------
// 用途：B 把 challenger 地址发给你后，本脚本自动完成 A 侧的全部动作：
//   1) 把 B 的地址写入 .env 的 CHALLENGER_ADDR
//   2) node scripts/deploy-v4.mjs      （部署金库 + 授权 B + 设限额；花费 ~0.4 MON）
//   3) 把新金库地址写回 .env 的 QUORUM_VAULT
//   4) node challenger/policy-attest.mjs --execute  （治理侧认证策略 guardrailHash）
//   5) node scripts/whitelist-wmon.mjs               （把 WMON 加入金库白名单）
//   6) 打印 A 的局域网 IP 与 B 该运行的命令；可选 --run 直接起 orchestrator
//
// 用法（在 aegis/ 目录内运行）：
//   node setup-proposer-for-challenger.mjs --challenger 0xB的地址
//   node setup-proposer-for-challenger.mjs --challenger 0xB的地址 --yes   # 跳过确认
//   node setup-proposer-for-challenger.mjs --challenger 0xB的地址 --dry   # 只校验+打印，不发交易/不写 .env
//   node setup-proposer-for-challenger.mjs --interactive                  # 交互式输入地址
//   ... --run   在最后启动 orchestrator（常驻）
// ============================================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { JsonRpcProvider, Wallet } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));   // .../aegis/scripts
const ROOT = path.resolve(__dirname, "..");                       // .../aegis
const ENV = path.join(ROOT, ".env");
const ENV_EXAMPLE = path.join(ROOT, ".env.example");
const args = process.argv.slice(2);
const has = (f) => args.includes("--" + f);
const argVal = (k, d) => { const i = args.indexOf("--" + k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
const DRY = has("dry");
const log = (...a) => console.log(...a);
const line = () => log("─".repeat(64));

function readEnv(f) {
  const m = {};
  if (fs.existsSync(f)) for (const l of fs.readFileSync(f, "utf8").split(/\r?\n/)) {
    const x = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (x) m[x[1]] = x[2];
  }
  return m;
}
function writeEnvVals(vals) {
  let lines = fs.existsSync(ENV) ? fs.readFileSync(ENV, "utf8").split(/\r?\n/) : [];
  const seen = new Set();
  lines = lines.map((l) => {
    const x = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=/);
    if (x && vals[x[1]] !== undefined) { seen.add(x[1]); return `${x[1]}=${vals[x[1]]}`; }
    return l;
  });
  for (const [k, v] of Object.entries(vals)) if (!seen.has(k)) lines.push(`${k}=${v}`);
  fs.writeFileSync(ENV, lines.join("\n").replace(/\n+$/, "") + "\n");
}
function runNode(script, extra = []) {
  const r = spawnSync(process.execPath, [script, ...extra], { cwd: ROOT, encoding: "utf8" });
  return { status: r.status, out: (r.stdout || "") + (r.stderr || "") };
}
function lanIPs() {
  const out = [];
  for (const [iface, list] of Object.entries(os.networkInterfaces())) {
    for (const i of list || []) {
      if (i.family === "IPv4" && !i.internal) out.push({ iface, address: i.address });
    }
  }
  // 推荐顺序：物理网卡 > Tailscale(100.64-127) > 其它物理网段 > 虚拟网卡(VMware/VBox/Hyper-V)
  const isVirtual = (n) => /vmware|virtualbox|hyper-?v|vethernet|wsl|docker|loopback|default switch|虚拟/i.test(n);
  const isPhysical = (n) => /wi-?fi|wireless|wlan|ethernet|eth\d|en\d|以太网|无线/i.test(n);
  const score = (c) => {
    if (isVirtual(c.iface)) return 10;
    if (/^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(c.address)) return 1; // Tailscale / CGNAT
    if (isPhysical(c.iface)) return 0;
    return 2;
  };
  return out.sort((a, b) => score(a) - score(b));
}

log("");
line();
log("  Aegis 第一台机器（proposer）一键接入 challenger");
line();

// 0) 环境
const major = Number(process.versions.node.split(".")[0]);
log(`[0/6] Node ${process.version}  (${process.platform})  ${DRY ? "[DRY 模式：不发交易、不写 .env]" : ""}`);
if (major < 20) { log("  ✗ 需要 Node >= 20：https://nodejs.org/"); process.exit(1); }
if (!fs.existsSync(path.join(ROOT, "node_modules"))) {
  log("[1/6] 安装依赖 npm install ...");
  const r = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["install"], { cwd: ROOT, stdio: "inherit" });
  if (r.status !== 0) { log("  ✗ npm install 失败"); process.exit(1); }
} else log("[1/6] 依赖已存在，跳过 npm install");

if (!fs.existsSync(ENV) && fs.existsSync(ENV_EXAMPLE)) fs.copyFileSync(ENV_EXAMPLE, ENV);
const env = readEnv(ENV);
if (!env.MONAD_TESTNET_PK) {
  log("  ✗ .env 缺少 MONAD_TESTNET_PK（A 的部署/治理钱包私钥）。请先在 aegis/.env 填好再运行。");
  process.exit(1);
}

// 2) 取 B 的地址
let challenger = argVal("challenger", "");
if (!challenger && (has("interactive") || (args.length === 0 && process.stdin.isTTY))) {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  challenger = (await rl.question("  粘贴 B 发给你的 challenger 地址（0x...）: ")).trim();
  rl.close();
}
if (!/^0x[0-9a-fA-F]{40}$/.test(challenger)) {
  log(`  ✗ 地址非法或缺失：'${challenger}'。用法：node setup-proposer-for-challenger.mjs --challenger 0xB的地址`);
  process.exit(1);
}
log(`[2/6] B 的 challenger 地址：${challenger}`);

// 3) 余额检查（deploy-v4 需 ~0.4 MON）
const provider = new JsonRpcProvider(env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz", 10143, { staticNetwork: true });
let balMon = "?";
try {
  const bal = await provider.getBalance(new Wallet(env.MONAD_TESTNET_PK).address);
  balMon = (Number(bal) / 1e18).toFixed(4);
  log(`[3/6] A 部署钱包余额：${balMon} MON（部署+授权+限额约需 0.4）`);
  if (Number(bal) / 1e18 < 0.4) log("  ⚠️ 余额可能不足，请去 https://faucet.monad.xyz 领取");
} catch (e) { log(`[3/6] 余额查询失败（RPC 问题？）：${String(e.message).slice(0, 80)}`); }

// 4) 确认
if (!DRY && !has("yes")) {
  const readline = await import("node:readline/promises");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const a = (await rl.question(`  将写入 CHALLENGER_ADDR=${challenger} 并部署新金库（花费约 0.4 MON）。输入 yes 继续：`)).trim();
  rl.close();
  if (a.toLowerCase() !== "yes") { log("  已取消（未做任何改动）。"); process.exit(0); }
}

// 5) 写入 CHALLENGER_ADDR
if (DRY) log(`[4/6] (dry) 将写入 .env: CHALLENGER_ADDR=${challenger}`);
else { writeEnvVals({ CHALLENGER_ADDR: challenger }); log(`[4/6] 已写入 .env: CHALLENGER_ADDR=${challenger}`); }

// 6) 部署 + 授权 + 限额
let vault = "";
if (DRY) {
  log("[5/6] (dry) 将运行：node scripts/deploy-v4.mjs");
} else {
  log("[5/6] 部署金库 + 授权 challenger + 设限额（node scripts/deploy-v4.mjs）...");
  const r = runNode("scripts/deploy-v4.mjs");
  const m = r.out.match(/QUORUM_VAULT\s*=\s*(0x[0-9a-fA-F]{40})/);
  if (r.status !== 0 || !m) { log("  ✗ 部署失败或未解析到 QUORUM_VAULT。输出尾部：\n" + r.out.slice(-600)); process.exit(1); }
  vault = m[1];
  log(`  ✓ 新金库 QUORUM_VAULT = ${vault}`);
  writeEnvVals({ QUORUM_VAULT: vault });
  log(`  ✓ 已写入 .env: QUORUM_VAULT=${vault}`);

  log("[6/6] 治理认证策略 + 白名单 ...");
  const a1 = runNode("challenger/policy-attest.mjs", ["--execute"]);
  log("  policy-attest: " + (a1.status === 0 ? "OK" : "失败") + "  " + a1.out.trim().split(/\r?\n/).slice(-1)[0]);
  const a2 = runNode("scripts/whitelist-wmon.mjs");
  log("  whitelist-wmon: " + (a2.status === 0 ? "OK" : "失败") + "  " + a2.out.trim().split(/\r?\n/).slice(-1)[0]);
  if (a1.status !== 0 || a2.status !== 0) log("  ⚠️ 后两步有失败——请人工核对（challenger 会以 policy_not_attested 拒绝）。");
}

// 7) 给 B 的信息 + 可选起 orchestrator
const ips = lanIPs();
const ip = ips.length ? ips[0].address : "127.0.0.1";
line();
log("  A 侧完成。把下面信息发给 B：");
log(`    A 的 IP（推荐）: ${ip}${ips[0]?.iface ? "   [" + ips[0].iface + "]" : ""}`);
if (ips.length > 1) {
  log("    其它候选 IP（若 B 连不上，换一个再试）：");
  for (const c of ips.slice(1)) log(`      ${c.address}   [${c.iface}]`);
}
log(`    QUORUM_VAULT   : ${vault || "<部署后得到>"}`);
log("");
log("  B 运行（在其 challenger 目录，把 <A的IP> 换成上面推荐的地址）：");
log(`    node setup-second-host.mjs --orch-url http://<A的IP>:8787 --vault ${vault || "<QUORUM_VAULT>"} --run`);
line();
if (has("run")) {
  log("启动 orchestrator（常驻，Ctrl+C 退出）...");
  spawnSync(process.execPath, ["orchestrator/server.mjs"], { cwd: ROOT, stdio: "inherit" });
} else {
  log("最后一步：在另一个窗口运行  node orchestrator/server.mjs  以启动 A 的服务。");
  if (process.platform === "win32") log('  （若 B 连不上，用管理员 PowerShell 放行：New-NetFirewallRule -DisplayName "Aegis 8787" -Direction Inbound -LocalPort 8787 -Protocol TCP -Action Allow）');
}
