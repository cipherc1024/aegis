# AGENTS.md — Aegis 项目转交说明

> 本文件是给接手本项目的 AI Agent / 工程师的交接文档。**开工前先完整读一遍**，尤其是第 8 节 Monad 坑表和第 10 节硬约束。
> 最后更新：2026-09-15（SOA-lite 链上 E2E 实跑通过：objectiveHash 上链 + L5 重推导 + executeTrade 全链；另修复推理模型 token 预算 + RPC 读滞后两个真实 bug）

---

## 0. 接手第一步：验证现状（约 5 分钟，建议先跑）

在动手改任何东西前，先确认交接状态真实可用：

```bash
# 工作目录：C:\Users\12190\Desktop\本科二年级\Monad量化\aegis
npx hardhat compile          # 期望 "evm target: paris"
npx hardhat test             # 期望 "26 passing"
node scripts/d6-negative.mjs # 期望 8 项攻击向量全部被拒 + 1 正例通过（真实上链 fresh 合约，~0.15 MON gas，非零成本）
node scripts/parity-check.mjs # 期望 "17 agree / 0 diverge"
node challenger/selftest.mjs  # 期望 17/17（L1–L5 全覆盖）
node scripts/soa-demo.mjs     # 期望 4/4：诚实通过，漂移/篡改/过期被 L5 拒
node scripts/soa-demo.mjs --onchain  # 真实上链版（需 orchestrator+challenger 在跑；期望 5/5，含 executeTrade）
```

> 全链一笔会真实上链（消耗主钱包 gas）。若主钱包余额 <0.1 MON 先测 dryRun：
> `node orchestrator/server.mjs` 后 `POST /api/agent/command?agentId=1 {"command":"buy WMON 0.01"}`（零 gas，看 `challenger.agree=true`）。

**最近一次工作记录（2026-09-15，SOA-lite + 攻击族四格 + 代价曲线 + SOA 链上 E2E）**：
- SOA-lite（T3 工程落地）：用户 EIP-191 签署目标 → challenger L5 独立验签 + ε-区间检查 → `objectiveHash` 经 `bindTranscript` 上链存证；命令 `node scripts/soa-demo.mjs`（诚实/漂移/篡改/过期 4/4 符合预期）、`node scripts/soa-sign.mjs`（用户侧签名）
- **SOA 链上 E2E 实跑通过（`--onchain`，2026-09-15，见下方证据块）**：5/5——诚实场景全链执行（含 objectiveHash 上链 + L5 重推导 + executeTrade），漂移/篡改/过期三场景在链前被拒零 gas
- 攻击族四格（`scripts/attack-family.mjs`）：7/8 拦下；1 未拦 = 输入真实性不可能性（论文 R1，设计边界，刻意保留展示）
- 谱系代价曲线（`scripts/regime-cost.mjs`）：L1–L5 全链重推导 ≈2.1–2.7 ms/次（三次实测区间；护栏 ≈68–106µs / PACE ≈86–106µs / L5 验签+ε ≈1.6–2.2ms）；菜单扫描 ≈18–32 ns/点线性

**SOA-lite 链上 E2E（2026-09-15，`node scripts/soa-demo.mjs --onchain`，可去区块浏览器核对）**：
- 收据（含 DCAP quote）+ bindTranscript：tx `0xac1a5c8a2f60f2110d005fd4383c4b9b36d75819ac174c6dbd9b7214bbe904de` @62756780（gas 3.48M），receipt digest `0x85f52983…3dc740`，`TranscriptBound` uri = `aegis://objective/0x7d3789c5…e51648`（= 用户签署的 objectiveHash）
- challenger 五层（L1–L5）独立重推导 pass → validationResponse=100（`0x0cd3f6a9…d2e60e`）→ executeTrade{value} `0x03a754cf…a5f388` @62756812，**TradeExecuted target=WMON amount=1e16，金库 WMON 0.01→0.02**
- 三负例（链前拒，零 gas）：漂移 `objective_exceeds_max` + `objective_not_eps_optimal:dev=1e16` / 篡改签名 `objective_bad_signature` / 过期 `objective_expired`
- 本次实跑修复 3 个真实 bug：① deepseek-flash 为推理模型，max_tokens 预算过小（300/400）被 reasoning 吃光 → 空 content → fail-closed 误拒（现 `LLM_MAX_TOKENS=2000`，`llm-openai.mjs` 对 `finish_reason=length` 明确报因）；② `tx.wait()` 后读 `lastReceiptHash` 命中滞后 RPC 后端 → bindTranscript 用旧 digest 估 gas → "Not latest receipt" revert（现客户端预算 expectedDigest + 轮询对齐，prev 读改为连续两次一致）；③ orchestrator HTTP 异常此前静默无日志（现 catch-all 打印）

**Phase 4 全链 WMON E2E（2026-09-14，可去区块浏览器核对）**：
- 策略治理：setGuardrailHash `0x2464ea4c0bf76f02f615fa91a32f963b3b9ccd0ab0f7943afb65b8ce99767dce`（新认证哈希 `0x0fd539cd…cfb84`）；setTarget(WMON) `0x451e6c13ff8163a8ebf72fbb35ce2c5742911077355d4bb9b62bcb707974bad5`
- 全链 buy WMON 0.01：收据 `0x911bb84e…161408` @62366788 → challenger 四层 pass → validation `0x1a080156…629e7` + `0xaed41909…10cc9` → **TradeExecuted `0x1d30e015…d3f99b` @62366819，execHash 与 transcript 逐字节一致，金库 WMON 0→0.01**
- 历史记录（2026-09-13 双代理互证）：quorum 部署 `0xbac0c00d…`、AGREE 收据 `0xd6f89e50...`、TAMPER response=0 `0xe4d59674...`、quorum E2E TradeExecuted @62070391 `0xa1624850…`

---

## 1. 项目是什么

- **项目名**：Aegis —— TEE-Attested Autonomous Trading Agent
- **赛事**：Monad Metropolis 黑客松，**Track 04: Trust, Identity & AI Infrastructure**
- **提交截止**：**2026-10-13**（交接时剩约 1 个月）
- **一句话定义**：给“持有链上资金的自主 AI 代理”做**可验证执行**——AI 每一步决策都变成密码学对象（确定性摘要 → 绑定区块的哈希链收据 → 链上验证的 TEE 身份 → 独立 challenger 重推导互证），金库只执行通过全部关卡的字节。
- **答辩金句**：“以太坊解决了‘代码即法律’，我们解决‘模型即法律’——不让 AI 直接动钱，让‘可被独立重推导出相同结论’的决策动钱。”

**创新点（答卷/README 要反复强调，别只讲技术堆叠）**：
1. **AI 决策可验证化**：把安全关键路径做成确定性函数（护栏 + PACE + 目标层），LLM 只当 proposer，其输出只是被摘要/分类的不可信输入；challenger 用纯确定性代码独立重推导“同意/拒绝”。TEE 证明“谁在什么环境跑”，challenger 证明“决策本身是否一致”——两个正交信任维度。
2. **完整字节级绑定链**：LLM 决策 → semantic digest → PDR(executionHash+guardrailHash) → 收据绑定 blockhash → 链上 DCAP 验 TEE 身份 → vault 只执行与收据 executionHash 一致的字节 → 执行前 challenger quorum。8 个攻击向量 + 1 正例对照实测（攻击全部被拒、正例通过）。
3. **ERC-8004 ValidationRegistry 从元数据变硬闸门**：`_preExecutionHook` 要求最新收据 response≥100 才放行 executeTrade，requestHash = 收据 digest，验证的是“那次具体决策”。
4. **SOA-lite 签署目标（"选择可验证性"的最小落地）**：用户签署**目标**（金额区间/标的/期限/nonce）而非动作；challenger L5 层验签 + ε-区间算术，意图漂移即使"策略合规"也被拒；不验证"最优"，验证"落在你授权的范围内"。

**诚实边界（评委追问时主动说，别吹）**：链上 DCAP 验证（Automata 等有先例）、双 LLM 隔离（接近 CaMeL/dual-LLM pattern）、challenger 游戏（形似 Arbitrum 欺诈证明）都是已有技术；创新在**端到端咬合 + 确定性可重推导设计 + 负例实测**。challenger 当前验证的是策略合规性 + 签署目标 ε-一致性，不是完整重推导 LLM 的推理过程；输入真实性不可验证（R1 不可能性，见 attack-family 第一格）；SOA 目标链上强制未做（存证层证据）；challenger 经济模型未设计。

---

## 2. 当前状态（已完成，全部 Monad testnet 实测）

- [x] 链上 DCAP 验证真 Intel TDX quote（full stack，14+ 合约）
- [x] `ReceiptRegistry`：哈希链收据 + blockhash 双绑定 + nonce 防重放 + 心跳独立槽位
- [x] in-TEE 自治闭环：真实 TDX CVM 内 决策→自证→上链
- [x] ERC-8004 三注册表**自部署**（官方 testnet 无部署，codeLen=0）+ Agent 注册 + 验证闭环 + 声誉反馈
- [x] D6 负例测试：8 攻击向量全部被拒 + 1 正例对照（`scripts/d6-negative.mjs`）；坏 quote 位置扫描（`scripts/dcap-corrupt-sweep.mjs`）
- [x] Orchestrator 读侧+写侧（`orchestrator/server.mjs`）
- [x] 收据索引器（绕过 getLogs 100 块限制，`scripts/index-receipts.mjs`）
- [x] **Proposer/Challenger 双代理互证** + `AegisVaultQuorum` 上链部署 + 链上 quorum E2E
- [x] **Challenger 独立性包**（2026-09-13 Phase 1）：`challenger/` 自包含验证进程（4 层独立重推导 + 决策原文存证端点 + fail-closed，11 用例自测全过；**现已扩展到 5 层 / 17 用例**）；orchestrator 角色分离（不再代签 validation）；**部署到队友机器（见 challenger/README.md）即成真 2-of-2**
- [x] **Phase 2 完成**（2026-09-13）：合约 v2 部署——ReceiptRegistry `0x4622D041...`（bindTranscript 决策原文绑定 + MAX_BLOCK_AGE=100）、AegisVaultQuorum `0xe6E24BB7...`（executeTrade 带 {value}，vault 余额真实变动）；**quote 路径上线**——Phala CVM `aegis-quote`（tdx.small 常驻，公网端点在 .env QUOTE_URL）实时生成绑定 digest 的真 TDX quote → `submitReceiptWithQuote` 链上 DCAP 验真；orchestrator execute 流程接通（AGENTS 待办#1 完成）；**全链 E2E 实测（17.6s）**：submitReceiptWithQuote（gas 3.5M，tx 0x7981eb9b...）→ challenger 四层 pass → validationResponse(100) → executeTrade（tx 0xe4902c0a...，TradeExecuted @62191167 块后）→ vault 0.5→0.48 MON；18/18 单测（新增 3 个 bindTranscript 用例）；策略变更流程实跑（白名单 → env 同步 → re-attest）；主钱包余额约 1.7 MON（challenger 回转 1.5 MON，tx 0x6a444c95...）；已知坑：Windows 下 Git Bash kill 杀不干净 node 后台进程（用 PowerShell Stop-Process），orchestrator 端口占用时新进程 EADDRINUSE 静默崩溃（重定向前先查 netstat）
- [x] **Phase 3 完成（代码侧）**（2026-09-13）：proposer 侧**双 LLM 隔离管线**（`tee-runtime/llm.mjs` + `orchestrator/pipeline.mjs`：隔离 LLM 只抽取 facts/suspicious、无工具权限 → 特权 LLM 只吃「可信指令 + 隔离摘要」产出 typed intent，全程 fail-closed）；**信任边界显式化**（LLM 在 TEE 之外，因模型仅校园网可达 —— 该设计已从论文 P1 推导证明不削弱安全性，见 `..\..\monad论文\A会论文路线图.md` §5）；challenger 新增可选**交叉模型层**（`challenger/llm-challenge.mjs`，`MODEL_CHALLENGE=true` 开启，默认关闭；要求不同家族模型 + temp=0 + 确定性代码裁决，`agree=null` 表示无法裁决→不签发）。**注意命名：此层历史上曾被称作"L5"，现 L5 专指 SOA-lite 目标层，两者不同**；新增 `GET /api/pipeline` 只读预览端点；**语义分歧度量**实验脚本 `scripts/llm-divergence.mjs`（论文 §6 实验 1b，零 gas 离线）
- [x] **Phase 3 修复的口径漏洞**（重要，3 个真实 bug）：① `orchestrator` 预览护栏**未规范化 text** 就匹配 blocklist → `ev\u200Bil.com` 零宽混淆可绕过（challenger 一直是对的，会制造假性分歧）；② orchestrator `norm` 缺 leetspeak folding → `3vil.com` 两侧结论漂移；③ leet 折叠把 `a11`→`aii` 导致注入正则漏判（两侧同口径修）；④ mock LLM 用 `/ISOLATED/i` 判别分支，而 `PRIVILEGED_SYSTEM` 含 "isolated analyst" 字样 → 特权调用误入隔离分支，mock 路径整体静默失效。**新增 `scripts/parity-check.mjs`** 守住口径：同一批输入分别喂 proposer 预览与 challenger 完整重推导，断言"拒绝与否"一致（当前 17/17 agree，含 7 个目标层用例，漂移即 exit 1）
- [x] Hardhat 单测 **18/18 通过**（新增 3 个 bindTranscript 用例）；challenger selftest **17/17**（L1–L5）；parity **17/17**；Dashboard 构建通过
- [x] **Phase 3 live 完成**（2026-09-13/14）：真实校园网模型接入（USTC 网关，OpenAI 兼容，key 在 .env）——proposer=deepseek-flash / challenger=glm-5.3-flash（**经网关 token 指纹实测确认不同后端**，`scripts/probe-gateway.mjs`：smart/reasoning/qwen3.6-chat/claude-haiku-4-5 共享同一后端，glm 独立）；live E2E 已实测（网关偶发 503/超时 → fail-closed 返回 refuse，退避重试即可）
- [x] **Phase 4 完成**（2026-09-14）：**真实协议交互路径上线**——重置后 testnet（2025-12-16 genesis reset）无法核实任何第三方 DEX router（Uniswap v2/v3/v4 canonical 地址链上实测 codeLen=0，`scripts/probe-dex.mjs`；Kuru 无法核实），经用户确认以**官方 canonical WMON wrap** 为真实路径：官方文档核实 WMON `0xFb8bf4c1…8541`（链上 codeLen=3249、name/symbol/decimals 读回正确）→ `.env` WHITELIST 与 challenger 策略加入 WMON → `policy-attest --execute` 上链新认证 → `whitelist-wmon.mjs` 金库白名单上链 → pipeline assetMap 加 WMON（intent→`deposit()` calldata `0xd0e30db0`，`pipeline.mjs` WMON_DEPOSIT）→ **全链 E2E 实测：buy WMON 0.01 → executeTrade{value} → TradeExecuted @62366819，execHash 与 transcript 逐字节一致，金库 WMON 0→0.01**。修复 /api/verify 口径：未显式传 target/amount 时走与 /api/agent/command 完全相同的 pipeline 解析（data 也取 pipeline 值），新增 `resolvedBy` 字段。challenger 加固：全局 unhandledRejection 接管（RPC 抖动不再杀进程）
- [x] **Phase 6 完成**（2026-09-14）：**统一入口 Dashboard**——Next rewrites 把 `/orch/*` 同源代理到 orchestrator（**dashboard 生产路径不经 CORS**，内网地址不进浏览器；注：orchestrator 自身的 CORS 白名单是 2026-09-16 才收紧的，见下方"审计修正"条）；新页 `/try`（现场跑一笔：pipeline 预览 → 双实现裁决 → dry-run 摘要，preset 覆盖合规/注入/未知标的/超限）与 `/architecture`（信任边界图 + TEE 虚线 + 10 步路径 + 一键 11 负例实测）；landing 四卡全改真实读数（编造数字清除或标「示例」）；`/receipts` 改走 orchestrator 索引（真实哈希+tx 可点 explorer，未覆盖字段诚实显示"—"）；nav 重排评审动线（核心→用户→运营者）。修复：try/architecture 页管线拒绝时 challenger=null 的 TypeError、challenger layers 对象误当数组、11 负例面板未知标的误用白名单 target
- [x] **Phase 5 完成**（2026-09-14）：README 重写（信任边界口径、P1-P6 里程碑、Phase 4 全链 tx 表、部署地址表更新到 v2、诚实边界清单、testnet 重置坑）；agents.md 同步
- [x] **Tenderly 公开验证**（2026-09-15）：6 个自部署核心合约（DcapGate / ReceiptRegistry / AegisVaultQuorum / ValidationRegistry / IdentityRegistry / ReputationRegistry）**源码级 public 验证**（Tenderly 项目 monad-testnet），合约页与 E2E tx 页**匿名免登录可开**（评委直接核验）；配套 `scripts/tenderly-prep.mjs`（任一合约编译预检 + 链上 bytecode diff）与 `scripts/dcap-standard-input.mjs`（DcapGate shanghai standard JSON）；证据链接见 `aegis/README.md`「Tenderly 公开证据」节

- [x] **运营更新**（2026-09-15）：DEX 复探维持「testnet 无第三方 DEX」结论（新发现 Permit2 存在但不可核实）；challenger 包修复 v1 废弃默认地址 + 新增 `scripts/send-mon.mjs`（钱包注资）+ 真 2-of-2 传输包已打包；**LLM 切官方 DeepSeek**（校外可达，¥10 充值实测连通，dry-run `mode:"live"` 四层 pass；**校园网关已删除**，交叉模型层需另配端点）
- [x] **SOA-lite 签署目标层（L5）**（2026-09-15，零 gas）：用户 EIP-191 签署客观目标（draft-then-sign：`POST /api/objective/draft` 起草 → `scripts/soa-sign.mjs` 用户侧签名）→ proposer（`tee-runtime/objective.mjs`）与 challenger（`challenger/objective.mjs`）**零共享代码双实现**独立验签 + ε-区间检查（`objective_not_eps_optimal:dev=`）→ `objectiveHash` 经 `ReceiptRegistry.bindTranscript` 的 uri 字段上链存证（`aegis://objective/<hash>`，`TranscriptBound` 事件）；challenger verify 新增 `5_objective` 层，receipt 带 `timestamp` 作时间源；selftest **17/17**、parity **17/17**（含 7 目标层用例）；演示 `scripts/soa-demo.mjs` 4 场景符合预期。**命名**：L5 = 目标层（确定性），"交叉模型层" = 可选跨家族 LLM 层，两者不同
- [x] **攻击族四格实验**（2026-09-15，论文 §8.1 对应，零 gas）：`scripts/attack-family.mjs` 对四类攻击者各构造最优攻击实测——x-代换（**拦不住，按设计**：R1 输入真实性不可能性）、策略后门 ×3（L1/L3 拦下）、意图漂移 ×2（L5 拦下）、混淆代理 ×2（L4 拦下）；**7/8 拦下，1 项为诚实的负结果**（此实验价值所在）
- [x] **谱系代价曲线实验**（2026-09-15，论文 T1/T2/T5 对应，零 gas）：`scripts/regime-cost.mjs` 实测（三次运行区间）——护栏 ≈68–106µs / PACE ≈86–106µs / L5 验签+ε ≈1.6–2.2ms / 全链 L1–L5 ≈2.1–2.7ms（可进热路径）；全菜单最优性扫描 ≈18–32 ns/点（线性于菜单规模，与模型大小无关）；ε-覆盖网 (D/ε)^d 为**合成计算（非实测，已标注）**
- [x] **审计修正（只读结构审计后的三项修复）**（2026-09-16，commit `ebfc6cf`）：三处均属"未声明的缺口"而非已声明边界——
  ① **orchestrator CORS 由 `Access-Control-Allow-Origin: *` 收紧为来源白名单**（`ALLOWED_ORIGINS`，默认 `http://localhost:3000,http://127.0.0.1:3000`）。本进程持有 proposer 私钥且 `/api/agent/command` 可写（可真实上链），通配符使浏览器里任意页面都能跨站打到 `localhost:8787`；无 `Origin` 的非浏览器调用（curl/服务端）不受影响但不再回显 ACAO。**dashboard 生产路径走 Next 同源 rewrite，不经 CORS，故演示链路不受影响**——这也解释了为何此前 Phase 6 记录写"不开 CORS"却未暴露问题：同源代理让通配符从未被实际触发。
  ② **Dashboard 愿景页（vaults / funds / subaccounts / copy / backtest / market）全部基于 `mock.ts` 编造数字，此前零标注** → 新增 `components/SampleBanner.tsx` 页级横幅（沿用 `StatCard`/`SafetyPanel` 既有 `sample` 芯片口径，整页占位时更显眼），market 页附定制文案点明"真实可验证的 agent 只有 agentId=1"；顺带补上 funds 页缺失的 h1。
  ②b **同一轮只覆盖了 6 页，另有 5 页漏标（2026-09-16 复查补做）**：`console` / `audit` / `sdk` / `notifications` / `settings`——其中 `console` 页的伪造 TEE 度量值（MRTD/RTMR0/FMSPC/TCB）与"心跳 3 秒前"最伤可信度（该页在 nav 的「核心（评审从这里看）」组内）；`audit` 页伪造"12,480 条记录"并断言"所有导出均带哈希链校验值"（功能不存在）；`sdk` 页宣传 npm 上不存在的 `@aegis/sdk`；`settings` 页把 `8`/`60`/`a7f2c8d9…` 显示成实际配置值。处理：五页均加 `SampleBanner`（各带定制文案），并删掉具体编造数值（改为 `—` / "无数据源" / 标"规划中"），`audit` 导出按钮置 `disabled`。教训：**"改了愿景页"必须按 nav 清单逐页核对**，不能按已改页数报完成。
  ③ **`tee-runtime/runtime.mjs` 的 `pdrHash` 由 4 字段改回与链上一致的 3 字段**（`[intentHash, policyHash, true]`）。原 4 字段形态与 orchestrator/challenger 都算不出同一值；该模块仅经 `agent.mjs → agent-demo.mjs` 演示路径可达，**未污染生产管线**。同时在文件头标注本模块为演示路径——其 `buildIntent` 的 `intentHash = keccak(kind,target,amount,data,slippage)` **语义比链上宽，不等于 `executionHash`**，故其 `pdrHash` 不可直接当链上收据字段；并补齐 `computeReceiptDigest`（链上 `_submit` 实际落盘的 digest 公式，此前只在 orchestrator 内联）。
  **回归验证**：hardhat 18/18 · challenger selftest 17/17 · parity 17 agree / 0 diverge · agent-demo 三场景不变 · dashboard tsc + build + 浏览器实测横幅渲染
- [x] **审计修正第二轮（2026-09-16，未提交）**：三项均为"未声明的缺口"，本轮全部修复——
  ④ **`AegisVaultQuorum` 加 challenger 验证者白名单**（`isTrustedValidator` 映射 + `trustedValidatorCount` + `setTrustedValidator` + `ValidatorTrustUpdated` 事件；钩子改为 `require(isTrustedValidator[validator], "Untrusted challenger")`）。**漏洞**：`ValidationRegistry` 本身是 permissionless 的——任何人可调 `validationRequest` 把 `validatorAddress` 设成自己，再用自己的地址回 `validationResponse(100)`；旧钩子只读 `response >= MIN_RESPONSE`，故**攻击者可自证自答伪造 quorum**（不需要 challenger 私钥）。修复后钩子先查验证者是否在 owner 白名单内，**白名单默认为空 = fail-closed**（未授权时 executeTrade 一律 revert，宁可拒绝不可放行）。`scripts/deploy-quorum.mjs` 部署时自动把 `CHALLENGER_ADDR` 授权上链；单测新增（自证伪造被忽略 / 撤销授权立即生效 / 白名单 owner-only 且拒零地址 + `ValidationRegistry` 五个边界用例）→ hardhat **18 → 26 passing**。⚠️ **旧 v2 地址（`0xe6E24BB7…`）仍是旧钩子，本修复要生效需 v3 重部署**。
  ⑤ **`tee/intee/agent.mjs` 的第三条护栏口径（in-TEE 自治闭环路径）**——原文件手写了一套独立的护栏/PACE，其中 `guardrailHash` 硬编码为 `keccak256(toUtf8Bytes("guardrail-v1"))`，**永远不等于**链上 `agentGuardrailHash = attestedGuardrailHash(policy)`，且其 `norm` 缺 leet 折叠（与 challenger L2 漂移）；它既不在 `parity-check` 覆盖内，也不被仓库任何文件 import（`tee-runtime/agent-demo.mjs` 用的是另一个 `agent.mjs`）。处理：**删除自实现，改为 import 仓库权威模块**（`../tee-runtime/runtime.mjs` 的 `runGuardrail/paceVerify/computeExecutionHash` + `../challenger/verify.mjs` 的 `attestedGuardrailHash`），从根上消掉第三口径；`PER_TX_LIMIT`/`DAILY_LIMIT` 缺省时 `CONFIG_ERROR` 退出（不设默认，避免与链上策略静默分叉）；`policy` 字段集补齐 `allowedAssets`/`maxSlippageBps`（缺则 policyHash 与链上不等）。**部署路径同步改造**：单文件 base64 已不足以还原 import 依赖 → `docker-compose.yml` 引入 `MODULES_B64`（tar.gz），新增 `scripts/pack-intee.mjs` 生成 `APP_B64`/`MODULES_B64`（`--env` 写 `.env.intee`，**含密钥，不得提交**）。
  **回归验证（2026-09-16 实跑）**：hardhat **26/26** · challenger selftest **17/17** · parity **17 agree / 0 diverge** · dashboard `tsc --noEmit` 通过。⑤ 的 API 面经临时冒烟脚本验证（`attestedGuardrailHash(policy) === runGuardrail(...).guardrailHash` 为 true，四类 PACE 分支与两类护栏分支结论正确；`agent.mjs` 本体因 `@phala/dstack-sdk` 只装在 CVM 内、本机未安装，**无法在本机端到端运行**，只能进 CVM 验）。
- [x] 参赛材料：`aegis/README.md`、`demo-90s-操作脚本.md`、`第四版策略.md`

---

## 3. 下一步待办（按优先级）

1. **可选增强（第三方 DEX swap）**：接一个"已验证流动性"的 router（重置后 testnet 暂无可核实的 DEX，`scripts/probe-dex.mjs` 可随时复测）；路径其余部分已全部打通（intent→calldata→PACE→收据→互证→executeTrade{value}）。
2. **多 challenger / k-of-n**（未来工作，答辩可讲）：当前单 challenger = 2-of-2 quorum；扩展为声誉加权 k-of-n 是自然延伸。
3. **challenger 经济模型**（未来工作）：谁付钱、作恶罚没。
4. **SOA-lite 链上强制**（未来工作）：把"执行落在签署目标内"作为 vault 的 revert 条件（当前 objectiveHash 经 bindTranscript 只做存证，强制在两侧重推导完成）；链上防重放（nonce 消费）一并做。
5. **⚠️ v3 重部署（含已修但未上链的 quorum 验证者白名单）**：`AegisVaultQuorum` 新增的 `isTrustedValidator` 白名单只在源码里，线上仍是 `0xe6E24BB7…`（旧钩子，无法阻止自证伪造 quorum）。重部署后需按序执行：`deploy-quorum.mjs`（自动授权 `CHALLENGER_ADDR`）→ 更新 `.env` 的 `QUORUM_VAULT` → 金库白名单 `whitelist-wmon.mjs` → Tenderly 重新验证 → 全链 E2E 复跑。**另**：v3 可顺带把钩子从 `lastReceiptHash` 改为 `lastTradeReceipt`（消掉心跳与交易窗口互斥的合约层残留约束，见 §11）。
6. 提交前通读 README/STATUS，确认所有引用可核实（README 2026-09-15 已对齐）。
7. **`scripts/parity-check.mjs` 的 `ASSETS`（第 34 行）是死变量 + 用例只覆盖 USDC**（2026-09-16 核实）：`const ASSETS = { USDC: WHITELIST[0] }` 定义后**从未被引用**（`grep ASSETS` 仅此一处），用例实际直接用 `WL0` 字面量与 `asset: "USDC"`；同时 `pipeline.mjs` 的 `assetMap` 已返回 `{USDC, WMON}`。故 parity 守卫**没有覆盖 WMON 真实路径**（Phase 4 起的主用路径）。影响有限（两侧都不以 assets 判定拒绝与否，守卫的核心不变式仍成立），但属真实缺口：建议删掉死变量并把 `benign` 换成 WMON target。**未改，待批准。**

---

## 4. 环境与凭据

- **私钥等敏感信息全在 `aegis/.env`**（已被 `.gitignore` 忽略，**切勿提交/外传**）。当前 key：`MONAD_TESTNET_PK`、`MONAD_TESTNET_RPC`、`MONAD_TESTNET_CHAIN_ID`、`CHALLENGER_PK`、`QUORUM_VAULT`、`SOA_USER_PK`（"用户"角色签名私钥，只签名、不需要资金；真实部署中应在用户设备上）。
- ~~`aegis/secrets.txt`~~ 已并入 `.env` 并删除（2026-09-13 Phase 0）。
- **已 git init（2026-09-13 baseline）**，无远程；`.env`、secrets、vendor（359MB）、构建产物、日志已被根 `.gitignore` 忽略——提交前仍需确认敏感文件未进暂存区。
- **钱包**：
  - 主钱包（=proposer =deployer =TEE =owner）：`0x2a0eECA027B617F5e6f631a5475dc283294Ff0a9`，余额约 **0.59 MON**（2026-09-15 SOA 链上 E2E 跑完后；单笔全链 E2E 实测 ≈0.37 MON，建议 ≥0.5 再跑）
  - challenger：`0x16e619c3d6625f4d6F583791A4C2351D65508a2c`，余额约 **0.57 MON**（2026-09-15 向主钱包补 0.5 后；另需给第二台机器新钱包注资 ~0.5）
- **RPC**：`https://testnet-rpc.monad.xyz`（主，QuickNode 50rps/batch 100）+ `https://rpc.ankr.com/monad_testnet`（备，无 archive）+ `https://rpc-testnet.monadinfra.com`（备，官方 20rps）；完整列表见 docs.monad.xyz testnet 页
- **LLM**：proposer=**官方 DeepSeek API**（`https://api.deepseek.com`，model=deepseek-flash，2026-09-15 起主用，校外可达；key 在 .env，充值 ¥10 实测连通）；**校园网关已删除**（2026-09-15）——challenger 可选交叉模型层需另配可达端点（如另一家 API / 本地 Ollama；默认关闭，不影响 L1–L5 确定性重推导）；端点不可达时自动降级 mock（如实标注 mode=mock）
- **补 MON**：官方 faucet `https://faucet.monad.xyz`（连 X/Discord 提额）；Alchemy `https://www.alchemy.com/faucets/monad-testnet`（1 MON/24h，需主网 ≥0.001 ETH + 主网活动，且 testnet 余额不能太高）

---

## 5. 链上部署地址（Monad testnet, chainId 10143）

| 合约 | 地址 |
|---|---|
| ReceiptRegistry（v2：bindTranscript + MAX_BLOCK_AGE=100） | `0x4622D041696942dC873a8A5E54f1e1ca9669c90B` |
| DcapGate | `0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F` |
| ERC-8004 IdentityRegistry（自部署，agentId=1） | `0xC99D2957fdA1455E68dF2181A4bB97fd73081A74` |
| ERC-8004 ReputationRegistry | `0xb5B853BcE92940b8E5BFba131301509eaCFb5c9f` |
| ERC-8004 ValidationRegistry | `0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa` |
| **AegisVaultQuorum**（v2：executeTrade 带 value） | `0xe6E24BB72a4a327b7A7E7aA025A04eBc5a6533D7` |
| WMON（官方 canonical，P4 真实路径目标） | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` |

> 旧 v1 地址（ReceiptRegistry `0x91482e67…`、Vault `0x60F9F1FB…`）已废弃，勿引用。
> testnet 于 2025-12-16 从创世重置——重置前的第三方合约地址（博客级 DEX 教程等）全部作废。
> 其中全部 6 个自部署核心合约（AegisVaultQuorum / ReceiptRegistry / DcapGate / ValidationRegistry / IdentityRegistry / ReputationRegistry）已在 Tenderly 源码级公开验证（2026-09-15，匿名可查；链接见 `aegis/README.md`「Tenderly 公开证据」）。

完整记录（DCAP 全栈地址、测试 tx 哈希与 gas）见 `aegis/dcap-verifier/STATUS.md`。

---

## 6. 架构与数据流

```
外部内容/market data ─┐
                      ├─► 隔离 LLM（无工具权限，只产出 facts/suspicious）
可信指令 ─────────────┘
                          │
        ┌─────────────────▼──────────────────┐
        │ 特权 LLM（proposer）：typed intent    │  ←—— LLM 在 TEE 之外（proposer 侧），
        └─────────────────┬──────────────────┘      这是刻意的：判据是确定性谓词 δ，
                          ▼                          不是「模型在 TEE 里」
        护栏（normalize 零宽/leet → 注入模式 → blocklist）→ PACE（白名单+限额）
                          ▼
        目标层 L5（用户 EIP-191 签署 objective → 验签 + ε-区间；无签署目标时跳过）
                          ▼
        executionHash = keccak(target,value,data)
        pdrHash = keccak(executionHash, guardrailHash, true)
        semantic digest
        ═════════════ TEE 信任边界 ═════════════
                          ▼
        TEE 生成 TDX quote（report_data = digest，Phala CVM 实时）
                          ▼
        ReceiptRegistry.submitReceiptWithQuote（链上 DCAP 验真 + blockhash 绑定 + 哈希链）
                          ▼
   challenger 独立重推导（零共享代码；L1–L5 确定性 + 可选交叉模型层）→ 比对 executionHash/pdrHash/digest/transcript/objective
                          ▼
   ValidationRegistry.validationResponse(requestHash=收据digest, 100/0)
                          ▼
   AegisVaultQuorum._preExecutionHook：response≥100 才放行 executeTrade
                          ▼
   链上硬约束（白名单/限额/日限）→ 真实协议交互（WMON deposit()）→ TradeExecuted
```

---

## 7. 文件地图

### 合约（`aegis/contracts/`）
- `AegisVault.sol` — 金库：PACE 绑定、白名单/限额、死手开关、`_preExecutionHook` 虚钩子
- `AegisVaultQuorum.sol` — 继承 AegisVault，覆写钩子查 ValidationRegistry response≥100（MIN_RESPONSE=100）
- `ReceiptRegistry.sol` — 收据：onlyTEE、submitReceiptWithQuote、哈希链、MAX_BLOCK_AGE=100、bindTranscript、usedNonces
- `ValidationRegistry.sol` / `IdentityRegistry.sol` / `ReputationRegistry.sol` — 自部署 ERC-8004
- `PolicyRegistry.sol`、`interfaces/IReceiptRegistry.sol`、`mocks/MockTarget.sol`

### 运行时（`aegis/tee-runtime/`）
- `runtime.mjs` — buildIntent/policyHash/normalize/runGuardrail/paceVerify/computeExecutionHash/computeSemanticDigest
- `objective.mjs` — **L5 proposer 侧实现**：canonical 目标序列化 + objectiveHash + checkObjective（验签 + ε-区间检查；与 challenger 零共享代码）
- `llm.mjs` / `llm-openai.mjs` — makeLLM() 无 key 自动 mock；含 OBJECTIVE_SYSTEM（目标起草分支）
- `agent.mjs` / `agent-demo.mjs` / `run.mjs` / `llm-test.mjs`

### Challenger（`aegis/challenger/`，Phase 1 新增，自包含可整目录拷到队友机器）
- `verify.mjs` — **5 层独立重推导**（L1 策略认证 / L2 独立护栏 / L3 独立 PACE 含日限 / L4 算术+transcript preimage 绑定 / L5 目标层验签+ε），与 proposer 零共享代码；fail-closed
- `objective.mjs` — L5 独立实现（canonicalObjective/objectiveHash/evalU/checkObjective；拒绝语义见文件头注释）
- `challenger-agent.mjs` — 独立进程：轮询链上收据 → 直读字段 → 拉 decision 原文（拉不到=拒绝）→ 验证 → 独立钱包上链 validation；`--once` 单次模式
- `challenger-policy.json` — challenger 自持策略（改后需 proposer 跑 policy-attest --execute）
- `policy-attest.mjs` — 治理侧把认证 guardrailHash 设上链（默认打印零 gas，--execute 发交易；含 env/策略一致性检查）
- `selftest.mjs` — 17 用例离线自测（L1–L5）；`gen-key.mjs` 独立钱包生成；`README.md` 队友部署指南

### Orchestrator（`aegis/orchestrator/`）
- `server.mjs` — 读侧 `/api/status` `/api/receipts` `/api/decision/:digest`(决策原文) `/api/events`(SSE)；写侧 `POST /api/agent/command?agentId=1`（body: `{command, marketData, target, amount, data, dryRun, tamperTranscript, objective, objectiveSignature}`——objective 走 L5 预检 fail-closed，objectiveHash 经 bindTranscript 上链）+ `POST /api/objective/draft`（目标起草）。**角色分离：本进程只当 proposer，不持有 challenger 私钥，不代签 validation**；上链后决策原文存证 `decisions.jsonl` 供 challenger 拉取
- `pipeline.mjs` — 双 LLM 隔离管线 + `draftObjective()`（目标起草，asset/target 校验后编 canonical 目标）
- `receipts-cache.json` — 索引器产物

### 脚本（`aegis/scripts/`，重点）
- `lib.mjs` — loadEnv/RPC_LIST/getWallet/loadArtifact/deploy/attach
- `d6-negative.mjs` — 8 项攻击向量 + 1 正例对照负例（真实 gas）
- `parity-check.mjs` — **口径一致性守卫**：proposer 预览 vs challenger 重推导（含 7 个目标层用例），漂移即 exit 1（改 normalize/护栏/PACE/目标层后必跑）
- `soa-sign.mjs` — **"用户"侧签名器**：草案 → canonical 目标 + EIP-191 签名（真实部署中运行在用户设备上）
- `soa-demo.mjs` — SOA-lite 四场景演示（诚实/漂移/篡改/过期；orchestrator 在跑走 HTTP，否则本地重放；`--onchain` 真实上链版已实测 5/5，见文首证据块）
- `attack-family.mjs` — 攻击族四格实验（7/8 拦下 + 1 项诚实的"拦不住"；论文 §8.1 工程对应）
- `regime-cost.mjs` — 谱系代价曲线（δ/目标层/菜单扫描实测 + ε-覆盖网合成计算）
- `probe-dex.mjs` — 候选 DEX/协议合约链上 codeLen 探测（P4 核实用，可随时复测）
- `whitelist-wmon.mjs` — 金库白名单加 WMON（owner 交易，幂等）
- `dcap-corrupt-sweep.mjs` — 坏 quote 位置扫描（全 view 零成本）
- `index-receipts.mjs` — 收据索引器（JSON-RPC batch）
- `erc8004.mjs` — ERC-8004 三注册表部署 + 注册 + 验证闭环
- `deploy-quorum.mjs` — 部署 AegisVaultQuorum
- `quorum-e2e.mjs` — 链上 quorum E2E（无验证拒绝 + challenger 同意执行；v1 时代留档，勿对着 v2 跑）
- `llm-divergence.mjs` — 语义分歧度量（零 gas 离线）；`probe-gateway.mjs` — OpenAI 兼容模型 token 指纹探测（跨家族独立性核实；含 2026-09-13 网关实测记录）
- `tenderly-prep.mjs` — Tenderly 验证预检：加载 build-info → 本地 solc 重编译 → 与链上 runtime bytecode diff（PERFECT/LIKELY/MISMATCH；`--dump` 导出 standard JSON 到 `.tenderly-verify/`，该目录已 gitignore 可重建）
- `dcap-standard-input.mjs` — DcapGate 专用单文件 standard JSON（shanghai；source key 必须为 `dcap-verifier/contracts/DcapGate.sol`，否则 metadata 哈希不匹配）；产物供 Tenderly JSON Upload
- `pack-intee.mjs` — 打包 `tee/intee/agent.mjs` + 其仓库依赖（`tee-runtime/`、`challenger/`）为 `APP_B64`/`MODULES_B64` 两个 base64 块，供 `tee/intee/docker-compose.yml` 在 Phala CVM 内还原。`--env` 写 `.env.intee`（**含 PK，不得提交**）。注：Windows/Git Bash 下 GNU tar 需 `--force-local` 且必须排在 `czf` 之后
- `d5-e2e-submit.mjs`、`rpc-probe.mjs`、`probe-monad.mjs` 等
- ⚠️ `vault-exec-multicall.mjs` 是失败路径留档（Monad Multicall3 内层 msg.sender 失效）

### 其他
- `aegis/dcap-verifier/STATUS.md` — **完整工程记录（地址+坑+gas+tx 哈希），接手必读**
- `aegis/test/aegis.test.js` — 26/26 测试（含 quorum 验证者白名单 + ValidationRegistry 边界）
- `aegis/hardhat.config.js` — solc 0.8.24 + viaIR + optimizer 200 + `evmVersion: paris`
- `aegis/README.md` — 参赛级 README
- `第四版策略.md` — 主策略文档（工作区根目录）
- `..\..\monad论文\`（即 `C:\Users\12190\Desktop\本科二年级\monad论文\`，2026-09-14 从工作区根目录移出）— **论文全部文档的独立文件夹（已有自己的 AGENTS.md，论文工作台自动加载）**：
  - `monad论文\A会论文路线图v3.md` — **把本项目升维成安全顶会（S&P/USENIX/CCS/NDSS）论文的研究路线图（最新版）**：R1 输入真实性不可能性（主）+ R2 组件必要性 + R3 机制设计 + R4 UC（冲刺）；含对 v2 错误的逐条更正
  - `monad论文\新原语提案-验证闭包与选择可验证性.md` — **新原语提案（论文升级核心候选）**：验证闭包原则、选择可验证性三分谱系（T1–T5）、SOA 签署目标协议、ε-悔憾验证与 bond 定价；把 v3 的 R1 变为其 T5 特例
  - `monad论文\架构创新提案-验证拓扑演算.md` — **架构级创新提案（论文最高层形态）**：验证拓扑演算 VTC——能力格+验证算子代数（o1–o8）、组合健全性定理（Fréchet–Hoeffding 任意相关）、综合算法与复杂度（Thm A/B/C）、算子集完备性；把黑客松系统/SOA 都变成综合实例，正面消解"原语组合"批评；含 §7 相邻领域必查清单（BAN logic/trust management/攻击树/runtime enforcement）
  - `monad论文\精品论文制作计划.md` — **论文生产计划（最终定形）**：单篇收拢（题目/四贡献/砍单清单）、13 页骨架与页数预算、W0–W10 周计划、证明依赖图（R1 坍缩为 T5 推论）、导师协作节奏（每次带 2 页）、投稿前验收杠、稳妥 A 类对冲清单（五杠杆+概率账）、止损线
  - `monad论文\A会论文路线图.md` — v1 版路线图（已被 v3 取代，保留作历史）
- `demo-90s-操作脚本.md` — demo 分镜脚本（用户不录视频，备用）
- `答辩背书-完整版.md` — **答辩/评委追问背书**（金句、四大主张、15 问 Q&A、数字备查表含代价曲线、诚实边界清单、5 分钟答辩结构；数字与 agents.md 同步）
- `dashboard/` — 统一入口 Dashboard：`/try` 现场跑一笔、`/architecture` 信任边界图+一键 11 负例、`/receipts` 真实索引+explorer 链接、`/orch/*` 同源代理 orchestrator

---

## 8. ⚠️ Monad 特性坑（全部实测确认，踩一次浪费数小时）

| # | 坑 | 解法 |
|---|---|---|
| 1 | MCOPY 行为不正确 | hardhat `evmVersion: paris`（不要用 cancun） |
| 2 | Multicall3 内层 `msg.sender` 失效 | **不要用 multicall**，逐笔调用 |
| 3 | `eth_getLogs` **严格限 100 块范围**（-32614 / HTTP 413） | **JSON-RPC batch**（30 个 getLogs/HTTP 请求）+ 100 块窗口 + 并发回扫 |
| 4 | RPC 间歇 `-32603 Archive error` | FallbackProvider（官方+Ankr），重试 |
| 5 | `fetch` 无默认超时会**永久挂起** | 一律加 `AbortSignal.timeout(...)` |
| 6 | ethers v6 同名重载需完整签名做 key | 用完整函数签名 |
| 7 | `ReceiptSubmitted` 事件 topic0 静默查不到 | 必须用**完整 9 参数签名**运行时计算（`0x57317a50484cce61...`），禁止硬编码缩短 selector |
| 8 | 部署大合约 gas 高（3.8M+） | 每次部署前确认余额（约 0.78 MON/大合约） |
| 9 | 出块 300ms、区块 gas 上限 150M | 等交易确认注意节奏 |

**FallbackProvider 正确写法（ethers v6.17）**：
```js
new FallbackProvider([providerA, providerB], 10143, { quorum: 1, stallTimeout: 2500 })
// 第二参是 network/chainId，第三参才是 options —— 写错报 "invalid network object name or chainId"
```

---

## 9. 运行 / 测试命令

```bash
# 工作目录：C:\Users\12190\Desktop\本科二年级\Monad量化\aegis

# 合约编译 + 单测（应 26/26 通过）
npx hardhat compile                 # 期望 "evm target: paris"
npx hardhat test                    # 期望 "26 passing"

# D6 负例（8 攻击向量 + 1 正例对照应全部符合预期；真实上链 fresh 合约，~0.15 MON gas）
node scripts/d6-negative.mjs

# 口径一致性守卫（proposer 预览 vs challenger 重推导，含目标层用例，漂移即 exit 1；改 normalize/护栏/PACE/目标层后必跑）
node scripts/parity-check.mjs

# challenger 离线自测（17 用例，L1–L5 全覆盖）+ 独立进程（轮询收据 → 重推导 → 上链 validation；--once 单次）
node challenger/selftest.mjs
node challenger/challenger-agent.mjs

# SOA-lite 签署目标（零 gas；四场景：诚实通过 / 漂移 / 篡改 / 过期被 L5 拒）
node scripts/soa-demo.mjs
node scripts/soa-sign.mjs draft.json        # 「用户」侧签名（草案来自 POST /api/objective/draft 或手工编写）
node scripts/attack-family.mjs              # 攻击族四格实验（7/8 拦下 + 1 项设计边界）
node scripts/regime-cost.mjs                # 谱系代价曲线（L1–L5 全链 ≈2ms/次）

# 策略变更（改 challenger-policy.json 后：默认零 gas 预览，确认后 --execute 上链）
node challenger/policy-attest.mjs
node challenger/policy-attest.mjs --execute

# 链上 quorum E2E（⚠️ v1 时代脚本：硬编码 v1 地址且会改写 registry 的 agentGuardrailHash，勿对着 v2 生产地址跑）
node scripts/quorum-e2e.mjs

# 收据索引器（约 30+ 分钟扫历史块 → orchestrator/receipts-cache.json）
node scripts/index-receipts.mjs

# Orchestrator（默认 :8787，ORCH_PORT 可改）
node orchestrator/server.mjs
#   dryRun 预览（零 gas；dryRun 默认 true）：
#   POST /api/agent/command?agentId=1  {"command":"buy WMON 0.01"}
#   真实全链（收据 → challenger 互证 → executeTrade{value} → 金库真实转账）：
#   POST /api/agent/command?agentId=1  {"command":"buy WMON 0.01","dryRun":false,"execute":true}
#   challenger 作恶演示：
#   POST /api/agent/command?agentId=1  {"dryRun":false,"execute":true,"tamperExecHash":true,"recordReject":true}
#   SOA-lite 目标草稿（LLM 起草，零 gas）：
#   POST /api/objective/draft  {"command":"buy WMON 0.01","marketData":"..."}
#   带签署目标的提交：在 body 附加 objective + objectiveSignature（scripts/soa-sign.mjs 产出）

# 统一入口 Dashboard（演示用 build+start；dev 与 build 共享 .next 会互相破坏，切 dev 前先 rm -rf .next）
cd ../dashboard && npm install && npm run build && npm start
```

> Windows 注意：PowerShell 5.1 不支持 `&&`；内联 `node -e "...中文..."` 易引号冲突，复杂脚本请写成 `.mjs` 文件再跑。

---

## 10. 🚫 硬约束与禁止事项（用户明确要求）

1. **不要录 demo 视频**（用户明确不需要）。
2. **不要把私钥/secrets 写进文档或提交**；`.env` / `secrets.txt` 不得外传。
3. **引用必须核实**——不要生成/猜测未经验证的 URL、论文、地址、数据。
4. **不要用 Multicall3**（坑 #2）。
5. **不要硬编码事件 topic0/selector**（坑 #7）。
6. **不要提交官方 ERC-8004 地址**——官方 testnet 无部署，必须用自部署三注册表。
7. **不要谎称用了 RL**（答辩时说“多代理互证/可验证性”，借鉴 AMMO 但走诚实版）。
8. **未经用户批准不要 commit/push**；已 git init（无远程）。

---

## 11. 风险与注意

- **余额**：主钱包 ~0.59 MON（2026-09-15 SOA E2E 后，≈1–2 笔全链）；单笔全链实测 ≈0.373 MON（收据 3.48M gas 占大头）。现场连续跑多笔前先补 gas。
- **challenger**：余额 ~0.57 MON；每笔决策 2 笔 validation 交易（≈0.025 MON）；需预留第二台机器新钱包的注资（~0.5 MON）。
- **LLM 端点（主用：官方 DeepSeek API，校外可达）**：偶发 503 / 超时 / 请求挂起 → 管线 fail-closed 返回 refuse（如实标注，不静默降级假数据）；退避 45–60s 重试即可。**deepseek-flash 是推理模型**：reasoning 与答案共享 max_tokens，预算过小会截断成空 content（`finish_reason=length`）→ 误拒；已统一 `LLM_MAX_TOKENS=2000`（`pipeline.mjs`）。（原 USTC 网关条目已于 2026-09-15 删除）
- **RPC 读可能瞬时滞后**（FallbackProvider 后端 LB，曾观测到后端落后 ~39k 块的陈旧读）：写路径已加固（客户端预算 expectedDigest + 轮询对齐；prev 读连续两次一致才采信）——若见 "Not latest receipt"/digest 不匹配类报错，先怀疑读滞后而非合约状态。
- **历史收据索引有少量缺口**（RPC 限流放弃的窗口），重跑 `index-receipts.mjs` 可补。
- **TEE 阶段二三（OPA/Membrane）未实现**，当前为可插拔结构——README 已标为已知边界，勿在答辩中声称已实现。
- **心跳与交易窗口互斥**（2026-09-15 客户端修复）：orchestrator 已加在途守卫——trade 收据上链后 60s 内心跳请求返回 `heartbeat_deferred`（时间自愈）；challenger 对心跳收据直接跳过（无 transcript 绑定，不参与重推导）。合约层残留约束：quorum 钩子读 `lastReceiptHash`（含心跳），若绕过 orchestrator 直接发心跳 tx 顶掉在途交易收据，executeTrade 会 revert "No challenger quorum"（fail-closed，资金安全）；合约层修复（钩子改读 lastTradeReceipt）需 v3 重部署，暂不做。
- v2 金库 `executeTrade` 带 `{value}`（原生 MON 传递已实现；Phase 4 实测金库 WMON 余额 0→0.01）。
- **⚠️ 线上 quorum 合约缺验证者白名单（2026-09-16 审计发现，源码已修、链上未修）**：`ValidationRegistry` 是 permissionless 的——任何人可 `validationRequest`(validatorAddress=自己) 再自己回 `validationResponse(100)`。线上 v2 `AegisVaultQuorum`（`0xe6E24BB7…`）的钩子只读 `response >= 100`，**故攻击者无需 challenger 私钥即可伪造 quorum 放行 executeTrade**（前提是已持有 vault 的 executor 权限或 owner 误授）。讽刺的是这与全项目"不让单方自证"的主张直接冲突，属**必须修复项**。源码已加 `isTrustedValidator` 白名单（默认空 = fail-closed）+ 3 个单测（自证伪造被忽略/撤销即时生效/owner-only），但**要生效必须 v3 重部署**（见 §3 待办 5）。答辩若被追问合约层，**不要声称线上已强制白名单**——当前强制只在源码 + 测试。
- **`tee/intee/agent.mjs` 修复后未跑 CVM E2E**（2026-09-16）：改为 import 权威模块后（`@phala/dstack-sdk` 本机未安装，无法本地端到端），新 `MODULES_B64` 部署路径**只在打包侧验证过**（`scripts/pack-intee.mjs` 能产出两个 base64 块），**CVM 内实际还原 + 执行未经复跑**。若答辩要用 in-TEE 闭环证据，须先真跑一次。
