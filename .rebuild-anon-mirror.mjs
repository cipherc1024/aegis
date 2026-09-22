// 一次性重建脚本：把 live 工作树同步进 .anon-mirror-build 匿名快照。
// 与「直接拷贝」的区别：必须重新施加脱敏（绝对本地路径 → 相对路径），
// 否则会把作者机器的真实目录（含姓名拼音目录）写进双盲镜像。
// 用法：node .rebuild-anon-mirror.mjs [--apply]   （默认 dry-run）
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const MIRROR = path.join(ROOT, ".anon-mirror-build");
const APPLY = process.argv.includes("--apply");
const FORCE = process.argv.includes("--force");

// ---- 脏工作树守卫 ----
// 写入阶段**无条件覆盖**镜像侧文件。若镜像工作树里有未提交的改动（手工修正、
// 或上一轮同步后又调过的产物），一次 --apply 就会把它们静默擦掉、且不留痕迹。
// 这不是假想：`aegis/ARTIFACT.md` 的锚点修正与 `aegis/.env.example` 的
// `SOA_USER_PK` 就是这么丢过一次——dry-run 的 SCRUB 列表里看不出任何回退迹象。
//
// 所以：**只要工作树脏就拒绝 --apply**，要求先把镜像改动提交或恢复。
// 确认"那些改动就是要被覆盖的"时，显式加 --force。
// dry-run 只警告不阻断（它的用途就是看差异，不该被拦住）。
//
// DIRTY_OK_PREFIX：这两个是**已知的脚本外产物**（论文实验脚本及其输出，由另一条
// 流水线写入镜像且本就与 live 逐字节一致），不算"会被吃掉的手工修正"，故不阻断。
const DIRTY_OK_PREFIX = ["aegis/scripts/spectrum-bandwidth.mjs", "aegis/scripts/spectrum-rate.json"];
function mirrorDirty() {
  const r = spawnSync("git", ["status", "--porcelain"], { cwd: MIRROR, encoding: "utf8" });
  if (r.status !== 0) return { entries: [] };  // 不是 git 仓/无 git：不阻断
  return { entries: (r.stdout || "").split("\n").filter((l) => l.trim()).map((l) => l.slice(3).trim()) };
}

// ---- 脱敏规则（按序施加；长的先替换）----
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ABS_WIN = "C:\\Users\\12190\\Desktop\\本科二年级\\Monad量化\\aegis";
const ABS_POSIX = "C:/Users/12190/Desktop/本科二年级/Monad量化/aegis";
const SCRUBS = [
  // Windows 反斜杠形态（先长后短）
  [new RegExp(esc(ABS_WIN) + "\\\\tee", "g"), ".\\tee"],
  [new RegExp(esc(ABS_WIN), "g"), "."],
  // POSIX 形态（先长后短）
  [new RegExp(esc(ABS_POSIX) + "/tee", "g"), "./tee"],
  [new RegExp(esc(ABS_POSIX), "g"), "."],
  // 身份线索：作者私有仓库句柄不得进双盲镜像
  [/cipherc1024\/aegis/g, "<anonymous-artifact-mirror>"],
  // 匿名镜像自身地址同样是可关联句柄，文档中的裸 URL 一并抹掉
  [/cipherCN\/monad/g, "<anonymous-artifact-mirror>"],
];
// 兜底：任何残留的 C:/Users/12190 或 C:\Users\12190 一律报错。
// ⚠️ 这里必须容忍**重复转义的反斜杠**：JSON.stringify 会把 `\` 写成 `\\`，
// 于是 JSON 产物里字面存的是 `C:\\Users\\12190`。若模式只写 `[\\/]`（匹配单个
// `\` 或 `/`），JSON 里的双反斜杠就永远匹配不到——守卫会静默打印"✅ 无残留"，
// 而真实用户名已经随产物发布出去（2026-09-22 实测踩中：crossmachine-2of2-attestation.json）。
// 故用 `[\\/]+` 吞掉任意层数的转义斜杠，并对 `12190` 单独再兜一层。
const LEAK = /C:[\\/]+Users[\\/]+12190|Users[\\/]+12190|\bDESKTOP-DT6GK2M\b/;
// 身份线索兜底。
// 注意：aegis-dev 是镜像自身的**中性提交身份**（git user.name），文档中必须保留，
// 不得列为泄露——否则重建会因自身合法内容 exit 1。（它是本机 git user.name 的子串，
// 易被误当成作者线索，故在此显式记明。）
const ID_LEAK = /cipherc1024|cipherCN/;

// 当前生效的 artifact 锚点 tag。镜像内文档必须指向它，而父仓文档指向同一值——
// 两者字符串一致，差别只在 URL（镜像里被 SCRUBS 抹成占位符）。
// 换 tag 时改这里一处，镜像与父仓同步漂移，避免"镜像自称可复现却指向已废弃 tag"。
const ARTIFACT_TAG = "artifact-anon-2026-09-21";

// 已知的历史 artifact tag。文档正文里若把其中任何一个写成"当前锚点"（而非
// 明确标注为历史版本），就是陈旧引用——镜像与父仓都必须指向 ARTIFACT_TAG。
const STALE_TAGS = ["artifact-anon-2026-09-17", "artifact-anon-2026-09-18"];
// 「当前锚点」句式的判据：锚点行是 `tag **\`<tag>\`**。历史说明行则写成
// "> **旧 tag 说明**：..." 且 tag 带反引号但不带 ** 包裹。
const ANCHOR_RE = /tag \*\*`(artifact-anon-[\d-]+)`\*\*/g;

const anchorDrift = [];

function scrub(text) {
  let out = text;
  for (const [re, to] of SCRUBS) out = out.replace(re, to);
  // 锚点纠偏：任何 `tag **\`<tag>\`**` 写法一律改指 ARTIFACT_TAG。
  // 历史 tag 只允许以「旧 tag 说明」形式出现（无 ** 包裹），所以这里不会误伤。
  out = out.replace(ANCHOR_RE, (m, tag) => {
    if (tag !== ARTIFACT_TAG) anchorDrift.push(tag);
    return `tag **\`${ARTIFACT_TAG}\`**`;
  });
  return out;
}

// ---- 纳入范围（镜像 track 的路径），排除策略与旧快照一致 ----
const EXCLUDE_DIRS = new Set(["node_modules", ".next", "artifacts", "cache", "out", "coverage", "vendor", "tools", "artifacts-gen", ".git", ".tenderly-verify"]);
// 注意 /^\.env$/ 是精确匹配，匹配不到 .env.intee 之类的派生文件——
// 它虽不含私钥，却是打包后 agent 源码的 base64（`base64 -d` 即可还原，
// 且长串会绕过文本脱敏）。故所有 `.env*` 一律排除，仅放行 `.env.example`。
// `*.zip` 是发布物而非源码：challenger-dist.zip 由 challenger/ 源码打包而来
// （供 scripts/serve-dist.mjs 给第二台机器下载），内容与树内未打包源码重复，
// 且是二进制、脱敏表扫不到内部文本——一律排除。
const EXCLUDE_FILES = [/^\.env(?!\.example$)/, /^secrets\.txt$/, /\.log$/, /receipts-cache\.json$/, /decisions\.jsonl$/, /challenger-state\.json$/, /challenger-log\.jsonl$/, /\.zip$/];

function walk(dir, rel = "") {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      out.push(...walk(path.join(dir, e.name), r));
    } else {
      if (EXCLUDE_FILES.some((re) => re.test(e.name))) continue;
      out.push(r);
    }
  }
  return out;
}

const liveFiles = [...walk(path.join(ROOT, "aegis"), "aegis"), ...walk(path.join(ROOT, "dashboard"), "dashboard")];

// 二进制/非 UTF-8 文件：按原始字节整体拷贝，绝不走 utf8 往返
// （utf8 往返会把 UTF-16 BOM FF FE 变成 EF BF BD EF BF BD，字节数还会变）
const DECODER = new TextDecoder("utf-8", { fatal: true });
function isUtf8(buf) {
  try { DECODER.decode(buf); return true; } catch { return false; }
}

let copied = 0, scrubbed = 0, binaries = 0;
const leaks = [];

// 写任何东西之前先过脏工作树守卫（见下方 mirrorDirty 的说明）。
// 必须放在写入循环**之前**——否则守卫生效时镜像已经被改掉一半了。
const dirty = mirrorDirty();
const dirtyBlocking = dirty.entries.filter((p) => !DIRTY_OK_PREFIX.some((ok) => p.startsWith(ok)));
if (dirty.entries.length) {
  console.log("ℹ️  镜像工作树有未提交改动：");
  for (const p of dirty.entries) console.log("   " + (dirtyBlocking.includes(p) ? "⚠️  " : "· ") + p);
}
if (APPLY && dirtyBlocking.length && !FORCE) {
  console.error("\n❌ 拒绝 --apply：镜像工作树有未提交改动会被覆盖（上面标 ⚠️ 的）。");
  console.error("   这些改动可能是手工修正。请先处理其一：");
  console.error("     cd .anon-mirror-build && git add -A && git commit -m '...'   # 保留");
  console.error("     cd .anon-mirror-build && git checkout -- <path>             # 丢弃");
  console.error("   确认「就是要用 live 树覆盖它们」时，重跑并加 --force。");
  process.exit(1);
}

for (const rel of liveFiles) {
  const src = path.join(ROOT, rel);
  const dst = path.join(MIRROR, rel);
  const buf = fs.readFileSync(src);
  let payload;
  if (!isUtf8(buf)) {
    binaries++;
    payload = buf;
    if (!APPLY) { console.log(`BINARY ${rel}`); continue; }
  } else {
    const text = buf.toString("utf8");
    const after = scrub(text);
    if (after !== text) scrubbed++;
    if (LEAK.test(after) || ID_LEAK.test(after)) leaks.push(rel);
    if (!APPLY) { if (after !== text) console.log(`SCRUB ${rel}`); continue; }
    payload = Buffer.from(after, "utf8");
  }
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.writeFileSync(dst, payload);
  copied++;
}

// ---- 删除传播 ----
// 本脚本原本**只写不删**：live 树里删掉的文件会永远留在镜像里，形成幽灵文件。
// 这不是假想——`aegis/.npmrc` 就是这样在 live 树消失后仍留在镜像 tag 树里，
// 而它恰恰是干净克隆 `npm ci` 能否通过的关键（无它必然 ERESOLVE 失败）。
// 那条漂移已被单独修掉；这里补上机制，避免同类再次发生。
//
// 只清理**本脚本管理范围内**（aegis/ 与 dashboard/ 下、且不在 EXCLUDE_* 里）的
// 镜像侧文件；EXCLUDE_DIRS 内的（node_modules/.git/vendor/...）一律不碰。
// 注意：`artifacts-gen` 在 EXCLUDE_DIRS 里，故镜像里那 22 个它**不归本脚本管**，
// 不在删除候选内（live 侧新增的 8 个也不会被同步——那是既有的历史口径，保持原样）。
// ---- 脏工作树守卫 ----
// 写入阶段**无条件覆盖**镜像侧文件。若镜像工作树里有未提交的改动（手工修正、
// 或上一轮同步后又调过的产物），一次 --apply 就会把它们静默擦掉、且不留痕迹。
// 这不是假想：`aegis/ARTIFACT.md` 的锚点修正与 `aegis/.env.example` 的
// `SOA_USER_PK` 就是这么丢过一次——dry-run 的 SCRUB 列表里看不出任何回退迹象。
//
// 所以：**只要工作树脏就拒绝 --apply**，要求先把镜像改动提交或恢复。
// 确认"那些改动就是要被覆盖的"时，显式加 --force。
// dry-run 只警告不阻断（它的用途就是看差异，不该被拦住）。
const inScope = new Set(liveFiles);
const stale = [];
function collectStale(dir, rel) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (EXCLUDE_DIRS.has(e.name)) continue;
      collectStale(path.join(dir, e.name), r);
    } else {
      if (EXCLUDE_FILES.some((re) => re.test(e.name))) continue;
      if (!inScope.has(r)) stale.push(r);
    }
  }
}
collectStale(path.join(MIRROR, "aegis"), "aegis");
collectStale(path.join(MIRROR, "dashboard"), "dashboard");

for (const rel of stale) {
  if (APPLY) fs.rmSync(path.join(MIRROR, rel));
  else console.log(`STALE ${rel}`);
}
if (APPLY && stale.length) {
  // 顺手清掉因删除而空掉的目录（空目录不会被 git 跟踪，留着只会干扰人工审阅）
  for (const rel of stale) {
    let d = path.dirname(path.join(MIRROR, rel));
    while (d.startsWith(MIRROR) && d !== MIRROR) {
      try { if (fs.readdirSync(d).length === 0) fs.rmdirSync(d); else break; }
      catch { break; }
      d = path.dirname(d);
    }
  }
}

console.log(APPLY
  ? `\napplied: ${copied} files written (${binaries} raw-binary), ${scrubbed} scrubbed, ${stale.length} stale removed`
  : `\ndry-run: ${liveFiles.length} files in scope, ${scrubbed} would be scrubbed, ${binaries} raw-binary, ${stale.length} stale to remove`);
if (!APPLY && dirtyBlocking.length) {
  console.log(`\n⚠️  注意：镜像工作树有 ${dirtyBlocking.length} 个未提交改动，--apply 会被拒绝（除非 --force）。`);
}
if (anchorDrift.length) {
  console.log(`\nℹ️  锚点纠偏：以下陈旧 tag 被改写为 ${ARTIFACT_TAG}（父仓文档应同步修正）`);
  for (const t of [...new Set(anchorDrift)]) console.log("   " + t);
}
if (leaks.length) {
  console.error("\n❌ 脱敏后仍有绝对路径/身份线索残留：");
  for (const l of leaks) console.error("   " + l);
  process.exit(1);
}
console.log("✅ 无绝对本地路径残留");
