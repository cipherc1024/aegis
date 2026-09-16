# D3 链上 DCAP 验证 —— ✅ W1 go/no-go = GO（2026-09-11）

## 🎉 结论：链上验证真实 Intel TDX quote 成功

```
V4QuoteVerifier.verifyQuote(header, quote, tcbEval=20)
=> success: true
=> output: 0x0004 0002 20 20a06f000000 ...
   quoteVersion=4, quoteBodyType=2 (TD10), tcbStatus=0x20, fmspc=20A06F000000 ✅
=> gas: 3,384,766（Monad 区块上限 150,000,000）✅
```

- **P-256 走 Monad 的 `0x100` 预编译**（脚本自动判定）
- 完整验证：quote 签名 + 证书链到 Intel root + TCB 状态 + QE 身份 + report_data
- 机制：Automata v1.1 DCAP 栈，**legacy(V1) 配置**（V2 是异步 upsert 协议，不适合手工灌数据）

## 部署清单（Monad testnet, chain 10143）

DCAP：
- AutomataDcapAttestationFee `0x3BfEa6CEA1C1bcaCBb6244085675DbF788625B60`
- PCCSRouter `0x06829D1a3E99B70d6d2A7b5fa5a65c4f31d33173`
- **V4QuoteVerifier** `0x0eb496471d638173cdF35bE6b0e54FE035289F1f`
- V1 AutomataFmspcTcbDaoVersioned(20) `0xf1271d0813AeED748790a8f5157CcB2bF8E5aF1B`

PCCS：
- AutomataDaoStorage `0xFDa15d0b5c29bb4bF251a80C689e78147Cb8e877`
- AutomataPcsDao `0xe96011FC5f23A84EfB2F1a630e8e0b78785CDba8`
- AutomataPckDao `0x4A3657F84871674BDB82090E956183D930B7A5Dc`
- AutomataEnclaveIdentityDaoVersioned(20,4) `0xC7Ab05a9aCB14c92cE227A0f7E2A8e2630c30210`
- 6× helper（复用链上已有）

Router 映射：crlHelper=PcsDao legacy、pcsDao=legacy、fmspcTcbDaoVersioned[20]=V1、qeIdDaoVersioned[20]=enclave。

## 灌入的 collateral（Intel 签名）
ROOT cert / SIGNING cert / PLATFORM cert / root CA CRL / PCK CRL / TCB info / QE identity(TD_QE v4)

## 脚本
- `scripts/pccs-upsert.mjs` — 灌 collateral（legacy 路径）
- `scripts/dcap-verify.mjs` — 链上验证真 quote
- `scripts/compute-helpers.mjs` / `make-dcap-registry.mjs` 等

## 下一步（项目层面，非 spike）
- D4：让 TEE 产生**绑定我们收据 digest 的 report_data**，在链上校验 report_data == 收据摘要
- D5：把 `V4QuoteVerifier` 接入 `ReceiptRegistry`（替代/补充 `onlyTEE`）
- 注意：V2/CRL-V2 异步 upsert 是生产路径，若上线需官方 updater

## ✅ D4 完成（2026-09-11）
- 部署最小 Phala 应用 `tee/d4/`（python + dstack-sdk），用 `get_quote(自定义 64 字节)` 产出**绑定我们 digest 的真 TDX quote**
- 产物 `tee/d4/quote.hex`（report_data[0:32] = `keccak256("aegis-d4-receipt")`）
- 链上 `V4QuoteVerifier.verifyQuote` → `success: true`，gas 3.35M；CVM 已删除

## ✅ D5 完成（2026-09-11）
- 新增 `dcap-verifier/contracts/DcapGate.sol`：链上验 quote + 校验 `report_data[0:32] == 收据摘要`
- DcapGate `0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F`（→ V4QuoteVerifier, tcbEval 20）
- 测试（`scripts/d5-deploy-test.mjs`）：正确 digest `[true,true]`；错误 digest `[true,false]`；D1 quote `[true,false]`
- **完整证明：链上"验真 quote + 绑定收据摘要"**

## 花费
累计约 4–5 MON（余额见链上）。

## ✅ D5-集成 完成（2026-09-11）
- `contracts/ReceiptRegistry.sol` 新增：
  - `setDcapGate(address)`（治理设置）
  - `submitReceiptWithQuote(..., bytes quote)`：**任何人可代提交**，但必须
    ① 链上 `dcapGate.check` 验 quote 通过；② quote 的 `report_data[0:32] == semanticDigest`
  - `semanticDigest = keccak256(agentId, pdrHash, guardrailHash, executionHash, nonce, prev)`
    （不含区块锚点；新鲜度/分叉绑定仍由 `_submit` 单独校验 → 支持预生成 quote）
  - 原 `submitReceipt`（onlyTEE）保留为 MVP/回退
- `contracts/mocks/MockDcapGate.sol` + 3 个集成测试；`npx hardhat test` → **12/12 通过**
- 真实 `DcapGate` 已部署且验证通过（见上）

## 还剩（可选）
- **现场 E2E**：用真 TEE 产出一份绑定某收据 `semanticDigest` 的 quote，链上 `submitReceiptWithQuote` 落库（因 semanticDigest 不含区块锚点，quote 可预生成）
- 其余项目：TEE 运行时（双 LLM/PACE/护栏）、前端、ERC-8004、demo

## ✅ In-TEE 自治闭环（2026-09-12）
- `tee/intee/`：把 护栏 + PACE + 收据哈希 + `getQuote` + `submitReceiptWithQuote` 打包进 **node:22 CVM**
- 真实 CVM（tdx.small）内自主执行，实测：
  - `GUARDRAIL_HASH=0x9bd27ccb…`，`PDR`/`EXECUTION` 计算完成
  - 读取链上 `PREV=0x04ceda08…`，算出 `SEMANTIC`
  - TEE 生成 TDX quote（5010 bytes）
  - `SUBMIT_TX=0x8563c26e…` **STATUS=1，GAS=3,474,328**，`NEW_LAST_RECEIPT_HASH=0xb28e3ec3…`
  - `DECISION=approved_onchain`
- **Agent 在真实 TEE 内自主决策 + 自证 + 上链，全程无人干预**（⚠️ 见下方更正）
- `tee-runtime/`：双 LLM 隔离（可插拔，OpenAI 兼容适配器 + mock 回退）、PACE 验证器、护栏管线；离线 `semanticDigest` 与链上一致

> ⚠️ **更正（2026-09-16 审计发现）**：本节的 `GUARDRAIL_HASH=0x9bd27ccb…` 来自 `tee/intee/agent.mjs` 当时**手写的独立护栏实现**，其 guardrailHash 是硬编码的 `keccak256(toUtf8Bytes("guardrail-v1"))`——**该值不可能等于链上认证的 `agentGuardrailHash = keccak256(abi.encode("guardrail-v1", policyHash(policy)))`**。也就是说：那笔"STATUS=1"的收据之所以能上链，是因为 `_submit` 当时**没有**校验 guardrailHash 与 registry 认证值的一致性；而该决策摘要**不是**挑战者会独立重推导出的同一个值（两者 `norm` 也不同：手写版缺 leet 折叠）。因此「摘要与链上一致」这条早于 challenger/parity 出现的结论，**对 guardrailHash 口径不成立**。
> 已修复（2026-09-16）：`tee/intee/agent.mjs` 删除自实现，改为 import `tee-runtime/runtime.mjs` 与 `challenger/verify.mjs` 的权威实现，第三口径从根上消除；部署路径同步改为 `MODULES_B64`（见 `scripts/pack-intee.mjs`）。**修复后尚未重跑 CVM E2E**（需 Phala 部署 + `@phala/dstack-sdk`，本机不可验）。

## 运行时的 env（部署时用 `phala deploy -e` 注入，加密封进 TEE）
`APP_B64` / `MODULES_B64`（2026-09-16 新增：`tee-runtime/` + `challenger/` 的 tar.gz，见 `scripts/pack-intee.mjs`）/ `RPC` / `PK`（testnet 丢弃钱包）/ `REGISTRY` / `AGENT_ID` / `TARGET` / `AMOUNT` / `DATA` / `PER_TX_LIMIT` / `DAILY_LIMIT`（无默认值，缺失即 `CONFIG_ERROR` 退出）/ `MAX_SLIPPAGE_BPS` / `ALLOWED_ASSETS` / `WHITELIST` / `TRUSTED_CMD` / `MARKET_DATA` / `BLOCKLIST` / `DAILY_SPENT`
（LLM：`LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL`，见 `.env.example`）

## ✅ D5 现场 E2E 完成（2026-09-11）
- `scripts/d5-e2e-prepare.mjs` 选定收据字段并算 `semanticDigest`
- 起 Phala CVM `aegis-d5e2e`，`get_quote(semanticDigest||nonce)` 产出真 quote（`tee/d4e2e/quote.hex`），CVM 已删
- `scripts/d5-e2e-submit.mjs`：部署 `ReceiptRegistry` `0xD5411ac5Ee8Bf9007c0F1dAfF6d3C3D98CcCA359`，挂真实 `DcapGate`，调用 `submitReceiptWithQuote`
- 结果：**status 1，gasUsed 3,765,634**，`lastReceiptHash=0x04ceda08…337ddd`，stored executionHash == expected ✅
- **完整闭环在 Monad 上跑通**：真 TDX quote → 链上验真+绑定 → 收据落库

## ERC-8004 自部署三注册表完成（2026-09-12）
- 背景：官方 Identity `0x8004A169…` 在 Monad testnet 无代码（codeLen=0，主网才有），改为按 EIP-8004 接口自主实现
- 合约：`contracts/IdentityRegistry.sol`（ERC-721+URIStorage+register 重载+agentWallet）、`contracts/ReputationRegistry.sol`（giveFeedback/readFeedback/getSummary/revoke）、复用自部署 ValidationRegistry
- hardhat.config.js 开 `viaIR: true`（ReputationRegistry 栈太深）；编译 24 文件，12/12 测试通过
- 部署（Monad testnet）：
  - IdentityRegistry `0xC99D2957fdA1455E68dF2181A4bB97fd73081A74`
  - ReputationRegistry `0xb5B853BcE92940b8E5BFba131301509eaCFb5c9f`
  - ValidationRegistry `0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa`
- 注册：`agentId=1`，agentURI=base64 内联注册文件，supportedTrust=[reputation, validation, tee-attestation]
- 验证闭环：validationRequest → validationResponse(100, "tee-dcap") 通过
- 声誉：client `0xAB3c…b0ec` giveFeedback(100, "successRate"/"tee") status=1；getSummary count=1 value=100
- 脚本：`scripts/erc8004.mjs`
- 坑：Monad RPC 间歇抛 `-32603 Internal error: Archive error: Error getting index data`（eth_getTransactionReceipt 也会中招）→ `scripts/lib.mjs` 改用 **FallbackProvider**（官方 + Ankr `https://rpc.ankr.com/monad_testnet`，quorum=1，stallTimeout 2.5s 自动切换）；publicnode 404、alchemy demo/drpc/thirdweb 不可用
- 注意：ethers v6 同名重载需用完整签名做 key（`encodeFunctionData("register(string)", …)`），否则 "ambiguous function description"

## D6 负例测试完成（2026-09-12）
- 脚本：`scripts/d6-negative.mjs`（fresh ReceiptRegistry + 真 quote，8 项攻击向量 + 1 正例对照）
- 结果（8+1/9，各层 revert 原因逐项核对）：
  - A1 过期锚点(blockHeight-50) → `Stale attestation` ✅
  - A2 伪造区块锚点 → `Block hash mismatch` ✅
  - A3 坏 quote → 由免费 view 扫描证实（见下）
  - A4 跨收据 quote(d4) → `DCAP report_data not bound` ✅
  - A5 篡改 executionHash → `DCAP report_data not bound` ✅
  - A6 护栏不匹配（registry 侧改错后提交正确 quote）→ `Guardrail mismatch` ✅
  - B1 正例对照 → status=1, gasUsed=3,837,429 ✅
  - C1 正例后重放同一 quote → `not bound`（哈希链 prev 已变，重放保护生效）✅
  - D1 非 governance setDcapGate → `Not governance` ✅（第二钱包 staticCall）
- 测试顺序坑：正例对照必须放最后——它消耗哈希链（prev 变化）后，所有后续提交都先命中重放保护
- A3 结论：`scripts/dcap-corrupt-sweep.mjs` 位置扫描（全 view 调用，零成本）：
  - baseline 原 quote → (true, true)
  - 翻转 1 nibble @ header(40)/report_mac(120)/report 体(400)/tee_data(800)/QE(1200,2000,3000)/cert 链(4000,8022,9022,9822) → **全部拒绝**（verified=false 或 revert require(false)）
  - 仅尾部 ~100 hex chars（证书后的惰性 padding）被忽略 → 预期行为，非签名覆盖区
  - **V4 verifier 无真实完整性盲区**
- 坑：quote 尾部就是 `0000`，用 `slice(0,-4)+"00"` 破坏等于原值——破坏必须选真实字节
- 注意：钱包余额 0.36 MON；每次完整 d6 运行消耗 ~0.15 MON（fresh registry + 3.8M gas 正例）
- **钱包余额告急（2026-09-12）**：0.36 MON——部署 tx（3.84M gas × maxFee ~200 gwei）需预留 ~0.78 MON，已无法再部署新 registry；D6 证据已充分（上轮 8/9 + 扫描证实 A3），无需重跑；后续链上工作（Orchestrator 写侧/demo 录制）需先从 faucet 补充 testnet MON

## Orchestrator 写侧 + 收据索引器完成（2026-09-13）
- **写侧**（`orchestrator/server.mjs`）：`POST /api/agent/command?agentId=1`
  - 完整决策管线（镜像 in-TEE 闭环）：护栏（注入模式+blocklist）→ PACE（白名单+per-tx 限额）→ 读链（prev+治理护栏哈希）→ fresh nonce → semanticDigest
  - `dryRun=true`（默认）→ approved_preview（零 gas）；`dryRun=false` → 治理自授权 agentTEE → `submitReceipt`（onlyTEE 路径）
  - 实测（Monad testnet）：交易收据 **status=1, gas 138,409**（quote 路径 3.8M 的 1/27）、心跳 **status=1, gas 97,749**；prev 正确链接成哈希链
  - 负例实测：注入指令 → `blocked_by_guardrail`（3 原因）；超额 → `exceeds_per_tx_limit`；护栏未注册 → 显式报错
  - signer 未配置时自动降级 dryRun-only
- **收据索引器**（`scripts/index-receipts.mjs`）：Monad RPC `eth_getLogs` **严格限 100 块范围**（-32614），官方+Ankr 均限；解决方案：**JSON-RPC batch**（30 个 getLogs/HTTP 请求可用）+ 100 块窗口 + fetch 20s 超时 + 并发回扫 700k 块 → `orchestrator/receipts-cache.json`
- **Orchestrator 读侧升级**：`/api/receipts` = 缓存（索引器产物）+ 实时尾扫（最近 2000 块）；provider 改 FallbackProvider（官方+Ankr）
- **坑（重要）**：`ReceiptSubmitted` 事件 topic0 必须用**完整签名字段**（含 executionHash/pdrHash 等 9 参数）计算 = `0x57317a50484cce61…`；用缩短签名 `ReceiptSubmitted(uint256,bytes32,uint256,bool)` 算出的 topic0 错误 → getLogs 永远查不到（静默 0 结果）。硬编码 selector/topic0 前必须用 Interface 运行时计算
- **余额**：0.20 MON（写侧实测消耗：交易+心跳 ~0.02 MON）；demo 录制足够
- **索引器完成（2026-09-13）**：34.5 分钟扫 700k 块（234 batch 请求），恢复 **4 张收据**（今日交易+心跳 @62050846/91、2 天前交易+心跳 @61836771/807）；300/7000 窗口因 RPC 限流 3 次重试后放弃（历史有小缺口，重跑可补）；Orchestrator `/api/receipts` 实测返回 4 条（缓存+实时尾扫合并）——**Dashboard 收据流数据接真完成**

## ? Proposer/Challenger 双代理互证 2026-09-13 完成

**架构**：Agent A（proposer）提交收据 → Agent B（challenger）独立重推导（自持 blocklist/策略，比对 executionHash/pdrHash/摘要算术）→ ValidationRegistry validationResponse(requestHash=收据digest, 100/0) → AegisVaultQuorum._preExecutionHook 要求最新收据 response>=100 才放行 executeTrade。

**新合约**：contracts/AegisVaultQuorum.sol（继承 AegisVault，覆写 _preExecutionHook；MIN_RESPONSE=100）。IReceiptRegistry 补 lastReceiptHash 接口。未部署（余额不足），Hardhat 本地 15/15 全绿（quorum 通过 / 无验证拒绝 / challenger 拒绝 response=0）。

**运行时**：tee-runtime/challenger.mjs（challengerGuardrail/challengerPace/challengeReceipt，digest=null 时跳过摘要检查供 dryRun）；orchestrator dual 模式：dryRun 返回 challenger 预览，real 在收据上链后做 request+response（同意才上链背书，recordReject:true 拒绝也上链）。

**链上 E2E 实测（复用已部署 ValidationRegistry 0x8b96a09e...，requestHash=收据digest）**：
- challenger 钱包 0x16e619c3d6625f4d6F583791A4C2351D65508a2c（.env CHALLENGER_PK，主钱包注资 0.05 MON，tx 0xdc3705d1...）
- AGREE：收据 0xd6f89e50... → challenger request 0xcbcb1b0d... + response 0x1c42a8ce...（response=100，status=1）
- TAMPER（tamperExecHash:true + recordReject）：收据 0xe4d59674... → challenger 发现 executionHash_mismatch → response=0 上链（getValidationStatus 实测 validator=0x16e619c3 response=0 tag=challenger）
- challenger 余额剩 ~0.000033 MON（4 笔 tx 耗尽 0.05 MON，再跑需注资）

**demo 要点**：AGREE（绿灯 executeTrade 通过）+ TAMPER（红灯 response=0，合约层若用 VaultQuorum 则 executeTrade revert "No challenger quorum"——本地测试已证）。

## VaultQuorum 上链部署 + 链上 quorum E2E 完成（2026-09-13）

**部署**：AegisVaultQuorum => 0x60F9F1FBa953ce5CD9c8805CD4858eFf35BcB20a（tx 0xbac0c00d81a70274d9896ad2520cc626a40133a072497c310c31d9857991134a；参数 registry=0x91482e67、validationRegistry=0x8b96a09e、agentId=1、TEE=owner=0x2a0eECA0）。资金来源：challenger 钱包 faucet 领取后回转 1 MON 给主钱包（tx 0x55f93a81...）。脚本 scripts/deploy-quorum.mjs。

**链上 quorum E2E（scripts/quorum-e2e.mjs）**：
- setup：guardrail 0x1111...11、TEE 授权、MockTarget 部署、白名单/限额、vault 注资 0.5 MON
- 场景1（无验证）：executeTrade revert "No challenger quorum"——TradeExecuted 事件扫描确认该场景 0 个事件
- 场景2（challenger 同意）：validationRequest + validationResponse(100) → executeTrade 成功，**TradeExecuted 事件 @块 62070391，tx 0xa16248508c76f82d1a9381ca3836e1a457a1410ec8aab63e60e9f077a6b7d965**
- 注意：executeTrade 的 target.call 不带 value（原生 MON 传递为已知边界），vault 余额不动属正常
- 主钱包剩 ~0.38 MON；challenger 剩 ~4 MON
