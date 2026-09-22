# Aegis 改进建议 Handoff（交给实现 agent）

> 生成时间：2026-09-20
> 来源：一次只读技术评估（读完 `aegis/` + `dashboard/`，重跑离线 harness，独立核对链上证据）
> 适用对象：实现型 agent。**请先完整读完 §0 与 §1 再动手。**

---

## 0. 任务总纲

本轮有两类目标，**同等重要**：

1. **安全与一致性收口**（§3–§5）：修掉真正的资金/访问风险，统一前端「可点但无反应」的观感，把文档里被夸大的口径改成可核实的口径。
2. **去 Mock 化（§6，本轮新增重点）**：**把所有 mock 数据、所有「未接后端」的按钮与页面，全部改造成真实可用**——即接到真实的链上/后端/事件源，或（当真实化需要尚未构建的基础设施时）改造成真实的只读/运营视图，**绝不允许继续出现「假数据但可点击」**。

**不可动摇的底线**：这是一个真实 testnet，gas 是真钱；链上地址牵连整条证据链。**默认不改链、不发交易、不重部署**。凡涉及合约改造/重部署的，见 §9「需用户拍板」。

---

## 1. 给实现 agent 的硬约束（违反即回退）

1. **只改代码/文档**；禁止发任何链上交易。白名单：`hardhat compile/test`、`challenger/selftest.mjs`、`parity-check.mjs`、`attack-family.mjs`、`atomic-input.mjs`、`tee-adversary-sim.mjs`（不加 `--live`）、`regime-cost.mjs`、dashboard `tsc`/`build`。
   - **禁止**跑：`d6-negative.mjs`、`m2m3-testnet.mjs`、`deploy-*.mjs`、`soa-demo.mjs --onchain`、任何 `--live`。
2. **不得读取/打印/提交** `.env` 内容；只允许报告「存在且被 gitignore」。
3. **未获用户明确批准，不得 commit / push / 重部署合约 / 更改任何链上地址引用**。
4. **不得编造** URL、地址、行号、tx 哈希、测试计数。无法核实写「无法核实」。
5. 改 `challenger/verify.mjs`、`orchestrator/server.mjs`、`scripts/parity-check.mjs`、护栏/PACE/目标层**任一**后，**必须重跑 parity-check + selftest**，漂移即失败。
6. 前端占位一律**标注清楚**；去 Mock 化过程中，**不得为按钮接假 handler**（宁可禁用，不可假装）。
7. 每个上屏数值必须带**数据来源标签**：`链上` / `后端` / `本地` / `示例`（见 §6.0）。

---

## 2. 优先级与阶段

| 阶段 | 内容 | 是否需用户拍板 |
|---|---|---|
| **P0** | 资金/访问安全（§3） | 部分（P0-1/2 可直接做；P0-4/5 需决策） |
| **P1-A** | 前端一致性 + 文档诚实性（§4–§5） | 否 |
| **P1-B** | 去 Mock 化·A 组：现有数据源可真实化（§6.A） | 否 |
| **P2-A** | 去 Mock 化·B 组：需新合约/账务（§6.B） | **是（重部署/审计）** |
| **P2-B** | 去 Mock 化·C 组：需外部数据/发布（§6.C） | **是** |
| **P2-C** | 可复现性/工程（§7） | 部分 |

---

## 3. P0 — 资金与访问安全

### P0-1 写端点零认证（最高优先）
- **位置**：`aegis/orchestrator/server.mjs:722-731`（路由）、`:65`（`MONAD_TESTNET_PK`→`wallet`）、`:250/337/474`（dryRun/execute 门控）
- **现状**：`POST /api/agent/command` 是唯一真实上链端点，**无 auth/session/token/apiKey/tenant**。
- **建议（推荐 A）**：
  - **A**：新增 `ORCH_API_TOKEN`；非空时对写端点要求 `X-API-Token`，否则 401（同时覆盖 `/api/objective/draft`）。
  - **B**：写端点默认 dryRun-only，仅 `ORCH_ENABLE_EXECUTE=1` 时允许真实执行，启动时打印警告。
- **DoD**：无 token 的写请求 401 且**不发交易**；带 token 的 dry-run 仍返回 `approved_preview`。

### P0-2 监听全网卡
- **位置**：`server.mjs:745`（`server.listen(PORT,…)` 无 host）
- **建议**：新增 `ORCH_HOST`，默认 `127.0.0.1`；设 `0.0.0.0` 时打印安全警告。日志打印真实 host。
- **DoD**：默认仅回环监听。

### P0-3 `DEMO_MAX_MON` 口径不一致
- **位置**：`server.mjs:35`、`:230`（仅 proposer 本地 `paceVerify`；challenger L3 与链上均无）
- **建议**：删除，或保留但在 `/api/config` 与 README 标注「仅 proposer 预览用，不参与裁决」。默认 `0.1 > perTx 0.05`，实际从不生效，易误导。
- **DoD**：文档/字段无歧义。

### P0-4 角色密钥未分离（owner = TEE = deployer = governance）
- **位置**：`.env`（不打印）、`server.mjs:65`、`AegisVault.sol` 的 `onlyOwner` 群
- **建议**：本阶段**不拆钥**，但必须在 `README.md`「诚实边界」+ `agents.md` 增加「密钥角色现状」节，写明当前单钥承担的角色与生产拆分方案（owner 多签 / TEE HSM / governance timelock / challenger 独立主机）。`deploy-v4.mjs` 增加「owner 与 TEE 同址」警告。
- **DoD**：文档成节 + 部署脚本有警告。

### P0-5 `SafetyPanel` 硬编码 OK（未标注的伪造状态）
- **位置**：`dashboard/src/components/SafetyPanel.tsx:22-27`（`chain`/`dcap` 恒 `ok:true`）
- **建议**：由传入 `status` 推导；无法推导则整块打 `sample` 芯片，**绝不无条件显示 OK**。
- **DoD**：停 orchestrator/断网时不再显示 OK。

---

## 4. P1-A — 前端一致性

> 去 Mock 化（§6）会重写这些页面；此处先立统一口径。

### P1-1 死按钮统一（「无 onClick 也无 disabled」）
| 页面 | 位置 | 按钮 |
|---|---|---|
| vaults | `vaults/page.tsx:32-34` | 存入 |
| funds | `funds/page.tsx:41-43,67-69` | 存入 / 提现 |
| subaccounts | `subaccounts/page.tsx:22-25` | 创建子账户 |
| copy | `copy/page.tsx:29-31` | 跟投 |
| market | `market/page.tsx:83-85` | 跟投 |
| settings | `settings/page.tsx:113-115` | 导出私钥 |
| SafetyPanel | `components/SafetyPanel.tsx:64-69` | 存取款 / 编辑策略 |
| ReceiptCard | `components/ReceiptCard.tsx:57-59` | 验证这张收据 |
- **建议**：在去 Mock 化完成前，统一 `disabled` + `title`；完成后改为真实功能。
- **DoD**：不存在「可点但零行为」的按钮。

### P1-2 `/dashboard` 离线显示为「ok」
- **位置**：`dashboard/page.tsx:16`（`!s || !s.online` → `"ok"`）
- **建议**：改 `unknown`/`offline`。
- **DoD**：停服务后非 `ok`。

### P1-3 `MOCK_DATA_NOTICE` 死代码
- **位置**：`lib/mock.ts:40`（导出零引用）；`SampleBanner.tsx:18-21` 用内联文案
- **建议**：让 `SampleBanner` 引用它，或删除。
- **DoD**：无「导出但零引用」。

### P1-4 页面 × 横幅覆盖自检清单
- **建议**：在 `lib/nav.ts` 或 README 维护「19 页 × 是否占位 × 数据来源」，改愿景页后**按 nav 逐页核对**（历史教训：曾漏标 5 页）。
- **DoD**：清单与 `SampleBanner` 实际引用一致。

---

## 5. P1-A — 文档诚实性

### P1-5 可复现性叙事与工作树不一致（最重要）
- **位置**：`aegis/ARTIFACT.md`（tag 段）
- **现状**：曾宣称固定 tag `artifact-anon-2026-09-17`，且当时的镜像文档**自指**到这个已废弃 tag（`-09-17` 早于 v5 重部署，文档里是 v4 金库地址、源码无 `setReceiptRegistry`）。现锚点已改为 `artifact-anon-2026-09-21`；`-09-17`/`-09-18` 在 ARTIFACT 里保留为「旧 tag 说明」块并在其中显式标注为历史版本、勿用于复现。镜像本身是独立仓 `.anon-mirror-build`（remote `origin = github.com/cipherCN/monad`），由 `.rebuild-anon-mirror.mjs` 同步（dry-run 默认、`--apply` 写入）。
- **建议**：文档层面已改完；**待办是提交/推送镜像**——工作区修复尚未进 tag，评审现在 clone 到的仍是旧镜像。
- **DoD**：文档与现实一致 → 文档侧已完成；镜像侧取决于推送批准。

### P1-6 `executeTrade` 余额检查生效范围
- **位置**：源码 `contracts/AegisVault.sol:110`；线上 v4 `0x07Be2FCd…` 字节码**无**该 require（agents.md:383 已披露，但 README 断言性更强）
- **建议**：README 正文显式标注「线上 v4 为修复前字节码，缺该 require（+75B，ABI 不变），仅影响可观测性」。**默认不重部署**。
- **DoD**：README/agents/ARTIFACT 口径一致。

### P1-7 「跨机 2-of-2」措辞
- **位置**：`CROSSMACHINE-2OF2.md`、`README.md`、`agents.md`
- **现状**：自称「两台电脑」，但 `scripts/crossmachine-2of2-attestation.json` 的 `honestLabel` = `SINGLE-HOST TRANSFER REHEARSAL`。
- **建议**：改为「2-of-2 协议已实现 + **单机排练**已验证 + 提供双机部署手册」。
- **DoD**：三处均含「单机排练」。

### P1-8 `agents.md` 陈旧项
- **位置**：硬约束 #8「已 git init（无远程）」→ 实际有私有 `origin`。
- **DoD**：与 `git remote` 一致。

### P1-9 README 能力清单加证据标签
- **位置**：`README.md:81-94`
- **建议**：每条补 `实测 / 源码 / 文档` 标签（如 D6 标「文档·未复跑」）。
- **DoD**：无未标注强断言。

### P1-10 W11 非生产路径标注
- **建议**：README 注明 `CommittedOracle/AtomicExecutor/AuditDraw/PolicyRegistry` **未接入**生产 WMON 路径（`server.mjs`/`verify.mjs` 零引用）。
- **DoD**：读者不会误以为已上线。

### P1-11 交接文档位置
- **建议**：统一指向根 `agents.md`（部分文档误引 `aegis/agents.md`，该文件不存在）。

---

## 6. ★ 去 Mock 化：逐页真实化设计（本轮重点）

### 6.0 总原则
1. **每个页面要么真实，要么被明确改造为真实视图，要么删除**；不允许保留「假数据 + 可点击」。
2. 每个上屏值必须带来源标签：`链上` / `后端` / `本地` / `示例`。
3. 真实化优先级由「数据源是否已存在」决定，而非页面重要性。
4. 涉及用户资金的按钮，**在安全账务合约就绪前一律禁用并说明原因**（§6.B）。

### 6.0.1 前置基础设施（A/B/C 组共用，先做）
- **钱包连接**：dashboard 已用 viem。新增 `walletClient` + 「Connect Wallet」（`components/layout/Topbar.tsx`）。这是所有用户写操作的前置。
- **读 hooks**：把 `lib/chain.ts` 扩展为「合约只读视图层」：暴露 vault（balances、`perTxLimit`/`dailyLimit`/`dailySpent`/`isAlive`/白名单映射）、registry（`latestReceipt`/`lastTradeReceipt`/`agentGuardrailHash`）的统一 getter。
- **事件层**：接后端 SSE `/api/events`（`useOrch` 已有基础），把所有「通知/流水/审计」统一到事件流。
- **所有列表空态**：显示「无数据源」而非编造条目。

---

### 6.A 组 — 现有后端/链上即可真实化（P1-B，不需新合约）

| 页面 | 现状（mock/占位） | 真实化设计 | 数据源 | 工作量 |
|---|---|---|---|---|
| `/dashboard` | `12480/1204/+10.7%/1.2-5MON` 假指标 | 改为真实：vault MON/WMON 余额、PACE 已用（`dailySpent(today)` / `perTxLimit`）、agent 在线态、最近收据年龄、真实收据计数 | 链上 + `/api/status` | 低 |
| `/dashboard` SafetyPanel | chain/dcap 恒 OK | 由真实状态推导（见 P0-5） | 链上 | 低 |
| `/receipts` | `blockHash`/`prevReceiptHash` 恒 `—`；DCAP 字段「未解析」 | ① `blockHash` ← `getBlock(blockHeight).hash`；② `prevReceiptHash` ← 事件索引器扫 `ReceiptSubmitted` 重放哈希链；③ DCAP 面板改为真实 `quoteHash` + 跳转 DcapGate，并标注「原始 quote 未解析度量」 | 链上 + 索引器 | 中 |
| `/audit` | 记录数写死、导出禁用 | 真实导出：从 `/api/receipts`+`getReceiptViews` 生成 CSV/JSON（含真实哈希链校验列）；计数 = 真实条数 | 后端 | 低 |
| `/notifications` | 本地假通知列表 | 订阅 `/api/events` SSE，实时渲染 `ReceiptSubmitted`/`TradeExecuted`/`ValidatorTrustUpdated` 等 | 后端 SSE | 低 |
| `/settings` | 假配置值 | 绑定真实 `/api/config`（白名单、限额、地址、guardrailHash、RPC）；**删除「导出私钥」**（永不可为用户功能） | 后端 | 低 |
| `/market` | `mock.ts AGENTS` 假 agent | 列出**真实已注册 agent**（从 `IdentityRegistry` 事件读，当前至少 agentId=1）+ 真实金库统计；「跟投」在 §6.B 完成前禁用并注明 | 链上 | 中 |
| `/vaults` | 3 条假 APY/TVL/DD 产品 | 改造为**真实金库运营视图**：唯一真实金库 `0x07Be2FCd…` 的余额、限额、日限、白名单、暂停态、信任验证者数 | 链上 | 中 |
| `/funds` | 假流水 + 假存入/提现 | 展示真实金库余额与真实 `Deposit/Withdrawn/TradeExecuted` 事件流水；**用户存取款**属 §6.B（账务改造前禁用） | 链上 | 中 |
| `/console` | MRTD/RTMR/FMSPC/TCB（已为 `—`）+ 心跳假值 | 心跳真实化：`isAlive`/`latestReceipt.timestamp`；暂停/恢复接**后端运营端点**（owner key 在服务端，不暴露浏览器）调用 `emergencyPause/resumeTrading`；TEE 度量先标注「原始 quote，见 verifier」，后续见 §6.C | 链上 + 后端 | 中 |
| `/copy` | mock agent 跟投 | 在 §6.B 跟投账务就绪前，改为**只读浏览真实 agent**，跟投禁用并注明 | 链上 | 低 |
| `/backtest` | 假收益/Sharpe | 见 §6.C（缺历史行情源） | — | — |
| `/sdk` | 假包名 `@aegis/sdk` | 见 §6.C（仓库内真实 SDK 源码 / npm 发布） | — | — |
| `/create` | 全禁用 | 见 §6.B（注册 agent + 部署金库，需 gas） | — | — |
| `/policy` | 全禁用 | 见 §6.B（改策略需 owner 上链 `setGuardrailHash` + 重认证） | — | — |
| `/try` | dry-run only | 增加「真实执行」按钮：**必须**满足 P0-1 认证 + 二次确认 + `DEMO_MAX_MON` 展示；默认仍 dry-run | 后端 | 中 |
| `/architecture`、`/verify` | 已真实 | 保持 | 链上/后端 | — |
| `/` | 已真实 | 保持 | 后端 | — |

**A 组 DoD**：A 组页面无 `mock.ts` 依赖、无字面量假数、无死按钮；每个值有来源标签；`tsc`+`build` 通过。

---

### 6.B 组 — 需要新合约/账务（P2-A，**需用户拍板 + 安全审计**）

> 这些是「真实可用」绕不过去的硬骨头。**用户资金安全第一，未审计前禁止上主用。**

#### B-1 份额化金库（`/vaults`、`/funds`、`/copy` 的用户存取款）
- **问题**：当前 `AegisVaultQuorum.withdraw` 是 `onlyOwner`（owner=agent），用户把钱存进去**无法自行取回**，只有 agent 能取。直接开放用户存款＝把资金控制权交出去。
- **设计**：新增 ERC-4626 风格份额金库（`deposit` 得 shares，`withdraw` 按 shares 赎回），或「金库 + 用户份额账本」包装合约。agent 只被授权在 PACE 限额内 `executeTrade`，**不能提走用户本金**。
- **代价**：新合约 → 重部署 → Tenderly 重验 → 全链路地址同步 → 现有 v4 E2E 证据降级为历史。**需用户批准 + 建议外部审计。**
- **DoD**：用户在测试网可存、可赎、可查份额；agent 无法 withdraw 用户资金。

#### B-2 多 agent / 子账户（`/subaccounts`、`/create`）
- **问题**：`agentId` 硬编码 1，单金库单策略。
- **设计**：`IdentityRegistry` 已支持多 agentId；需 orchestrator 按 agentId 路由 + 每 agent 一套策略/金库；`/create` 走「注册 agent + 部署金库」的运营流程（真实 gas）。
- **DoD**：可创建并列出多个真实 agent；各自独立金库与策略。

#### B-3 跟投 / copy trading（`/copy`、`/market` 投资按钮）
- **设计**：follower → 目标 agent 的份额映射 + 收益/费用结算。依赖 B-1。
- **DoD**：跟投者资金独立可赎，收益按真实成交结算。

#### B-4 `/policy` 策略编辑上链
- **设计**：后端认证的运营端点：写入 challenger 策略 + `policy-attest --execute`（owner tx）+ 同步 env；前端只做「预览 diff + 提交」。
- **DoD**：策略变更全程可审计，链上 `agentGuardrailHash` 随之更新。

---

### 6.C 组 — 需要外部数据/发布（P2-B，需用户拍板）

#### C-1 `/backtest`
- **问题**：无历史行情源；当前收益/Sharpe 是编造。
- **选项**：(a) 删除页面；(b) 退化为「已执行成交的真实统计」（笔数/名义额，**不含**收益/Sharpe，并说明无价源）；(c) 接入真实行情 API（外部依赖 + key）。
- **DoD**：页面不再出现任何编造收益指标。

#### C-2 `/sdk`
- **选项**：(a) 在仓库内建真实 `sdk/`（从 `lib/aegis.ts`+`chain.ts` 抽薄客户端），文档写 `import from './sdk'`；(b) 若发布 npm，则更新 README 为真实包名与版本。
- **DoD**：README 不再宣传 npm 上不存在的包，或包真实存在。

#### C-3 `/console` TEE 度量（MRTD/RTMR/FMSPC/TCB）
- **设计**：解析真实 DCAP quote（`dcap-verifier` 已有 Automata/PCCS 能力），把 quote 字段上屏；或至少展示真实 `quoteHash` 并链接 verifier。
- **DoD**：度量值来自真实 quote，否则明确标注未解析。

---

## 7. P2-C — 可复现性与工程

1. **工作树收敛**：决定 65 项未提交改动中哪些进 tag（重点 `challenger/verify.mjs`、`orchestrator/server.mjs`、`scripts/parity-check.mjs`、`contracts/AegisVault.sol`）。**用户批准后再 commit。**
2. **parity 守卫增强**：加「带真实 `executionHash`/`digest` 的收据」用例让 L4 进入比对；或把 proposer 预览改为 import `server.mjs` 的 `runGuardrail/paceVerify`，消除副本盲区。
3. **测试计数口径**：README 的 `41/41（28+13）`与实测一致，保持；注意不要被外部文档的 `42+29` 误导。
4. **`.env` 卫生**：确认无 `PK=` 中间文件进暂存区；`.intee-deploy/`、`.tenderly-verify/`、`.env.intee` 已 gitignore。
5. **审计留痕**：README 标注 `decisions.jsonl`/`receipts-cache.json` 为本地文件、索引有历史缺口。
6. **单点风险**：README 新增「单点风险清单」（orchestrator / challenger / owner 单钥 / Phala CVM / RPC / LLM）。

---

## 8. 统一验收

```bash
# 工作目录：Monad量化\aegis
npx hardhat compile                  # evm target: paris
npx hardhat test                     # 41 passing
node challenger/selftest.mjs         # 17 pass
node scripts/parity-check.mjs        # 21 agree / 0 diverge
node scripts/attack-family.mjs       # 7 拦下 + 1 ACCEPTED
node scripts/atomic-input.mjs        # ALL REGIMES PASS
node scripts/tee-adversary-sim.mjs   # ALL LEGS PASS（不加 --live）

# 前端
cd ../dashboard
npx tsc --noEmit
npm run build
```

**去 Mock 化专项验收**：
- `grep -rn "mock.ts" dashboard/src/app` 应仅剩「明确标注为示例且不可交互」的页面，或为空。
- 全站六大核心页（`/ /dashboard /verify /receipts /try /architecture`）离线/断网时不出现任何伪造 OK 或假数。
- 所有可交互按钮要么有真实行为，要么 `disabled` 且有原因说明。

---

## 9. 需用户拍板的决策点（agent 遇到即停下询问）

1. 是否给写端点加认证 / 是否开启真实执行（P0-1）。
2. 是否重部署合约（P1-6 余额 require、§6.B 份额金库、多 agent、跟投、策略编辑）——**均牵连 Tenderly 重验与全链路地址同步**。
3. `/backtest` 删除还是接外部行情源。
4. `/sdk` 仓库内 SDK 还是发布 npm。
5. 是否 commit / 重建匿名镜像 tag。
6. 用户资金类改造是否接受引入外部安全审计。

---

## 10. 明确不要做

1. 不要发链上交易、不要重部署（除非 §9 获批）。
2. 不要为死按钮接假 handler。
3. 不要用 Multicall3（Monad 坑 #2）。
4. 不要硬编码事件 topic0/selector（坑 #7）。
5. 不要提交官方 ERC-8004 地址（必须自部署三注册表）。
6. 不要声称用了 RL。
7. 不要把「单机排练」表述为完成跨机 2-of-2。
8. 不要读取/打印/提交 `.env`。

---

## 附：本轮改动涉及的关键文件索引

- 后端：`aegis/orchestrator/server.mjs`、`aegis/orchestrator/pipeline.mjs`
- 挑战者：`aegis/challenger/verify.mjs`、`challenger-agent.mjs`、`objective.mjs`
- 合约：`aegis/contracts/AegisVault.sol`、`AegisVaultQuorum.sol`、`ReceiptRegistry.sol`
- 脚本：`aegis/scripts/parity-check.mjs`、`deploy-v4.mjs`
- 前端：`dashboard/src/lib/{chain.ts,aegis.ts,mock.ts,useReceipts.ts,nav.ts}`、`dashboard/src/components/{SafetyPanel.tsx,SampleBanner.tsx,ReceiptCard.tsx,layout/*}`、`dashboard/src/app/*/page.tsx`（19 页）
- 文档：`aegis/README.md`、`aegis/ARTIFACT.md`、`agents.md`、`aegis/CROSSMACHINE-2OF2.md`
