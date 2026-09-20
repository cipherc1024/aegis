# Aegis — TEE-Attested Autonomous Trading Agent (Monad Metropolis, Track 04)

> **Agent 必须证明它听话了——以及它做的是你想做的。**
> LLM 自治交易的核心信任缺口：用户凭什么相信一个黑盒 Agent 拿着你的钱在交易？
> Aegis 的答案：不让 AI 直接动钱——安全关键路径是**确定性谓词 δ**（护栏 + PACE），外加 **SOA-lite 用户签署目标层**（L5），LLM 只当 proposer；
> 每一笔决策生成绑定区块高度的 TEE 收据（DCAP quote 的 `report_data` = 决策摘要），并由**独立 challenger**
> 用自己的代码独立重推导同一结论（L1–L5 五层），2-of-2 一致才放行执行。任何人在 Monad 链上即可独立验证。

对应策略文档 `../第四版策略.md`。
**状态：44/44 单测 + challenger selftest 17/17 + parity 21/21 + 全链路 Monad testnet 实测（见"已验证里程碑"）。**

## 信任边界（务必照此口径讲）

```
外部内容/market data ─┐
                      ├─► 隔离 LLM（无工具权限，只产出 facts/suspicious）
可信指令 ─────────────┘         │
                                ▼
                    特权 LLM（只吃「可信指令 + 隔离摘要」→ typed intent）
                                │   ←—— LLM 在 TEE 之外（proposer 侧），这是刻意的：
                                ▼        安全性不依赖「模型在 TEE 里」——
        δ① 护栏（注入模式 + blocklist，含零宽/leet 归一化）      威胁模型本就假设模型可被完全操纵，
                                │                              判据是确定性谓词 δ 被正确执行
        δ② PACE（白名单 + 单笔/日限 + 评审上限）
                                │
        δ③ 目标层 L5（用户 EIP-191 签署 objective → 验签 + ε-最优；无签署目标时跳过）
                                │
                    executionHash = keccak(target, value, data)
                    pdrHash = keccak(executionHash, guardrailHash, true)
                    semanticDigest（绑定 agentId/nonce/prev）
        ══════════════════ TEE 信任边界 ══════════════════
                                ▼
        TEE 生成 TDX quote（report_data = semanticDigest，Phala CVM）
                                │ submitReceiptWithQuote → 链上 DCAP 验真 + blockhash 绑定
                                ▼
        challenger 独立重推导（自持策略 + 不 import proposer 任何模块；L1–L5 + 可选交叉模型层）
                                │ validationResponse(requestHash=收据digest, 100/0)
                                ▼
        AegisVaultQuorum._preExecutionHook：response≥100 才放行
                                ▼
        链上硬约束（白名单/限额/日限）→ 真实协议交互（MON→WMON wrap）→ TradeExecuted
```

**为什么 LLM 在 TEE 之外**：威胁模型假设模型完全可被操纵（提示注入、数据投毒）。把可被操纵的东西放进 TEE
只保护它的机密性，不产生"决策正确"的保证。真正的保证是：**同一份决策，由独立的第二套实现（不同代码路径、
可选不同模型家族）重推导，结论一致才执行**。TEE 解决"谁在什么环境跑"，challenger 解决"决策本身是否一致"
——两个正交的信任维度。

## 目录

```
contracts/
  ReceiptRegistry.sol          收据哈希链账本（onlyTEE / submitReceiptWithQuote / blockhash 绑定 / MAX_BLOCK_AGE=100 / bindTranscript 决策原文绑定）
  AegisVault.sol               资金托管 + 链上硬约束 + 死手开关（提现永不冻结）
  AegisVaultQuorum.sol         继承 AegisVault，执行前 challenger quorum 硬闸门
  PolicyRegistry.sol           策略版本注册（链上治理）
  IdentityRegistry.sol         ERC-8004 Identity（自主实现：官方 testnet 无部署）
  ReputationRegistry.sol       ERC-8004 Reputation（giveFeedback/getSummary）
  ValidationRegistry.sol       ERC-8004 Validation（自部署：官方 "coming soon"）
challenger/                    独立验证进程（可整目录拷到另一台机器 = 真 2-of-2）
  verify.mjs                   5 层独立重推导：L1 策略认证 / L2 独立护栏 / L3 独立 PACE / L4 算术+transcript preimage / L5 用户目标层（SOA-lite）
  objective.mjs                L5 独立实现：canonical 目标序列化 + EIP-191 验签 + ε-最优检查（不 import proposer）
  challenger-agent.mjs         轮询链上收据 → 拉决策原文（拉不到=拒绝）→ 重推导 → 独立钱包上链 validation
  llm-challenge.mjs            交叉模型层（可选：MODEL_CHALLENGE=true 开启，须与 proposer 不同家族，默认关闭）
  challenger-policy.json       challenger 自持策略（与 proposer env 严格一致，policy-attest 上链认证）
  policy-attest.mjs            治理侧把认证 guardrailHash 设上链（--execute）
dcap-verifier/                 链上 DCAP 全栈（Automata V4 verifier + PCCS DAO + DcapGate），STATUS.md 完整记录
tee-runtime/                   Agent 循环（双 LLM 隔离管线 → 护栏 → PACE → 目标层 → 收据哈希；objective.mjs = L5 proposer 侧实现）
tee/intee/                     In-TEE 自治闭环（Phala CVM 实测；2026-09-16 改为复用 tee-runtime/challenger 模块，2026-09-18 复跑通过，见 STATUS.md）
orchestrator/                  零依赖服务：读侧（状态/收据/决策原文/SSE）+ 写侧（POST 决策 → 上链）；角色分离：本进程只当 proposer，不持有 challenger 私钥
scripts/                       部署/验证/索引/负例/探测（d6-negative、parity-check、probe-dex、whitelist-wmon…）
test/aegis.test.js             28 个测试（另有 m2m3.test.js 13 个，合计 41）
test/m2m3.test.js              M2 共识提交输入 / M3 承诺-揭示抽选机
dashboard/                     Next.js 14 统一入口（评审动线：总览 → 现场跑一笔 → 独立验证器 → 架构与信任边界 → 收据流）
```

## 已验证里程碑（全部 Monad testnet 实测，非模拟）

| # | 里程碑 | 结果 |
|---|---|---|
| D1 | 真实 TDX quote（Phala Cloud tdx.small）离链验证 | DCAP status=UpToDate，无 advisory |
| D3+ | **链上 DCAP 验证**（Automata V4 + 全套 PCCS） | 真 quote 链上 verifyQuote `success:true` |
| D5 | `submitReceiptWithQuote` 集成 | status=1，哈希链落库 |
| E2E | **In-TEE 自治闭环**（CVM 内无人干预） | 护栏→PACE→读链→quote→上链 |
| — | **ERC-8004 三注册表**（自部署） | agentId=1 注册 + 验证闭环(response=100) + 声誉(getSummary=100) |
| D6 | **负例测试**（9+ 项攻击向量） | 全部被拒；坏 quote 位置扫描 11/13 捕获（2 MISS 均在证书尾部惰性 padding，非签名覆盖区） |
| P1 | **Challenger 独立性包** | 4 层独立重推导（现已扩展到 5 层 / 17 用例）+ 决策原文存证 + fail-closed；角色分离：proposer 不代签 validation；**方向：challenger 侧不 import proposer，反向有一处复用（dry-run 预览）** |
| P2 | **合约 v2 + quote 路径上线** | ReceiptRegistry v2（bindTranscript）+ AegisVaultQuorum v2（executeTrade 由金库自有余额出资）；Phala CVM quote 实时生成 → 链上 DCAP 验真 |
| P3 | **双 LLM 隔离管线 + 跨家族** | 隔离 LLM（无工具）→ 特权 LLM（只吃可信指令+摘要）→ δ 裁决；proposer=deepseek-flash / challenger=glm-5.3-flash（**经网关指纹实测确认不同后端**，见 `scripts/probe-gateway.mjs`；**该端点已于 2026-09-15 删除，交叉模型层现需另配端点**）；parity-check 守住两侧口径 |
| P4 | **真实协议交互路径** | 官方 canonical WMON wrap：LLM intent → `deposit()` calldata → executeTrade（金库余额出资）→ 金库 WMON 0→0.01（四笔 tx 全链实测，见下） |
| P6 | **统一入口 Dashboard（已全面去占位化）** | 评审动线四页 + `/orch/*` 同源代理 + 一键负例（11 向量实测全过）+ 11 个负例浏览器内断言；**全站无编造数字**——所有卡片/表格改读 orchestrator 真实端点或浏览器内直读链上，不存在的功能删除或降级为"设计边界论证"（见下方「Dashboard 诚实口径」） |
| P6b | **真实读数端点（甲/丙档）** | `/api/vault`（余额·限额·日限用量·白名单标的余额）· `/api/vaults`（逐 agent 金库清单）· `/api/agents`（ERC-8004 身份）· `/api/policy`（策略文件 vs 链上已认证 `guardrailHash`）· `/api/exec-stats`（收据聚合 + 逐笔直读 `ValidationRegistry`） |
| P6c | **治理写路径 + 两步确认（乙档）** | `POST /api/admin/*` 与 `POST /api/agents`：不带 `confirm` 只 `estimateGas`（零 gas preview，含预估费用），确认后再广播；`/create` 真实注册 agent、`/policy` 真实改策略并重新认证、`/console` 真实冻结开关 |
| P7 | **SOA-lite 签署目标层（L5）** | 用户 EIP-191 签署客观目标（金额区间/标的/期限/nonce，不签动作）→ 两侧独立实现验签 + ε-最优检查 → `objectiveHash` 经 `bindTranscript` 上链存证；意图漂移/篡改/过期/超签署上限全部被拒；**链上 E2E 已实测 5/5**（见下，`scripts/soa-demo.mjs --onchain`、`selftest 17/17`、`parity 21/21`） |
| — | **攻击族四格 + 代价曲线实验** | 四类攻击者（R1 代换 / 策略后门 / 意图漂移 / 混淆代理）完整验证链实测 7/8 拦下（1 项 = 输入真实性不可能性，设计边界）；L1–L5 全链重推导 ≈2.1–2.7 ms/次（三次实测区间；`scripts/attack-family.mjs`、`scripts/regime-cost.mjs`） |
| — | **Tenderly 公开验证** | 6 个合约源码级 public 验证（vault/receipt/gate/三注册表），合约页与 E2E tx **匿名可开**（见「Tenderly 公开证据」） |

### Phase 4 全链实测（buy WMON 0.01，2026-09-14）

| 步骤 | tx / 结果 |
|---|---|
| submitReceiptWithQuote（绑定 TDX quote） | `0x911bb84e48993e0285ba3119bf6276a91714c2bd6dabf082c122dea08a161408` @62366788 |
| challenger 重推导（4 层全过） | verdict response=100，mismatches=[] |
| validationRequest + validationResponse | `0x1a080156ae15da143757f29b000afc204e8f421e115ac7fbef431ded0e5629e7` / `0xaed419099daed33b950d1dbc3f5b9b0c8056d1dc8bc9c33bb7c04efa8a110cc9` |
| executeTrade（真实 WMON wrap） | `0x1d30e015733474ecb249743033f0a50fec81988efbbdbe6b63c309d34fd3f99b` @62366819 |
| 链上结果 | TradeExecuted target=`0xFb8bf4c1…8541`（官方 WMON）value=0.01 MON，**execHash 与决策 transcript 逐字节一致**；金库 WMON 余额 0 → 0.01 |

策略/白名单治理交易：`setGuardrailHash` `0x2464ea4c…67dce`（gas 42.9k）、`setTarget(WMON)` `0x451e6c13…bad5`（gas 60.6k）。

### SOA-lite 链上 E2E 实测（`--onchain`，2026-09-15）

| 步骤 | tx / 结果 |
|---|---|
| 用户 EIP-191 签署目标 → orchestrator 收据（含 DCAP quote）+ `bindTranscript` | `0xac1a5c8a2f60f2110d005fd4383c4b9b36d75819ac174c6dbd9b7214bbe904de` @62756780（gas 3.48M） |
| receipt digest | `0x85f52983349cac66b0591917a8b4e986abb73c4633976ee9f1675fd5ce3dc740` |
| `TranscriptBound` uri（= 签署的 objectiveHash） | `aegis://objective/0x7d3789c5e4e9be100fa4f8a621cd587c11d1d4a8062544496ecf56cc21e51648` |
| challenger 重推导（L1–L5 全过）→ validationResponse=100 | `0x0cd3f6a9a63e3130308b0e4ecd8cd6aad51f2111146ce4c47ac76701f8d2e60e` |
| executeTrade（真实 WMON wrap） | `0x03a754cf73610a2350a5658e4a1fc90909ca8afbe585bdb9f90f767b81a5f388` @62756812 |
| 链上结果 | TradeExecuted target=WMON amount=1e16，**执行落在用户签署目标内（L5 重推导确认）**；金库 WMON 0.01 → 0.02 |
| 三负例（链前拒，零 gas） | 漂移 `objective_exceeds_max`+`objective_not_eps_optimal:dev=1e16` / 篡改 `objective_bad_signature` / 过期 `objective_expired` |

> 本次实跑暴露并修复 3 个真实 bug：① deepseek-flash 为推理模型，max_tokens 预算被 reasoning 吃光 → 空 content → fail-closed 误拒（统一 `LLM_MAX_TOKENS=2000`）；② `tx.wait()` 后读 `lastReceiptHash` 命中滞后 RPC 后端 → bindTranscript 用旧 digest 估价 revert（改为客户端预算 expectedDigest + 轮询对齐）；③ orchestrator HTTP 异常静默无日志（现 catch-all 打印）。

### v5 全链 E2E（buy WMON 0.01，2026-09-20，当前生产地址）

上面两个 E2E 走的是 v2/v3 时代地址（已废弃，保留作历史）。**当前生产地址 `AegisVaultQuorum 0x3aBbb284…b89De`（v5：registry 可换 + 余额检查上线）的 E2E 结果**：

| 步骤 | tx / 结果 |
|---|---|
| 金库 `deposit()` 注资 | `0x75b9d614…915b`，金库 MON 0 → 0.5 |
| 收据提交（`submitReceiptWithQuote`，链上 DCAP 验真） | `0xda7a711711244c7d81283c231d5b79e27b6fab05ce1229ac1abd9e88385fe831`（gas 3,477,266），digest `0x690fd212…2f1619` |
| challenger 独立重推导（L1–L4 全过） | `agree: true` / `response: 100`，四层 `1_policy`/`2_guardrail`/`3_pace`/`4_arithmetic` 无 mismatch |
| validationRequest + validationResponse | `0x0a41dbcb…761c1` / `0x98fe4af5…cdfac`（status 1） |
| executeTrade（金库余额出资） | `0x7e6e71d34e6ca04f465d565252eac5edd2997af1d1cebecc9f0b68896d2544ef`（gas 183,708），`execution.status: "executed"` |
| 链上结果 | 金库 **WMON 0 → 0.010000**，MON **0.5 → 0.49** |

> 该笔在真实执行路径上验证了 v5 的全部合约层性质：验证者白名单（`isTrustedValidator`，未授权一律 revert）、交易槽钩子（读 `lastTradeReceipt`，心跳不再顶掉在途交易）、`executeTrade` 金库余额显式检查（`Insufficient vault balance`，链上首次生效）、以及 `setReceiptRegistry` 可变绑定的部署态（`registry()` 读回 `0x4622D041…`）。

### Tenderly 公开证据（匿名可查，评委直接核验）

6 个自部署核心合约已在 Tenderly Monad Testnet **源码级公开验证**（`"public": true`，含精确编译设置）：

| 合约 | Tenderly 合约页（无需登录） |
|---|---|
| AegisVaultQuorum `0x3aBbb284…b89De`（v5） | https://dashboard.tenderly.co/contract/monad-testnet/0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De |
| ReceiptRegistry `0x4622D041…9c90B` | https://dashboard.tenderly.co/contract/monad-testnet/0x4622D041696942dC873a8A5E54f1e1ca9669c90B |
| DcapGate `0xAe58A4F6…fc66F` | https://dashboard.tenderly.co/contract/monad-testnet/0xAe58A4F6DD3E2810812193D4766f11d5F3Dfc66F |
| ValidationRegistry `0x8b96a09e…be0cEa` | https://dashboard.tenderly.co/contract/monad-testnet/0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa |
| IdentityRegistry `0xC99D2957…81A74` | https://dashboard.tenderly.co/contract/monad-testnet/0xC99D2957fdA1455E68dF2181A4bB97fd73081A74 |
| ReputationRegistry `0xb5B853Bc…5c9f` | https://dashboard.tenderly.co/contract/monad-testnet/0xb5B853BcE92940b8E5BFba131301509eaCFb5c9f |

该 E2E 的三笔关键 tx 在 Tenderly 里可直接看到**源码级调用栈**（`_preExecutionHook` 的 response≥100 闸门 → WMON `deposit()`）：

| 步骤 | Tenderly 链接 |
|---|---|
| 收据提交（链上 DCAP 验真） | https://dashboard.tenderly.co/tx/0x911bb84e48993e0285ba3119bf6276a91714c2bd6dabf082c122dea08a161408 |
| 挑战者裁决（validationResponse） | https://dashboard.tenderly.co/tx/0xaed419099daed33b950d1dbc3f5b9b0c8056d1dc8bc9c33bb7c04efa8a110cc9 |
| 执行（TradeExecuted） | https://dashboard.tenderly.co/tx/0x1d30e015733474ecb249743033f0a50fec81988efbbdbe6b63c309d34fd3f99b |

匿名可查性实测（无任何凭据、无重定向到登录页）：

```bash
curl -s https://api.tenderly.co/api/v1/public-contracts/10143/0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De
# => "public":true, "contract_name":"AegisVaultQuorum", "type":"contract",
#    "verification_date":"2026-09-20T13:22:24Z", "compiler_version":"v0.8.24", "evm_version":"paris",
#    "optimizations_used":true, "optimization_runs":200, "main_contract":1,
#    compiler_settings{"optimizer":{"enabled":true,"runs":200},"evmVersion":"paris","viaIR":true}
# 上表 6 个地址同构可查（把末尾地址换成任意一个即可复测）
```

> v5 于 2026-09-20 完成源码级公开验证（`verification_date = 2026-09-20T13:22:24Z`，匿名实测
> `"public":true`）；验证源码含 v5 两处标记（`setReceiptRegistry` 与 `Insufficient vault balance`），
> 三个源文件匿名可下载。上传前先用
> `node scripts/tenderly-prep.mjs` 做本地重编译 → 链上 runtime 逐字节 diff，并用
> `node scripts/diff-immutables.mjs` 把差异逐簇归类：差异应全部落在 20 字节 address immutable
> 槽 + 1 字节标志位（构造期写入），**「未归类簇 = 0」才判源码一致**。注意 `tenderly-prep.mjs`
> 的 `MISMATCH` 阈值是 128 字节，对 immutable 较多的合约会**误报**，不要只看阈值。

重新部署/新增合约后可重生成上传件并复核（流程 2026-09-15 首次实操 / 2026-09-16 用于 v4 / 2026-09-20 用于 v5）：

1. 入口：合约页 `https://dashboard.tenderly.co/contract/monad-testnet/<地址>` → **Source code** → **Verify Contract**（无需 tx 调试器）
2. Visibility 选 **Public** → Source Code 选 **JSON Upload** → 粘贴下面的 standard JSON → Review 勾选目标合约 → Compiler Version 选 `solc v0.8.24` → Finish
3. 注：Optimizer / Optimization Count / EVM Version / ViaIR 会从 JSON 的 `settings` 自动带出，但 **Compiler Version 必须手选**（不会自动带出）

```bash
node scripts/tenderly-prep.mjs artifacts/build-info/<buildInfo>.json <ContractName> <0xAddr> --dump out.json
node scripts/dcap-standard-input.mjs   # DcapGate 单文件 standard JSON + 与链上 runtime 逐字节 diff
```

## 真实协议路径（Phase 4）为什么是 WMON

重置后的 Monad testnet（2025-12-16 genesis reset）无法核实任何第三方 DEX router：
Uniswap v2/v3/v4 全系 canonical 地址链上实测 `codeLen=0`（`scripts/probe-dex.mjs`），
Kuru 等生态部署无法核实。官方文档 canonical 的 WMON
（`0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541`，链上核实 name/symbol/decimals）是当前唯一可核实的
第三方协议交互目标。**wrap 是任何真实 swap 的第一步**（MON→WMON→token）；接第三方 DEX 只差一个
已验证流动性的 router，路径其余部分（intent→calldata→PACE→收据→互证→executeTrade）已全部打通。

## 运行

```powershell
npm install
npx hardhat compile   # evm target: paris（MCOPY 坑）
npx hardhat test      # 44/44

# Challenger（独立进程；部署到另一台机器即成真 2-of-2，见 challenger/README.md）
node challenger/challenger-agent.mjs          # 常驻轮询
node challenger/selftest.mjs                  # 17 用例离线自测（L1–L5 全覆盖）

# SOA-lite 签署目标（draft → 用户签名 → 四场景裁决；默认零 gas）
node scripts/soa-demo.mjs                     # 诚实/漂移/篡改/过期；orchestrator 在跑则走 HTTP
node scripts/soa-demo.mjs --onchain           # 真实上链版（5/5 实测；需 orchestrator + challenger 在跑，≈0.37 MON）
node scripts/soa-sign.mjs draft.json          # 「用户」侧签名（真实部署中运行在用户设备上）
node scripts/attack-family.mjs                # 攻击族四格实测（含 1 项诚实的"拦不住"）
node scripts/regime-cost.mjs                  # 谱系代价曲线（δ/目标层/菜单扫描实测 + 覆盖网合成）

# 策略变更流程：改 challenger-policy.json + orchestrator .env → 两侧同步 →
node challenger/policy-attest.mjs --execute   # 认证 guardrailHash 上链（治理钱包）

# Orchestrator（proposer；默认 :8787）
node orchestrator/server.mjs
# 读: GET /api/status | /api/config | /api/receipts | /api/decision/:digest | /api/pipeline | /api/events (SSE)
#     GET /api/vault | /api/vaults | /api/agents | /api/policy | /api/exec-stats   （金库/身份/策略/执行统计真实读数）
# 写: POST /api/agent/command?agentId=1  body: {"command":"buy WMON 0.01","dryRun":false,"execute":true}
#      dryRun 预览（零 gas）/ 真实上链 / tamperExecHash 作恶演示
#      body 可附 objective + objectiveSignature（SOA-lite 签署目标，见 scripts/soa-sign.mjs）
# 治理写: POST /api/admin/<op> / POST /api/agents —— 不带 confirm 只 estimateGas（零 gas preview），带 confirm 才广播
# 目标草稿: POST /api/objective/draft  body: {"command":"buy WMON 0.01","marketData":"..."}

# 口径一致性（改 normalize/护栏/PACE/目标层后必跑）
node scripts/parity-check.mjs                 # proposer 预览 vs challenger 重推导，漂移即 exit 1（21 用例：14 护栏/PACE + 7 目标层）
node scripts/d6-negative.mjs                  # 8 项攻击向量 + 1 正例对照（真实上链 fresh 合约，~0.15 MON gas）

# 统一入口 Dashboard（评审从这里看）
cd ../dashboard && npm install && npm run build && npm start
# 浏览器：/ → 现场跑一笔 /try → 独立验证器 /verify → 架构与信任边界 /architecture → 收据流 /receipts
```

## 安全属性（合约层，44/44 测试覆盖）

| 属性 | 位置 |
|---|---|
| 收据只能由授权 TEE 写入（`onlyTEE`） | ReceiptRegistry |
| 任何人可代提交但须链上验真 quote + `report_data` 绑定摘要 | ReceiptRegistry.submitReceiptWithQuote |
| 收据哈希链 + `blockhash()` 双绑定 + per-agent nonce 防重放 | ReceiptRegistry |
| 决策原文绑定（transcriptHash 上链，challenger 拉取核对，拉不到=拒绝） | ReceiptRegistry.bindTranscript |
| 执行体必须匹配收据 `executionHash`（PACE 绑定） | AegisVault |
| 白名单 / 单笔 / 日限额（含真实 value 传递） | AegisVault |
| 死手开关：失活冻结 + 提现永不冻结 | AegisVault |
| **执行前 challenger 互证 quorum**：最新收据须被独立验证者以 response≥100 背书 | AegisVaultQuorum |

## Challenger 独立性（2-of-2 的"2"从哪来）

- **零共享代码（方向说明）**：challenger 侧严格成立——`challenger/` 是自包含目录，自持策略 JSON、独立钱包、
  独立 5 层实现（L1–L4 确定性重推 + L5 目标层验签/ε-算术，全部零 LLM 依赖），**不 import proposer 的任何模块**。
  反向不成立：`orchestrator/server.mjs` 为复用裁决逻辑而 import 了 `challenger/verify.mjs` 的
  `verifyDecision`/`attestedGuardrailHash`（dry-run 预览走这份代码）。因此 `scripts/parity-check.mjs` 的覆盖方向是
  **proposer 预览 → challenger 裁决**，challenger 单方面改口径不会被该守卫检出；生产 `execute=true` 路径的护栏判定
  用的是 `server.mjs` 自持的 `INJECTION_PATTERNS`（5 条，与 challenger 逐条一致，改动需两侧同步）。
  守卫覆盖：14 个护栏/PACE 用例 + 7 个目标层用例，同批输入喂两侧，"拒/放"结论不一致即失败（漂移即 exit 1）
- **交叉模型层（可选，默认关闭）**：challenger 可另配一个与 proposer 不同家族的模型独立提议
  （`llm-challenge.mjs`，`MODEL_CHALLENGE=true` 开启）。**"不同模型名"不等于"不同后端"**——同一网关可能
  把不同名字路由到同一模型；2026-09-13 曾以 token 指纹探测确认当时两侧后端互斥（`scripts/probe-gateway.mjs`）。
  该端点已于 2026-09-15 删除，启用交叉模型层需另配可达端点（如另一家 API / 本地小模型）
- **角色分离**：orchestrator 只当 proposer，不持有 challenger 私钥、不代签 validation；
  challenger 部署到独立机器（`challenger/README.md`）即成真 2-of-2
- **fail-closed**：决策原文拉不到 → 拒绝；on-chain transcriptHash 不匹配 → 拒绝；无法裁决（agree=null）→ 不签发
- **进程加固**：全局 `unhandledRejection` 接管（RPC 抖动不再杀死进程）；`MAX_BLOCK_AGE=100` 容忍读锚点→上链往返

## SOA-lite：用户签署目标（L5 层）

护栏和 PACE 保证"LLM 没有越权"，但**不保证它做的是用户想要的**——一笔完全合规的交易可能是幻觉或被注入的产物。
SOA-lite 把用户的**目标**（而非动作）变成签署对象：用户对目标 u 做 EIP-191 签名，u 包含
`{v,kind,user,asset,target,desiredWei,maxWei,tolWei,deadline,nonce}`，challenger L5 层独立验签并检查
执行金额落在 `[desired±tol, max]` 区间内。

- **draft-then-sign**：agent 起草目标草案（`POST /api/objective/draft`）→ 用户在**自己设备上**审阅并签名
  （`scripts/soa-sign.mjs`；真实部署中用户私钥不离开用户设备）→ 目标随决策一起提交
- **判据仍是确定性的**：验签 + 区间算术，任何人可复现；challenger 侧独立实现在 `challenger/objective.mjs`（不 import `tee-runtime/objective.mjs`）
- **链上证据**：`objectiveHash` 经 `ReceiptRegistry.bindTranscript` 的 uri 字段上链
  （`aegis://objective/<hash>`），决策收据可溯到用户签署的目标
- **拒绝语义**：`objective_bad_signature`（字段被篡改）/ `objective_expired`（期限已过）/
  `objective_not_eps_optimal:dev=<wei>`（意图漂移）/ `objective_exceeds_max` / `objective_unsatisfiable` /
  `objective_target_mismatch`
- **实验**：`scripts/soa-demo.mjs`（诚实/漂移/篡改/过期四场景；`--onchain` 真实上链版 **5/5 实测**，
  收据 `0xac1a5c8a…` → `TranscriptBound(aegis://objective/0x7d3789c5…)` → validation 100 →
  `executeTrade` `0x03a754cf…`，金库 WMON 0.01→0.02，见「SOA-lite 链上 E2E 实测」）、
  `scripts/attack-family.mjs`（意图漂移两格）、
  `scripts/regime-cost.mjs`（L5 验签+ε ≈1.6–2.2 ms/次，全链 L1–L5 ≈2.1–2.7 ms/次；三次实测区间）

诚实边界：链上尚未把 objectiveHash 作为 revert 条件（当前为收据存证层证据，强制在两侧重推导完成）；
standing authorization 的 replay 防护由 nonce + deadline 收敛，链上防重放是 future work。

## 已知边界（诚实清单）

- **LLM 跑在 TEE 之外**（proposer 侧）——刻意的，见"信任边界"；TEE 内只跑 quote 生成
- **当前"真实协议交互"= WMON wrap**，非第三方 DEX swap：重置后 testnet 无可核实的 DEX router（见上）；
  challenger 当前验证的是策略合规性 + transcript 绑定 + 签署目标的 ε-一致性（L5），不是完整重推导 LLM 的推理过程
- **输入真实性不可验证（不可能性边界）**：challenger 验证"决策与给定输入/签署目标一致"，但无法判定输入本身
  是否被代换（论文 R1 不可能性结果）；`scripts/attack-family.mjs` 第一格刻意展示这一"拦不住"
- **challenger 经济模型未设计**（谁付钱、作恶罚没——未来工作）；当前单 challenger = 2-of-2，扩展为
  声誉加权 k-of-n 是自然延伸
- **Dashboard 上"结构上不能做"的三项产品功能**（已从假 UI 改为页内边界论证，见下节）：策略跟投
  （无第二个出资方槽位）、per-role 子账户（角色共享同一金库余额）、多 agent 规模化（1 agent = 1 金库，
  `agentId` immutable）——这些是设计边界，**不是待办，也不是已实现**
- ERC-8004 官方 Registry 在 Monad testnet 无部署（`codeLen=0`），按 EIP 接口自主实现三注册表
- quote 尾部 ~100 hex chars（证书后惰性 padding）verifier 不校验——非签名覆盖区，无实际风险
- TEE 运行时 OPA/Membrane 阶段二三未实现（可插拔结构）
- LLM 主用官方 DeepSeek API（`api.deepseek.com`，2026-09-15 起，校外可达）；**校园网关已删除**——
  challenger 可选交叉模型层需另配可达端点（默认关闭，不影响 L1–L5 确定性重推导）；端点 503/超时时
  管线 fail-closed 返回 refuse（不猜不兜底），重试即可；任何端点不可达时自动降级 mock（如实标注 mode=mock）

## Dashboard 诚实口径（全站无编造数字）

评审动线依赖"页面上写的就是链上发生的"，因此 dashboard 的每一条数字都必须有来源。分三类处理：

| 类别 | 处理 | 页面 |
|---|---|---|
| **真实读数** | 走 orchestrator 只读端点或浏览器内用公共 RPC 直读链上 | `/` `/dashboard` `/receipts` `/verify` `/architecture` `/funds` `/audit` `/notifications` `/console` `/policy` `/vaults` `/market` `/backtest` `/try` |
| **真实读数 + 显式边界论证** | 产品功能在本架构下结构上不能做 → 给真实读数 + 页内逐条论证"为什么没有这个按钮" | `/copy`（策略跟投）· `/subaccounts`（per-role 子账户）· 部分 `/vaults`（多 agent） |
| **已删除** | 找不存在的功能直接删掉，不留死 UI | npm 包 `@aegis/sdk`（改为五组真实可调用接口）· `/settings` 的全部假开关与"导出私钥"按钮 · `/console` 伪造的 TEE 度量值（MRTD/RTMR0/FMSPC/TCB）· `/notifications` 的预设通知 |

**硬规则（改 dashboard 时照做）**：
1. 端点不可达一律显示"离线"，**绝不回退到看起来像真数据的占位值**（`dashboard/src/lib/aegis.ts` 的 `get()` 返回 `null`）
2. 每个数字能答出"从哪个端点/哪条 tx 来的"；答不出就删
3. 未实现的功能标「（未实现）」或删除，不留一个点了没反应的按钮
4. 链上地址从 `api.config()` 插值，不硬编码（策略/金库地址换版后页面自动跟随）
5. `nav.ts` 的分组名即诚实声明——「设计边界（真实读数 + 边界论证）」组的页面，**数据真实但功能不承诺**

> 历史教训（保留作前车之鉴）：2026-09-16 首轮标注只覆盖了 6 个愿景页，漏了 `console`/`audit`/`sdk`/`notifications`/`settings`
> 五页，其中 `console` 的伪造 TEE 度量值与 `audit` 的"12,480 条记录"最伤可信度。**"改了愿景页"必须按 `nav.ts` 清单逐页核对**，不能按已改页数报完成。本轮（2026-09-20）已把余下页面全部去 mock，`mock.ts` 的编造 fixtures 删除。

## Monad 特性实测记录（别的链上踩不到的坑）

| 坑 | 结论 |
|---|---|
| **MCOPY 行为不正确** | 必须用 `evm target: paris` 编译 |
| **Multicall3 内层 `msg.sender` 失效** | 不用 multicall，逐笔调用 |
| **`eth_getLogs` 严格限 100 块**（-32614/413） | JSON-RPC batch + 100 块窗口回扫 |
| **RPC 间歇 `-32603 Archive error`** | FallbackProvider（官方 + Ankr，quorum=1）+ challenger 全局 unhandledRejection 接管 |
| **`fetch` 无默认超时永久挂起** | 一律 `AbortSignal.timeout(...)` |
| ethers v6 同名重载 | 用完整函数签名做 key；事件 topic 用完整签名运行时计算 |
| **testnet 2025-12-16 从创世重置** | 重置前所有第三方合约地址（博客级 DEX 教程等）全部作废，接手者勿信 |
| MAX_BLOCK_AGE 标定 | 8 块不够 → 100 块（v2 合约） |

## 部署地址（Monad testnet, chainId 10143）

| 合约 | 地址 |
|---|---|
| ReceiptRegistry（v2：bindTranscript + MAX_BLOCK_AGE=100） | `0x4622D041696942dC873a8A5E54f1e1ca9669c90B` |
| DcapGate | `0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F` |
| ERC-8004 IdentityRegistry（自部署） | `0xC99D2957fdA1455E68dF2181A4bB97fd73081A74` |
| ERC-8004 ReputationRegistry（自部署） | `0xb5B853BcE92940b8E5BFba131301509eaCFb5c9f` |
| ERC-8004 ValidationRegistry（自部署） | `0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa` |
| **AegisVaultQuorum（v5：registry 可换 + 验证者白名单 + 交易槽钩子 + 余额检查）** | `0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De` |
| WMON（官方 canonical，P4 目标） | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` |

其余（DCAP 全栈 14+ 合约、历史 tx 哈希与 gas）见 `dcap-verifier/STATUS.md`。
其中全部 6 个自部署核心合约（AegisVaultQuorum / ReceiptRegistry / DcapGate / ValidationRegistry / IdentityRegistry / ReputationRegistry）已在 Tenderly 源码级公开验证（证据链接见上方「Tenderly 公开证据」）。
旧 v1 地址（ReceiptRegistry `0x91482e67…`、Vault `0x60F9F1FB…`）已废弃，勿引用。
`AegisVaultQuorum` 历史版本：v2 `0xe6E24BB7…533D7`（缺验证者白名单——`ValidationRegistry` 无需许可，可自证自答伪造 quorum）、v3 `0x3e5dDe45…3eBa19`（有白名单但钩子读链头，心跳顶掉链头后 executeTrade 全 revert）、v4 `0x07Be2FCd…B65bc`（两项均已修，但 `registry` 仍是 immutable，`ReceiptRegistry` 一旦需要更换就必须 withdraw→redeploy、金库地址与全部历史作废；余额检查也只在源码、未上链），三者均已废弃。
