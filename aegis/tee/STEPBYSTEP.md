# D1：在 Phala Cloud 产出一份真实 TDX quote（逐步）

> 前置：Node 18+、Phala CLI 已装（`phala --version`）。本仓库已 `npm install`。
> 目标：拿到一份**真实 TDX quote**，并**离链验证通过**。成本：tdx.small ≈ $0.06/小时，新账号有 $20 赠额。

## Step 1 — 登录
```powershell
phala login
```
浏览器会自动打开完成设备登录；若不行，去 dashboard → API Tokens → Create Token，然后：
```powershell
phala login --manual
```
确认：
```powershell
phala status
```

## Step 2 — 进入 tee 目录并部署
```powershell
cd "C:\Users\12190\Desktop\本科二年级\Monad量化\aegis\tee"
phala deploy -c docker-compose.yml -n aegis-quote -t tdx.small --wait
```
`--wait` 会阻塞到部署完成。记下输出的 CVM 名称（`aegis-quote`）。

## Step 3 — 确认运行中
```powershell
phala cvms get aegis-quote
```
状态应为 `running`。

## Step 4 — 取 attestation（真实 TDX quote）
```powershell
phala cvms attestation aegis-quote -j > attestation.json
```
（若 `-j` 输出不是纯 JSON，改用 dashboard：CVM → **Attestations** → 复制完整报告存成 `attestation.json`。）

## Step 5 — 离链验证（D1 判定点）
回到 aegis 目录：
```powershell
cd "C:\Users\12190\Desktop\本科二年级\Monad量化\aegis"
node scripts/verify-quote.mjs tee/attestation.json
```
期望看到 `status: "UpToDate"`（或 `SWHardeningNeeded` 等合法 TCB 状态）与 `quote bytes: ...`。

也可把 quote 粘到官方 explorer 交叉核对：https://proof.t16z.com/

## Step 6 — 立刻删除 CVM（停止计费）
```powershell
phala cvms delete aegis-quote
```
> 注意：`stop` 只停算力费，**磁盘仍计费**；要彻底停费必须 `delete`。

## 记账提醒
- tdx.small ≈ $0.06/小时；D1 全程几分钟 → 成本以"美分"计。
- 若赠额未到账，先确认账号已通过验证（Verified accounts get $20 CVM credits）。
