# Aegis — TEE-Attested Autonomous Trading Agent (Monad Metropolis, Track 04)

> **每一个交易决策都携带可在链上验证的 Intel TDX 硬件证明。**
> LLM 自治交易的核心信任缺口：用户凭什么相信一个黑盒 Agent 拿着你的钱在交易？
> Aegis 的答案：决策在 TEE 内运行，每一步动作生成 DCAP quote，其 `report_data` 绑定收据摘要，任何人在 Monad 链上即可验证——无需信任 Agent 运营方。

对应策略文档 `../第四版策略.md`。**状态：15/15 单测 + 全链路在 Monad testnet 实测通过（见下"已验证里程碑"）。**

## 架构

```
┌─ TEE (Phala CVM, TDX) ─────────────────────────┐
│ 护栏净化 → 双 LLM 隔离 → PACE 确定性验证        │
│ → semanticDigest → TDX quote(report_data=摘要) │
└──────────────────┬─────────────────────────────┘
                   │ submitReceiptWithQuote(quote)
┌──────────────────▼─────────────────────────────┐    ┌─ Dashboard ─┐
│ ReceiptRegistry ─ 哈希链 + DCAP 门控           │◄───│ 三态状态/    │
│ AegisVault ───── 死手开关 + 执行哈希绑定       │    │ 哈希链可视化 │
│ PolicyRegistry ── 非对称策略升级               │    └─────────────┘
│ ValidationRegistry (ERC-8004)                   │
│ IdentityRegistry (ERC-8004)  ReputationRegistry │
│ DcapGate → Automata V4QuoteVerifier (链上 DCAP)│
└────────────────────────────────────────────────┘
```

## 目录

```
contracts/
  ReceiptRegistry.sol          收据哈希链账本（onlyTEE / submitReceiptWithQuote / blockhash 绑定 / per-agent nonce / 心跳槽）
  AegisVault.sol               资金托管 + 链上硬约束 + 死手开关（提现永不冻结）
  PolicyRegistry.sol           策略版本注册（链上治理）
  IdentityRegistry.sol         ERC-8004 Identity（自主实现：ERC-721+URIStorage+agentWallet）
  ReputationRegistry.sol       ERC-8004 Reputation（giveFeedback/getSummary）
  ValidationRegistry.sol       ERC-8004 Validation（自部署：官方"coming soon"）
dcap-verifier/                 链上 DCAP 全栈（Automata V4 verifier + PCCS DAO + DcapGate），STATUS.md 有完整记录
tee-runtime/                   Agent 循环（护栏 → 双 LLM 隔离 → PACE → 收据哈希）
tee/intee/                     In-TEE 自治闭环（Phala CVM 实测）
orchestrator/                  零依赖服务：读侧（状态/收据/SSE）+ 写侧（POST 决策 → 上链）
scripts/                       部署/验证/索引/负例测试（d6-negative、erc8004、index-receipts…）
test/aegis.test.js             15 个测试
dashboard/                     Next.js 14 前端（17 页，三态状态条 + 哈希链可视化 + 独立验证器）
```

## 已验证里程碑（全部 Monad testnet 实测，非模拟）

| # | 里程碑 | 结果 |
|---|---|---|
| D1 | 真实 TDX quote（Phala Cloud tdx.small）离链验证 | DCAP status=UpToDate，无 advisory |
| D3 | Monad 区块 gas 上限 150M；P-256 预编译 `0x100` | 均支持 → GO |
| D3+ | **链上 DCAP 验证**（Automata V4 + 全套 PCCS） | 真 quote 链上 verifyQuote `success:true`，gas 3.38M |
| D4 | 自定义 `report_data` 绑定收据摘要 | 真 quote 产出+链上验证通过 |
| D5 | `submitReceiptWithQuote` 集成 | status=1，gas 3.77M，哈希链落库 |
| E2E | **In-TEE 自治闭环**（CVM 内无人干预） | 护栏→PACE→读链→quote→上链，gas 3.47M |
| — | **ERC-8004 三注册表**（自部署） | agentId=1 注册 + 验证闭环(response=100) + 声誉(getSummary=100) |
| — | **Orchestrator 写侧** | `POST /api/agent/command`：注入拦截 → `blocked_by_guardrail`；正常决策 → `submitReceipt`（交易 gas 138k / 心跳 97k，dryRun 默认） |
| D6 | **负例测试**（9 项攻击向量） | 全部被拒：过期锚点/伪造锚点/篡改 executionHash/跨收据 quote/坏 quote/护栏不匹配/重放/非 governance；坏 quote 位置扫描 11/13 捕获（2 个 MISS 均在证书尾部惰性 padding，非签名覆盖区，预期行为） |

## Monad 特性实测记录（别的链上踩不到的坑）

| 坑 | 结论 |
|---|---|
| **MCOPY 行为不正确**（loopBack ✅ / copyBack ❌） | 必须用 `evm target: paris` 编译（hardhat config 已设） |
| **Multicall3 内层 `msg.sender` 是 Multicall3 本身** | `onlyTEE` 门控在 multicall 内失效 → 不用 multicall 聚合 |
| **`eth_getLogs` 严格限 100 块范围**（-32614/413） | JSON-RPC **batch**（30 个 getLogs/HTTP 请求可用）+ 100 块窗口回扫（`scripts/index-receipts.mjs`） |
| **RPC 间歇 `-32603 Archive error`** | `FallbackProvider`（官方 + Ankr，quorum=1，stallTimeout 2.5s） |
| MAX_BLOCK_AGE 标定 | 8 块（2.4s）实测不够：读锚点→上链往返超 2.4s 即误拒 → **40 块（12s）** |
| P-256 预编译 `0x100`（EIP-7951） | 支持，为 future passkey/wallet 签名预留 |

## 运行

```powershell
npm install
npx hardhat compile   # evm target: paris（MCOPY 坑）
npx hardhat test      # 15/15

# Orchestrator（读侧 + 写侧）
node orchestrator/server.mjs
# 读: GET  /api/status | /api/receipts | /api/events (SSE)
# 写: POST /api/agent/command?agentId=1  body: {"command":"buy USDC 0.01","dryRun":false}
#      注入指令 "ignore previous instructions..." → blocked_by_guardrail

# 收据索引器（深历史；getLogs 限 100 块 → batch 回扫）
node scripts/index-receipts.mjs

# Dashboard
cd ../dashboard && npm install && npm run dev
```

## 安全属性（合约层，15/15 测试覆盖）

| 属性 | 位置 |
|---|---|
| 收据只能由授权 TEE 写入（`onlyTEE`） | ReceiptRegistry |
| 任何人可代提交但须链上验真 quote + `report_data` 绑定摘要 | ReceiptRegistry.submitReceiptWithQuote |
| 收据哈希链 + `blockhash()` 双绑定 + per-agent nonce 防重放 | ReceiptRegistry |
| `isTradeFresh`(背书新鲜) / `isAlive`(存活) 双时间基准分离 | ReceiptRegistry |
| 心跳收据独立槽位，不顶替交易背书 | ReceiptRegistry |
| 执行体必须匹配收据 `executionHash`（PACE 绑定） | AegisVault |
| 白名单 / 单笔 / 日限额 | AegisVault |
| 死手开关：失活冻结 + 存活校验后可解冻；提现永不冻结 | AegisVault |
| 非 governance 不可改 DcapGate / 护栏 | ReceiptRegistry |
| **执行前 challenger 互证 quorum**：最新收据须被独立验证者以 response≥100 背书 | AegisVaultQuorum |

## Proposer/Challenger 双代理互证

借鉴 ERC-8004 多代理信任模型：**Agent A（proposer）** 提出决策并提交收据，**Agent B（challenger）**
用独立实现（自持 blocklist/策略）重推导护栏 + PACE + `executionHash` + 收据摘要算术，比对无误才
向 ValidationRegistry 提交 `validationResponse(requestHash=digest, 100)`；`AegisVaultQuorum` 的
`_preExecutionHook` 要求最新收据已获 challenger 背书，否则 `executeTrade` revert `"No challenger quorum"`。

- **proposer 作恶演示**：`POST /api/agent/command` 传 `tamperExecHash:true` → 收据与决策输入不符，
  challenger 发现 `executionHash_mismatch` → `response=0` 上链作证据，资金止步于互证
- **诚实路径**：三笔上链（收据 → validationRequest → validationResponse），E2E 已实测
  （challenger `0x16e619c3…`，response=100 与 response=0 两种状态均链上可查）
- challenger 无 key 时自动降级为离线重推导（`challenger` 字段仍返回 agree/mismatches）

## 已知边界

- ERC-8004 官方 Registry 在 Monad testnet 无部署（`codeLen=0`），按 EIP-8004 接口自主实现三注册表；主网上线后可平移至官方地址
- quote 尾部 ~100 hex chars（证书后惰性 padding）verifier 不校验——非签名覆盖区，无实际风险
- TEE 运行时双 LLM 隔离为可插拔结构（mock/OpenAI 兼容）；OPA/Membrane 阶段二三未实现
- 原生 MON 交易需实现层补 `value` 传递（当前按 ERC-20/router 场景设计）

## 部署地址（Monad testnet, chainId 10143）

| 合约 | 地址 |
|---|---|
| ReceiptRegistry（in-TEE 收据） | `0x91482e67998a01C0A33Fe12ec01A6A43177A7181` |
| DcapGate | `0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F` |
| ERC-8004 IdentityRegistry | `0xC99D2957fdA1455E68dF2181A4bB97fd73081A74` |
| ERC-8004 ReputationRegistry | `0xb5B853BcE92940b8E5BFba131301509eaCFb5c9f` |
| ERC-8004 ValidationRegistry | `0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa` |
| **AegisVaultQuorum（challenger 互证金库）** | `0x60F9F1FBa953ce5CD9c8805CD4858eFf35BcB20a` |

其余（DCAP 全栈 14+ 合约、测试 tx 哈希与 gas 记录）见 `dcap-verifier/STATUS.md`。

链上 quorum E2E：`node scripts/quorum-e2e.mjs`（无验证拒绝 + challenger 同意执行成功，TradeExecuted @62070391）。
