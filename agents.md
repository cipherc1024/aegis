# AGENTS.md — Aegis 项目转交说明

> 本文件是给接手本项目的 AI Agent / 工程师的交接文档。**开工前先完整读一遍**，尤其是第 8 节 Monad 坑表和第 10 节硬约束。
> 最后更新：2026-09-13（交接时状态）

---

## 0. 接手第一步：验证现状（约 5 分钟，建议先跑）

在动手改任何东西前，先确认交接状态真实可用：

```bash
# 工作目录：C:\Users\12190\Desktop\本科二年级\Monad量化\aegis
npx hardhat compile          # 期望 "evm target: paris"
npx hardhat test             # 期望 "15 passing"
node scripts/d6-negative.mjs # 期望 9 项攻击向量全部被拒
node scripts/quorum-e2e.mjs  # 期望场景1 revert "No challenger quorum"、场景2 executeTrade status=1
```

> `quorum-e2e.mjs` 会真实上链（消耗主钱包 gas）：收据 ~138k、validation ~2 笔、executeTrade。若主钱包余额 <0.1 MON 先测 dryRun：
> `node orchestrator/server.mjs` 后 `POST /api/agent/command?agentId=1 {"command":"buy USDC 0.01"}`（零 gas，看 `challenger.agree=true`）。

**最近一次工作记录（双代理互证，2026-09-13，可去区块浏览器核对）**：
- AegisVaultQuorum 部署 tx：`0xbac0c00d81a70274d9896ad2520cc626a40133a072497c310c31d9857991134a`
- 主钱包从 challenger 回转 1 MON：`0x55f93a81ac1e8be80d500dadf11ede2b92c0cf23d4b50b9589aebe99082c6756`
- Orchestrator 互证 AGREE：收据 `0xd6f89e50...`、challenger request `0xcbcb1b0d...` + response `0x1c42a8ce...`（response=100）
- Orchestrator 互证 TAMPER：收据 `0xe4d59674...` → challenger response=0 上链
- 链上 quorum E2E：**TradeExecuted @块 62070391，tx `0xa16248508c76f82d1a9381ca3836e1a457a1410ec8aab63e60e9f077a6b7d965`**

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
- [x] Hardhat 单测 **15/15 通过**；Dashboard 构建通过
- [x] 参赛材料：`aegis/README.md`、`demo-90s-操作脚本.md`、`第四版策略.md`

---

## 3. 下一步待办（按优先级）

1. **可选增强**：把 orchestrator 的 command 流程接到 `AegisVaultQuorum.executeTrade`（目前 proposer 只提交收据 + challenger 验证，执行单独由 `scripts/quorum-e2e.mjs` 演示）——注意 vault 的 TEE 地址 = 主钱包，executeTrade 是 onlyTEE。
2. **多 challenger / k-of-n**（未来工作，答辩可讲）：当前单 challenger = 2-of-2 quorum；扩展为声誉加权 k-of-n 是自然延伸。
3. **challenger 经济模型**（未来工作）：谁付钱、作恶罚没。
4. 提交前通读 README/STATUS，确认所有引用可核实。
5. **提醒用户**：撤销暴露的 token `phak_wnqa...`（用户始终未操作）。

---

## 4. 环境与凭据

- **私钥等敏感信息全在 `aegis/.env`**（已被 `.gitignore` 忽略，**切勿提交/外传**）。当前 key：`MONAD_TESTNET_PK`、`MONAD_TESTNET_RPC`、`MONAD_TESTNET_CHAIN_ID`、`CHALLENGER_PK`、`QUORUM_VAULT`。
- ~~`aegis/secrets.txt`~~ 已并入 `.env` 并删除（2026-09-13 Phase 0）。
- **已 git init（2026-09-13 baseline）**，无远程；`.env`、secrets、vendor（359MB）、构建产物、日志已被根 `.gitignore` 忽略——提交前仍需确认敏感文件未进暂存区。
- **钱包**：
  - 主钱包（=proposer =deployer =TEE =owner）：`0x2a0eECA027B617F5e6f631a5475dc283294Ff0a9`，余额约 **0.38 MON**（丢弃钱包，仅测试用）
  - challenger：`0x16e619c3d6625f4d6F583791A4C2351D65508a2c`，余额约 **4 MON**
- **RPC**：`https://testnet-rpc.monad.xyz`（主）+ `https://rpc.ankr.com/monad_testnet`（备，Ankr）
- **补 MON**：官方 faucet `https://faucet.monad.xyz`（连 X/Discord 提额）；Alchemy `https://www.alchemy.com/faucets/monad-testnet`（1 MON/24h，需主网 ≥0.001 ETH + 主网活动，且 testnet 余额不能太高）
- **LLM key 由用户自行配置**（`LLM_BASE_URL/LLM_API_KEY/LLM_MODEL`，OpenAI 兼容）；无 key 时自动降级 mock。

---

## 5. 链上部署地址（Monad testnet, chainId 10143）

| 合约 | 地址 |
|---|---|
| ReceiptRegistry（in-TEE 收据） | `0x91482e67998a01C0A33Fe12ec01A6A43177A7181` |
| DcapGate | `0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F` |
| ERC-8004 IdentityRegistry（自部署，agentId=1） | `0xC99D2957fdA1455E68dF2181A4bB97fd73081A74` |
| ERC-8004 ReputationRegistry | `0xb5B853BcE92940b8E5BFba131301509eaCFb5c9f` |
| ERC-8004 ValidationRegistry | `0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa` |
| **AegisVaultQuorum**（challenger 互证金库） | `0x60F9F1FBa953ce5CD9c8805CD4858eFf35BcB20a` |

完整记录（DCAP 全栈地址、测试 tx 哈希与 gas）见 `aegis/dcap-verifier/STATUS.md`。

---

## 6. 架构与数据流

```
外部内容/market data ─┐
                      ├─► 非特权 LLM（只摘要/分类，不碰钱）
可信指令 ─────────────┘
                          │
        ┌─────────────────▼──────────────────┐
        │  特权 LLM（proposer）：产出执行意图   │
        └─────────────────┬──────────────────┘
                          ▼
        护栏（注入模式+blocklist）→ PACE（白名单+限额）
                          ▼
        executionHash = keccak(target,amount,data)
        pdrHash = keccak(executionHash, guardrailHash, true)
        semantic digest
                          ▼
        ReceiptRegistry.submitReceipt（绑定区块 blockhash+nonce，哈希链）
                          ▼
   challenger 独立重推导（自持 blocklist/策略）→ 比对 executionHash/pdrHash/digest
                          ▼
   ValidationRegistry.validationResponse(requestHash=收据digest, 100/0)
                          ▼
   AegisVaultQuorum._preExecutionHook：response≥100 才放行 executeTrade
                          ▼
   链上硬约束（白名单/限额/日限）→ target.call(data) → TradeExecuted
```

---

## 7. 文件地图

### 合约（`aegis/contracts/`）
- `AegisVault.sol` — 金库：PACE 绑定、白名单/限额、死手开关、`_preExecutionHook` 虚钩子
- `AegisVaultQuorum.sol` — 继承 AegisVault，覆写钩子查 ValidationRegistry response≥100（MIN_RESPONSE=100）
- `ReceiptRegistry.sol` — 收据：onlyTEE、submitReceiptWithQuote、哈希链、MAX_BLOCK_AGE=40、usedNonces
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
- `dcap-corrupt-sweep.mjs` — 坏 quote 位置扫描（全 view 零成本）
- `index-receipts.mjs` — 收据索引器（JSON-RPC batch）
- `erc8004.mjs` — ERC-8004 三注册表部署 + 注册 + 验证闭环
- `deploy-quorum.mjs` — 部署 AegisVaultQuorum
- `quorum-e2e.mjs` — 链上 quorum E2E（无验证拒绝 + challenger 同意执行）
- `d5-e2e-submit.mjs`、`rpc-probe.mjs`、`probe-monad.mjs` 等
- ⚠️ `vault-exec-multicall.mjs` 是失败路径留档（Monad Multicall3 内层 msg.sender 失效）

### 其他
- `aegis/dcap-verifier/STATUS.md` — **完整工程记录（地址+坑+gas+tx 哈希），接手必读**
- `aegis/test/aegis.test.js` — 15/15 测试
- `aegis/hardhat.config.js` — solc 0.8.24 + viaIR + optimizer 200 + `evmVersion: paris`
- `aegis/README.md` — 参赛级 README
- `第四版策略.md` — 主策略文档（工作区根目录）
- `demo-90s-操作脚本.md` — demo 分镜脚本（用户不录视频，备用）
- `dashboard/` — 前端 Dashboard

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

# 合约编译 + 单测（应 15/15 通过）
npx hardhat compile                 # 期望 "evm target: paris"
npx hardhat test                    # 期望 "15 passing"

# D6 负例（9 攻击向量应全部被拒）
node scripts/d6-negative.mjs

# 链上 quorum E2E（无验证拒绝 + challenger 同意执行成功）
node scripts/quorum-e2e.mjs

# 收据索引器（约 30+ 分钟扫历史块 → orchestrator/receipts-cache.json）
node scripts/index-receipts.mjs

# Orchestrator（默认 :8787，ORCH_PORT 可改）
node orchestrator/server.mjs
#   dryRun 预览（零 gas）：
#   POST /api/agent/command?agentId=1  {"command":"buy USDC 0.01"}
#   真实上链：
#   POST /api/agent/command?agentId=1  {"command":"buy USDC 0.01","dryRun":false}
#   challenger 作恶演示：
#   POST /api/agent/command?agentId=1  {"dryRun":false,"tamperExecHash":true,"recordReject":true}

# Dashboard
cd ../dashboard && npm install && npm run dev
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
8. **未经用户批准不要 commit/push**；本项目当前非 git 仓库。
9. 提醒用户：**撤销暴露的 token `phak_wnqa...`**。

---

## 11. 风险与注意

- **余额**：主钱包仅 ~0.38 MON，大合约部署前必须先补 faucet（约 0.78 MON/次）。
- **challenger 已花费**：4 笔 tx 曾耗尽 0.05 MON，现余额 ~4 MON 充足。
- **历史收据索引有少量缺口**（RPC 限流放弃的窗口），重跑 `index-receipts.mjs` 可补。
- **TEE 阶段二三（OPA/Membrane）未实现**，当前为可插拔结构——README 已标为已知边界，勿在答辩中声称已实现。
- `executeTrade` 的 `target.call(data)` **不带 value**（原生 MON 传递为已知边界），vault 余额不动属正常。
