/**
 * 给 out/ 起一个最小静态文件服务器（仅用于本地验证导出产物）。
 *
 * 为什么不 `npx serve`：那个包要联网下载；这里 40 行就够，且能明确打印出
 * "本服务器不接触 orchestrator" —— 验证"无需 orchestrator"这个断言时，
 * 别让一个带代理功能的三方工具把它变得无法证伪。
 *
 * 端口默认 3222（与 orchestrator 的 8787、next dev 的 3111 都错开）。
 */
import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "out");
const port = Number(process.env.PORT || 3222);

if (!existsSync(root)) {
  console.error(`[serve-export] 找不到 ${root}\n先跑 npm run build:export。`);
  process.exit(1);
}

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

function resolve(urlPath) {
  const clean = decodeURIComponent(urlPath.split("?")[0]);
  const target = path.join(root, clean);
  // 目录穿越防护：解析后必须仍在 root 内
  if (!target.startsWith(root)) return null;
  if (existsSync(target) && statSync(target).isFile()) return target;
  const asDir = path.join(target, "index.html");
  if (existsSync(asDir)) return asDir;
  const asHtml = `${target}.html`;
  if (existsSync(asHtml)) return asHtml;
  return null;
}

createServer((req, res) => {
  const file = resolve(req.url || "/");
  if (!file) {
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`404 ${req.url}`);
    return;
  }
  res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(port, () => {
  console.log(`[serve-export] http://127.0.0.1:${port}  ← 纯静态，无代理、不碰 orchestrator`);
  console.log(`[serve-export] 根目录 ${root}`);
});
