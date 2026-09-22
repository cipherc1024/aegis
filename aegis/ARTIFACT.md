# ARTIFACT — 复现指南（Aegis / 对应论文 §8.6）

> 目标徽章：**Available**（公开仓库 + 固定 commit）+ **Functional**（一键零 gas 复现 harness 全绿）
> + **Reproduced**（另机复跑 challenger 2-of-2）。链上证据走"公开可验"通道（Tenderly public
> + Monad 区块浏览器），不依赖评审计时重放。
>
> 诚实前提：默认路径**单工作站零 gas**（离线 harness）；链上与 live LLM 项为可选档，见 §4/§5。

**固定 commit（Available 徽章锚点）**：匿名镜像
`https://github.com/<anonymous-artifact-mirror>`，tag **`artifact-anon-2026-09-21`**。
**论文引用一律写仓库 URL + tag 名，不写裸 sha**（镜像 tag 曾因文档修正重打过，裸 sha 会漂；
固定 sha 以 tag 解析为准：`git rev-parse artifact-anon-2026-09-21`）。该镜像提交身份全为中性占位符
`aegis-dev <aegis@local>`，不含作者身份信息；本地开发仓 `Monad量化` 为私有仓，
**其地址不得写入论文**（双盲）。镜像内 `aegis/ARTIFACT.md` 即本文件的对等版本（内容一致，仅锚点段不同）。

> **旧 tag 说明**：`artifact-anon-2026-09-17` / `artifact-anon-2026-09-18` 为历史版本，分别早于
> v5 金库重部署与 in-TEE CVM E2E 证据同步——**其中的文档指向已废弃的 v4 金库地址、合约源码不含
> v5 的 `setReceiptRegistry`**。复现请一律使用 `artifact-anon-2026-09-21`。

## 0. 环境要求

- Node.js ≥ 22（开发实测 v24）、npm；`npm install`
- 合约编译：`npx hardhat compile`（**evm target 必须 paris**——Monad MCOPY 行为不正确，见 README"Monad 特性实测"）
- 图与 bond 数值（论文侧，可选）：Python 3.10+，matplotlib + numpy（脚本在论文仓 `figs/`，投稿打包时随 artifact 一并收录）
- 不需要任何 API key 即可跑完 §1 全部（LLM 走 mock 降级，如实标注 mode=mock）
- **唯一需要的一个环境变量是 `SOA_USER_PK`**（第 6 行 `soa-demo` 用；「用户」角色签名私钥，
  无资金、不上链）。`.env.example` 已内置一个**公开测试密钥**，直接
  `cp .env.example .env` 即可复现；不设它会以 exit 1 明确报缺（不会静默跳过）。

## 1. 一键零 gas 复现（Functional 徽章主体）

按序执行，每条末尾为预期输出（exit code 0 = 全绿）：

| # | 命令 | 预期 | 验证内容（论文对应） |
|---|---|---|---|
| 1 | `npx hardhat test` | 44/44（31 原 + 13 M2/M3） | 合约层安全属性（§5/§7）+ M2/M3 合约（W11） |
| 2 | `node challenger/selftest.mjs` | 17/17 | challenger L1–L5 重推导（单向独立：不 import proposer） |
| 3 | `node scripts/parity-check.mjs` | 21/21, exit 0 | proposer/challenger 口径零分歧（14 护栏/PACE + 7 目标层） |
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
| AegisVaultQuorum (v5) | `0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De` | https://dashboard.tenderly.co/contract/monad-testnet/0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De |
| ReceiptRegistry (v2) | `0x4622D041696942dC873a8A5E54f1e1ca9669c90B` | 同构链接（换地址） |
| DcapGate | `0xAe58A4F6DD3E2810812193D4766f11d5F3Dfc66F` | 同上 |
| ValidationRegistry | `0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa` | 同上 |
| IdentityRegistry | `0xC99D2957fdA1455E68dF2181A4bB97fd73081A74` | 同上 |
| ReputationRegistry | `0xb5B853BcE92940b8E5BFba131301509eaCFb5c9f` | 同上 |

W11 新增（M2/M3，2026-09-16 部署，**2026-09-16 已完成 Tenderly 源码级公开验证**）：

| 合约 | 地址 | 验证时刻 (UTC) | Tenderly |
|---|---|---|---|
| CommittedOracle（M2 共识提交输入） | `0xe3D4a4F8DA20654dC2D845F130C654beb75C8967` | 2026-09-16T23:28:23Z | https://dashboard.tenderly.co/contract/monad-testnet/0xe3D4a4F8DA20654dC2D845F130C654beb75C8967 |
| AtomicExecutor（M2 原子输入–执行绑定，演示件） | `0x0861C00133eCDf67fE61501F61D3fB8969A0e3D6` | 2026-09-16T23:35:23Z | https://dashboard.tenderly.co/contract/monad-testnet/0x0861C00133eCDf67fE61501F61D3fB8969A0e3D6 |
| AuditDraw（M3 承诺–揭示抽选机） | `0x4EabbF03aa526D4B5C012Cd176D69025Cc52CE45` | 2026-09-16T23:32:29Z | https://dashboard.tenderly.co/contract/monad-testnet/0x4EabbF03aa526D4B5C012Cd176D69025Cc52CE45 |

三合约均公开（`"public":true`）+ 编译设置逐项一致：`solc v0.8.24` / `optimizer{enabled:true,runs:200}` / `evmVersion:paris` / `viaIR:true`。匿名核查示例：

```bash
curl -s https://api.tenderly.co/api/v1/public-contracts/10143/0x0861c00133ecdf67fe61501f61d3fb8969a0e3d6
# => "public":true, "contract_name":"AtomicExecutor", "verification_date":"2026-09-16T23:35:23Z",
#    compiler_settings{"optimizer":{"enabled":true,"runs":200},"evmVersion":"paris","viaIR":true}
```

验证输入 = 重编译产出的 standard JSON input（含 inline `content`；AtomicExecutor 需带 `contracts/CommittedOracle.sol` 两个 source unit，因其 import）。生成脚本 `scripts/tenderly-prep-w11.mjs`，产物在 `.tenderly-verify/w11-*-standard-input.json`。注意：Tenderly 的 JSON Upload 虽然 UI 文案写 "contract metadata"，但实测喂 solc metadata **会失败**（metadata 只有 source 哈希无 content），必须喂 standard JSON input。另：`tenderly-prep.mjs` 的 runtime bytecode diff 对 AtomicExecutor 会误报——它有 4 个 immutable，构造期写入的 154 字节差异超过该脚本 ≤128 的启发式阈值；**权威判据是 creation-input 比对**（部署 tx calldata vs 重编译 init code + 编码构造参数），三合约均逐字节一致（653 / 1733 / 1807 字节）。

匿名可查性一行复测（无凭据、无登录重定向，2026-09-20 实测）：

```bash
curl -s https://api.tenderly.co/api/v1/public-contracts/10143/0x3abbb284760dce5643a8a5d1ba2bb9a58c2b89de
# => "public":true, "contract_name":"AegisVaultQuorum", "verification_date":"2026-09-20T13:22:24Z",
#    "compiler_version":"v0.8.24", "evm_version":"paris",
#    "optimizations_used":true, "optimization_runs":200, "main_contract":1,
#    compiler_settings{"optimizer":{"enabled":true,"runs":200},"evmVersion":"paris","viaIR":true}
# （地址替换为第一张表任意一行即可同构复测；三个源文件亦经 data.contract_info 匿名可下载）
# v5 验证源码含两处 v5 标记：setReceiptRegistry 与 Insufficient vault balance
```

关键 E2E 交易（Tenderly 有源码级调用栈，`_preExecutionHook` 的 response≥100 闸门 → WMON `deposit()`）。
注意：Phase 4 / SOA-lite 那几行走的是 **v2/v3 时代**地址（已废弃，仅作历史留档）；**v5 生产地址上的全链
E2E 为 2026-09-20 那三行**（`0x3aBbb284…b89De`：验证者白名单 + 交易槽钩子 + 余额检查 + registry 可变绑定在真实执行路径上生效）：

| 步骤 | tx 哈希 | 块 |
|---|---|---|
| 收据提交（链上 DCAP 验真，Phase 4） | `0x911bb84e48993e0285ba3119bf6276a91714c2bd6dabf082c122dea08a161408` | 62366788 |
| challenger 裁决 validationResponse | `0xaed419099daed33b950d1dbc3f5b9b0c8056d1dc8bc9c33bb7c04efa8a110cc9` | — |
| executeTrade（真实 WMON wrap） | `0x1d30e015733474ecb249743033f0a50fec81988efbbdbe6b63c309d34fd3f99b` | 62366819 |
| SOA-lite E2E：收据+bindTranscript（objectiveHash 存证） | `0xac1a5c8a2f60f2110d005fd4383c4b9b36d75819ac174c6dbd9b7214bbe904de` | 62756780 |
| SOA-lite E2E：executeTrade | `0x03a754cf73610a2350a5658e4a1fc90909ca8afbe585bdb9f90f767b81a5f388` | 62756812 |
| **v5 全链 E2E（2026-09-20）：金库 `deposit()` 注资 0.5 MON** | `0x75b9d614…915b` | — |
| **v5 全链 E2E：收据提交（DCAP verified，经 `submitReceiptWithQuote`）** | `0xda7a711711244c7d81283c231d5b79e27b6fab05ce1229ac1abd9e88385fe831` | 64148932 |
| **v5 全链 E2E：challenger 裁决 validationResponse（100）** | `0x98fe4af5a0372abee8defae09e3ee9736c4c9ae548c0073f30ef9f9e9f5cdfac` | — |
| **v5 全链 E2E：`executeTrade`（金库余额出资；WMON 0 → 0.01）** | `0x7e6e71d34e6ca04f465d565252eac5edd2997af1d1cebecc9f0b68896d2544ef` | — |
| v4 全链 E2E（2026-09-17，已废弃）：金库 `deposit()` 注资 0.5 MON | `0x92e6e5425dcc2281f92c7a2223517f6a83da79a4f5a0c4cea63c89d7e4c179c4` | — |
| v4 全链 E2E：收据提交（DCAP verified） | `0xf9e49b5b22b878e3f225180d2ada035b516389a4d12694849cfc7a4d174d8d7b` | — |
| v4 全链 E2E：`executeTrade`（金库余额出资；WMON 0 → 0.01） | `0x42048bec27b97c3c640cf21e701a2a87e23f1f7d313c765bd3990852b4b76b05` | — |
| M2：postObservation（共识提交输入，commitRoot=链下重算一致） | `0xd8a8dc9efad004aa7ca05d258105e813a924fe4cd58e09d34fcddc02417aada3` | 63051989 |
| M2：executeAtomic（原子读输入 + 真 WMON wrap 0.01，executor 0→0.01） | `0x2dc3210087fef1fdbe08dccf928904da1cdcc5a10b476f891d513e4d76f29941` | 63051997 |
| M2 负例：伪造根 → revert（status=0） | `0xfb6d87194c7168aee96809457e12232021fdb06f249b0c6c3fb18b68f39f8d6b` | 63052002 |
| M3：commitDraw（承诺） | `0xbbb72dfff340913cf410bf96b6a2652ae72d7b10589e5b54c18f7f035dcefcd0` | 63052007 |
| M3：revealDraw（揭示，200 索引链上==链下重算） | `0xb7336a0dc8dbb39fe6ff170952b249c3ea324e1359c0ee6a4d1a1c6b42ff8a82` | 63052022 |

其余链上记录（D6 八向量 + 一正例的 gas 3,837,429、quorum E2E、DCAP verifyQuote 等）见 `dcap-verifier/STATUS.md`。

## 3. 链上读侧快照（RPC 历史不依赖）

Monad testnet 无归档公共端点保证（`eth_getLogs` 限 100 块、间歇 Archive error）。
`orchestrator/receipts-cache.json` 为索引器产物（`node scripts/index-receipts.mjs` 可再生成），
附逐 tx 快照——读侧复现不依赖实时 RPC 历史。

## 4. 可选档：真实上链（需测试网 MON）

钱包余额不足时跳过，不阻塞 Functional 徽章：

- `node scripts/soa-demo.mjs --onchain` — SOA-lite 全链 5/5（需 orchestrator + challenger 在跑，≈0.37 MON）
- `node scripts/d6-negative.mjs` — 8 攻击向量 + 1 正例对照（fresh 合约部署 ~0.78 MON + 运行 ~0.15 MON）
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

**一键脚本（推荐）**：把一个 challenger 部署到第二台机器、并让第一台机器接入——两条命令即可：

- 机器 A（proposer，本仓根）：`node scripts/setup-proposer-for-challenger.mjs --challenger 0xB的地址`
  （或 Windows 双击 `一键接入-第二台机器.cmd`）→ 写 `CHALLENGER_ADDR`、部署并授权 B、更新
  `QUORUM_VAULT`、认证策略、加 WMON 白名单、打印 A 的 IP 与 B 的命令。
- 机器 B（challenger，`challenger/` 目录）：`node setup-second-host.mjs`
  （或 Windows 双击 `一键配置-第二台机器.cmd`；Linux/macOS `./setup-second-host.sh`）
  → 生成独立钱包（打印地址）、写 `.env`、自测 17/17；拿到 A 的 IP 与 vault 后
  `node setup-second-host.mjs --orch-url http://<A的IP>:8787 --vault <QUORUM_VAULT> --run`。

**手工步骤**（供理解/排错，见 `CROSSMACHINE-2OF2.md`）：`challenger/` 整目录拷到**另一台机器**
（`npm install`），配 `challenger-policy.json` + 治理侧 `policy-attest.mjs --execute` 上链认证
guardrailHash，跑 `challenger-agent.mjs` 常驻轮询即成真 2-of-2（见 `challenger/README.md`）。

**验收证据**：两台机器 `hostname` 不同 + B 的钱包地址独立 + B 的 `validationResponse` tx +
A 的 `executeTrade` 在 B 背书后成功。**未在第二台物理机执行前，不得声称"真跨机"**（单机转机排练
见 `scripts/crossmachine-2of2.mjs`，只是"可转机 + 自包含"的证据）。

## 7. 诚实注记（引用 artifact 数字前必读）

1. **单工作站默认**：§1 的 challenger 与 proposer 同机跑；"2-of-2" 的独立性主张以 §6 的另机部署为准，
   论文表述为 "single-workstation default; true 2-of-2 by redeploying challenger"。
2. **in-TEE 收据更正**：tx `0x8563c26e…`（gas 3,474,328）的 guardrailHash 来自当时手写实现，
   ≠ 链上认证值。该收据的 gas 数字为真实运行值可引用，
   **不得**引用其"摘要与 challenger 一致"语义。
   修复后的口径已由 tx `0xadf52203…003be`（2026-09-18 复跑）取代，见下一条。
2b. **in-TEE CVM E2E 已复跑（2026-09-18）**：tx `0xadf522038b8ace6d7ada14ca491b527eb3ab8caf630153d2570b799ec96003be`
   @63607466（gas 3,477,689，`status=1`），CVM 内 `GUARDRAIL_HASH=0x0fd539cd…cfb84` = 链上 `agentGuardrailHash`，
   事件三字段（executionHash/pdrHash/guardrailHash）与 CVM 日志逐字段一致。**边界**：该进程止于
   `submitReceiptWithQuote`；`challenger 重推导→validationResponse→executeTrade` 属第二段，由 v4 全链 E2E
   （tx `0x42048bec…76b05`）覆盖。**不存在一次进程内跑完全链的证据，不得声称"单进程全链"。**
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
10. **`executeTrade` 的金库余额检查已于 v5 上链生效**（2026-09-20）：`AegisVault.executeTrade` 含
    `require(value <= address(this).balance, "Insufficient vault balance")`（外部调用前置检查，
    避免"金库余额不足"在目标合约处表现为晦涩失败）。v5 部署（`0x3aBbb284…b89De`）起该检查
    在线上字节码中，不再是"源码有、链上无"。v4（`0x07Be2FCd…B65bc`）为修复前版本，已废弃。
    v5 另含 `setReceiptRegistry`（`registry` 由 immutable 改为可变）——使 `ReceiptRegistry`
    需要更换时无需 withdraw→redeploy，金库地址、白名单、限额、余额历史全部保留。
    单测 **44/44** 覆盖三个 v5 用例（换表保资金 / 换表后钩子读新表 / owner-only + 拒零地址）。
11. **v4 全链 E2E 与 v5 金库注资的区块号未记录**：§2 表中标 `—` 的行是
    `eth_sendRawTransaction` 返回值，当时未落盘区块号；tx 哈希可在 Monad 区块浏览器直接查证。
12. **Dashboard 是复现的观测面，不是证据来源**：`dashboard/` 只渲染 `orchestrator` 的只读端点或
    浏览器内直读链上，**不持密钥、不代签、不产生新的事实**。因此它不构成论文的任何数字来源——
    论文/artifact 的数字一律以链上 tx、脚本输出、`STATUS.md` 为准；dashboard 用于让评审**核对**
    这些数字与链上是否一致（不可达时显示"离线"，绝不回退占位值）。
13. **Dashboard 有三类页面，引用时勿混**：① 真实读数页（走 `/api/status|config|vault|receipts|exec-stats`
    等，或浏览器内直读 RPC）；② 真实读数 + **结构边界论证**页（`/copy` 策略跟投、`/subaccounts` per-role
    子账户——架构上无第二个出资方槽位、角色共享同一金库余额，故**功能不承诺**，页内逐条给论证）；
    ③ 无编造数字。**不存在"示例数据页"了**：`dashboard/src/lib/mock.ts` 的编造 fixtures 已删除
    （仅留类型定义与 `shortHash`/`shortAddr` 纯函数）。若在旧文档/旧截图里见到 `$11,418 总资产`、
    `MRTD/RTMR0/FMSPC/TCB` 度量值、"12,480 条审计记录"等数字，均为已删除的历史占位。
14. **Dashboard 回归验证口径（2026-09-20 实跑）**：`npx tsc --noEmit` EXIT=0 · `npx next build` EXIT=0
    （23 静态页 / 20 路由）· `npx hardhat test` 44 passing · `challenger/selftest.mjs` 17/17 ·
    `scripts/parity-check.mjs` 21 agree / 0 diverge。dashboard 的改动不触碰合约、不改口径函数，
    故对 §1 的复现 harness 无影响（此三行 aegis 侧命令为**实测**，非推断）。
