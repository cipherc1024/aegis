// 打包 tee/intee/agent.mjs 及其仓库依赖为 APP_B64 / MODULES_B64，
// 供 tee/intee/docker-compose.yml 在 Phala CVM 内还原后再执行。
//
// 用法：
//   node scripts/pack-intee.mjs            # 打印两个变量（零副作用）
//   node scripts/pack-intee.mjs --env      # 写成 .env.intee（只含 APP_B64/MODULES_B64，勿提交）
//
// ⚠️ agent.mjs 复用仓库模块（tee-runtime/runtime.mjs、challenger/verify.mjs），
//    故单文件 base64 已不够——必须同时带 MODULES_B64，否则 CVM 内 import 解析失败。
import { readFileSync, writeFileSync, mkdtempSync, mkdirSync, cpSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// agent.mjs 的 import 目标（相对 tee/intee/ 解析）：../../tee-runtime/*、../../challenger/*
const MODULE_DIRS = ["tee-runtime", "challenger"];

function b64(buf) {
  return Buffer.from(buf).toString("base64");
}

const appB64 = b64(readFileSync(join(ROOT, "tee", "intee", "agent.mjs")));

// 用 tar 保留目录结构；随包附带 package.json 供 CVM 内对照依赖
const stage = mkdtempSync(join(tmpdir(), "aegis-intee-"));
for (const d of MODULE_DIRS) {
  mkdirSync(join(stage, d), { recursive: true });
  cpSync(join(ROOT, d), join(stage, d), {
    recursive: true,
    filter: (src) => !/(node_modules|[\\/]\.|\.log$)/.test(src),
  });
}
const tgz = join(stage, "modules.tgz");
// ⚠️ Windows/Git Bash：路径含盘符 `C:\...` 会被 GNU tar 当成远程主机（"Cannot connect to C:"），
//    必须加 --force-local 强制按本地文件处理；且它要排在功能位（czf）之后。
execFileSync("tar", ["czf", tgz, "--force-local", "-C", stage, ...MODULE_DIRS]);

const modulesB64 = b64(readFileSync(tgz));

console.log("# APP_B64（agent.mjs 单文件）");
console.log("APP_B64=" + appB64);
console.log("");
console.log("# MODULES_B64（tee-runtime/ + challenger/ 的 tar.gz）");
console.log("MODULES_B64=" + modulesB64);
console.log("");
console.log(`# 大小：agent.mjs ${appB64.length}B(base64) / modules ${modulesB64.length}B(base64)`);
console.log("# 打包内容：" + MODULE_DIRS.join("/ + ") + "/ （已剔除 node_modules 与隐藏文件）");

if (process.argv.includes("--env")) {
  const out = join(ROOT, ".env.intee");
  writeFileSync(
    out,
    [
      "# 由 scripts/pack-intee.mjs 生成 —— 只含 APP_B64/MODULES_B64（不含 PK/密钥），仍勿提交",
      "APP_B64=" + appB64,
      "MODULES_B64=" + modulesB64,
      "",
    ].join("\n")
  );
  console.log("\n已写入 " + out + "（⚠️ 本文件不含 PK/RPC 等运行期变量，须另行 export 或经 -e 传入；含空格的取值请走 env-file）");
}
