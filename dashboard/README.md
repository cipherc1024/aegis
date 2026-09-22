# Aegis Dashboard

Aegis 的统一入口前端。19 个页面，**只读渲染器**——本目录不持有任何私钥、不代签任何交易。

真实读数来自 `../aegis/orchestrator/server.mjs`（默认 `:8787`），经 Next 同源 rewrite
`/orch/*` 转发，浏览器不直连 orchestrator，生产路径不经 CORS。

## 两种交付形态

| 形态 | 命令 | 需要 orchestrator | 用途 |
|---|---|---|---|
| 代理版 | `npm run build` → `npm start` | 是 | 本地/内网完整功能（19 页真实读数） |
| 静态导出 | `npm run build:export` → `npm run start:export` | **否** | 产出 `out/` 纯静态目录，可放任意静态托管 |

静态导出没有服务端，`/orch/*` 代理不存在，因此依赖 orchestrator 的页会**如实显示"离线"**
（离线文案 + 全 `—` 字段表），而不是回退到占位数字。这是刻意的：宁可显示"读不到"，
不可显示编造值。详见 `../aegis/README.md`「Dashboard 诚实口径」的 5 条硬规则。

两套构建产物互不干扰：代理版走 `.next/`，导出走 `out/`。

## 快速开始

```bash
npm install

# 代理版（需要一个在跑的 orchestrator）
npm run build && npm start          # http://localhost:3000

# 或：静态导出（不需要 orchestrator，不需要 node 进程常驻）
npm run build:export && npm run start:export   # http://127.0.0.1:3222
```

静态导出目录可直接丢给任意静态托管（Nginx / GitHub Pages / OSS / Vercel static 等），
`out/` 约 2.4 MB，无运行时依赖。

### 环境变量

| 变量 | 默认 | 作用 |
|---|---|---|
| `ORCH_ORIGIN` | `http://127.0.0.1:8787` | 代理版转发目标；换部署环境时改这个 |
| `STATIC_EXPORT` | 未设 | 由 `build:export` 脚本置 `1`，勿手工设置 |
| `PORT` | `3222` | 仅 `start:export` 的最小静态服务器端口 |

## 页面分组

侧边栏的三组不是产品分类，而是**"这一页的数据从哪来"**：

- **核心（评审从这里看）** — 数据全部来自链上/orchestrator 真实读数，可直接核实
- **运营（真实写操作）** — 读数真实，但页面会发起真实上链写操作（花钱，需二次确认）
- **设计边界（真实读数 + 边界论证）** — 数据是真的，但对应产品功能在本架构下
  「结构上不能做」或「尚未做」，页内逐条给出论证

判断一页该放哪组的方法：问「删掉 orchestrator，这页还剩什么」。

桌面端走侧边栏；**移动端侧边栏隐藏**，底部 tab 放 3 个高频页 + 「更多」抽屉，
抽屉直接渲染 `src/lib/nav.ts` 的三组，因此加页时不会出现「新页在手机上点不到」。

## 目录

```
src/app/            19 个路由（app router）
src/components/     layout/（Sidebar/Topbar/AppShell）+ ConfirmTx/SafetyPanel/StatCard 等
src/lib/            nav.ts（唯一导航清单）· chain.ts（viem 只读）· aegis.ts（接口封装）
                    useOrch/useVault/useReceipts/useAgentStatus.ts（各读路径 hook，失败即"离线"）
                    replay.ts（离线重放）· snapshot.ts（缺省值）· i18n.ts · mock.ts（仅类型与格式化）
scripts/            build-export.mjs · serve-export.mjs（本地验证导出产物的最小静态服务器）
```

## 开发注意

- **加页/改名后同步 `src/lib/nav.ts`** —— 侧边栏、移动端抽屉、Topbar 面包屑都读它。
- **`next.config.mjs` 里不要设 `distDir`** —— Next 内部把导出目录写成
  `config.distDir ?? "out"`，覆盖它会让 `out/` 落错位置。
- `next dev` 与 `next build` 共用 `.next/`，两者会互相破坏；切回 dev 前先 `rm -rf .next`。
- 静态导出模式下 `images.unoptimized` 与 `trailingSlash` 必须保持开启（无服务端）。
