# 任务：对 Aegis 项目做「功能完整性 + 可落地性」独立评估

你是一名独立技术评估员。你要评估的项目是一个**参赛作品**（Monad Metropolis 黑客松，Track 04），
不是生产系统。评估目标是回答三个问题：

1. **功能完整性**：项目文档声称做的每一件事，代码里是否真的做了？
2. **板块真实性**：前端每个页面的数字/按钮，背后是否真有数据源和写入路径？
3. **可落地性**：它离「能直接部署到生产、给真实用户使用」还差哪些硬缺口？

请**不要**给我一个笼统的分数就结束。我要的是**可核对的具体条目**。

---

## 一、项目位置与第一手材料

项目根目录：`<仓库根>`（下文相对路径均以此为基准，实际为 `Monad量化/`）

| 路径 | 是什么 |
|---|---|
| `aegis/` | 后端主体：合约、运行时、challenger、orchestrator、脚本 |
| `aegis/README.md` | 参赛级 README |
| `aegis/ARTIFACT.md` | 复现指南：一键零 gas harness 的命令与预期输出 |
| `aegis/agents.md` | 给接手者的交接文档，含「诚实边界」清单 |
| `aegis/CROSSMACHINE-2OF2.md` | 跨机 2-of-2 部署指南 |
| `aegis/dcap-verifier/STATUS.md` | 完整工程记录（地址、gas、tx 哈希） |
| `dashboard/` | Next.js 前端（20 个页面） |

**关键要求**：文档里的每一句「已完成 / 已实现 / 已实测」都是**待核实的陈述，不是事实**。
你必须去读对应的源码/链上来判断它是否成立。如果文档说「已实测」，而你没有独立复核，
你必须写「未复核」，而不是引用文档当作证据。

---

## 二、硬性约束（违反即评估无效）

1. **只读**。不要修改、新建、删除项目里的任何文件（本次评估报告除外）。不要 `git commit`。
2. **禁止发链上交易**。这是真实 testnet，gas 是真钱。不要跑 `d6-negative.mjs`、
   `m2m3-testnet.mjs`、`deploy-*.mjs`、`soa-demo.mjs --onchain` 等任何会发交易的脚本。
3. **禁止启动常驻进程**（orchestrator / challenger）。如果你想验证 HTTP 层，
   只做代码阅读，或说明「需要用户自行启动后验证」。
4. 如果发现 `.env`，只报告「存在且被 gitignore 忽略」这一事实，**不得打印其中任何内容**。
5. **不得编造**任何 URL、地址、行号、tx 哈希、测试计数。无法核实的写「无法核实」。
6. 可以运行**零 gas、离线**的验证命令（白名单在下文 §四）。

---

## 三、中性事实清单（均为可直接复核的原始观察，不含结论）

本节只列**路径、行号、字符串、计数、地址**。下列每一条都可以由你自己重跑或重读来确认；
若有与你的观察不符之处，以你的观察为准。

### 3.1 前端页面清单（`dashboard/src/app/*/page.tsx`，20 个）

| 页面路径 | 调用的数据接口/函数（源码中出现） |
|---|---|
| `/` | `useAgentStatus`、`/api/config` |
| `/architecture` | `/api/config` |
| `/audit` | 无 |
| `/backtest` | 无 |
| `/console` | 无 |
| `/copy` | `mock.ts` 的 `AGENTS` |
| `/create` | 无 |
| `/dashboard` | `useReceipts` |
| `/funds` | 无 |
| `/market` | `mock.ts` 的 `AGENTS` |
| `/notifications` | 无 |
| `/policy` | 无 |
| `/receipts` | `useReceipts`、浏览器直连 RPC |
| `/sdk` | 无 |
| `/settings` | 无 |
| `/subaccounts` | 无 |
| `/try` | `POST /api/agent/command` |
| `/vaults` | 无 |
| `/verify` | `verifyLatest`（`lib/chain.ts`），浏览器直连 RPC |

（「无」= 该文件内未出现上述任何接口调用；页数请自行与目录清单核对。）

**`vaults/page.tsx` 第 10–12 行的字面量**（组件函数体内定义，非来自接口）：
```
{ name: L("稳定币策略","Stablecoin"), risk: L("低风险","Low risk"), apy: "6.2%", tvl: "$12.4M", dd: "-0.8%", tone: "text-green" }
{ name: L("MON 生态指数","MON Ecosystem"), risk: L("中风险","Medium"), apy: "14.7%", tvl: "$6.1M", dd: "-6.3%", tone: "text-amber" }
{ name: L("高波动趋势","High-vol Trend"), risk: L("高风险","High"), apy: "31.5%", tvl: "$2.2M", dd: "-14.2%", tone: "text-red" }
```

**占位横幅组件的使用位置**（`grep -rl SampleBanner dashboard/src/app`）：
`/audit`、`/backtest`、`/console`、`/copy`、`/funds`、`/market`、`/notifications`、
`/policy`、`/sdk`、`/settings`、`/subaccounts`、`/vaults`、`/create`。
`components/SampleBanner.tsx` 导出的常量文案为 `MOCK_DATA_NOTICE`（定义在 `lib/mock.ts`）。

**页面内可见的字符串**（原文，供你判断其准确性）：
- `/console`：展示 MRTD / RTMR0 / FMSPC / TCB 四个度量名与一个「心跳」时间差文案。
- `/audit`：展示记录条数文案（形如「12,480 条记录」）与一句关于导出带哈希链校验值的说明；
  该页导出按钮属性为 `disabled`。
- `/sdk`：正文提到包名 `@aegis/sdk`。
- `/create`、`/policy`：提交按钮带 `disabled` 属性，文案含「未实现」。
- `/vaults` 的「存入」按钮、`/funds` 的「存入」「提现」、`/subaccounts` 的「创建子账户」、
  `/copy` 的「跟投」、`/market` 的跟投按钮、`/settings` 的「导出私钥」：
  在上述源码中**既无 `onClick` 也无 `disabled` 属性**。（点击后的实际后果请自行判断。）
- `/verify` 页头文案含「不依赖我们的前端 / 服务器 / TEE」。
- `/dashboard` 页：`StatCard` 与 `SafetyPanel` 组件接收 `sample` 属性。

### 3.2 后端端点清单（`aegis/orchestrator/server.mjs`）

源码中出现的路由：
`GET /api/status`、`GET /api/receipts`、`GET /api/config`、`POST /api/verify`、
`GET /api/pipeline`、`POST /api/objective/draft`、`GET /api/decision/:digest`、
`GET /api/events`(SSE)、`POST /api/agent/command`。

在同一文件中检索 `auth`、`session`、`token`、`tenant`、`apiKey` 等关键字的结果请自行复核。
`ALLOWED_ORIGINS` 的默认值为 `http://localhost:3000,http://127.0.0.1:3000`。
`server.listen(PORT, ...)` 未传 host 参数。
`DEMO_MAX_MON` 从环境变量读取，默认 `"0.1"`。

### 3.3 测试与脚本规模（可直接重跑核对）

| 命令 | 用例数（脚本内 `it(` / 用例数组计数） |
|---|---|
| `npx hardhat test` | `test/aegis.test.js` 42 个 `it(`；`test/m2m3.test.js` 29 个 |
| `challenger/selftest.mjs` | 脚本自报用例集合，覆盖 L1–L5 |
| `scripts/parity-check.mjs` | 用例数组共 21 条 |
| `scripts/d6-negative.mjs` | 8 个攻击向量 + 1 个正例对照（**会发交易，不要跑**） |
| `scripts/attack-family.mjs` | 8 条用例 |

`parity-check.mjs` 的收敛逻辑（文件尾部）：目标层用例走原因集合比对（`sameSet`），
其余用例走 `sameVerdict`；断言失败时 `process.exit(1)`。
断言字符串形如 `parity: ${pass} agree / ${fail} diverge`。
每个用例覆盖的具体场景，请自行读用例数组。

### 3.4 文件存在性观察

`scripts/d6-negative.mjs` 读取 `tee/d4e2e/params.json`、`tee/d4e2e/quote.hex`；
`scripts/tee-adversary-sim.mjs` 读取 `tee/d4/quote.hex`。
请自行在仓库内检索上述路径是否存在，并核对 `aegis/ARTIFACT.md` §1 的命令表与实际可执行性。

### 3.5 可核实的链上/配置事实

- 合约地址（chainId 10143）：
  `AegisVaultQuorum v4 0x07Be2FCdAA649F11177AaCCbd68A5bFF36aB65bc`、
  `ReceiptRegistry 0x4622D041696942dC873a8A5E54f1e1ca9669c90B`、
  `DcapGate 0xAe58A4F6DD3E2810812193D4766f11d5F3Dfc66F`、
  `ValidationRegistry 0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa`、
  `IdentityRegistry 0xC99D2957fdA1455E68dF2181A4bB97fd73081A74`、
  `ReputationRegistry 0xb5B853BcE92940b8E5BFba131301509eaCFb5c9f`。
- `receipt-*` 与 `aegis://objective/<hash>` 的绑定走 `ReceiptRegistry.bindTranscript`。
- `aegis/contracts/AegisVault.sol` 中 `executeTrade` 无 `payable` 修饰符；
  含 `require(value <= address(this).balance, "Insufficient vault balance")`；
  日限额映射 key 为 `block.timestamp / 1 days`。
- 合约中检索 `delegatecall`、`upgrade`、代理模式的结果请自行复核。
- `aegis/scripts/lib.mjs` 与 `aegis/scripts/deploy-v4.mjs` 的默认参数中，chainId 写作 `10143`。
- `aegis/challenger/challenger-agent.mjs` 的 `AGENT_ID` 取自环境变量，默认 `1`。
- `aegis/scripts/crossmachine-2of2-attestation.json` 字段原文：
  `"experiment": "crossmachine-2of2-rehearsal (single-host transfer)"`、
  `"honestLabel": "SINGLE-HOST TRANSFER REHEARSAL; true cross-machine = run printed SECOND HOST steps on another machine"`。

### 3.6 W11 合约与生产路径的关系

仓库中存在 `CommittedOracle`、`AtomicExecutor`、`AuditDraw`、`PolicyRegistry` 相关源码与脚本
（`scripts/atomic-input.mjs`、`scripts/m2m3-testnet.mjs`、`challenger/input-commitment.mjs` 等）。
它们在 `orchestrator/server.mjs`、`challenger/verify.mjs` 中的引用情况，请自行 `grep` 复核。

### 3.7 文档中与上述事实有关的自述（原文位置，供你逐条核对真伪）

`aegis/README.md`、`aegis/agents.md` 中出现的表述包括：
LLM 位于 TEE 之外；真实协议交互为 WMON wrap；输入真实性不可验证；
challenger 无经济模型、单 challenger = 2-of-2；`objectiveHash` 仅链上存证；
TEE 运行时 OPA/Membrane 阶段二三未实现；`executeTrade` 余额检查未重部署；
跨机 2-of-2 属单机排练。
以上均为**文档的自我陈述**，不是事实来源，请到对应源码/链上自行判定。

---

## 四、允许运行的命令（全部零 gas、离线、不启常驻进程）

```bash
cd <仓库根>/aegis

npx hardhat compile              # 期望 evm target: paris
npx hardhat test                 # 期望 41 passing
node challenger/selftest.mjs     # 期望 17/17
node scripts/parity-check.mjs    # 期望 21 agree / 0 diverge
node scripts/attack-family.mjs   # 期望 7 拦下 + 1 ACCEPTED
node scripts/regime-cost.mjs     # 性能数字（单机微基准，随机器漂移）
node scripts/tee-adversary-sim.mjs   # 不加 --live，只校验文档证据

cd ../dashboard
npx tsc --noEmit
npm run build
```

只读的链上查询（不花 gas）可以用，例如：
```bash
curl -s https://api.tenderly.co/api/v1/public-contracts/10143/<地址>
```
已知合约地址（chainId 10143）：
`AegisVaultQuorum v4 0x07Be2FCdAA649F11177AaCCbd68A5bFF36aB65bc`、
`ReceiptRegistry 0x4622D041696942dC873a8A5E54f1e1ca9669c90B`、
`DcapGate 0xAe58A4F6DD3E2810812193D4766f11d5F3Dfc66F`、
`ValidationRegistry 0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa`。

---

## 五、你要回答的问题（请逐条给证据）

### A. 功能完整性

1. 文档（`aegis/README.md`）声称的各项能力，**逐项**在代码里是否成立？
   每一项请给出：支撑它的文件 + 函数名 + 你的判断（成立 / 部分成立 / 不成立 / 无法核实）。
2. 有没有「文档说 A，代码做的是 B」的地方？请列出**具体位置**（文件:行）。
3. 读 `scripts/parity-check.mjs` 的用例数组与文件尾部的收敛逻辑，
   说明它实际断言的是什么、**没有**断言什么，以及这对「2-of-2 互证」这一主张的支撑程度。
4. 前端各页面中，有没有**局部**数据来自字面量或 mock 而未被标注的？
   （可查 `/` 与 `/dashboard` 的 StatCard、`/verify` 的字段、`/receipts` 显示为 `—` 的字段。）

### B. 板块真实性

5. 请给出一张**逐页表**：页面路径 | 已实现功能 | 占位内容 | 标注手段 | 剩余风险。
   **不要漏页**，按 `dashboard/src/app/*/page.tsx` 穷举。
6. 对 §3.1 列出的「既无 `onClick` 也无 `disabled`」的按钮，
   在「这是参赛作品、多数占位页已挂占位横幅」的前提下，**是否可接受**？
   如果你认为不可接受，给出最小修改建议。

### C. 可落地性（这是我最关心的部分）

7. **离生产还差什么**？请按「必须做 / 应该做 / 可以以后做」三档列出，
   每条给出为什么它是那一档。至少覆盖你观察到的：
   认证与多租户、多 agent、密钥管理、灾备、RPC 依赖、计费、可升级性、审计、监管。
8. **单点风险清单**：当前架构里，哪些环节挂掉会导致整个系统不可用或资金滞留？
   请具体到进程/服务/外部依赖。
9. 如果明天要让一个**真实用户**把自己的钱交给这个 agent 跑，你会阻止他吗？
   如果你会，请给出**最关键的 3 个阻断理由**（要具体、可验证，不要泛泛说「不够成熟」）。
10. **10 倍工作量评估**：要把这个项目从「黑客松作品」推到「可小规模真实运行」，
    你认为最大的 3 个工作项分别是什么？各需要什么（时间/人力/外部依赖）？

---

## 六、输出格式

用中文写。结构固定为：

```
## 一、总体判断（≤300 字）
## 二、功能完整性核实表（逐条，含文件:行证据）
## 三、逐页真实性表（穷举 20 页）
## 四、可落地性缺口（必须做/应该做/以后做 三档）
## 五、单点风险与阻断理由
## 六、你认为文档中最需要修正的 3 处表述
## 七、你无法核实的事项（明确列出）
```

**关于「总体判断」的格式要求**：不要给一个笼统的 0–100 分就完事。请给一个
**分维度的定性判断**，例如「核心机制：真做出来了 / 前端产品形态：占位 / 生产就绪度：低」，
并说明每个维度你是**基于什么证据**下的结论。

**最重要的要求**：区分「我实测确认」「我读了代码推断」「文档这么说但我未复核」三种状态，
并在每一条结论上明确标注属于哪一种。**不要把文档的自信当成事实依据。**
如果你发现文档的某个说法无法核实，直接写「无法核实」，这比一个漂亮的推断有价值得多。

最后：如果你认为这个项目**确实做成了某些不平凡的事**，也请明确说出来——
评估的目的是搞清楚真实水平，不是找茬。
