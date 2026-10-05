# Aegis — TEE-Attested Autonomous Trading Agent

> Monad Metropolis 黑客松 · 赛道 **Trust, Identity & AI Infrastructure**（官方条款写作 **Track 04**）
> 一句话：给"持有链上资金的自主 AI 代理"做**可验证执行**——AI 每一步决策都变成密码学对象，
> 金库只执行"能被独立第二套实现重推导出相同结论"的字节。

**完整技术文档见 [`aegis/README.md`](aegis/README.md)**（信任边界、合约设计、复现表、诚实边界清单）。
**一键零 gas 复现表**见 [`aegis/ARTIFACT.md`](aegis/ARTIFACT.md) §1；**链上证据索引**（Tenderly + tx 表）见 §2。

## 快速开始

```bash
cd aegis
npm ci                             # 锁定 lockfile；.npmrc 固定 legacy-peer-deps
npx hardhat test                   # 44 passing（零 gas）
node challenger/selftest.mjs       # 17 pass / 0 fail
node scripts/parity-check.mjs      # 21 agree / 0 diverge
node scripts/attack-family.mjs     # 8 as-expected / 0 unexpected（含 1 项刻意的"拦不住"）
```

无需任何 API key 或私钥——全部 harness 刻意做到**环境无关**（详见 `aegis/README.md` 的"运行"节）。
`scripts/soa-demo.mjs` 另需一个**丢弃用的用户角色签名键**（`SOA_USER_PK`，只签 canonical JSON、不碰链、不需要资金）。

## 目录结构

| 路径 | 内容 |
|---|---|
| `aegis/contracts/` | Solidity 合约：`AegisVault`/`AegisVaultQuorum`（执行闸门）、`ReceiptRegistry`（收据哈希链）、自部署 ERC-8004 三注册表、M2/M3 组件 |
| `aegis/tee-runtime/` | 确定性判定管线：护栏（零宽/leet 归一化）→ PACE（白名单+限额）→ 目标层 L5 |
| `aegis/challenger/` | **独立重推导进程**（L1–L5，不 import proposer 任何模块）+ 链上 validation |
| `aegis/orchestrator/` | proposer 侧零依赖服务（读侧只读端点 + 写侧，含两道 fail-closed 闸门） |
| `aegis/dcap-verifier/` | 链上 DCAP 验证集成（Automata V4 verifier + PCCS），完整工程记录在其 `STATUS.md` |
| `aegis/tee/intee/` | in-TEE 自治闭环（Phala TDX CVM 内实测；复用仓库权威模块） |
| `dashboard/` | Next.js 14 统一入口（19 路由，全部真实读数或显式边界论证） |
| `aegis/scripts/` | 复现 harness、负例/攻击族实验、代价曲线、部署、Tenderly 预检、索引器 |

## 合规披露（Monad Metropolis 条款 §4.1）

- **开源许可**：本仓库以 **MIT License** 发布，全文见 [`LICENSE`](LICENSE)；全部 Solidity 源码顶部带
  `SPDX-License-Identifier: MIT`。MIT 是条款 §7.2 列举的 OSI 认可许可之一。
- **AI 编码工具使用披露**（§4.1.4）：本项目开发过程中**大量使用 AI 编码助手（agent 形式）**参与实现、
  重构、内部审计与文档撰写；**设计决策、合约部署、链上资金操作与最终核验由人类作者完成**。
  本仓库引用的每一个合约地址、tx 哈希与实验数字都经链上或公开来源核实。
- **第三方代码与库的归属**（§4.1.1）：完整表格见 [`aegis/README.md`](aegis/README.md) 的「合规披露 ③」。
  要点：Automata V4 quote verifier / on-chain PCCS（MIT）、OpenZeppelin（MIT）、solady（MIT）、ethers（MIT）、
  Hardhat 与 solc（MIT）、`@phala/dstack-sdk` 与 `@phala/dcap-qvl`（Apache-2.0）、Next/React/Tailwind/viem/zustand（MIT）、
  `lucide-react`（ISC）、TypeScript（Apache-2.0）——**无 copyleft 传染项**。
  ERC-8004 三注册表为**自行实现**（官方 testnet 无部署，链上实测 `codeLen=0`）；本地 `vendor/`（约 359 MB 的
  Automata 源码树）不随仓库分发，`dcap-verifier/artifacts-gen/` 可由 `node scripts/compile-dcap.mjs` 从 npm 依赖重建。
- **原创性与 build window**（§4.1.4）：官方 build window 为 **2026-09-01 – 2026-10-14**；本仓库 git 历史自
  **2026-09-13** 起，覆盖本次提交的全部代码，**不含窗口外的既有代码**。

## 链上证据（浏览器即可核验，无需本地环境）

Monad testnet（chainId **10143**）。现行生产金库
`AegisVaultQuorum = 0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De`；
自部署核心合约（金库/收据账本/DcapGate/三注册表/M2/M3）共 **9 个已在 Tenderly 源码级公开验证**（匿名免登录可查），
关键端到端 tx 可在 Monad 区块浏览器直接查证——地址表、tx 表与匿名复测命令见
[`aegis/ARTIFACT.md`](aegis/ARTIFACT.md) §2。

## 诚实边界

本项目主动交底：LLM 跑在 TEE 之外（刻意的）、challenger 验证的是策略合规性与签署目标 ε-一致性（非完整重推导 LLM 推理）、
输入真实性不可验证（不可能性边界，实验里有刻意的负对照）、真实协议路径当前是官方 WMON wrap（重置后 testnet 无可核实的第三方 DEX）、
以及**链上金库 owner / TEE 执行地址 / proposer 签名地址当前是同一把密钥**（见 `aegis/README.md`「已知边界」首条）。
