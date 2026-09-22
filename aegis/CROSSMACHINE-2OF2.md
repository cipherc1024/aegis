# 跨机 2-of-2 保姆级操作指南（两台电脑）

> **给谁看**：完全不懂命令行的小白。照着复制粘贴即可。
> **目标**：把 **B 电脑**变成独立的「挑战者（challenger）」，与 **A 电脑**（proposer）组成
> **真 2-of-2**：A 提交决策收据 → B 独立重算并上链背书 → A 的金库只在 B 背书后才执行。
> **配套脚本**：本仓库 `scripts/crossmachine-2of2.mjs`（单机排练）、`challenger/`（B 要拷的目录）。
> 日期：2026-09-18。

---

## 0. 先说人话：我们在做什么

- **A 电脑**：负责"出主意"的代理（proposer）。它想花用户的钱，会先把"我打算这么做"写成一笔
  链上记录（收据）。
- **B 电脑**：负责"查作业"的独立裁判（challenger）。它把 A 的收据拿来，用自己的代码
  从头算一遍。算得对就上链说"通过（100）"，算得不对就说"拒绝（0）"。
- **规矩**：A 的钱包（金库）**只在 B 说通过之后**才肯花钱。B 的私钥只存在 B 电脑上，A 拿不到。

**A 和 B 必须是两台不同的电脑**（不同主机名、不同文件夹、不同钱包）。这样"查作业"的裁判才
没法被 A 偷偷改掉。

> 本指南分两段：
> **第一段（5 分钟，零花钱）**：先证明 B 电脑能独立跑起来（自测 17/17）。
> **第二段（约 40 分钟，需要少量测试币）**：把两台电脑连起来，跑一次真正的链上 2-of-2。

---

## 0.5 一键脚本（推荐先看）

装好 Node 后，在 B 电脑上进入 `challenger` 文件夹，**双击 `一键配置-第二台机器.cmd`**（Windows），
或运行 `./setup-second-host.sh`（Mac / Linux），或直接在终端：

```powershell
cd C:\aegis\challenger
node setup-second-host.mjs
```

脚本自动完成：检查 Node → 装依赖 → **生成本机独立钱包（打印地址）** → 写 `.env` → 跑自测
（应 **17/17**）→ 打印下一步。

拿到 A 的 IP 与金库地址后，**一条命令连上并开跑**：

```powershell
node setup-second-host.mjs --orch-url http://<A的IP>:8787 --vault <QUORUM_VAULT> --run
```

**A 电脑（第一台机器）**：B 把地址发给你后，在 `aegis` 文件夹：

- Windows **双击 `一键接入-第二台机器.cmd`**；或终端：
  ```powershell
  cd "你的路径\Monad量化\aegis"
  node scripts/setup-proposer-for-challenger.mjs --challenger 0xB的地址
  ```
  脚本自动：写 `CHALLENGER_ADDR` → **部署金库并授权 B** → 更新 `QUORUM_VAULT` → 治理认证策略 →
  加 WMON 白名单 → **打印 A 的 IP 和 B 该运行的命令**（会花约 0.4 MON，需输入 yes 确认）。
  先看流程不花钱可用 `--dry`。

（§1–§3 是同样的手工步骤，供理解与排错；只跟脚本走也能跑通。）

---

## 1. 五分钟版：先证明 B 能独立跑（零 gas）

在 **B 电脑**上做（A 不用动）。

### 1.1 装 Node.js
1. 打开浏览器，进 https://nodejs.org/ ，下载 **LTS** 版 Windows 安装包（.msi）。
2. 双击安装，**一路点下一步**（"Add to PATH" 保持勾选）。
3. 装完，打开 PowerShell：按 `Win` 键，输入 `powershell`，回车。
4. 输入下面两行，各回车：
   ```powershell
   node -v
   npm -v
   ```
   应分别显示类似 `v20.x.x` 和 `10.x.x`。**若提示不是命令**，关掉 PowerShell 重开一次。

### 1.2 把 challenger 文件夹拷到 B
- 在 **A 电脑**上找到文件夹：`...\Monad量化\aegis\challenger`
- 整个文件夹拷到 **B 电脑**（U 盘 / 微信文件传输 / 压缩成 zip 再传都行）。
- 在 B 上把它放到一个好找的位置，例如 `C:\aegis\challenger`。
  （**只拷 challenger 这一个文件夹即可**，它自带所需的 package.json。）

### 1.3 在 B 上安装依赖并自测
在 B 的 PowerShell 里，逐行复制粘贴（**把路径换成你实际放的位置**）：
```powershell
cd C:\aegis\challenger
npm install
node selftest.mjs
```
- `npm install` 会联网下载依赖（1–3 分钟）。
- `node selftest.mjs` 最后应显示 **`selftest: 17 pass / 0 fail`**。
  **看到 17/17 = B 电脑能独立完成全部"查作业"逻辑，且完全不依赖 A 的代码。**

> 到这一步，你已经证明了"转机 + 自包含"。要跑真正的链上 2-of-2，继续第二段。

---

## 2. 第二段准备（两台机器都要做一次）

### 2.1 A 电脑：确认能跑起来
在 **A** 的 PowerShell：
```powershell
cd "你的路径\Monad量化\aegis"
npm install
npx hardhat compile
```
- `npx hardhat compile` 全绿即可（编译合约）。
- A 需要一份 `.env` 文件（里面有 A 的钱包私钥、RPC、模型 key）。若还没有：
  把 `.env.example` 复制成 `.env`，按注释填写。**A 还需要 testnet 测试币**（见 §2.3）。

### 2.2 确认文件夹结构
| 电脑 | 需要有什么 |
|---|---|
| A | 整个 `Monad量化\aegis` 仓库（orchestrator + 合约 + 脚本） |
| B | **只有** `challenger` 文件夹 |

### 2.3 领测试币（faucet）
- A 的钱包地址（`MONAD_TESTNET_PK` 对应的地址）和 B 的钱包地址（下一步生成）各领一点测试 MON：
  浏览器打开 https://faucet.monad.xyz ，粘贴地址，领取。
- A 建议至少 **0.5 MON**（部署要花钱）；B 只需一点点（提交一次背书，约 0.01 MON）。

---

## 3. 第二段：跑真正的链上 2-of-2

> **关键顺序**：先让 B 生成地址 → A 用这个地址部署并授权 → A 启动 → B 连上 → 跑一次。
> **顺序不能反**：A 必须一开始就把 B 的地址登记成"可信裁判"。

### 3.1 B：生成自己的钱包，把地址发给 A

在 **B** 的 PowerShell（在 challenger 目录里）：
```powershell
cd C:\aegis\challenger
node gen-key.mjs
```
- 屏幕会打印 `address : 0x....` 和 `private : 0x....`。
- **把 `address` 那一串复制下来，发给 A**（微信/文件都行）。
- `private` 那一串是你的钥匙，**留在 B 电脑上，不要发给任何人、不要发聊天窗口**。

### 3.2 A：把 B 登记成可信裁判，并部署金库

在 **A** 电脑上：
1. 打开 A 仓库根目录的 `.env` 文件（用记事本），加一行（把地址换成 B 发给你的）：
   ```
   CHALLENGER_ADDR=0x把B的地址粘这里
   ```
2. 保存。然后在 A 的 PowerShell：
   ```powershell
   cd "你的路径\Monad量化\aegis"
   node scripts/deploy-v4.mjs
   ```
   - 需要 A 余额 ≥ 0.4 MON。
   - 它会：部署一个新的金库 → 把 B 的地址设成可信裁判 → 设置限额。
   - 屏幕最后会打印 `QUORUM_VAULT = 0x....`，**把这串记下来**。
3. 把 A 的 `.env` 里 `QUORUM_VAULT=` 这一行改成上面那个新地址，保存。
4. 认证策略（让链上认可 A 的策略）：
   ```powershell
   node challenger/policy-attest.mjs --execute
   ```
5. 把 WMON 加入金库白名单：
   ```powershell
   node scripts/whitelist-wmon.mjs
   ```
6. 启动 A 的服务（**这个窗口不要关**）：
   ```powershell
   node orchestrator/server.mjs
   ```
   看到监听 8787 就对了。另开一个 PowerShell 验证：
   ```powershell
   curl "http://localhost:8787/api/status?agentId=1"
   ```
   能返回内容即成功。

### 3.3 B：配置并连接

在 **B** 的 PowerShell（challenger 目录里）：
1. 生成配置文件：
   ```powershell
   copy .env.example .env
   ```
2. 用记事本打开 `C:\aegis\challenger\.env`，改这几行（其余保持默认）：
   ```
   CHALLENGER_PK=0x你的私钥（node gen-key.mjs 打印的 private）
   ORCH_URL=http://A的IP:8787
   VAULT=0x A 刚打印的 QUORUM_VAULT
   ```
   - `A的IP`：见 §3.4 怎么找。
3. 再自测一次（应仍 17/17）：
   ```powershell
   node selftest.mjs
   ```
4. 启动裁判（**这个窗口不要关**）：
   ```powershell
   node challenger-agent.mjs
   ```

### 3.4 怎么找 A 的 IP / 两台机器怎么连

**情况一：A 和 B 连同一个 WiFi / 同一个路由器（最简单）**
1. 在 **A** 的 PowerShell 输入 `ipconfig`，回车。
2. 找到 `IPv4 地址`，形如 `192.168.1.23`，这就是" A 的 IP"。
3. B 的 `ORCH_URL` 填 `http://192.168.1.23:8787`。
4. 如果 B 连不上，可能是 A 的防火墙挡住了 8787。在 **A 用管理员身份**打开 PowerShell，运行：
   ```powershell
   New-NetFirewallRule -DisplayName "Aegis Orchestrator 8787" -Direction Inbound -LocalPort 8787 -Protocol TCP -Action Allow
   ```

**情况二：A 和 B 不在同一个网络（一个在家一个在学校等）**
用隧道把 A 的服务临时暴露出去。在 **A** 上：
1. 安装 cloudflared（任选其一）：
   - 用 winget：`winget install cloudflare.cloudflared`；或
   - 去 https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/ 下载 Windows 版。
2. 运行（**这个窗口不要关**，它会打印一个网址）：
   ```powershell
   cloudflared tunnel --url http://localhost:8787
   ```
3. 复制它打印的 `https://xxxx.trycloudflare.com` 网址，填进 B 的 `ORCH_URL`（去掉末尾斜杠）。

### 3.5 跑一次完整的 2-of-2

保持 A 的 `orchestrator/server.mjs` 和 B 的 `challenger-agent.mjs` 都在运行。在 **A** 上
**另开一个** PowerShell：
```powershell
cd "你的路径\Monad量化\aegis"
node scripts/soa-demo.mjs --onchain
```
会发生三件事（可在 Monad 区块浏览器或用 A 的终端看到）：
1. A 提交一笔"决策收据"上链；
2. B 抓到收据 → 独立重算 → 上链回复"通过（100）"；
3. A 的金库确认 B 的背书后，才真正执行（`executeTrade`）。

**成功的标志**：B 的窗口打印出各层 `pass` 并显示它提交了一笔 `validationResponse`；
A 的窗口显示 `executeTrade` 成功。

---

## 4. 跑完后要记录什么（给论文/评审用）

| 要记录的东西 | 在哪看 |
|---|---|
| A 的电脑名 | A 上运行 `hostname` |
| B 的电脑名 | B 上运行 `hostname` |
| **B 的钱包地址** | §3.1 `node gen-key.mjs` 的输出 |
| 第 1 笔：A 提交收据的 tx 哈希 | A 的窗口 / 区块浏览器 |
| **第 2 笔：B 回复背书的 tx 哈希** | B 的窗口（这是"B 是独立主机独立钱包"的关键证据） |
| 第 3 笔：A 执行交易的 tx 哈希 | A 的窗口 |
| 新金库地址 | §3.2 的 `QUORUM_VAULT` |

> **判断"真 2-of-2"的两个硬条件**：① A、B 的 `hostname` 不同；② B 的钱包地址 ≠ A 的任何钱包。
> 满足这两条 + 上面三笔 tx，就是可提交的 Reproduced 证据。

---

## 5. 常见报错对照表（小白版）

| 屏幕上的字 | 什么意思 | 怎么办 |
|---|---|---|
| `node` 不是命令 | 没装 Node 或没重开窗口 | 重装 Node，关掉 PowerShell 重开 |
| `policy_not_attested` | A 没有按 B 的策略去链上认证 | 在 A 上运行 `node challenger/policy-attest.mjs --execute` |
| 拉不到决策原文 / response=0 | B 连不上 A 的 `ORCH_URL` | 检查 IP/网址、A 的服务是否在跑、防火墙/隧道 |
| `No challenger quorum` | A 的金库没把 B 登记成可信裁判 | 回到 §3.2，确认 `CHALLENGER_ADDR` 填的是 B 的地址并重新部署 |
| `insufficient funds` | 某个钱包测试币不够 | 去 https://faucet.monad.xyz 领币 |
| `npm install` 卡住/报网络错 | 网络问题 | 换网络重试；或配置 npm 镜像 |
| B 提示 `MODEL_CHALLENGE=true 需要完整仓库` | B 只拷了 challenger 却开了交叉模型层 | 把 B 的 `.env` 里 `MODEL_CHALLENGE=false`（默认就是 false） |

---

## 6. 老实交代（写进论文时必须保留的边界）

1. **两台不同的电脑**才算真 2-of-2。若只在同一台电脑上跑两个进程（或用虚拟机），只能叫
   "单机排练 / 同一物理主机的独立 guest"，**不能写成"真跨机"**。
2. 本仓库跑过一次**单机转机排练**（`node scripts/crossmachine-2of2.mjs`，结果在
   `scripts/crossmachine-2of2-attestation.json`）：证明了 challenger 可转机、可在独立进程跑，
   **但这不是真跨机**。
3. **不存在"一个进程一口气跑完 A→B→A 全链"的证据**：B 的 CVM 记录止于提交收据，
   后续由 A 的端到端流程覆盖。不要声称"单进程全链"。
4. 论文/文档里引用仓库，**只写"匿名镜像网址 + tag 名"**，不要写裸的 commit 哈希。
5. B 的私钥只存在 B 电脑；任何情况下不要外传或提交。

---

## 附：一段话总结给完全不懂的人

> 你有两台电脑。A 负责干活，B 负责检查。B 是一台**独立**的电脑、用**自己的钥匙**。
> 你把 B 的钥匙地址告诉 A，A 就认这个裁判；以后 A 每次想花钱，B 都要先独立对一遍账，
> B 点头（100）A 才敢花。我们上面做的，就是把这套"独立检查"在真实区块链上跑通，
> 并把每一步的链上记录留作证据。
