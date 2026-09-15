# Aegis Challenger —— 独立验证进程

这是 Aegis 的 challenger（挑战者）端。它运行在 **proposer 之外的机器上**，构成 2-of-2 互证：proposer 提交决策收据，challenger 独立重推导后决定是否背书；**金库只执行被 challenger 背书过的决策**。proposer 的机器上没有任何 challenger 私钥 —— 这是真正的角色分离。

## Challenger 做什么（5 层独立重推导，每层都可单独说"不"）

| 层 | 检查 | 拒绝原因 |
|---|---|---|
| L1 策略认证 | 收据的 guardrailHash 必须等于本机 `challenger-policy.json` 算出的认证值 | `policy_not_attested` |
| L2 独立护栏 | 自持 normalize + 注入模式 + blocklist，独立重跑 | `challenger_blocks_decision:*` |
| L3 独立 PACE | 白名单 / 单笔限额 / 日限（dailySpent 直读 vault 链上） | `challenger_policy_reject:*` |
| L4 算术绑定 | 重算 executionHash/pdrHash/digest；决策原文的执行字段必须是链上 executionHash 的 preimage | `*_mismatch` |
| L5 目标层（SOA-lite，原文携带 objective 时启用） | 验证用户对目标 u 的 EIP-191 签名 + 执行动作对 u 的 ε-最优性（金额偏离 ≤ tol） | `challenger_objective_reject:*` |

L5 的语义：用户签署的是**目标**（期望金额 ± ε、上限、期限），不是某条指令。LLM 被注入后即使想"多买两倍"，也会被 `objective_not_eps_optimal` 拦下；目标被篡改则签名直接失效。未携带 objective 的原文 = 该层缺席（如实标注，不假装验证过）。时间源用链上收据 timestamp（不可伪造）；无时间源且目标带 deadline 时 fail-closed（`objective_time_unknown`）。

**Fail-closed 三条**：拉不到决策原文 → response=0（no transcript, no signature）；策略未认证 → response=0；任何层不符 → response=0。

## 部署（队友机器，约 10 分钟）

前置：Node ≥ 20。

```bash
# 1) 拷贝整个 challenger/ 目录到本机（U 盘/压缩包均可）
# 2) 安装依赖
npm install
# 3) 生成独立钱包（切勿复用 proposer 的任何 key）
node gen-key.mjs
# 4) 去 faucet 领 testnet MON：https://faucet.monad.xyz
# 5) 配置
cp .env.example .env   # 填入 CHALLENGER_PK 和 proposer 的 ORCH_URL
# 6) 先自测（零 gas、离线，应 17/17 全过）
node selftest.mjs
# 7) 运行
node challenger-agent.mjs        # 常驻轮询
node challenger-agent.mjs --once # 单次处理最新收据（演示用）
```

> **自包含范围**：确定性层 L1–L5 全部在本目录内（selftest 也只依赖本目录 + ethers）。可选交叉模型层（`MODEL_CHALLENGE=true`）需要完整仓库（challenger/ 与 tee-runtime/ 同级）——只拷本目录时保持默认关闭即可；显式开启但缺依赖时进程启动即报错退出（不静默降级）。

## 网络说明

本进程只发起**出站**连接：Monad 公共 RPC（读链+上链）+ orchestrator HTTP（拉决策原文）。无需开放任何入站端口。proposer 的 orchestrator（:8787）与本机同网段时直连；跨网段时 proposer 侧起一行隧道即可（如 `cloudflared tunnel --url http://localhost:8787`，然后把分配的 URL 填进 `ORCH_URL`）。

## 策略变更流程

`challenger-policy.json` 是 challenger 自持的策略（白名单/blocklist/限额），**可以比 proposer 更严格**。修改后必须通知 proposer 重跑：

```bash
# proposer 侧（先打印看差异，零 gas）：
node policy-attest.mjs
# 确认无误后设置上链（治理交易，~0.01 MON gas）：
node policy-attest.mjs --execute
```

不重跑 attest，challenger 会以 `policy_not_attested` 拒绝所有收据 —— 这是设计行为。

## 安全须知

- 私钥只存在本机 `.env`，不要提交、不要外传。
- 不复用 proposer 侧的任何钱包。
- `RECORD_REJECT=true` 时拒绝也上链留证（demo 作恶演示用）；默认 false（拒绝不上链，作恶提案止步于互证）。
- 本地审计日志：`challenger-log.jsonl`（每次验证的各层结果全部留痕）。
