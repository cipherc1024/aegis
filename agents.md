# AGENTS.md — Aegis 项目转交说明

> 本文件是给接手本项目的 AI Agent / 工程师的交接文档。**开工前先完整读一遍**，尤其是第 8 节 Monad 坑表和第 10 节硬约束。
> 最后更新：2026-09-14（Phase 4+5+6 完成后）

---

## 0. 接手第一步：验证现状（约 5 分钟，建议先跑）

在动手改任何东西前，先确认交接状态真实可用：

```bash
# 工作目录：C:\Users\12190\Desktop\本科二年级\Monad量化\aegis
npx hardhat compile          # 期望 "evm target: paris"
npx hardhat test             # 期望 "18 passing"
node scripts/d6-negative.mjs # 期望 9 项攻击向量全部被拒
node scripts/parity-check.mjs # 期望 "10 agree / 0 diverge"
```

> 全链一笔会真实上链（消耗主钱包 gas）。若主钱包余额 <0.1 MON 先测 dryRun：
> `node orchestrator/server.mjs` 后 `POST /api/agent/command?agentId=1 {"command":"buy WMON 0.01"}`（零 gas，看 `challenger.agree=true`）。

**最近一次工作记录（2026-09-14，Phase 4 全链 WMON E2E，可去区块浏览器核对）**：
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
1. **AI 决策可验证化**：把安全关键路径做成确定性函数（护栏 + PACE），LLM 只当 proposer，其输出只是被摘要/分类的不可信输入；challenger 用纯确定性代码独立重推导“同意/拒绝”。TEE 证明“谁在什么环境跑”，challenger 证明“决策本身是否一致”——两个正交信任维度。
2. **完整字节级绑定链**：LLM 决策 → semantic digest → PDR(executionHash+guardrailHash) → 收据绑定 blockhash → 链上 DCAP 验 TEE 身份 → vault 只执行与收据 executionHash 一致的字节 → 执行前 challenger quorum。9 个负例向量实测全部被拒。
3. **ERC-8004 ValidationRegistry 从元数据变硬闸门**：`_preExecutionHook` 要求最新收据 response≥100 才放行 executeTrade，requestHash = 收据 digest，验证的是“那次具体决策”。

**诚实边界（评委追问时主动说，别吹）**：链上 DCAP 验证（Automata 等有先例）、双 LLM 隔离（接近 CaMeL/dual-LLM pattern）、challenger 游戏（形似 Arbitrum 欺诈证明）都是已有技术；创新在**端到端咬合 + 确定性可重推导设计 + 负例实测**。challenger 当前验证的是策略合规性，不是完整重推导 LLM 选出的指令；challenger 经济模型未设计。

---

## 2. 当前状态（已完成，全部 Monad testnet 实测）

- [x] 链上 DCAP 验证真 Intel TDX quote（full stack，14+ 合约）
- [x] `ReceiptRegistry`：哈希链收据 + blockhash 双绑定 + nonce 防重放 + 心跳独立槽位
- [x] in-TEE 自治闭环：真实 TDX CVM 内 决策→自证→上链
- [x] ERC-8004 三注册表**自部署**（官方 testnet 无部署，codeLen=0）+ Agent 注册 + 验证闭环 + 声誉反馈
- [x] D6 负例测试：9 攻击向量全部被拒（`scripts/d6-negative.mjs`）；坏 quote 位置扫描（`scripts/dcap-corrupt-sweep.mjs`）
- [x] Orchestrator 读侧+写侧（`orchestrator/server.mjs`）
- [x] 收据索引器（绕过 getLogs 100 块限制，`scripts/index-receipts.mjs`）
- [x] **Proposer/Challenger 双代理互证** + `AegisVaultQuorum` 上链部署 + 链上 quorum E2E
- [x] **Challenger 独立性包**（2026-09-13 Phase 1）：`challenger/` 自包含验证进程（4 层独立重推导 + 决策原文存证端点 + fail-closed，11 用例自测全过）；orchestrator 角色分离（不再代签 validation）；**部署到队友机器（见 challenger/README.md）即成真 2-of-2**
- [x] **Phase 2 完成**（2026-09-13）：合约 v2 部署——ReceiptRegistry `0x4622D041...`（bindTranscript 决策原文绑定 + MAX_BLOCK_AGE=100）、AegisVaultQuorum `0xe6E24BB7...`（executeTrade 带 {value}，vault 余额真实变动）；**quote 路径上线**——Phala CVM `aegis-quote`（tdx.small 常驻，公网端点在 .env QUOTE_URL）实时生成绑定 digest 的真 TDX quote → `submitReceiptWithQuote` 链上 DCAP 验真；orchestrator execute 流程接通（AGENTS 待办#1 完成）；**全链 E2E 实测（17.6s）**：submitReceiptWithQuote（gas 3.5M，tx 0x7981eb9b...）→ challenger 四层 pass → validationResponse(100) → executeTrade（tx 0xe4902c0a...，TradeExecuted @62191167 块后）→ vault 0.5→0.48 MON；18/18 单测（新增 3 个 bindTranscript 用例）；策略变更流程实跑（白名单 → env 同步 → re-attest）；主钱包余额约 1.7 MON（challenger 回转 1.5 MON，tx 0x6a444c95...）；已知坑：Windows 下 Git Bash kill 杀不干净 node 后台进程（用 PowerShell Stop-Process），orchestrator 端口占用时新进程 EADDRINUSE 静默崩溃（重定向前先查 netstat）
- [x] **Phase 3 完成（代码侧）**（2026-09-13）：proposer 侧**双 LLM 隔离管线**（`tee-runtime/llm.mjs` + `orchestrator/pipeline.mjs`：隔离 LLM 只抽取 facts/suspicious、无工具权限 → 特权 LLM 只吃「可信指令 + 隔离摘要」产出 typed intent，全程 fail-closed）；**信任边界显式化**（LLM 在 TEE 之外，因模型仅校园网可达 —— 该设计已从论文 P1 推导证明不削弱安全性，见 `..\..\monad论文\A会论文路线图.md` §5）；challenger 新增可选 **L5 交叉模型层**（`challenger/llm-challenge.mjs`，`MODEL_CHALLENGE=true` 开启，默认关闭 = 与 Phase 2 行为逐字节一致；要求不同家族模型 + temp=0 + 确定性代码裁决，`agree=null` 表示无法裁决→不签发）；新增 `GET /api/pipeline` 只读预览端点；**语义分歧度量**实验脚本 `scripts/llm-divergence.mjs`（论文 §6 实验 1b，零 gas 离线）
- [x] **Phase 3 修复的口径漏洞**（重要，3 个真实 bug）：① `orchestrator` 预览护栏**未规范化 text** 就匹配 blocklist → `ev\u200Bil.com` 零宽混淆可绕过（challenger 一直是对的，会制造假性分歧）；② orchestrator `norm` 缺 leetspeak folding → `3vil.com` 两侧结论漂移；③ leet 折叠把 `a11`→`aii` 导致注入正则漏判（两侧同口径修）；④ mock LLM 用 `/ISOLATED/i` 判别分支，而 `PRIVILEGED_SYSTEM` 含 "isolated analyst" 字样 → 特权调用误入隔离分支，mock 路径整体静默失效。**新增 `scripts/parity-check.mjs`** 守住口径：同一批输入分别喂 proposer 预览与 challenger 完整重推导，断言"拒绝与否"一致（当前 10/10 agree，漂移即 exit 1）
- [x] Hardhat 单测 **18/18 通过**（新增 3 个 bindTranscript 用例）；challenger selftest **11/11**；parity **10/10**；Dashboard 构建通过
- [x] **Phase 3 live 完成**（2026-09-13/14）：真实校园网模型接入（USTC 网关，OpenAI 兼容，key 在 .env）——proposer=deepseek-flash / challenger=glm-5.3-flash（**经网关 token 指纹实测确认不同后端**，`scripts/probe-gateway.mjs`：smart/reasoning/qwen3.6-chat/claude-haiku-4-5 共享同一后端，glm 独立）；live E2E 已实测（网关偶发 503/超时 → fail-closed 返回 refuse，退避重试即可）
- [x] **Phase 4 完成**（2026-09-14）：**真实协议交互路径上线**——重置后 testnet（2025-12-16 genesis reset）无法核实任何第三方 DEX router（Uniswap v2/v3/v4 canonical 地址链上实测 codeLen=0，`scripts/probe-dex.mjs`；Kuru 无法核实），经用户确认以**官方 canonical WMON wrap** 为真实路径：官方文档核实 WMON `0xFb8bf4c1…8541`（链上 codeLen=3249、name/symbol/decimals 读回正确）→ `.env` WHITELIST 与 challenger 策略加入 WMON → `policy-attest --execute` 上链新认证 → `whitelist-wmon.mjs` 金库白名单上链 → pipeline assetMap 加 WMON（intent→`deposit()` calldata `0xd0e30db0`，`pipeline.mjs` WMON_DEPOSIT）→ **全链 E2E 实测：buy WMON 0.01 → executeTrade{value} → TradeExecuted @62366819，execHash 与 transcript 逐字节一致，金库 WMON 0→0.01**。修复 /api/verify 口径：未显式传 target/amount 时走与 /api/agent/command 完全相同的 pipeline 解析（data 也取 pipeline 值），新增 `resolvedBy` 字段。challenger 加固：全局 unhandledRejection 接管（RPC 抖动不再杀进程）
- [x] **Phase 6 完成**（2026-09-14）：**统一入口 Dashboard**——Next rewrites 把 `/orch/*` 同源代理到 orchestrator（不开 CORS，内网地址不进浏览器）；新页 `/try`（现场跑一笔：pipeline 预览 → 双实现裁决 → dry-run 摘要，preset 覆盖合规/注入/未知标的/超限）与 `/architecture`（信任边界图 + TEE 虚线 + 10 步路径 + 一键 11 负例实测）；landing 四卡全改真实读数（编造数字清除或标「示例」）；`/receipts` 改走 orchestrator 索引（真实哈希+tx 可点 explorer，未覆盖字段诚实显示"—"）；nav 重排评审动线（核心→用户→运营者）。修复：try/architecture 页管线拒绝时 challenger=null 的 TypeError、challenger layers 对象误当数组、11 负例面板未知标的误用白名单 target
- [x] **Phase 5 完成**（2026-09-14）：README 重写（信任边界口径、P1-P6 里程碑、Phase 4 全链 tx 表、部署地址表更新到 v2、诚实边界清单、testnet 重置坑）；agents.md 同步

- [x] 参赛材料：`aegis/README.md`、`demo-90s-操作脚本.md`、`第四版策略.md`

---

## 3. 下一步待办（按优先级）

1. **可选增强（第三方 DEX swap）**：接一个"已验证流动性"的 router（重置后 testnet 暂无可核实的 DEX，`scripts/probe-dex.mjs` 可随时复测）；路径其余部分已全部打通（intent→calldata→PACE→收据→互证→executeTrade{value}）。
2. **多 challenger / k-of-n**（未来工作，答辩可讲）：当前单 challenger = 2-of-2 quorum；扩展为声誉加权 k-of-n 是自然延伸。
3. **challenger 经济模型**（未来工作）：谁付钱、作恶罚没。
4. 提交前通读 README/STATUS，确认所有引用可核实（README 2026-09-14 已重写对齐）。

---

## 4. 环境与凭据

- **私钥等敏感信息全在 `aegis/.env`**（已被 `.gitignore` 忽略，**切勿提交/外传**）。当前 key：`MONAD_TESTNET_PK`、`MONAD_TESTNET_RPC`、`MONAD_TESTNET_CHAIN_ID`、`CHALLENGER_PK`、`QUORUM_VAULT`。
- ~~`aegis/secrets.txt`~~ 已并入 `.env` 并删除（2026-09-13 Phase 0）。
- **已 git init（2026-09-13 baseline）**，无远程；`.env`、secrets、vendor（359MB）、构建产物、日志已被根 `.gitignore` 忽略——提交前仍需确认敏感文件未进暂存区。
- **钱包**：
  - 主钱包（=proposer =deployer =TEE =owner）：`0x2a0eECA027B617F5e6f631a5475dc283294Ff0a9`，余额约 **0.49 MON**（2026-09-14 Phase 4 后；demo 前建议补 faucet）
  - challenger：`0x16e619c3d6625f4d6F583791A4C2351D65508a2c`，余额约 **3.9 MON**
- **RPC**：`https://testnet-rpc.monad.xyz`（主，QuickNode 50rps/batch 100）+ `https://rpc.ankr.com/monad_testnet`（备，无 archive）+ `https://rpc-testnet.monadinfra.com`（备，官方 20rps）；完整列表见 docs.monad.xyz testnet 页
- **LLM**：USTC 校园网网关（OpenAI 兼容，key 在 .env 的 `LLM_BASE_URL/LLM_API_KEY`）；proposer=deepseek-flash、challenger=glm-5.3-flash（跨家族，指纹已实测）；**仅校园网可达**——off-campus 自动降级 mock（如实标注）
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
        executionHash = keccak(target,value,data)
        pdrHash = keccak(executionHash, guardrailHash, true)
        semantic digest
        ═════════════ TEE 信任边界 ═════════════
                          ▼
        TEE 生成 TDX quote（report_data = digest，Phala CVM 实时）
                          ▼
        ReceiptRegistry.submitReceiptWithQuote（链上 DCAP 验真 + blockhash 绑定 + 哈希链）
                          ▼
   challenger 独立重推导（零共享代码 + 另一家族模型）→ 比对 executionHash/pdrHash/digest/transcript
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
- `llm.mjs` / `llm-openai.mjs` — makeLLM() 无 key 自动 mock
- `agent.mjs` / `agent-demo.mjs` / `run.mjs` / `llm-test.mjs`

### Challenger（`aegis/challenger/`，Phase 1 新增，自包含可整目录拷到队友机器）
- `verify.mjs` — **4 层独立重推导**（L1 策略认证 / L2 独立护栏 / L3 独立 PACE 含日限 / L4 算术+transcript preimage 绑定），与 proposer 零共享代码；fail-closed
- `challenger-agent.mjs` — 独立进程：轮询链上收据 → 直读字段 → 拉 decision 原文（拉不到=拒绝）→ 验证 → 独立钱包上链 validation；`--once` 单次模式
- `challenger-policy.json` — challenger 自持策略（改后需 proposer 跑 policy-attest --execute）
- `policy-attest.mjs` — 治理侧把认证 guardrailHash 设上链（默认打印零 gas，--execute 发交易；含 env/策略一致性检查）
- `selftest.mjs` — 11 用例离线自测；`gen-key.mjs` 独立钱包生成；`README.md` 队友部署指南

### Orchestrator（`aegis/orchestrator/`）
- `server.mjs` — 读侧 `/api/status` `/api/receipts` `/api/decision/:digest`(决策原文) `/api/events`(SSE)；写侧 `POST /api/agent/command?agentId=1`（body: `{command, marketData, target, amount, data, dryRun, tamperTranscript}`）。**角色分离：本进程只当 proposer，不持有 challenger 私钥，不代签 validation**；上链后决策原文存证 `decisions.jsonl` 供 challenger 拉取
- `receipts-cache.json` — 索引器产物

### 脚本（`aegis/scripts/`，重点）
- `lib.mjs` — loadEnv/RPC_LIST/getWallet/loadArtifact/deploy/attach
- `d6-negative.mjs` — 9 项攻击向量负例
- `parity-check.mjs` — **口径一致性守卫**：proposer 预览 vs challenger 重推导，漂移即 exit 1（改 normalize/护栏/PACE 后必跑）
- `probe-dex.mjs` — 候选 DEX/协议合约链上 codeLen 探测（P4 核实用，可随时复测）
- `whitelist-wmon.mjs` — 金库白名单加 WMON（owner 交易，幂等）
- `dcap-corrupt-sweep.mjs` — 坏 quote 位置扫描（全 view 零成本）
- `index-receipts.mjs` — 收据索引器（JSON-RPC batch）
- `erc8004.mjs` — ERC-8004 三注册表部署 + 注册 + 验证闭环
- `deploy-quorum.mjs` — 部署 AegisVaultQuorum
- `quorum-e2e.mjs` — 链上 quorum E2E（无验证拒绝 + challenger 同意执行）
- `llm-divergence.mjs` — 语义分歧度量（零 gas 离线）；`probe-gateway.mjs` — 网关 token 指纹探测（跨家族核实）
- `d5-e2e-submit.mjs`、`rpc-probe.mjs`、`probe-monad.mjs` 等
- ⚠️ `vault-exec-multicall.mjs` 是失败路径留档（Monad Multicall3 内层 msg.sender 失效）

### 其他
- `aegis/dcap-verifier/STATUS.md` — **完整工程记录（地址+坑+gas+tx 哈希），接手必读**
- `aegis/test/aegis.test.js` — 18/18 测试
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
- `答辩背书-完整版.md` — **答辩/评委追问背书**（金句、三大主张、14 问 Q&A、数字备查表、诚实边界清单、5 分钟答辩结构；数字与 agents.md 同步）
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

# 合约编译 + 单测（应 18/18 通过）
npx hardhat compile                 # 期望 "evm target: paris"
npx hardhat test                    # 期望 "18 passing"

# D6 负例（9 攻击向量应全部被拒）
node scripts/d6-negative.mjs

# 口径一致性守卫（proposer 预览 vs challenger 重推导，漂移即 exit 1；改 normalize/护栏/PACE 后必跑）
node scripts/parity-check.mjs

# challenger 离线自测（11 用例）+ 独立进程（轮询收据 → 重推导 → 上链 validation；--once 单次）
node challenger/selftest.mjs
node challenger/challenger-agent.mjs

# 策略变更（改 challenger-policy.json 后：默认零 gas 预览，确认后 --execute 上链）
node challenger/policy-attest.mjs
node challenger/policy-attest.mjs --execute

# 链上 quorum E2E（无验证拒绝 + challenger 同意执行成功；消耗主钱包 gas）
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

- **余额**：主钱包 ~0.49 MON（2026-09-14 Phase 4 后），全链一笔主要消耗在收据（~3.5M gas）+ validation×2 + executeTrade；demo 前建议补 faucet，避免现场连续跑全链。
- **challenger**：余额 ~3.9 MON 充足；每笔决策花 2 笔 validation 交易。
- **USTC 网关**：偶发 503 "Authentication timed out" / 请求挂起 → 管线 fail-closed 返回 refuse（如实标注，不静默降级假数据）；退避 45–60s 重试即可。
- **历史收据索引有少量缺口**（RPC 限流放弃的窗口），重跑 `index-receipts.mjs` 可补。
- **TEE 阶段二三（OPA/Membrane）未实现**，当前为可插拔结构——README 已标为已知边界，勿在答辩中声称已实现。
- v2 金库 `executeTrade` 带 `{value}`（原生 MON 传递已实现；Phase 4 实测金库 WMON 余额 0→0.01）。
