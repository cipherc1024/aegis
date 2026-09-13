# Aegis Agent — 前端应用开发规格（修订版 v2）

> 本文件在原《前端应用开发规格》基础上修订。核心改动：**范围分级（核心深/长尾浅）、补后端数据管线、明确 testnet、补 DCAP 数据字段、加入 i18n、补状态与错误态**。设计令牌（颜色/字体/圆角）沿用原规格 §2，不再重复。

---

## 〇、修订摘要（相对原规格）

| # | 改动 | 原因 |
|---|---|---|
| 1 | 21 页**分级**为 P0 深做 / P1 浅做 / P2 占位 | 1 人 4 周做 21 页全深不现实；平均用力会稀释护城河 |
| 2 | **新增「后端与数据管线」章节** | 原规格只有前端，`ws.subscribe`/链上验证缺依赖 |
| 3 | 链选择明确：**开发/Demo = Monad Testnet 10143**；主网 143 仅生产 | 避免真钱风险；我们全部实测在 testnet |
| 4 | 数据模型补 `quote/reportData/fmspc/tcbStatus/isHeartbeat/submitBlock/status` | DCAP 验证卡片需要 |
| 5 | **i18n（next-intl）从阶段 1 介入** | 后补返工成本高 |
| 6 | 补「钱包连接/切网络/错误/加载/空态」 | 原规格缺 |
| 7 | 三态与链上真实状态对齐（`isTradeFresh`/`isAlive`/`tradingFrozen`） | 不能是纯前端布尔 |
| 8 | 增加「与已有后端代码接口映射」 | 复用 `aegis/scripts`、`tee-runtime`、合约 |

---

## 一、产品定位与范围分级

### 1.1 定位
基于 TEE 的可验证自主交易 Agent 平台——「Agent 必须证明它听话了」。护城河 = **可验证收据（哈希链 + finalized 锚定 + DCAP 真伪）+ 死手开关**，不是收益率。

### 1.2 页面分级

**P0 — 深做（真数据 + 完整交互，10 页）**

| 页面 | 角色 | 护城河点 |
|---|---|---|
| Landing | 公开 | 叙事 + live 数据 |
| Agent 市场 | 公开 | 身份/声誉/验证率 |
| 用户 Dashboard | 存款人 | 收据流 + 哈希链 + 三态 |
| 收据/验证 | 存款人 | 单张收据完整验证 |
| 独立验证器 | 审计 | **纯链上、浏览器本地、无登录** |
| Agent Console | 运营者 | TEE 内部决策流 |
| 创建 Agent | 运营者 | ERC-8004 注册 |
| 策略编辑器 | 运营者 | 白名单/限额/护栏/非对称升级 |
| 存取款 | 存款人 | 交易/提现分区 |
| 设置 | 系统 | 参数 + 度量白名单 |

**P1 — 浅做（代表性内容，6 页）**：策略跟投、收益金库、通知、审计日志、Aegis SDK、策略回测。

**P2 — 占位（导航可点，内容「即将推出」，5 页）**：子账户、以及原规格中其余长尾。

> 导航展示完整产品广度；火力集中在 P0。

---

## 二、技术栈（修正）

| 层 | 技术 |
|---|---|
| 框架 | Next.js 14 App Router + TypeScript strict |
| 样式 | Tailwind CSS + shadcn/ui + Framer Motion + Lucide |
| 字体 | Inter + JetBrains Mono |
| Web3 | **wagmi + viem**；**开发/演示用 Monad Testnet（Chain ID 10143, RPC `https://testnet-rpc.monad.xyz`）**；主网 143 仅生产分支 |
| 状态 | TanStack Query + Zustand |
| i18n | **next-intl**（`zh` 默认 / `en`），路由 `/[locale]/...` |
| 实时 | **WebSocket**（Orchestrator 推送）；不可用时降级 5s 轮询 `GET /api/receipts/latest` |
| 图表 | **纯 CSS**，不引重型图表库 |

---

## 三、后端与数据管线（新增，关键）

前端需要以下服务（可先本地跑，Hackathon 足够）：

### 3.1 Orchestrator（Node/Express）
职责：
- 触发 Agent 决策：调用 `aegis/tee-runtime`（护栏 → PACE → 收据哈希）
- 触发 TEE 生成 quote：本地 mock 或调 Phala CVM 的 `get_quote`
- 把收据提交上链：`ReceiptRegistry.submitReceiptWithQuote(...)` 或 `submitReceipt(...)`
- 向 WS 广播 `receipt` / `status` / `notification` 事件

接口：
```
GET  /api/receipts/latest?agentId=1&limit=20   // 轮询降级用
GET  /api/agent/:id/status                      // SafetyStatus
POST /api/agent/:id/command {text}              // 触发一次指令（含攻击演示）
POST /api/agent/:id/freeze  {on:bool}           // 演示用
WS   /ws                                        // 事件流
```

### 3.2 Indexer（Envio 或自建 `eth_getLogs`）
- 索引 `ReceiptSubmitted` 事件 → 收据历史、统计（验证数、拦截数、TVL）
- 提供聚合接口给 Landing / 市场 / 审计日志
- 收 Envio bounty 时优先用 Envio

### 3.3 独立验证器的数据源
- **不经过任何 Aegis 服务器**：浏览器用 viem 直连 Monad RPC
- 读取：`ReceiptSubmitted` 事件、`lastReceiptHash`、`blockhash`、`DcapGate.check(quote, digest)`
- 需要的合约地址见 §十三

---

## 四、设计系统
沿用原规格 §2（颜色、字体、圆角、发光、脉冲、径向光源）。补充：
- 三态色：🟢 `--accent-green` / 🟡 `--accent-amber` / 🥶 `--accent-red`
- 拒绝卡：背景 `rgba(239,68,68,0.06)`，左竖线 `--accent-red`
- 哈希/区块/地址：一律 JetBrains Mono

---

## 五、数据模型（补 DCAP）

```ts
interface Receipt {
  id: string;                    // "1046"
  agentId: number;
  type: 'trade' | 'rejected' | 'heartbeat';
  action: string;                // "买入 MON" | "拦截 $SCAM"
  amount?: string;               // "0.5 MON"
  blockHeight: number;           // finalized 锚定高度
  blockHash: string;
  executionHash: string;
  nonce: string;
  guardrailHash: string;
  prevReceiptHash: string;
  receiptHash: string;           // 链上 digest
  submitBlock: number;           // 提交高度（死手开关依据）
  isHeartbeat: boolean;
  timestamp: number;
  rejectedReason?: string;

  // —— DCAP（新增）——
  quoteHash?: string;            // 对 quote 原始字节的 keccak
  reportDataDigest?: string;     // quote.report_data[0:32]（应等于 semanticDigest）
  fmspc?: string;                // "20A06F"
  tcbStatus?: string;            // "OK" / ...
  dcapVerified?: boolean;        // DcapGate.check 结果
}

interface SafetyStatus {
  freshness: 'fresh' | 'stale' | 'expired';   // 基于 isTradeFresh
  chainIntegrity: 'intact' | 'broken';        // 基于哈希链校验
  alive: boolean;                             // 基于 isAlive
  frozen: boolean;                            // 基于 tradingFrozen
  dcapVerified: boolean;
  currentBlock: number;
  lastReceiptBlock: number;
}

interface Agent {
  id: string; name: string; avatar: string; erc8004Id: string;
  tvl: string; return30d: string; maxDrawdown: string; winRate: string;
  reputation: number; verified: boolean; insured: boolean; totalReceipts: number;
}
```

---

## 六、实时数据流

- `ws.subscribe('receipt')` → 插入收据流顶部、更新哈希链、更新统计
- `ws.subscribe('status')` → 侧边栏徽章 + Dashboard 安全面板
- `ws.subscribe('notification')` → 通知中心 + 铃铛红点
- 降级：WS 断 → 5s 轮询 `/api/receipts/latest`
- **独立验证器页例外**：不订阅 WS，纯浏览器 viem 直连链

---

## 七、i18n（新增）

- `next-intl`，`messages/zh.json` / `messages/en.json`
- 路由 `/[locale]/...`，默认 `zh`
- 顶栏/侧边栏提供语言切换
- **阶段 1 就建立文案字典**；P0 页面必须双语，P1/P2 可先 zh
- 数字/哈希不翻译；日期用 locale 格式化

---

## 八、状态与错误态（新增）

每个数据页面需覆盖：
- **加载**：骨架屏（skeleton），不用 spinner 占满屏
- **空态**：插画/文案 + 引导按钮（如「还没有收据」）
- **错误**：RPC 失败 → 重试按钮 + 保留上次数据；链不匹配 → 提示切换网络
- **钱包**：未连接 → 引导连接；连错网络 → 一键切到 Monad Testnet 10143

---

## 九、响应式（收敛）

- ≥1280 完整；768–1279 侧栏折叠 60px；<768 底部 Tab
- **仅移动优先页**做完整移动适配：Dashboard、收据/验证、存取款
- 其余页面保证不破版即可（不做精细移动布局）

---

## 十、Demo 模式
`?demo=true`：
- 隐藏真实钱包操作按钮
- 预置收据流，每 2s 插入一条
- 底部演示控制：切换三态、💥 断链、模拟攻击
- 数据全部 mock，不调真实 RPC（但独立验证器页可保留"真验一张固定收据"作为彩蛋）

---

## 十一、实现顺序（P0 优先后）

**阶段 1 基础**：Next+TS+Tailwind+shadcn+Framer+Lucide；设计系统；i18n；侧栏+顶栏+布局；wagmi/viem 连接 Monad Testnet。
**阶段 2 P0-A**：Landing → Agent 市场 → 用户 Dashboard（收据流 + 哈希链 + 三态）。
**阶段 3 P0-B**：收据/验证 → 独立验证器 → 存取款。
**阶段 4 P0-C**：创建 Agent → 策略编辑器 → Agent Console → 设置。
**阶段 5 Orchestrator + Indexer**：WS / 轮询 / 真数据接入（替换 mock）。
**阶段 6 P1**：策略跟投 / 收益金库 / 通知 / 审计日志 / SDK / 回测（浅）。
**阶段 7 P2 占位 + 动效 + Demo 模式 + 响应式 + 性能 + a11y。**

---

## 十二、验收标准（修订）

- [ ] **P0 10 页**深度可用（真数据或明确标注 mock）
- [ ] 独立验证器：浏览器本地完成 6 项验证（含 DCAP 链上调用）
- [ ] 三态与链上 `isTradeFresh/isAlive/tradingFrozen` 对齐
- [ ] 收据流虚拟滚动、哈希链可视化、断链演示
- [ ] 语言切换（zh/en）在 P0 页面生效
- [ ] 钱包连接/切网络/加载/空/错态完备
- [ ] `?demo=true` 可完整演示
- [ ] 768/1440 不破版；无 TS 错误；无 console 错误
- [ ] Lighthouse Performance ≥ 80（demo 模式）

---

## 十三、与已有后端代码的接口映射（复用）

| 前端需求 | 复用 |
|---|---|
| 收据哈希 / semanticDigest 计算 | `aegis/tee-runtime/runtime.mjs` |
| 护栏 / PACE / 双 LLM | `aegis/tee-runtime/{runtime,agent,llm}.mjs` |
| TEE quote 生成（In-TEE） | `aegis/tee/intee/agent.mjs` |
| 链上读写封装 | `aegis/scripts/lib.mjs` |
| 独立验证 6 项 | `DcapGate.check` + `ReceiptRegistry.{lastReceiptHash,isTradeFresh,isAlive}` + `blockhash` |

**已部署（Monad testnet 10143）**
- ReceiptRegistry（E2E）`0xD5411ac5Ee8Bf9007c0F1dAfF6d3C3D98CcCA359`
- DcapGate `0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F`
- V4QuoteVerifier `0x0eb496471d638173cdF35bE6b0e54FE035289F1f`
（完整清单见 `aegis/dcap-verifier/STATUS.md`）

---

## 十四、禁止事项（保留）
1. 不用纯黑背景 2. 不用 Bootstrap/AdminLTE 风格 3. 不引重型图表库 4. 导航不做二级嵌套 5. 不用弹窗替代页面 6. 不直接展示原始 JSON 7. 未完成 P0 前不做动效 8. 不发明本文档未描述的页面/功能
