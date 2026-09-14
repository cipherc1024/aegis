# Aegis — TEE-Attested Autonomous Trading Agent (Monad Metropolis, Track 04)

> **Agent 必须证明它听话了。**
> LLM 自治交易的核心信任缺口：用户凭什么相信一个黑盒 Agent 拿着你的钱在交易？
> Aegis 的答案：不让 AI 直接动钱——安全关键路径是**确定性谓词 δ**（护栏 + PACE），LLM 只当 proposer；
> 每一笔决策生成绑定区块高度的 TEE 收据（DCAP quote 的 `report_data` = 决策摘要），并由**独立 challenger**
> 用自己的代码 + 另一家族的模型重推导同一结论，2-of-2 一致才放行执行。任何人在 Monad 链上即可独立验证。

对应策略文档 `../第四版策略.md`。
**状态：18/18 单测 + challenger selftest 11/11 + parity 10/10 + 全链路 Monad testnet 实测（见"已验证里程碑"）。**

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
                    executionHash = keccak(target, value, data)
                    pdrHash = keccak(executionHash, guardrailHash, true)
                    semanticDigest（绑定 agentId/nonce/prev）
        ══════════════════ TEE 信任边界 ══════════════════
                                ▼
        TEE 生成 TDX quote（report_data = semanticDigest，Phala CVM）
                                │ submitReceiptWithQuote → 链上 DCAP 验真 + blockhash 绑定
                                ▼
        challenger 独立重推导（自持策略 + 另一家族模型，零共享代码）
                                │ validationResponse(requestHash=收据digest, 100/0)
                                ▼
        AegisVaultQuorum._preExecutionHook：response≥100 才放行
                                ▼
        链上硬约束（白名单/限额/日限）→ 真实协议交互（MON→WMON wrap）→ TradeExecuted
```

**为什么 LLM 在 TEE 之外**：威胁模型假设模型完全可被操纵（提示注入、数据投毒）。把可被操纵的东西放进 TEE
只保护它的机密性，不产生"决策正确"的保证。真正的保证是：**同一份决策，由零共享代码、不同模型家族的
challenger 独立重推导，结论一致才执行**。TEE 解决"谁在什么环境跑"，challenger 解决"决策本身是否一致"
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
  verify.mjs                   4 层独立重推导：L1 策略认证 / L2 独立护栏 / L3 独立 PACE / L4 算术+transcript preimage
  challenger-agent.mjs         轮询链上收据 → 拉决策原文（拉不到=拒绝）→ 重推导 → 独立钱包上链 validation
  llm-challenge.mjs            可选 L5 跨模型层（MODEL_CHALLENGE=true 开启，默认关闭 = 与 Phase 2 行为逐字节一致）
  challenger-policy.json       challenger 自持策略（与 proposer env 严格一致，policy-attest 上链认证）
  policy-attest.mjs            治理侧把认证 guardrailHash 设上链（--execute）
dcap-verifier/                 链上 DCAP 全栈（Automata V4 verifier + PCCS DAO + DcapGate），STATUS.md 完整记录
tee-runtime/                   Agent 循环（双 LLM 隔离管线 → 护栏 → PACE → 收据哈希）
tee/intee/                     In-TEE 自治闭环（Phala CVM 实测）
orchestrator/                  零依赖服务：读侧（状态/收据/决策原文/SSE）+ 写侧（POST 决策 → 上链）；角色分离：本进程只当 proposer，不持有 challenger 私钥
scripts/                       部署/验证/索引/负例/探测（d6-negative、parity-check、probe-dex、whitelist-wmon…）
test/aegis.test.js             18 个测试
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
| P1 | **Challenger 独立性包** | 4 层独立重推导 + 决策原文存证 + fail-closed（11 用例自测全过）；角色分离：proposer 不代签 validation |
| P2 | **合约 v2 + quote 路径上线** | ReceiptRegistry v2（bindTranscript）+ AegisVaultQuorum v2（executeTrade 带 value）；Phala CVM quote 实时生成 → 链上 DCAP 验真 |
| P3 | **双 LLM 隔离管线 + 跨家族** | 隔离 LLM（无工具）→ 特权 LLM（只吃可信指令+摘要）→ δ 裁决；proposer=deepseek-flash / challenger=glm-5.3-flash（**经网关指纹实测确认不同后端**，见 `scripts/probe-gateway.mjs`）；parity-check 守住两侧口径 |
| P4 | **真实协议交互路径** | 官方 canonical WMON wrap：LLM intent → `deposit()` calldata → executeTrade{value} → 金库 WMON 0→0.01（四笔 tx 全链实测，见下） |
| P6 | **统一入口 Dashboard** | 评审动线四页 + `/orch/*` 同源代理 + 一键负例（11 向量实测全过）+ 11 个负例浏览器内断言 |

### Phase 4 全链实测（buy WMON 0.01，2026-09-14）

| 步骤 | tx / 结果 |
|---|---|
| submitReceiptWithQuote（绑定 TDX quote） | `0x911bb84e48993e0285ba3119bf6276a91714c2bd6dabf082c122dea08a161408` @62366788 |
| challenger 重推导（4 层全过） | verdict response=100，mismatches=[] |
| validationRequest + validationResponse | `0x1a080156ae15da143757f29b000afc204e8f421e115ac7fbef431ded0e5629e7` / `0xaed419099daed33b950d1dbc3f5b9b0c8056d1dc8bc9c33bb7c04efa8a110cc9` |
| executeTrade（真实 WMON wrap） | `0x1d30e015733474ecb249743033f0a50fec81988efbbdbe6b63c309d34fd3f99b` @62366819 |
| 链上结果 | TradeExecuted target=`0xFb8bf4c1…8541`（官方 WMON）value=0.01 MON，**execHash 与决策 transcript 逐字节一致**；金库 WMON 余额 0 → 0.01 |

策略/白名单治理交易：`setGuardrailHash` `0x2464ea4c…67dce`（gas 42.9k）、`setTarget(WMON)` `0x451e6c13…bad5`（gas 60.6k）。

## 真实协议路径（Phase 4）为什么是 WMON

重置后的 Monad testnet（2025-12-16 genesis reset）无法核实任何第三方 DEX router：
Uniswap v2/v3/v4 全系 canonical 地址链上实测 `codeLen=0`（`scripts/probe-dex.mjs`），
Kuru 等生态部署无法核实。官方文档 canonical 的 WMON
（`0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541`，链上核实 name/symbol/decimals）是当前唯一可核实的
第三方协议交互目标。**wrap 是任何真实 swap 的第一步**（MON→WMON→token）；接第三方 DEX 只差一个
已验证流动性的 router，路径其余部分（intent→calldata→PACE→收据→互证→executeTrade{value}）已全部打通。

## 运行

```powershell
npm install
npx hardhat compile   # evm target: paris（MCOPY 坑）
npx hardhat test      # 18/18

# Challenger（独立进程；部署到另一台机器即成真 2-of-2，见 challenger/README.md）
node challenger/challenger-agent.mjs          # 常驻轮询
node challenger/selftest.mjs                  # 11 用例离线自测

# 策略变更流程：改 challenger-policy.json + orchestrator .env → 两侧同步 →
node challenger/policy-attest.mjs --execute   # 认证 guardrailHash 上链（治理钱包）

# Orchestrator（proposer；默认 :8787）
node orchestrator/server.mjs
# 读: GET /api/status | /api/config | /api/receipts | /api/decision/:digest | /api/pipeline | /api/events (SSE)
# 写: POST /api/agent/command?agentId=1  body: {"command":"buy WMON 0.01","dryRun":false,"execute":true}
#      dryRun 预览（零 gas）/ 真实上链 / tamperExecHash 作恶演示

# 口径一致性（改 normalize/护栏/PACE 后必跑）
node scripts/parity-check.mjs                 # proposer 预览 vs challenger 重推导，漂移即 exit 1
node scripts/d6-negative.mjs                  # 9 项攻击向量负例

# 统一入口 Dashboard（评审从这里看）
cd ../dashboard && npm install && npm run build && npm start
# 浏览器：/ → 现场跑一笔 /try → 独立验证器 /verify → 架构与信任边界 /architecture → 收据流 /receipts
```

## 安全属性（合约层，18/18 测试覆盖）

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

- **零共享代码**：challenger 自持策略与 4 层重推导，与 proposer 无任何共享模块；代价是口径漂移风险，
  由 `scripts/parity-check.mjs` 守住（同批输入喂两侧，"拒/放"结论不一致即失败）
- **模型家族独立**：proposer=deepseek-flash / challenger=glm-5.3-flash。**"不同模型名"不等于"不同后端"**
  ——同网关可能把不同名字路由到同一模型。已用 token 指纹探测实测确认两侧后端独立
  （`scripts/probe-gateway.mjs`：deepseek 与 glm 输出指纹互斥，其余候选名共享后端）
- **角色分离**：orchestrator 只当 proposer，不持有 challenger 私钥、不代签 validation；
  challenger 部署到独立机器（`challenger/README.md`）即成真 2-of-2
- **fail-closed**：决策原文拉不到 → 拒绝；on-chain transcriptHash 不匹配 → 拒绝；无法裁决（agree=null）→ 不签发
- **进程加固**：全局 `unhandledRejection` 接管（RPC 抖动不再杀死进程）；`MAX_BLOCK_AGE=100` 容忍读锚点→上链往返

## 已知边界（诚实清单）

- **LLM 跑在 TEE 之外**（proposer 侧）——刻意的，见"信任边界"；TEE 内只跑 quote 生成
- **当前"真实协议交互"= WMON wrap**，非第三方 DEX swap：重置后 testnet 无可核实的 DEX router（见上）；
  challenger 当前验证的是策略合规性 + transcript 绑定，不是完整重推导 LLM 选出的指令序列
- **challenger 经济模型未设计**（谁付钱、作恶罚没——未来工作）；当前单 challenger = 2-of-2，扩展为
  声誉加权 k-of-n 是自然延伸
- ERC-8004 官方 Registry 在 Monad testnet 无部署（`codeLen=0`），按 EIP 接口自主实现三注册表
- quote 尾部 ~100 hex chars（证书后惰性 padding）verifier 不校验——非签名覆盖区，无实际风险
- TEE 运行时 OPA/Membrane 阶段二三未实现（可插拔结构）
- USTC 校园网 LLM 网关偶发 503/超时——管线 fail-closed 返回 refuse（不猜不兜底），重试即可；
  网关不可达时自动降级 mock（如实标注 mode=mock）

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
| **AegisVaultQuorum（v2：executeTrade 带 value）** | `0xe6E24BB72a4a327b7A7E7aA025A04eBc5a6533D7` |
| WMON（官方 canonical，P4 目标） | `0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541` |

其余（DCAP 全栈 14+ 合约、历史 tx 哈希与 gas）见 `dcap-verifier/STATUS.md`。
旧 v1 地址（ReceiptRegistry `0x91482e67…`、Vault `0x60F9F1FB…`）已废弃，勿引用。
