// 本地模拟 CVM 内的还原步骤（零成本、零链上副作用）。
// 严格按 tee/intee/docker-compose.yml 的 command 顺序在临时目录里重放：
//   1) 解 MODULES_B64 -> tar.gz -> tar xzf -C <app>
//   2) 解 APP_B64 -> <app>/tee/intee/agent.mjs
//   3) 静态解析 agent.mjs 的 import 图，确认每个相对路径在 <app> 下真实存在
//   4) 真的 import 一次 tee-runtime/runtime.mjs 与 challenger/verify.mjs
//
// 它验证「打包产物结构可还原 + 相对模块图解析得开 + 两侧 guardrailHash 口径一致」，
// 不验证 TEE quote 与上链（那必须在真 CVM 里跑）。
//
// ⚠️ Windows 下 tar 的路径坑（实测确认）：绝对路径 `C:\...` 被当远程主机；
//    加 --force-local 后 `\U`/`\t` 又被当转义。故本脚本自带最小 tar 解包器，
//    只解本项目自产归档（成员名都是 `tee-runtime/...` 纯 POSIX 名）。
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, existsSync, symlinkSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const envText = readFileSync(join(ROOT, ".env.intee"), "utf8");

function pick(name) {
  const m = envText.match(new RegExp("^" + name + "=(.*)$", "m"));
  if (!m) throw new Error("missing " + name + " in .env.intee");
  return m[1].trim();
}

// 最小 tar 解包：处理 ustar/GNU 的普通文件、目录、GNU longname
function untarGz(buf, dest) {
  const tar = gunzipSync(buf);
  let off = 0;
  const files = [];
  while (off + 512 <= tar.length) {
    const hdr = tar.subarray(off, off + 512);
    if (hdr.every((b) => b === 0)) break;
    let name = hdr.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const prefix = hdr.subarray(345, 500).toString("utf8").replace(/\0.*$/, "");
    if (prefix) name = prefix + "/" + name;
    let size = parseInt(hdr.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8);
    let type = String.fromCharCode(hdr[156]);
    let dataStart = off + 512;

    if (type === "L") {
      const longName = tar.subarray(dataStart, dataStart + size).toString("utf8").replace(/\0.*$/, "");
      off = dataStart + Math.ceil(size / 512) * 512;
      const h2 = tar.subarray(off, off + 512);
      size = parseInt(h2.subarray(124, 136).toString("utf8").replace(/\0.*$/, "").trim() || "0", 8);
      type = String.fromCharCode(h2[156]);
      dataStart = off + 512;
      name = longName;
    }
    if (type === "5") {
      mkdirSync(join(dest, name), { recursive: true });
      off = dataStart;
      continue;
    }
    if (type === "0" || type === "\0") {
      const p = join(dest, name);
      mkdirSync(dirname(p), { recursive: true });
      writeFileSync(p, tar.subarray(dataStart, dataStart + size));
      files.push(name);
    }
    off = dataStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

const app = mkdtempSync(join(tmpdir(), "aegis-app-"));
console.log("模拟 /app -> " + app);

// --- 1) MODULES_B64 -> 解开到 app ---
const files = untarGz(Buffer.from(pick("MODULES_B64"), "base64"), app);
console.log("[1] MODULES_B64 解开 OK，共 " + files.length + " 个文件");
console.log("    顶层：" + [...new Set(files.map((f) => f.split("/")[0]))].join(", "));

// --- 2) APP_B64 -> tee/intee/agent.mjs ---
mkdirSync(join(app, "tee", "intee"), { recursive: true });
const agentPath = join(app, "tee", "intee", "agent.mjs");
writeFileSync(agentPath, Buffer.from(pick("APP_B64"), "base64"));
console.log("[2] agent.mjs 落位 OK (" + readFileSync(agentPath).length + " B)");

// --- 3) 静态 import 图解析 ---
const src = readFileSync(agentPath, "utf8");
const specs = [...src.matchAll(/^\s*import\s[^;]*?from\s+"([^"]+)"/gm)].map((m) => m[1]);
console.log("[3] agent.mjs 的 import 共 " + specs.length + " 条：");
let missing = 0;
const localDeps = [];
for (const s of specs) {
  if (!s.startsWith(".")) {
    console.log("    " + s + "   (裸包，由 CVM 内 npm i 提供)");
    continue;
  }
  const abs = resolve(dirname(agentPath), s);
  const ok = existsSync(abs);
  if (!ok) missing++;
  else localDeps.push(abs);
  console.log("    " + s + "  -> " + (ok ? "FOUND" : "*** MISSING ***"));
}
if (missing) {
  console.log("\nRESULT=FAIL 有 " + missing + " 个相对 import 在还原后不存在");
  process.exit(1);
}

// --- 4) 真 import 本地依赖（含其传递依赖）---
// CVM 里靠 compose 的 `npm i ethers @phala/dstack-sdk` 提供 node_modules；
// 本机把仓库自己的软链过去，等价于"依赖已装好"。
symlinkSync(join(ROOT, "node_modules"), join(app, "node_modules"), "junction");
const mods = await Promise.all(localDeps.map((p) => import(pathToFileURL(p).href)));
console.log("[4] 动态 import 成功：" + localDeps.map((p) => p.replace(app, "<app>")).join(", "));

// --- 5) 口径核对：打包内的两侧对同一 policy 必须算出同一个 guardrailHash ---
// 这是 2026-09-16 重构的目的（消灭"第三条口径"）；若此处分叉，
// agent.mjs 的收据在链上 _submit 的 guardrail 校验处必然 revert。
const { attestedGuardrailHash } = mods.find((m) => m.attestedGuardrailHash);
const { runGuardrail } = mods.find((m) => m.runGuardrail);
const policy = JSON.parse(readFileSync(join(ROOT, "challenger", "challenger-policy.json"), "utf8"));
const a = attestedGuardrailHash(policy);
const b = runGuardrail("buy WMON 0.01", policy).guardrailHash;
console.log("[5] attestedGuardrailHash = " + a);
console.log("    runGuardrail hash     = " + b);
console.log("    两侧一致: " + (a === b ? "YES" : "*** NO ***"));

console.log("\nRESULT=" + (a === b ? "PASS 还原结构 + 模块图 + 双口径一致" : "FAIL 口径分叉"));
console.log("注意：agent.mjs 本体因 import @phala/dstack-sdk 无法在本机求值，需真 CVM。");
