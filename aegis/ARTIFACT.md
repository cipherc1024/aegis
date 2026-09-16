# ARTIFACT — 复现指南（Aegis / 对应论文 §8.6）

> 目标徽章：**Available**（公开仓库 + 固定 commit）+ **Functional**（一键零 gas 复现 harness 全绿）
> + **Reproduced**（另机复跑 challenger 2-of-2）。链上证据走"公开可验"通道（Tenderly public
> + Monad 区块浏览器），不依赖评审计时重放。
>
> 诚实前提：默认路径**单工作站零 gas**（离线 harness）；链上与 live LLM 项为可选档，见 §4/§5。

## 0. 环境要求

- Node.js ≥ 22（开发实测 v24）、npm；`npm install`
- 合约编译：`npx hardhat compile`（**evm target 必须 paris**——Monad MCOPY 行为不正确，见 README"Monad 特性实测"）
- 图与 bond 数值（论文侧，可选）：Python 3.10+，matplotlib + numpy（脚本在论文仓 `figs/`，投稿打包时随 artifact 一并收录）
- 不需要任何 API key 即可跑完 §1 全部（LLM 走 mock 降级，如实标注 mode=mock）

## 1. 一键零 gas 复现（Functional 徽章主体）

按序执行，每条末尾为预期输出（exit code 0 = 全绿）：

| # | 命令 | 预期 | 验证内容（论文对应） |
|---|---|---|---|
| 1 | `npx hardhat test` | 40/40（27 原 + 13 M2/M3） | 合约层安全属性（§5/§7）+ M2/M3 合约（W11） |
| 2 | `node challenger/selftest.mjs` | 17/17 | challenger L1–L5 重推导（零共享代码） |
| 3 | `node scripts/parity-check.mjs` | 17/17, exit 0 | proposer/challenger 口径零分歧 |
| 4 | `node scripts/attack-family.mjs` | 8 用例：7 拦下 + 1 项 ACCEPTED（设计边界） | 攻击族四格（R1 负对照 + T5/T3/L4） |
| 4b | `node scripts/atomic-input.mjs` | `ALL REGIMES PASS`（4/4） | M2 输入格两 regime 对照：链下=设计边界 / 链上承诺=BLOCKED（W11，§8.2 第 1 行升级件） |
| 5 | `node scripts/tee-adversary-sim.mjs` | `ALL LEGS PASS` | 对抗 TEE 仿真三腿：策略后门族离线拦截 + D6-A6（真 quote 错护栏 revert，文档证据模式）+ 链上 quorum 闸门 |
| 6 | `node scripts/soa-demo.mjs` | 4/4 场景（诚实放行 / 漂移 / 篡改 / 过期全拒） | SOA-lite 签署目标层（§6, T3/T1(ii)） |
| 7 | `node scripts/regime-cost.mjs` | δ / L1–L4 / L1–L5 三档延迟 + 菜单扫描斜率 | 代价曲线（Figure 4；单机微基准，数字随机器小幅漂移） |

论文侧（论文仓 `figs/`，同一机可跑）：

| # | 命令 | 预期 |
|---|---|---|
| 8 | `python figs/make-fig1.py` | Figure 1 谱系图（spectrum.png/pdf/svg） |
| 9 | `python figs/make-figs.py` | Figure 4 cost-frontier |
| 10 | `python figs/bond-check.py` | Figure 5 bond 数值校验（种子 20260916，合成蒙特卡洛，16/16 格在界内） |

## 2. 链上公开可验（Available 徽章，浏览器即可，无需本机任何环境）

chainId 10143（Monad testnet）。6 个核心合约已 Tenderly **源码级公开验证**（匿名可开）：

| 合约 | 地址 | Tenderly |
|---|---|---|
| AegisVaultQuorum | `0xe6E24BB72a4a327b7A7E7aA025A04eBc5a6533D7` | dashboard.tenderly.co/contract/monad-testnet/0xe6E24BB72a4a327b7A7E7aA025A04eBc5a6533D7 |
| ReceiptRegistry (v2) | `0x4622D041696942dC873a8A5E54f1e1ca9669c90B` | 同构链接（换地址） |
| DcapGate | `0xAe58A4F6DD3E2810812193D4766f11d5F3Dfc66F` | 同上 |
| ValidationRegistry | `0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa` | 同上 |
| IdentityRegistry | `0xC99D2957fdA1455E68dF2181A4bB97fd73081A74` | 同上 |
| ReputationRegistry | `0xb5B853BcE92940b8E5BFba131301509eaCFb5c9f` | 同上 |

W11 新增（M2/M3，2026-09-16 部署，**Tenderly 验证待做**）：

| 合约 | 地址 |
|---|---|
| CommittedOracle（M2 共识提交输入） | `0xe3D4a4F8DA20654dC2D845F130C654beb75C8967` |
| AtomicExecutor（M2 原子输入–执行绑定，演示件） | `0x0861C00133eCDf67fE61501F61D3fB8969A0e3D6` |
| AuditDraw（M3 承诺–揭示抽选机） | `0x4EabbF03aa526D4B5C012Cd176D69025Cc52CE45` |

匿名可查性一行复测（无凭据）：

```bash
curl -s https://api.tenderly.co/api/v1/public-contracts/10143/0xe6e24bb72a4a327b7a7e7aa025a04ebc5a6533d7
# => "public":true, "contract_name":"AegisVaultQuorum"
```

关键 E2E 交易（Tenderly 有源码级调用栈，`_preExecutionHook` 的 response≥100 闸门 → WMON `deposit()`）：

| 步骤 | tx 哈希 | 块 |
|---|---|---|
| 收据提交（链上 DCAP 验真，Phase 4） | `0x911bb84e48993e0285ba3119bf6276a91714c2bd6dabf082c122dea08a161408` | 62366788 |
| challenger 裁决 validationResponse | `0xaed419099daed33b950d1dbc3f5b9b0c8056d1dc8bc9c33bb7c04efa8a110cc9` | — |
| executeTrade（真实 WMON wrap） | `0x1d30e015733474ecb249743033f0a50fec81988efbbdbe6b63c309d34fd3f99b` | 62366819 |
| SOA-lite E2E：收据+bindTranscript（objectiveHash 存证） | `0xac1a5c8a2f60f2110d005fd4383c4b9b36d75819ac174c6dbd9b7214bbe904de` | 62756780 |
| SOA-lite E2E：executeTrade | `0x03a754cf73610a2350a5658e4a1fc90909ca8afbe585bdb9f90f767b81a5f388` | 62756812 |
| M2：postObservation（共识提交输入，commitRoot=链下重算一致） | `0xd8a8dc9efad004aa7ca05d258105e813a924fe4cd58e09d34fcddc02417aada3` | 63051989 |
| M2：executeAtomic（原子读输入 + 真 WMON wrap 0.01，executor 0→0.01） | `0x2dc3210087fef1fdbe08dccf928904da1cdcc5a10b476f891d513e4d76f29941` | 63051997 |
| M2 负例：伪造根 → revert（status=0） | `0xfb6d87194c7168aee96809457e12232021fdb06f249b0c6c3fb18b68f39f8d6b` | 63052002 |
| M3：commitDraw（承诺） | `0xbbb72dfff340913cf410bf96b6a2652ae72d7b10589e5b54c18f7f035dcefcd0` | 63052007 |
| M3：revealDraw（揭示，200 索引链上==链下重算） | `0xb7336a0dc8dbb39fe6ff170952b249c3ea324e1359c0ee6a4d1a1c6b42ff8a82` | 63052022 |

其余链上记录（D6 九向量 gas 3,837,429、quorum E2E、DCAP verifyQuote 等）见 `dcap-verifier/STATUS.md`。

## 3. 链上读侧快照（RPC 历史不依赖）

Monad testnet 无归档公共端点保证（`eth_getLogs` 限 100 块、间歇 Archive error）。
`orchestrator/receipts-cache.json` 为索引器产物（`node scripts/index-receipts.mjs` 可再生成），
附逐 tx 快照——读侧复现不依赖实时 RPC 历史。

## 4. 可选档：真实上链（需测试网 MON）

钱包余额不足时跳过，不阻塞 Functional 徽章：

- `node scripts/soa-demo.mjs --onchain` — SOA-lite 全链 5/5（需 orchestrator + challenger 在跑，≈0.37 MON）
- `node scripts/d6-negative.mjs` — 9 攻击向量 + 1 正例（fresh 合约部署 ~0.78 MON + 运行 ~0.15 MON）
- `node scripts/tee-adversary-sim.mjs --live` — 默认校验文档证据（STATUS.md 的 D6-A6 revert 记录），
  `--live` 改为真实上链重跑 d6-negative（fresh 合约部署 ~0.78 MON + 运行 ~0.15 MON）
- `node scripts/m2m3-testnet.mjs` — M2/M3 全链实测（三合约部署 + postObservation + executeAtomic
  真 wrap + 假根负例 + commit/reveal 抽选，≈0.05 MON；结果落盘 `scripts/m2m3-results.json`）
- `node scripts/atomic-input.mjs --live` — 读真 oracle 的 commitRoot 重跑两 regime 对照（零 gas 只读）

## 5. 可选档：live LLM（llm-divergence，需 API key）

`node scripts/llm-divergence.mjs` 需要 `.env` 配置 `LLM_API_KEY` + `LLM_BASE_URL`
（官方 DeepSeek `api.deepseek.com`；无 key 则自动降级 mock，如实标注）。
正式版口径 `node scripts/llm-divergence.mjs --n 20 --out llm-divergence-final.json`。
产物（论文 §8.3 数字来源）：`llm-divergence-final.json` + over-limit 探针落盘
（`llm-divergence-probe-overlimit.txt`，探针为脚本内 inline 追加）。推理模型注意
`LLM_MAX_TOKENS=2000`（默认预算会被 reasoning 吃光 → 空 content → fail-closed 误拒）。
API 不可达时管线自动降级 mock 并如实标注 mode=mock（此时数字不得用于论文）。

## 6. Reproduced 徽章路径（真 2-of-2）

`challenger/` 整目录拷到**另一台机器**（依赖只 node_modules 或重新 `npm install`），
配 `challenger-policy.json` + 治理侧 `policy-attest.mjs --execute` 上链认证 guardrailHash，
跑 `challenger-agent.mjs` 常驻轮询即成真 2-of-2（见 `challenger/README.md`）。

## 7. 诚实注记（引用 artifact 数字前必读）

1. **单工作站默认**：§1 的 challenger 与 proposer 同机跑；"2-of-2" 的独立性主张以 §6 的另机部署为准，
   论文表述为 "single-workstation default; true 2-of-2 by redeploying challenger"。
2. **in-TEE 收据更正**：tx `0x8563c26e…`（gas 3,474,328）的 guardrailHash 来自当时手写实现，
   ≠ 链上认证值；修复后未重跑 CVM E2E。该收据的 gas 数字为真实运行值可引用，
   **不得**引用其"摘要与 challenger 一致"语义。
3. **交叉模型层已不可复现**：原 proposer=deepseek / challenger=glm 网关端点已于 2026-09-15 删除，
   交叉模型层需另配端点（默认关闭）；论文不声称 cross-family 复现。
4. **输入真实性不在覆盖内**（R1 不可能性）：`attack-family.mjs` 第一格 ACCEPTED 是刻意的负对照。
5. **微基准数字**（regime-cost）单机口径，跨机器有漂移；论文引用区间为三次实测。
6. `bond-check.py` 为合成蒙特卡洛（非链上数据），种子固定 20260916。
7. **AtomicExecutor 是 M2 演示件**：`executeAtomic` 演示「链上数据 + 同一笔原子执行」的最小形态，
   尚未并入 AegisVaultQuorum 的 `_preExecutionHook` 链；论文引用其 gas 与拦截语义时按「设计槽位的工程化实现」口径。
8. **M2 负例交易 gas 200,000 = 节点按 gasLimit 全额计**：`stateHash != expectedStateHash` revert 的
   gasUsed 等于 gasLimit（节点对 revert 交易的计费行为），不是逻辑实际消耗；本地 hardhat 实测同路径实际消耗 31,769。
9. **M3 抽选参数 N=1000/n=200 为演示参数**：AuditDraw 的 receiptCount/sampleSize 由调用方传入，
   论文若引用需注明该组数字的演示口径；生产参数与审计覆盖率的关系归 T4 的 \(N\) 与 δ_audit 分配。
