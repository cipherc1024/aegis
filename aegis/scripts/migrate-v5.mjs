// v5 迁移：把旧金库（v4）余额 withdraw 回主钱包，并给新金库（v5）注资。
// withdraw 是 onlyOwner 且永不冻结的逃生通道 —— 这正是它存在的场景。
//
// 用法：
//   node scripts/migrate-v5.mjs --dry   # 只打印余额与预估，不发交易
//   node scripts/migrate-v5.mjs         # 执行迁移
import { loadEnv, getWallet } from "./lib.mjs";
import { Contract } from "ethers";

loadEnv();
const DRY = process.argv.includes("--dry");
const wallet = getWallet();

const OLD_VAULT = process.env.OLD_VAULT || "0x07Be2FCdAA649F11177AaCCbd68A5bFF36aB65bc";
const NEW_VAULT = process.env.NEW_VAULT || "0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De";
const FUND = 500_000_000_000_000_000n; // 0.5 MON，与 v4 复跑时一致

const ABI = ["function withdraw(uint256)", "function deposit() payable"];
const fmt = (v) => (Number(v) / 1e18).toFixed(6);

const fee = await wallet.provider.getFeeData();
const maxFee = fee.maxFeePerGas ?? 0n;

const oldBal = await wallet.provider.getBalance(OLD_VAULT);
console.log("old vault (v4):", OLD_VAULT, "balance:", fmt(oldBal), "MON");
console.log("new vault (v5):", NEW_VAULT);
console.log("main wallet   :", wallet.address, "balance:", fmt(await wallet.provider.getBalance(wallet.address)), "MON");
console.log("maxFeePerGas  :", maxFee.toString(), "wei");

if (oldBal === 0n) {
  console.log("\n旧金库已空，无需迁移。");
} else {
  const old = new Contract(OLD_VAULT, ABI, wallet);
  const wGas = await old.withdraw.estimateGas(oldBal);
  console.log(`\nwithdraw ${fmt(oldBal)} MON from v4: ${wGas.toString()} gas ≈ ${fmt(wGas * maxFee)} MON`);
  if (DRY) {
    console.log("DRY RUN：未发交易。");
  } else {
    const tx = await old.withdraw(oldBal);
    console.log("  tx:", tx.hash);
    await tx.wait();
    console.log("  迁移后旧金库余额:", fmt(await wallet.provider.getBalance(OLD_VAULT)), "MON");
    console.log("  主钱包余额:", fmt(await wallet.provider.getBalance(wallet.address)), "MON");
  }
}

if (!DRY) {
  const nv = new Contract(NEW_VAULT, ABI, wallet);
  console.log(`\n给 v5 注资 ${fmt(FUND)} MON …`);
  const tx2 = await nv.deposit({ value: FUND });
  console.log("  tx:", tx2.hash);
  await tx2.wait();
  console.log("  v5 金库余额:", fmt(await wallet.provider.getBalance(NEW_VAULT)), "MON");
  console.log("  主钱包余额:", fmt(await wallet.provider.getBalance(wallet.address)), "MON");
}
process.exit(0);
