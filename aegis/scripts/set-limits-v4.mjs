// 给已部署的 quorum 金库设 PACE 限额（onlyOwner，幂等：已是目标值则跳过）
// 用法：node scripts/set-limits-v4.mjs [地址]
// 缺省地址取 .env 的 QUORUM_VAULT
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv(path.join(__dirname, "..", ".env"));

const PER_TX = 50_000_000_000_000_000n;      // 0.05 MON
const DAILY = 1_000_000_000_000_000_000n;    // 1 MON

const artifact = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, "..", "artifacts", "contracts", "AegisVault.sol", "AegisVault.json"),
    "utf8"
  )
);

const wallet = await getWallet();
const addr = process.argv[2] || process.env.QUORUM_VAULT;
if (!addr) { console.error("缺少金库地址（argv 或 .env QUORUM_VAULT）"); process.exit(1); }

const vault = new Contract(addr, artifact.abi, wallet);

console.log(`=== 金库 ${addr}`);
const [perTxBefore, dailyBefore, owner, tee] = await Promise.all([
  vault.perTxLimit(), vault.dailyLimit(), vault.owner(), vault.teeDerivedAddress(),
]);
console.log(`  owner   => ${owner}`);
console.log(`  tee     => ${tee}`);
console.log(`  现值    => perTx=${perTxBefore} daily=${dailyBefore}`);

if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
  console.error(`  owner 不是当前钱包（${wallet.address}），无法 setLimits`);
  process.exit(1);
}

if (perTxBefore === PER_TX && dailyBefore === DAILY) {
  console.log("  已是目标值，无需变更");
  process.exit(0);
}

const tx = await vault.setLimits(PER_TX, DAILY);
console.log(`  setLimits tx ${tx.hash} ...`);
const rc = await tx.wait();
console.log(`  已上链 @${rc.blockNumber} gas ${rc.gasUsed}`);

const [perTxAfter, dailyAfter] = await Promise.all([vault.perTxLimit(), vault.dailyLimit()]);
console.log(`  读回    => perTx=${perTxAfter} daily=${dailyAfter}`);
if (perTxAfter !== PER_TX || dailyAfter !== DAILY) {
  console.error("  读回与目标不符");
  process.exit(1);
}
console.log("  OK");
