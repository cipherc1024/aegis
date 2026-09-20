# AGENTS.md — Aegis 项目转交说明

> 本文件是给接手本项目的 AI Agent / 工程师的交接文档。**开工前先完整读一遍**，尤其是第 8 节 Monad 坑表和第 10 节硬约束。
> 最后更新：2026-09-20（**v5 重部署完成**：`AegisVaultQuorum` = `0x3aBbb284…b89De`，`registry` 改为 owner 可换（`setReceiptRegistry`）+ `executeTrade` 金库余额检查首次上链；单测 **44/44**，v5 全链 E2E 实跑 `executed`（金库 WMON 0→0.01、MON 0.5→0.49），全链路文档地址同步，**v5 Tenderly 源码级公开验证完成**（2026-09-20 13:22:24 UTC，匿名可查，见 §2 末条）。此前 2026-09-20 承接：Dashboard 去占位化（真实读数 + 设计边界论证）；2026-09-18：`tee/intee/agent.mjs` 的 CVM 内 E2E 已跑通，见 §2）

---

## 0. 接手第一步：验证现状（约 5 分钟，建议先跑）

在动手改任何东西前，先确认交接状态真实可用：

```bash
# 工作目录：C:\Users\12190\Desktop\本科二年级\Monad量化\aegis
npx hardhat compile          # 期望 "evm target: paris"
npx hardhat test             # 期望 "44 passing"（31 原 + 13 M2/M3）
node scripts/d6-negative.mjs # 期望 8 项攻击向量全部被拒 + 1 正例通过（真实上链 fresh 合约，~0.15 MON gas，非零成本）
node scripts/parity-check.mjs # 期望 "21 agree / 0 diverge"
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
- challenger 五层（L1–L5）独立重推导 pass → validationResponse=100（`0x0cd3f6a9…d2e60e`）→ executeTrade（金库余额出资）`0x03a754cf…a5f388` @62756812，**TradeExecuted target=WMON amount=1e16，金库 WMON 0.01→0.02**
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
- [x] **Phase 2 完成**（2026-09-13）：合约 v2 部署——ReceiptRegistry `0x4622D041...`（bindTranscript 决策原文绑定 + MAX_BLOCK_AGE=100）、AegisVaultQuorum `0xe6E24BB7...`（executeTrade 由金库自有余额出资，vault 余额真实变动）；**quote 路径上线**——Phala CVM `aegis-quote`（tdx.small 常驻，公网端点在 .env QUOTE_URL）实时生成绑定 digest 的真 TDX quote → `submitReceiptWithQuote` 链上 DCAP 验真；orchestrator execute 流程接通（AGENTS 待办#1 完成）；**全链 E2E 实测（17.6s）**：submitReceiptWithQuote（gas 3.5M，tx 0x7981eb9b...）→ challenger 四层 pass → validationResponse(100) → executeTrade（tx 0xe4902c0a...，TradeExecuted @62191167 块后）→ vault 0.5→0.48 MON；18/18 单测（新增 3 个 bindTranscript 用例）；策略变更流程实跑（白名单 → env 同步 → re-attest）；主钱包余额约 1.7 MON（challenger 回转 1.5 MON，tx 0x6a444c95...）；已知坑：Windows 下 Git Bash kill 杀不干净 node 后台进程（用 PowerShell Stop-Process），orchestrator 端口占用时新进程 EADDRINUSE 静默崩溃（重定向前先查 netstat）
- [x] **Phase 3 完成（代码侧）**（2026-09-13）：proposer 侧**双 LLM 隔离管线**（`tee-runtime/llm.mjs` + `orchestrator/pipeline.mjs`：隔离 LLM 只抽取 facts/suspicious、无工具权限 → 特权 LLM 只吃「可信指令 + 隔离摘要」产出 typed intent，全程 fail-closed）；**信任边界显式化**（LLM 在 TEE 之外，因模型仅校园网可达 —— 该设计已从论文 P1 推导证明不削弱安全性，见 `..\..\monad论文\A会论文路线图.md` §5）；challenger 新增可选**交叉模型层**（`challenger/llm-challenge.mjs`，`MODEL_CHALLENGE=true` 开启，默认关闭；要求不同家族模型 + temp=0 + 确定性代码裁决，`agree=null` 表示无法裁决→不签发）。**注意命名：此层历史上曾被称作"L5"，现 L5 专指 SOA-lite 目标层，两者不同**；新增 `GET /api/pipeline` 只读预览端点；**语义分歧度量**实验脚本 `scripts/llm-divergence.mjs`（论文 §6 实验 1b，零 gas 离线）
- [x] **Phase 3 修复的口径漏洞**（重要，3 个真实 bug）：① `orchestrator` 预览护栏**未规范化 text** 就匹配 blocklist → `ev\u200Bil.com` 零宽混淆可绕过（challenger 一直是对的，会制造假性分歧）；② orchestrator `norm` 缺 leetspeak folding → `3vil.com` 两侧结论漂移；③ leet 折叠把 `a11`→`aii` 导致注入正则漏判（两侧同口径修）；④ mock LLM 用 `/ISOLATED/i` 判别分支，而 `PRIVILEGED_SYSTEM` 含 "isolated analyst" 字样 → 特权调用误入隔离分支，mock 路径整体静默失效。**新增 `scripts/parity-check.mjs`** 守住口径：同一批输入分别喂 proposer 预览与 challenger 完整重推导，断言"拒绝与否"一致（当前 21/21 agree，含 7 个目标层用例，漂移即 exit 1）
- [x] Hardhat 单测 **18/18 通过**（新增 3 个 bindTranscript 用例）；challenger selftest **17/17**（L1–L5）；parity **17/17**（2026-09-17 F2 修复后为 **21/21**，见 §3 待办 9）；Dashboard 构建通过
- [x] **Phase 3 live 完成**（2026-09-13/14）：真实校园网模型接入（USTC 网关，OpenAI 兼容，key 在 .env）——proposer=deepseek-flash / challenger=glm-5.3-flash（**经网关 token 指纹实测确认不同后端**，`scripts/probe-gateway.mjs`：smart/reasoning/qwen3.6-chat/claude-haiku-4-5 共享同一后端，glm 独立）；live E2E 已实测（网关偶发 503/超时 → fail-closed 返回 refuse，退避重试即可）
- [x] **Phase 4 完成**（2026-09-14）：**真实协议交互路径上线**——重置后 testnet（2025-12-16 genesis reset）无法核实任何第三方 DEX router（Uniswap v2/v3/v4 canonical 地址链上实测 codeLen=0，`scripts/probe-dex.mjs`；Kuru 无法核实），经用户确认以**官方 canonical WMON wrap** 为真实路径：官方文档核实 WMON `0xFb8bf4c1…8541`（链上 codeLen=3249、name/symbol/decimals 读回正确）→ `.env` WHITELIST 与 challenger 策略加入 WMON → `policy-attest --execute` 上链新认证 → `whitelist-wmon.mjs` 金库白名单上链 → pipeline assetMap 加 WMON（intent→`deposit()` calldata `0xd0e30db0`，`pipeline.mjs` WMON_DEPOSIT）→ **全链 E2E 实测：buy WMON 0.01 → executeTrade（金库余额出资）→ TradeExecuted @62366819，execHash 与 transcript 逐字节一致，金库 WMON 0→0.01**。修复 /api/verify 口径：未显式传 target/amount 时走与 /api/agent/command 完全相同的 pipeline 解析（data 也取 pipeline 值），新增 `resolvedBy` 字段。challenger 加固：全局 unhandledRejection 接管（RPC 抖动不再杀进程）
- [x] **Phase 6 完成**（2026-09-14）：**统一入口 Dashboard**——Next rewrites 把 `/orch/*` 同源代理到 orchestrator（**dashboard 生产路径不经 CORS**，内网地址不进浏览器；注：orchestrator 自身的 CORS 白名单是 2026-09-16 才收紧的，见下方"审计修正"条）；新页 `/try`（现场跑一笔：pipeline 预览 → 双实现裁决 → dry-run 摘要，preset 覆盖合规/注入/未知标的/超限）与 `/architecture`（信任边界图 + TEE 虚线 + 10 步路径 + 一键 11 负例实测）；landing 四卡全改真实读数（编造数字清除或标「示例」）；`/receipts` 改走 orchestrator 索引（真实哈希+tx 可点 explorer，未覆盖字段诚实显示"—"）；nav 重排评审动线（核心→用户→运营者）。修复：try/architecture 页管线拒绝时 challenger=null 的 TypeError、challenger layers 对象误当数组、11 负例面板未知标的误用白名单 target
- [x] **Phase 5 完成**（2026-09-14）：README 重写（信任边界口径、P1-P6 里程碑、Phase 4 全链 tx 表、部署地址表更新到 v2、诚实边界清单、testnet 重置坑）；agents.md 同步
- [x] **Tenderly 公开验证**（2026-09-15）：6 个自部署核心合约（DcapGate / ReceiptRegistry / AegisVaultQuorum / ValidationRegistry / IdentityRegistry / ReputationRegistry）**源码级 public 验证**（Tenderly 项目 monad-testnet），合约页与 E2E tx 页**匿名免登录可开**（评委直接核验）；配套 `scripts/tenderly-prep.mjs`（任一合约编译预检 + 链上 bytecode diff）与 `scripts/dcap-standard-input.mjs`（DcapGate shanghai standard JSON）；证据链接见 `aegis/README.md`「Tenderly 公开证据」节

- [x] **运营更新**（2026-09-15）：DEX 复探维持「testnet 无第三方 DEX」结论（新发现 Permit2 存在但不可核实）；challenger 包修复 v1 废弃默认地址 + 新增 `scripts/send-mon.mjs`（钱包注资）+ 真 2-of-2 传输包已打包；**LLM 切官方 DeepSeek**（校外可达，¥10 充值实测连通，dry-run `mode:"live"` 四层 pass；**校园网关已删除**，交叉模型层需另配端点）
- [x] **SOA-lite 签署目标层（L5）**（2026-09-15，零 gas）：用户 EIP-191 签署客观目标（draft-then-sign：`POST /api/objective/draft` 起草 → `scripts/soa-sign.mjs` 用户侧签名）→ proposer（`tee-runtime/objective.mjs`）与 challenger（`challenger/objective.mjs`）**两套独立实现**（challenger 侧不 import proposer）独立验签 + ε-区间检查（`objective_not_eps_optimal:dev=`）→ `objectiveHash` 经 `ReceiptRegistry.bindTranscript` 的 uri 字段上链存证（`aegis://objective/<hash>`，`TranscriptBound` 事件）；challenger verify 新增 `5_objective` 层，receipt 带 `timestamp` 作时间源；selftest **17/17**、parity **21/21**（含 7 目标层用例）；演示 `scripts/soa-demo.mjs` 4 场景符合预期。**命名**：L5 = 目标层（确定性），"交叉模型层" = 可选跨家族 LLM 层，两者不同
- [x] **攻击族四格实验**（2026-09-15，论文 §8.1 对应，零 gas）：`scripts/attack-family.mjs` 对四类攻击者各构造最优攻击实测——x-代换（**拦不住，按设计**：R1 输入真实性不可能性）、策略后门 ×3（L1/L3 拦下）、意图漂移 ×2（L5 拦下）、混淆代理 ×2（L4 拦下）；**7/8 拦下，1 项为诚实的负结果**（此实验价值所在）
- [x] **谱系代价曲线实验**（2026-09-15，论文 T1/T2/T5 对应，零 gas）：`scripts/regime-cost.mjs` 实测（三次运行区间）——护栏 ≈68–106µs / PACE ≈86–106µs / L5 验签+ε ≈1.6–2.2ms / 全链 L1–L5 ≈2.1–2.7ms（可进热路径）；全菜单最优性扫描 ≈18–32 ns/点（线性于菜单规模，与模型大小无关）；ε-覆盖网 (D/ε)^d 为**合成计算（非实测，已标注）**
- [x] **审计修正（只读结构审计后的三项修复）**（2026-09-16，commit `ebfc6cf`）：三处均属"未声明的缺口"而非已声明边界——
  ① **orchestrator CORS 由 `Access-Control-Allow-Origin: *` 收紧为来源白名单**（`ALLOWED_ORIGINS`，默认 `http://localhost:3000,http://127.0.0.1:3000`）。本进程持有 proposer 私钥且 `/api/agent/command` 可写（可真实上链），通配符使浏览器里任意页面都能跨站打到 `localhost:8787`；无 `Origin` 的非浏览器调用（curl/服务端）不受影响但不再回显 ACAO。**dashboard 生产路径走 Next 同源 rewrite，不经 CORS，故演示链路不受影响**——这也解释了为何此前 Phase 6 记录写"不开 CORS"却未暴露问题：同源代理让通配符从未被实际触发。
  ② **Dashboard 愿景页（vaults / funds / subaccounts / copy / backtest / market）全部基于 `mock.ts` 编造数字，此前零标注** → 新增 `components/SampleBanner.tsx` 页级横幅（沿用 `StatCard`/`SafetyPanel` 既有 `sample` 芯片口径，整页占位时更显眼），market 页附定制文案点明"真实可验证的 agent 只有 agentId=1"；顺带补上 funds 页缺失的 h1。
  ②b **同一轮只覆盖了 6 页，另有 5 页漏标（2026-09-16 复查补做）**：`console` / `audit` / `sdk` / `notifications` / `settings`——其中 `console` 页的伪造 TEE 度量值（MRTD/RTMR0/FMSPC/TCB）与"心跳 3 秒前"最伤可信度（该页在 nav 的「核心（评审从这里看）」组内）；`audit` 页伪造"12,480 条记录"并断言"所有导出均带哈希链校验值"（功能不存在）；`sdk` 页宣传 npm 上不存在的 `@aegis/sdk`；`settings` 页把 `8`/`60`/`a7f2c8d9…` 显示成实际配置值。处理：五页均加 `SampleBanner`（各带定制文案），并删掉具体编造数值（改为 `—` / "无数据源" / 标"规划中"），`audit` 导出按钮置 `disabled`。教训：**"改了愿景页"必须按 nav 清单逐页核对**，不能按已改页数报完成。
  ③ **`tee-runtime/runtime.mjs` 的 `pdrHash` 由 4 字段改回与链上一致的 3 字段**（`[intentHash, policyHash, true]`）。原 4 字段形态与 orchestrator/challenger 都算不出同一值；该模块仅经 `agent.mjs → agent-demo.mjs` 演示路径可达，**未污染生产管线**。同时在文件头标注本模块为演示路径——其 `buildIntent` 的 `intentHash = keccak(kind,target,amount,data,slippage)` **语义比链上宽，不等于 `executionHash`**，故其 `pdrHash` 不可直接当链上收据字段；并补齐 `computeReceiptDigest`（链上 `_submit` 实际落盘的 digest 公式，此前只在 orchestrator 内联）。
  **回归验证**：hardhat 18/18 · challenger selftest 17/17 · parity 17 agree / 0 diverge · agent-demo 三场景不变 · dashboard tsc + build + 浏览器实测横幅渲染
- [x] **审计修正第二轮（2026-09-16，未提交）**：三项均为"未声明的缺口"，本轮全部修复——
  ④ **`AegisVaultQuorum` 加 challenger 验证者白名单**（`isTrustedValidator` 映射 + `trustedValidatorCount` + `setTrustedValidator` + `ValidatorTrustUpdated` 事件；钩子改为 `require(isTrustedValidator[validator], "Untrusted challenger")`）。**漏洞**：`ValidationRegistry` 本身是 permissionless 的——任何人可调 `validationRequest` 把 `validatorAddress` 设成自己，再用自己的地址回 `validationResponse(100)`；旧钩子只读 `response >= MIN_RESPONSE`，故**攻击者可自证自答伪造 quorum**（不需要 challenger 私钥）。修复后钩子先查验证者是否在 owner 白名单内，**白名单默认为空 = fail-closed**（未授权时 executeTrade 一律 revert，宁可拒绝不可放行）。单测新增（自证伪造被忽略 / 撤销授权立即生效 / 白名单 owner-only 且拒零地址 + `ValidationRegistry` 五个边界用例）→ hardhat **18 → 26 passing**。**本项已于 2026-09-16 经 v4 重部署上链生效**（见待办 5 与 §5 地址表）。
  ⑤ **`tee/intee/agent.mjs` 的第三条护栏口径（in-TEE 自治闭环路径）**——原文件手写了一套独立的护栏/PACE，其中 `guardrailHash` 硬编码为 `keccak256(toUtf8Bytes("guardrail-v1"))`，**永远不等于**链上 `agentGuardrailHash = attestedGuardrailHash(policy)`，且其 `norm` 缺 leet 折叠（与 challenger L2 漂移）；它既不在 `parity-check` 覆盖内，也不被仓库任何文件 import（`tee-runtime/agent-demo.mjs` 用的是另一个 `agent.mjs`）。处理：**删除自实现，改为 import 仓库权威模块**（`../tee-runtime/runtime.mjs` 的 `runGuardrail/paceVerify/computeExecutionHash` + `../challenger/verify.mjs` 的 `attestedGuardrailHash`），从根上消掉第三口径；`PER_TX_LIMIT`/`DAILY_LIMIT` 缺省时 `CONFIG_ERROR` 退出（不设默认，避免与链上策略静默分叉）；`policy` 字段集补齐 `allowedAssets`/`maxSlippageBps`（缺则 policyHash 与链上不等）。**部署路径同步改造**：单文件 base64 已不足以还原 import 依赖 → `docker-compose.yml` 引入 `MODULES_B64`（tar.gz），新增 `scripts/pack-intee.mjs` 生成 `APP_B64`/`MODULES_B64`（`--env` 写 `.env.intee`，**含密钥，不得提交**）。
  **回归验证（2026-09-16 实跑）**：hardhat **26/26** · challenger selftest **17/17** · parity **17 agree / 0 diverge** · dashboard `tsc --noEmit` 通过。⑤ 的 API 面经临时冒烟脚本验证（`attestedGuardrailHash(policy) === runGuardrail(...).guardrailHash` 为 true，四类 PACE 分支与两类护栏分支结论正确；`agent.mjs` 本体因 `@phala/dstack-sdk` 只装在 CVM 内、本机未安装，**无法在本机端到端运行**，只能进 CVM 验）。
- [x] **v4 重部署 + 第三轮审计修正（2026-09-16）**：把两处"源码已修、链上未修"的合约层缺口真正上链——
  ⑥ **钩子改读交易槽**：旧钩子读链头 `lastReceiptHash`（心跳也写），心跳顶掉链头后每笔 executeTrade 都 revert "No challenger quorum"；v4 改读 `lastTradeReceipt`（`_submit` 对 `isHeartbeat=true` 不写该槽）。**为什么不按字面用 `latestReceipt()`**：`latestReceipt` 是"最近一条任意类型收据"的 mapping，心跳同样会覆盖它——一旦心跳占住该槽，钩子从同一槽读到的仍是心跳 digest，无法区分"这笔交易的裁决"与"心跳的裁决"，回归测试的意图（心跳不顶交易）在结构上无法满足。改用交易槽后语义唯一。**注意 `ReceiptRegistry` 无需重部署**：`lastTradeReceipt` 是自 v2 起的既有 public getter。
  ⑦ **验证者白名单上链**（见待办 5）：`0x07Be2FCd…B65bc`，部署时自动授权 challenger，`trustedValidatorCount` 授权前实测为 0（fail-closed）。
  **发现并修复脚本自身缺陷**：`deploy-v4.mjs` 文件头声称"部署 + 授权 + 设限额"，代码却从未调用 `setLimits` → 新金库 `perTxLimit`/`dailyLimit` 读回均为 0（PACE 零预算，会拦掉所有 executeTrade）。已补：脚本内直接 `setLimits`，并新增幂等的 `scripts/set-limits-v4.mjs`；余额门槛也从过时的 0.8 MON 改为实测值 0.4 MON。
  **本轮链上 tx**：部署 `0xba0df2eb…f422371` · 授权 challenger `0x977791a4…2ef392` · setLimits `0x3c4aa10c…0834b5`（gas 69,333）· WMON 白名单 `0xa967b760…068f37` · v3 余额 withdraw `0xe81b162f…3ae2c`。
  **文档同步**：README / ARTIFACT / 答辩背书 / `.env.example` / `challenger/.env.example` / `dashboard/src/lib/chain.ts` / agents.md 中指向 v2 的地址全部更新为 v4；v2/v3 明确标注为已废弃版本及各自缺陷。**Tenderly 对 v4 的源码级公开验证已于 2026-09-16 16:56 UTC 完成**（见下方独立条目）。文档中的单测计数一并从 26 校正为 **41/41**（`aegis.test.js` 28 + `m2m3.test.js` 13；此前 ARTIFACT 已写 40、其余文件仍是 26，属历史条目未随 M2/M3 增测更新）。
- [x] **v4 全链 E2E 复跑通过（2026-09-17）**：给 v4 金库 `deposit()` 注资 0.5 MON（tx `0x92e6e5425dcc2281f92c7a2223517f6a83da79a4f5a0c4cea63c89d7e4c179c4`，gas 23,349）→ 重启 orchestrator + challenger → `POST /api/agent/command?agentId=1 {"command":"buy WMON 0.01","dryRun":false,"execute":true}`：
  `decision: approved_onchain` · 收据 `0xf9e49b5b22b878e3f225180d2ada035b516389a4d12694849cfc7a4d174d8d7b`（digest `0x02adf665537852769c0762a640c7da3654d342fc296402985fbf5e260008f266`，`submitPath: submitReceiptWithQuote (DCAP verified)`）· challenger `agree: true / response: 100`（四层 `1_policy`/`2_guardrail`/`3_pace`/`4_arithmetic` 全过；validation request `0xd82088d7…2e41f1` → response `0x645612df…b03c7` status 1）· **`execution.status: "executed"`，tx `0x42048bec27b97c3c640cf21e701a2a87e23f1f7d313c765bd3990852b4b76b05`，gas 183,604**。
  **链上终态**：金库 WMON **0 → 0.010000**，MON **0.5 → 0.49**。该笔走的是生产地址 v4（`0x07Be2FCd…B65bc`），验证者白名单 + 交易槽钩子在真实执行路径上生效。
- [x] **`executeTrade` 金库余额显式检查（2026-09-17 源码修复；2026-09-20 随 v5 上链生效）**：原实现下"金库没注资"与"标的不配合"都报同一句 `Trade failed`，运维无法区分。新增 `require(value <= address(this).balance, "Insufficient vault balance")`（`AegisVault.sol`），并补单测 `reverts with a distinguishable error when the vault has no funds for the trade` → hardhat **40 → 41 passing**。**该检查现已随 v5 部署进入线上字节码**（见 §2 末条 v5 条目）。
  **语义澄清（此前文档口径有误）**：`executeTrade` **不是 payable**，且**不应**是——出资方是金库自有余额（`deposit()` 注入），三条理由已写入合约 `@dev` 注释：① TEE 派生地址是热钱包，逐笔另备资金会抬高密钥泄露的损失上限，而 `withdraw`（onlyOwner、永不冻结）是独立逃生通道；② PACE 是「授权额度」语义，TEE 上限 = 金库已注资额度；③ 非 payable 意味着调用者无法附带 value，恶意/失陷 TEE 也转不走未授权额度。文档中旧的 "`executeTrade` 带 `{value}`" 措辞已全部改为「由金库余额出资」。
  **链上状态**：该检查**仅存在于源码**，线上 v4 仍是修复前的字节码。经 `scripts/diff-immutables.mjs` 对长度匹配的 build-info（`ccd446f6fe2d9191638162ca1f833cc4.json`，修复前，5682 B = 链上）复核：`unknown clusters: 0`（8 个 20 字节地址 immutable 槽 + 6 个 1 字节 flag），确认 **v4 的 Tenderly 源码级验证对已部署字节码仍然成立**。修复后字节码比链上多 75 字节（该 require + 自定义 revert 串），**ABI 逐字节不变**；若日后重部署，需对新地址重做 Tenderly 验证（见 §3 待办 8）。
- [x] **v4 Tenderly 源码级公开验证完成**（2026-09-16 16:56:40 UTC）：`AegisVaultQuorum 0x07Be2FCd…B65bc` 在 Tenderly（项目 monad-testnet）**源码级 public 验证**，Tenderly 合约页与 API 均**匿名免登录可查**。
  **匿名实测（无凭据、无登录重定向）**：`curl -s https://api.tenderly.co/api/v1/public-contracts/10143/0x07be2fcdaa649f11177aaccbd68a5bff36ab65bc` → `"public":true`、`contract_name:"AegisVaultQuorum"`、`verification_date:"2026-09-16T16:56:40Z"`、`compiler_version:"v0.8.24"`、`evm_version:"paris"`、`compiler_settings {"optimizer":{"enabled":true,"runs":200},"evmVersion":"paris","viaIR":true}`；`data.contract_info` 为 array(3)，**三个源文件（`AegisVault.sol` / `AegisVaultQuorum.sol` / `IReceiptRegistry.sol`）匿名可下载**（`main_contract:1`）。注意该端点的 `creator_address` / `creation_tx` / `creation_block` 返回空/0，**不可引用作证据**。
  **流程要点（下次复验照做）**：入口 `https://dashboard.tenderly.co/contract/monad-testnet/<地址>` → **Source code → Verify Contract**（无需 tx 调试器）→ Visibility 选 **Public** → Source Method 选 **JSON Upload** → 粘贴 standard JSON（本仓库由 `scripts/tenderly-prep.mjs --dump` 产出，或 `scripts/make-upload-json.mjs` 从已有文件裁出最小三键）→ Review 步勾选目标合约 → **Compiler Version 必须手选 `solc v0.8.24`**（该字段**不会**从 JSON `settings` 自动带出；Optimizer/Count/EVM Version/ViaIR 会自动带出）。
  **踩坑记录**：① Tenderly 的 JSON 面板是 Monaco 惰性加载——首次 snapshot 可能只见 `Next` 按钮，重新 snapshot 才出现 `roledescription="editor"` 的 textbox；② 驱动 Monaco 用 `browser-use` 的 `fill`（同时写 model 与 textarea），**不要**用 ClipboardEvent 粘占位串再整体覆盖（曾差点覆盖掉已注入的 JSON）；每次写后都改用 `monaco.editor.getEditors()[0].getModel().getValue()` 校验真实内容；③ Review 步的单选按钮与 Compiler Settings 的 react-select 用 `click(uid)` 常常只聚焦不生效（单选 checked 仍 false）甚至抛 `TypeError: this.scrollIntoView is not a function`，改用 `evaluate_script` 里 `document.querySelectorAll('input[type="radio"]')[i].click()` 与对 `.Select__control` 派发 mousedown/mouseup/click 再 `scrollIntoView()` 点选项；④ 点击后弹窗会重渲染，旧 uid 会 `Node is detached from document`，需重新 snapshot。
  **`scripts/tenderly-prep.mjs` 对 v4 报 `MISMATCH: too many differing bytes` 属阈值假阳性**：v4 有 166 个差异字节（> 该脚本 128 字节阈值），但经 `scripts/diff-immutables.mjs` 分类，全部落在 **8 个 20 字节地址 immutable 槽 + 6 个 1 字节 flag**（164 + 2），**unknown clusters: 0** → 源码完全一致（solc 对 immutable 在 `deployedBytecode` 里留零占位，链上是构造时写入的真值）。判源一致应看"未归类簇=0"，而非差异字节总数。
- [x] **`tee/intee/agent.mjs` 的 CVM 内 E2E 跑通（2026-09-18）**：`MODULES_B64` 部署路径在真 Phala CVM 内**首次实际还原 + 执行 + 上链**成功，§11 此处长期挂着的"未复跑"状态就此关闭。
  **结果**：`GUARDRAIL_HASH = RUNTIME_GUARDRAIL_HASH = 0x0fd539cd…cfb84`（= 链上 `agentGuardrailHash`，第三口径消除得证）· `EXECUTION_HASH=0x1c941c37…1968e` · `PDR_HASH=0x82b1310c…1bacf` · `QUOTE_BYTES=5010`（真 TDX quote）· **`SUBMIT_TX=0xadf522038b8ace6d7ada14ca491b527eb3ab8caf630153d2570b799ec96003be` @63607466（gas 3,477,689，`status=1`）· `DECISION=approved_onchain`**。
  **独立链上核实**（非引用 CVM 自报）：回执 `to` = ReceiptRegistry `0x4622D041…`、`status=1`；`ReceiptSubmitted`（topic0 `0x57317a50…af9c`，agentId=1，receiptHash=`0x06f413a5…2015bc`）的 7 个 data word 中，`[1]=executionHash`、`[2]=pdrHash`、`[3]=guardrailHash` **与 CVM 日志逐字段一致**；`lastReceiptHash(1)` 读回 = 该 receiptHash。
  **本次唯一未知量的探针结论**：`dc.getQuote(new Uint8Array(64))`（全零 report_data）**被接受**，返回 5010 字节 quote，`report_data` 回显全零——即 dstack 不回填也不拒绝，`agent.mjs` 忽略回包 `report_data`、改用本地算的 `semantic` 作链上期望 digest 的做法**契约上成立**。探针同时确认 `DstackClient` 可用方法集（`getQuote`/`tdxQuote`/`info`/`getKey`/`sign`…），CVM 内 `app_id` 为 `app:custom`。
  **踩坑（重要，下次部署照做）**：`phala deploy -e K=V` 的 **V 会被 shell 按空格切分**——`-e BLOCKLIST="evil.com,attacker,drain,ignore previous"` 实际注入的是 `…,ignore`，`policyHash` 随之漂移 → 收据在 `_submit` 处 revert `Guardrail mismatch`（本次前两次部署均因此失败，第二批加 envdump 才定位到）。**含空格的变量必须走 env-file**（`-e some.env`，本次 `.intee-deploy/policy.env`），不要用命令行 `-e`。另：`--no-public-logs` 会让 `phala logs` 直接拒绝（"No log endpoints available"），必须带 `--public-logs` 才读得到容器日志。
  **成本与清理**：本次共 3 个一次性 CVM（1 探针 + 2 带诊断的 E2E），**全部跑完即刻 `phala cvms delete`**；Phala 余额 $3.275728 → **$2.838031**（Δ≈$0.438；含探针与两次失败重跑）。`phala cvms list` 复查：仅剩既有常驻 `aegis-quote`。**部署用临时 compose 与 policy.env 放在 `aegis/.intee-deploy/`，该目录已加入 `.gitignore`**（凡含 PK 的中间文件用完即删，已确认目录内无 `PK=` 残留）。
  **边界（不要外推）**：本次止于**收据上链**。in-TEE agent 的职责本来就到 `submitReceiptWithQuote` 为止，`challenger 重推导 → validationResponse → executeTrade` 后两段不在该进程内，由 orchestrator/challenger 承担，**已由 §3 待办 5b 的 v4 全链 E2E（`0x42048bec…76b05`）独立覆盖**。故"in-TEE 自治闭环"的证据链是**两段拼起来的**，不存在一次进程内跑完全链的证据——答辩时按此口径陈述，勿声称单进程全链。
- [x] **Dashboard 去占位化（2026-09-20，未提交）**：把 dashboard 上所有"愿景页/示例数据"换成真实读数或显式设计边界，`mock.ts` 的编造 fixtures 全部删除。**分四档推进**——
  **甲档（只读真实化）**：orchestrator 补只读端点并接页面——`/api/vault`（余额/限额/日限用量/白名单标的余额）、`/api/agents`（ERC-8004 身份直读）、`/api/policy`（challenger 策略文件 vs 链上已认证 `guardrailHash` 的差异核对）、`/api/exec-stats`（收据聚合 + 逐笔直读 `ValidationRegistry` 裁决状态）。落地页：`/funds`（真实金库读数 + 出入金）、`/dashboard`（真实读数）、`/audit`（真实收据 CSV/JSON 导出，编造的"12,480 条记录"删除、导出按钮在无数据源时 `disabled`）、`/notifications`（由真实链上/进程事件派生，非预设通知）、`/console`（真实状态 + 冻结开关，删掉伪造的 MRTD/RTMR0/FMSPC/TCB 度量值与"心跳 3 秒前"）。
  **乙档（写路径真实化）**：orchestrator 写接口 + 前端**两步确认**（先不带 `confirm:true` 只做 `estimateGas` 拿 preview 展示预估费用，用户确认后再带 `confirm:true` 广播）；`/create` 真实注册 agent（`POST /api/agents`，返回新 `agentId` + 仍需人工完成的三件事）；`/policy` 真实策略编辑与重新认证（`policy-attest --execute` 上链）；challenger 支持多 agent（按 agentId 读 policy 文件，缺文件则跳过）。
  **丙档（剩余愿景页去 mock）**：`/vaults` 真实金库清单（逐 agent 读链上，标明"有身份无金库"的 agent——合约 `agentId` immutable 使 1 agent = 1 金库）、`/market` 真实市场读数、`/backtest` 改「执行统计」（收据聚合 + 链上 validation 直读；**明确不叫回测**——收益率/回撤需要价格管道，本系统不产生）、以及最后四页：
  ① `/settings` 由假开关改为**真实运行环境读数**（chainId / 当前块高 / orchestrator 在线态 / 各合约地址 + explorer 短链 / 限额 / LLM `mode·model` / 跨家族模型是否启用）；删除"导出私钥"按钮与全部假 toggle，并加一段说明"本页不放连接钱包按钮：dashboard 是只读渲染器，不持密钥、不代表你签名"。
  ② `/copy` 改为**结构性边界论证**（不是待办）：① 金库 `agentId` immutable → 1:1，无第二个出资方的槽位；② `executeTrade` 非 payable → 外部调用者无法附带资金；③ `ValidationRegistry` 每 `requestHash` 只保一个验证者裁决。三条之下再给真实统计卡（`Agent #1` / 交易收据 / 已获背书 / 待背书）与真实交易行（逐行状态：已背书·同意/拒绝 / 已请求待裁决 / 待背书 / validation 读取失败）+ explorer 链接。
  ③ `/subaccounts` 改为**真实角色地址与权限**（owner=治理 / TEE 派生=执行 / challenger=裁决），并如实说明：三者共享同一金库余额，**没有 per-role 子余额**；challenger 行指向 `ValidationRegistry` 并附"按地址查链上裁决记录"（challenger 自身地址刻意不出现在 orchestrator 只读面——角色分离）；页内给出"为什么没有『创建子账户』按钮"。**修复过程记录**：本页曾显示三个角色同一地址 `0x2a0eECA0…`，排查确认**不是接线 bug**——`Vault.teeDerivedAddress()` 与 `vault.owner()` 确实是同一地址（部署者与 TEE 共用钱包，已核 `server.mjs` 的 Promise.all）；真正的错误是我把 challenger 地址取自 `IdentityRegistry.agentWallet()`（那是 ERC-8004 字段，不是 challenger 的密钥），已改为从 `api.config()` 取。
  ④ `/sdk` 删除宣传 npm 上不存在的 `@aegis/sdk`，改为五组**真实可调用**接口（只读 curl / 零 gas 预览与裁决 / 独立验证 + 决策原文 / 两步治理写入 / 浏览器内直读链上），每段带可用的复制按钮，链上地址从 `api.config()` 插值（不硬编码）。
  **nav 重组**：原「规划中（无后端）」组改名为 **「设计边界（真实读数 + 边界论证）」**——这些页数据是真的，但对应的产品功能在本架构下"结构上不能做"或"尚未做"；分组名本身不再把「结构边界」误标成「待办」。
  **`mock.ts` 清理**：删除 `AGENTS` / `RECEIPTS` / `MOCK_DATA_NOTICE` 三个 fixtures 与 `h()` 助手（删除前逐个确认零消费者），仅保留 `Receipt`/`ReceiptType`/`Agent` 接口与 `shortHash`/`shortAddr`。
  **回归验证（2026-09-20 实跑）**：`dashboard` `npx tsc --noEmit` **EXIT=0** · `npx next build` **EXIT=0**（23 静态页，20 路由全部产出）· `npx hardhat test` **41 passing** · `node challenger/selftest.mjs` **17/17** · `node scripts/parity-check.mjs` **21 agree / 0 diverge** · 浏览器实测 `/settings`（chainId 10143 / 块 64081476 / orchestrator 在线 / 新鲜度"陈旧"）、`/copy`（Agent #1、收据 2、已获背书 0、待背书 2，两行均"待背书"）、`/subaccounts`（0.48 MON、三角色、trustedValidators 1）、`/sdk`（真实插值地址 + 复制按钮）。**修复过程中的真实缺陷**：`next build` 因 4 处 ESLint 未使用变量（`backtest` 的 `Link`、`create` 的 `fmtMon` 与 `reg`、`market` 的 `onDone`）失败，均为历次重写遗留的死代码，逐个删除后 build 通过。
- [x] **v5 重部署：`registry` 可换 + 余额检查上线（2026-09-20）**：v4 有两处结构缺口——① `AegisVault.registry` 是 **`immutable`**，`ReceiptRegistry` 需要更换时（升级 bindTranscript 公式、修 God mode 等）只能 `withdraw` 全部资金 → 重新部署金库 → **金库地址、白名单、限额、余额历史全部作废**；② `require(value <= address(this).balance, "Insufficient vault balance")` **只在源码**（§3 待办 8 的历史遗留）。v5 一并收口。
  **合约改动**（`AegisVault.sol`）：`registry` 由 `immutable` 改为可变存储；新增 `setReceiptRegistry(address) external onlyOwner`（`require(_registry != address(0))`，发 `ReceiptRegistryUpdated(previous, current)`，构造函数亦发一次 `(address(0), _registry)`）；新增 `Deposited` 事件。**信任模型不变**——registry 本来就被信任（只有它背书的 executionHash 能放行执行），可变只是把「换表」从「搬钱"降级为「改一个存储槽」。`AegisVaultQuorum.sol` 只改注释（钩子读 `registry.lastTradeReceipt`，换表后自动读新表）。
  **单测 41 → 44 passing**（新增三个 v5 用例）：① 换表后金库余额原样保留、旧表收据立即不再被认可（`No fresh trade receipt`）、新表补收据+PDR 绑定后恢复执行（**白名单/限额/余额全程未重设**）；② `setReceiptRegistry` owner-only + 拒零地址；③ quorum 版：换表后钩子必须从**新表**取 digest 才放行 `executeTrade`。
  **部署（`scripts/deploy-v5.mjs`，含 `--dry` 零 gas 预估）**：dry-run 预估值 2,584,827 gas ≈ 0.522 MON 上界，**实际消耗 0.162752 MON**（主钱包 7.300850 → 7.138097）。v5 地址 **`0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De`**；链上复核构造参数 OK；`trustedValidatorCount` 授权前 **0**（fail-closed 实测）。随后 授权 challenger → `setLimits`(perTx 0.05 / daily 1 MON) → WMON 白名单。
  **迁移（`scripts/migrate-v5.mjs`）**：旧 v4 金库 `withdraw` 全额 0.480000 → 0.000000 MON（tx `0x3a6b143b…8ea4`）；v5 金库 `deposit` 0.5 MON（tx `0x75b9d614…915b`）；主钱包回到 **7.111281 MON**。
  **v5 全链 E2E（2026-09-20 实跑，生产地址）**：`POST /api/agent/command?agentId=1 {"command":"buy WMON 0.01","dryRun":false,"execute":true}` → `decision: approved_onchain` · 收据 `0xda7a7117…5fe831`（gas 3,477,266，`submitPath: submitReceiptWithQuote (DCAP verified)`，digest `0x690fd212…2f1619`）· challenger 独立重推导 `agree: true / response: 100`（四层全过；validation request `0x0a41dbcb…761c1` → response `0x98fe4af5…cdfac` status 1）· **`execution.status: "executed"`，tx `0x7e6e71d3…d2544ef`，gas 183,708**。**链上终态独立复核**：金库 WMON **0 → 0.010000**、MON **0.5 → 0.49**；`registry()` 读回 `0x4622D041…`、`perTxLimit` 0.05、`dailyLimit` 1.0、`trustedValidatorCount` 1、`agentId` 1。
  **地址同步**：README / ARTIFACT / 答辩背书 / `.env` / `.env.example` / `challenger/.env.example` / `dashboard/src/lib/chain.ts` 全部更新为 v5；v4 明确标注为已废弃（缺 `setReceiptRegistry`，余额检查只在源码）。单测计数从 41 校正为 **44/44**。
  **v5 Tenderly 源码级公开验证（2026-09-20 13:22:24 UTC，匿名可查）**：上传件 = `scripts/tenderly-prep.mjs artifacts/build-info/fca9e3ba259104b57a6c3f4deb5979fa.json AegisVaultQuorum 0x3aBbb284…b89De --dump v5-quorum-standard-input.json`（standard JSON, 16607 B, 三源文件 inline）。**上传前已证源码一致**：runtime 5702 B == 链上 5702 B，46 个差异字节经 `diff-immutables.mjs` 归类为 2 个 address immutable 槽（20 B）+ 6 个 flag 字节（1 B），**`unknown clusters: 0`**（v5 差异 46 B 低于该脚本 128 B 阈值，故未复现 v4 那种阈值假阳性）。**匿名实测**（无凭据）：`curl -s https://api.tenderly.co/api/v1/public-contracts/10143/0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De` → `"public":true` · `contract_name:"AegisVaultQuorum"` · `verification_date:"2026-09-20T13:22:24Z"` · `compiler_version:"v0.8.24"` · `evm_version:"paris"` · `optimizations_used:true` · `optimization_runs:200` · `main_contract:1`；三个源文件匿名可下载；**验证源码含 `setReceiptRegistry` 与 `Insufficient vault balance`**（确认验的是 v5 而非缓存旧的 v4 字节码）。
  **本次踩坑（补充 §5 已有的 Tenderly 流程要点）**：① 该 `public-contracts` 端点的字段全在**响应顶层**（`data` 里只有 `main_contract/contract_info/abi/...`）——按 `j.data.field` 读会全打印 `undefined`；② Monaco 面板注入 16 KB payload：`fill` 不展开 `@@FILE:` 标记（会把字面量打进去），本 browser-use 版本的 `evaluate_script` **只接受 `{function}` 不支持 `args`**；可行做法是临时起一个 localhost HTTP 服务让页面自己 `fetch()` 再 `monaco.editor.getEditors()[0].getModel().setValue(t)`；③ 注入后 model 长度 13833 与文件 16607 不等**不是截断**——13833 是 UTF-16 字符串长度，16607 是 UTF-8 字节数（源码含中文注释），用 `JSON.parse` 通过即可判完整；④ Review 步的合约单选按钮**没有包在 `<label>` 里**，label 文本查出来全是空串，靠父节点上溯找 `contracts/` 文本定位；且合成 `.click()` 只聚焦不触发 React state，必须用真实鼠标点击 snapshot uid。
  **本轮修复的自身缺陷**：备份 `.env` 时用了 `.env.bak-v4`，`git check-ignore` 实测**该文件未被 gitignore 覆盖**（只有 `.env` 命中规则）——立即 `rm` 并复验 `.env` 仍在忽略内。教训：**在 `.env` 同级做任何临时副本前先 `git check-ignore` 确认忽略规则覆盖该文件名**，不要假定前缀规则会泛化。
- [x] 参赛材料：`aegis/README.md`、`demo-90s-操作脚本.md`、`第四版策略.md`

---

## 3. 下一步待办（按优先级）

1. **可选增强（第三方 DEX swap）**：接一个"已验证流动性"的 router（重置后 testnet 暂无可核实的 DEX，`scripts/probe-dex.mjs` 可随时复测）；路径其余部分已全部打通（intent→calldata→PACE→收据→互证→executeTrade）。
2. **多 challenger / k-of-n**（未来工作，答辩可讲）：当前单 challenger = 2-of-2 quorum；扩展为声誉加权 k-of-n 是自然延伸。
3. **challenger 经济模型**（未来工作）：谁付钱、作恶罚没。
4. **SOA-lite 链上强制**（未来工作）：把"执行落在签署目标内"作为 vault 的 revert 条件（当前 objectiveHash 经 bindTranscript 只做存证，强制在两侧重推导完成）；链上防重放（nonce 消费）一并做。
5. **✅ v5 重部署已完成（2026-09-20），v4 已废弃**：现行地址 **`0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De`**（见 §2 末条 + §5）。以下 v4 条目保留作历史：**（2026-09-16）** `AegisVaultQuorum` 线上地址曾为 **`0x07Be2FCdAA649F11177AaCCbd68A5bFF36aB65bc`**，同时带上两项合约层修复——① `isTrustedValidator` 验证者白名单（授权前 `trustedValidatorCount==0`，fail-closed 实测确认）；② 钩子由链头 `lastReceiptHash` 改读交易槽 `lastTradeReceipt`（心跳不再顶掉在途交易，见 §11）。已按序执行：`scripts/deploy-v4.mjs`（部署 + 授权 challenger，tx `0xba0df2eb…`/`0x977791a4…`）→ 更新 `.env` `QUORUM_VAULT` → `scripts/set-limits-v4.mjs`（perTx 0.05 / daily 1 MON，tx `0x3c4aa10c…`）→ 金库白名单 WMON（tx `0xa967b760…`）→ v3 余额 0.1325 MON withdraw 回主钱包。
   **5b. ✅ 全链 E2E 复跑已完成（2026-09-17）**——注资 0.5 MON → 真实 `buy WMON 0.01` 全链执行（`execution.status: "executed"`，tx `0x42048bec…76b05`，金库 WMON 0→0.01）；tx 明细见上方工作记录条目。
   **✅ Tenderly 对 v4 的源码级公开验证已完成（2026-09-16 16:56 UTC，匿名可查）**。本项全部收尾，无剩余动作。
6. 提交前通读 README/STATUS，确认所有引用可核实（README 2026-09-15 已对齐）。
7. **✅ parity 守卫的 WMON 路径盲区已修（2026-09-17）**：原 `scripts/parity-check.mjs` 第 34 行 `const ASSETS = { USDC: WHITELIST[0] }` 是死变量（定义后从未被引用），且全部用例写死 `WL0`/`asset:"USDC"` → 守卫只覆盖白名单首项，**漏掉 Phase 4 起的主用路径 WMON**。处理：删掉死变量；新增 `WL_LAST = WHITELIST[WHITELIST.length - 1]`，`benign` 与全部目标层用例改用 `WL_LAST`（`.env` 白名单共 2 项，末项即 WMON 路径）；`asset` 字段两侧都不参与判据，改为中性占位 `WASSET`。
   **回归 + 演练**：`node scripts/parity-check.mjs` → **17 agree / 0 diverge**（用例集不变）。另做了一次**注入漂移演练**验证守卫非空转——把 proposer 侧预览的零宽剥离从 `[\u200B-\u200D\u2060\uFEFF]` 缩到 `[\u2060\uFEFF]` 后重跑：`DIFF blocklist-zero-width proposer=false challenger=true`，`16 agree / 1 diverge`，**exit 1**（演练产物已删，未改动工作区）。
8. **✅ `executeTrade` 余额检查已随 v5 上链生效（2026-09-20）**：该检查此前仅源码、线上 v4 未部署（2026-09-17 条目建议"不重部署"，理由是只改善运维可观测性）。**本轮因 `registry` 需改为可变（`setReceiptRegistry`）而重部署为 v5**，该 require 顺带上线——`0x3aBbb284…b89De` 的字节码含此检查。重部署代价已实际发生并完成：**Tenderly 对 v5 的源码级公开验证已完成（2026-09-20 13:22:24 UTC）** → README / ARTIFACT / 答辩背书 / `.env.example` / `challenger/.env.example` / `dashboard/src/lib/chain.ts` / agents.md 全链路地址同步。**v4 地址与 v4 E2E 证据链保留作历史**（见 §2/§5），不再作生产引用。

---

## 4. 环境与凭据

- **私钥等敏感信息全在 `aegis/.env`**（已被 `.gitignore` 忽略，**切勿提交/外传**）。当前 key：`MONAD_TESTNET_PK`、`MONAD_TESTNET_RPC`、`MONAD_TESTNET_CHAIN_ID`、`CHALLENGER_PK`、`QUORUM_VAULT`、`SOA_USER_PK`（"用户"角色签名私钥，只签名、不需要资金；真实部署中应在用户设备上）。
- ~~`aegis/secrets.txt`~~ 已并入 `.env` 并删除（2026-09-13 Phase 0）。
- **已 git init（2026-09-13 baseline）**；**2026-09-16 首推远程**——`origin` = `https://github.com/cipherc1024/aegis`（**private**），`main` 已 push，artifact 固定 commit tag = **`w11-m2m3-2026-09-16`**（指向 `033eefd`）。`.env`、secrets、vendor（359MB）、构建产物、日志已被根 `.gitignore` 忽略——提交前仍需确认敏感文件未进暂存区。**投稿前必须建匿名镜像**（Zenodo / 匿名 GitHub），论文引用不得指向作者个人仓库（双盲）。
- **钱包**：
  - 主钱包（=proposer =deployer =TEE =owner）：`0x2a0eECA027B617F5e6f631a5475dc283294Ff0a9`，余额约 **5.01 MON**（2026-09-16 faucet 补 5 MON + v3 余额 0.1325 回转后；单笔全链 E2E 实测 ≈0.37 MON）
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
| **AegisVaultQuorum**（v5：registry 可换 + 验证者白名单 + 交易槽钩子 + 余额检查） | `0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De` |
| WMON（官方 canonical，P4 真实路径目标） | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` |

> 旧 v1 地址（ReceiptRegistry `0x91482e67…`、Vault `0x60F9F1FB…`）已废弃，勿引用。
> testnet 于 2025-12-16 从创世重置——重置前的第三方合约地址（博客级 DEX 教程等）全部作废。
> `AegisVaultQuorum` 历史版本亦已废弃：v2 `0xe6E24BB7…533D7`（缺验证者白名单，可自证自答伪造 quorum）、v3 `0x3e5dDe45…3eBa19`（有白名单但钩子读链头，心跳顶掉链头后 executeTrade 全 revert）、v4 `0x07Be2FCd…B65bc`（两项均已修，但 `registry` 仍是 immutable——`ReceiptRegistry` 需更换时必须 withdraw→redeploy、金库地址与全部历史作废；余额检查也只在源码、未上链）。
> 其余 5 个自部署核心合约（ReceiptRegistry / DcapGate / ValidationRegistry / IdentityRegistry / ReputationRegistry）已在 Tenderly 源码级公开验证（2026-09-15，匿名可查；链接见 `aegis/README.md`「Tenderly 公开证据」）；**v4 `AegisVaultQuorum` 已于 2026-09-16 完成源码级公开验证**（匿名实测 `"public":true` + `verification_date:"2026-09-16T16:56:40Z"`），**现行 v5 `AegisVaultQuorum` 已于 2026-09-20 完成**（匿名实测 `"public":true` + `verification_date:"2026-09-20T13:22:24Z"`，`compiler_version:"v0.8.24"` / `evm_version:"paris"` / `optimizations_used:true` / `optimization_runs:200` / `main_contract:1`；三源文件匿名可下载，验证源码含 `setReceiptRegistry` 与 `Insufficient vault balance` 两处 v5 标记）。复测命令：`curl -s https://api.tenderly.co/api/v1/public-contracts/10143/0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De`。

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
   challenger 独立重推导（自包含：不 import proposer 任何模块；L1–L5 确定性 + 可选交叉模型层）→ 比对 executionHash/pdrHash/digest/transcript/objective
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
- `AegisVaultQuorum.sol` — 继承 AegisVault，覆写钩子：先查 `isTrustedValidator[validator]`（owner 白名单，默认空 = fail-closed），再查 ValidationRegistry response≥100（MIN_RESPONSE=100）；钩子读交易槽 `lastTradeReceipt` 而非链头
- `ReceiptRegistry.sol` — 收据：onlyTEE、submitReceiptWithQuote、哈希链、MAX_BLOCK_AGE=100、bindTranscript、usedNonces
- `ValidationRegistry.sol` / `IdentityRegistry.sol` / `ReputationRegistry.sol` — 自部署 ERC-8004
- `PolicyRegistry.sol`、`interfaces/IReceiptRegistry.sol`、`mocks/MockTarget.sol`

### 运行时（`aegis/tee-runtime/`）
- `runtime.mjs` — buildIntent/policyHash/normalize/runGuardrail/paceVerify/computeExecutionHash/computeSemanticDigest
- `objective.mjs` — **L5 proposer 侧实现**：canonical 目标序列化 + objectiveHash + checkObjective（验签 + ε-区间检查；challenger 侧有独立实现，两套互不 import）
- `llm.mjs` / `llm-openai.mjs` — makeLLM() 无 key 自动 mock；含 OBJECTIVE_SYSTEM（目标起草分支）
- `agent.mjs` / `agent-demo.mjs` / `run.mjs` / `llm-test.mjs`

### Challenger（`aegis/challenger/`，Phase 1 新增，自包含可整目录拷到队友机器）
- `verify.mjs` — **5 层独立重推导**（L1 策略认证 / L2 独立护栏 / L3 独立 PACE 含日限 / L4 算术+transcript preimage 绑定 / L5 目标层验签+ε），**单向独立：只依赖 ethers + `./objective.mjs`，不 import proposer 任何模块**（反向有一处复用：`orchestrator/server.mjs` 为 dry-run 预览 import 本模块的 `verifyDecision`/`attestedGuardrailHash`，故 `parity-check.mjs` 守卫的是"proposer 预览 vs 本模块裁决"这一方向）；fail-closed
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
- `deploy-v4.mjs` — **当前生产部署脚本**：部署 AegisVaultQuorum（含白名单 + 交易槽钩子）+ 链上复核构造参数 + 自动授权 `CHALLENGER_ADDR` + 设 PACE 限额
- `set-limits-v4.mjs` — 给已部署金库补设/校验 PACE 限额（onlyOwner，幂等）
- `deploy-quorum.mjs` — 旧版部署脚本（v2/v3 时代，无 setLimits / 无白名单复核），保留作历史
- `quorum-e2e.mjs` — 链上 quorum E2E（无验证拒绝 + challenger 同意执行；v1 时代留档，勿对着生产地址跑）
- `llm-divergence.mjs` — 语义分歧度量（零 gas 离线）；`probe-gateway.mjs` — OpenAI 兼容模型 token 指纹探测（跨家族独立性核实；含 2026-09-13 网关实测记录）
- `tenderly-prep.mjs` — Tenderly 验证预检：加载 build-info → 本地 solc 重编译 → 与链上 runtime bytecode diff（PERFECT/LIKELY/MISMATCH；`--dump` 导出 standard JSON 到 `.tenderly-verify/`，该目录已 gitignore 可重建）。**注意 128 字节阈值会对多 immutable 合约误报 MISMATCH**（见上方 v4 验证条目），此时用 `diff-immutables.mjs` 复核
- `diff-immutables.mjs` — 差异字节聚类分类器：把 `deployedBytecode` 与链上 runtime 的差异逐簇判定为 20 字节地址 immutable 或 1 字节 flag，输出「未归类簇」数。`unknown clusters: 0` = 源码完全一致。用于给 `tenderly-prep.mjs` 的字节数阈值假阳性兜底
- `make-upload-json.mjs` — 从已有 standard JSON 文件裁出 Tenderly JSON Upload 需要的最小三键（`language`/`sources`/`settings`），输出到 `.tenderly-verify/upload-min.json`；避免手抄 12KB JSON
- `dcap-standard-input.mjs` — DcapGate 专用单文件 standard JSON（shanghai；source key 必须为 `dcap-verifier/contracts/DcapGate.sol`，否则 metadata 哈希不匹配）；产物供 Tenderly JSON Upload
- `pack-intee.mjs` — 打包 `tee/intee/agent.mjs` + 其仓库依赖（`tee-runtime/`、`challenger/`）为 `APP_B64`/`MODULES_B64` 两个 base64 块，供 `tee/intee/docker-compose.yml` 在 Phala CVM 内还原。`--env` 写 `.env.intee`（**只含 `APP_B64`/`MODULES_B64` 两个变量，不含 PK/密钥；2026-09-18 实测确认**，仍不得提交）。注：Windows/Git Bash 下 GNU tar 需 `--force-local` 且必须排在 `czf` 之后
- `d5-e2e-submit.mjs`、`rpc-probe.mjs`、`probe-monad.mjs` 等
- ⚠️ `vault-exec-multicall.mjs` 是失败路径留档（Monad Multicall3 内层 msg.sender 失效）

### 其他
- `aegis/dcap-verifier/STATUS.md` — **完整工程记录（地址+坑+gas+tx 哈希），接手必读**
- `aegis/test/aegis.test.js` + `aegis/test/m2m3.test.js` — 44/44 测试（31 原：含验证者白名单 + 交易槽钩子 + ValidationRegistry 边界 + 金库余额不足可区分报错 + v5 setReceiptRegistry 三用例；13 M2/M3）
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
- `dashboard/` — 统一入口 Dashboard（**全站无编造数字**，`mock.ts` 的编造 fixtures 已删）：`/try` 现场跑一笔、`/architecture` 信任边界图+一键 11 负例、`/receipts` 真实索引+explorer 链接、`/orch/*` 同源代理 orchestrator；真实读数页 `/dashboard` `/funds` `/audit` `/notifications` `/console` `/policy` `/vaults` `/market` `/backtest` `/settings`；**设计边界页**（真实读数 + 页内论证，功能不承诺）`/copy` `/subaccounts`；`/sdk` 五组真实可调用接口（非 npm 包）。改 dashboard 前先读 `aegis/README.md`「Dashboard 诚实口径」（5 条硬规则）

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

# 合约编译 + 单测（应 44/44 通过：aegis.test.js 31 + m2m3.test.js 13）
npx hardhat compile                 # 期望 "evm target: paris"
npx hardhat test                    # 期望 "44 passing"

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
#   读侧（真实读数，dashboard 各页就靠这些）：
#   GET /api/status | /api/config | /api/receipts | /api/decision/:digest | /api/pipeline | /api/events (SSE)
#   GET /api/vault | /api/vaults | /api/agents | /api/policy | /api/exec-stats
#   dryRun 预览（零 gas；dryRun 默认 true）：
#   POST /api/agent/command?agentId=1  {"command":"buy WMON 0.01"}
#   真实全链（收据 → challenger 互证 → executeTrade（金库余额出资）→ 金库真实转账）：
#   POST /api/agent/command?agentId=1  {"command":"buy WMON 0.01","dryRun":false,"execute":true}
#   challenger 作恶演示：
#   POST /api/agent/command?agentId=1  {"dryRun":false,"execute":true,"tamperExecHash":true,"recordReject":true}
#   治理写（两步：不带 confirm 只 estimateGas 零 gas preview，带 confirm 才广播）：
#   POST /api/admin/<op>   与   POST /api/agents（注册新 agent）
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

- **余额**：主钱包 ~5.01 MON（2026-09-16，够约 13 笔全链）；单笔全链实测 ≈0.373 MON（收据 3.48M gas 占大头）。
- **challenger**：余额 ~0.57 MON；每笔决策 2 笔 validation 交易（≈0.025 MON）；需预留第二台机器新钱包的注资（~0.5 MON）。
- **LLM 端点（主用：官方 DeepSeek API，校外可达）**：偶发 503 / 超时 / 请求挂起 → 管线 fail-closed 返回 refuse（如实标注，不静默降级假数据）；退避 45–60s 重试即可。**deepseek-flash 是推理模型**：reasoning 与答案共享 max_tokens，预算过小会截断成空 content（`finish_reason=length`）→ 误拒；已统一 `LLM_MAX_TOKENS=2000`（`pipeline.mjs`）。（原 USTC 网关条目已于 2026-09-15 删除）
- **RPC 读可能瞬时滞后**（FallbackProvider 后端 LB，曾观测到后端落后 ~39k 块的陈旧读）：写路径已加固（客户端预算 expectedDigest + 轮询对齐；prev 读连续两次一致才采信）——若见 "Not latest receipt"/digest 不匹配类报错，先怀疑读滞后而非合约状态。
- **历史收据索引有少量缺口**（RPC 限流放弃的窗口），重跑 `index-receipts.mjs` 可补。
- **TEE 阶段二三（OPA/Membrane）未实现**，当前为可插拔结构——README 已标为已知边界，勿在答辩中声称已实现。
- **心跳与交易窗口互斥 — 已在 v4 合约层消除**（2026-09-16）：orchestrator 侧在途守卫保留（trade 收据上链后 60s 内心跳请求返回 `heartbeat_deferred`，时间自愈）；challenger 仍对心跳收据直接跳过（无 transcript 绑定，不参与重推导）。合约层的根因已修：v4 钩子读交易槽 `lastTradeReceipt`（心跳在 `_submit` 里不写该槽），故即便绕过 orchestrator 直接发心跳 tx，也不会顶掉在途交易收据、不再触发 "No challenger quorum"。**旧 v2/v3 地址仍有该约束，勿回退引用。**
- **金库出资语义（v2 起）**：`executeTrade` 内部 `target.call{value: value}(data)`，**资金来自金库自有余额**（owner 经 `deposit()` 注入），`executeTrade` 本身**非 payable**（刻意设计；三条理由见合约 `@dev`）。Phase 4 实测金库 WMON 0→0.01、v4 复跑 WMON 0→0.01 + MON 0.5→0.49、**v5 复跑同样 WMON 0→0.01 + MON 0.5→0.49**。`require(value <= address(this).balance, "Insufficient vault balance")` 自 **v5 起已在线上字节码生效**（v4 时代仅源码，见 §3 待办 8 的收尾）。
- **验证者白名单已在 v4 链上生效**（2026-09-16）：`ValidationRegistry` 是 permissionless 的——任何人可 `validationRequest`(validatorAddress=自己) 再自己回 `validationResponse(100)`。旧 v2 钩子只读 `response >= 100`，**攻击者无需 challenger 私钥即可伪造 quorum 放行 executeTrade**。v4 钩子先查 `isTrustedValidator[validator]`，**白名单默认为空 = fail-closed**（部署时实测 `trustedValidatorCount==0`，授权后才为 1）；`scripts/deploy-v4.mjs` 部署时自动把 `CHALLENGER_ADDR` 授权上链。**答辩口径**：合约层白名单强制**已在 v4 线上生效**（地址见 §5），并有单测覆盖（自证伪造被忽略 / 撤销授权即时生效 / owner-only 且拒零地址）。
- **`tee/intee/agent.mjs` 的 CVM 内 E2E 已跑通**（2026-09-18，见 §2 工作记录末尾条目）：`MODULES_B64` 在真 CVM 内还原 + 执行 + 上链收据全通，收据 tx `0xadf52203…003be` @63607466（gas 3,477,689，`status=1`），事件字段与 CVM 日志逐字段比对一致。**唯一未复跑的是"in-TEE 完整闭环"的后半段**：本次止于 `submitReceiptWithQuote`（含真 TDX quote 5010B），**未在同一 CVM 内继续跑 challenger 重推导 + `executeTrade`**（in-TEE agent 本就只负责到收据上链，后两段由 orchestrator/challenger 承担，已由 §3 待办 5b 的 v4 全链 E2E 覆盖）。
