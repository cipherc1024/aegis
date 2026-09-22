/**
 * 静态导出构建：产出 out/ 纯静态目录（无需 Node、无需 orchestrator）。
 *
 * 为什么不直接写 `STATIC_EXPORT=1 next build`：
 *   - Windows cmd 不支持 `VAR=1 cmd` 前缀语法，而 npm scripts 在 Windows 上默认走 cmd；
 *   - 加 cross-env 要多一个依赖，没必要 —— next.config.mjs 读的是 process.env，
 *     从 Node 里 spawn 时直接传 env 即可，跨平台一致。
 *
 * 注意：本脚本与 `npm run build`（代理版）产出的目录互不干扰 ——
 * 导出走 distDir=.next-export + out/，代理版走 .next/。
 */
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");

if (!existsSync(nextBin)) {
  console.error(`[build:export] 找不到 next 可执行文件：${nextBin}\n先跑 npm install。`);
  process.exit(1);
}

const r = spawnSync(process.execPath, [nextBin, "build"], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, STATIC_EXPORT: "1" },
});

process.exit(r.status ?? 1);
