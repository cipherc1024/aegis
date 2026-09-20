// v5 部署：AegisVaultQuorum（registry 可治理更换 + executeTrade 余额检查上链）
//
// 为什么是 v5：v4（0x07Be2FCd…B65bc）有两处只能靠重部署消除的缺口——
//   ① registry 是 immutable：ReceiptRegistry 一旦需要升级（改 bindTranscript 公式、
//      修 God mode），金库无法改指新表，资金要么永久困在旧金库、要么 withdraw→redeploy，
//      后者让金库地址/白名单/限额/余额历史全部作废。v5 加 setReceiptRegistry（onlyOwner）。
//   ② "Insufficient vault balance" require 只在源码里、线上 v4 是修复前字节码
//      （见 agents.md §3 待办 8）：金库没注资与标的不配合报同一句 "Trade failed"，
//      运维无法区分。v5 让该检查真正上链。
// v5 相对 v4 的 ABI 只增不改（+registry 可变、+setReceiptRegistry、+ReceiptRegistryUpdated），
// 故 orchestrator 的 VAULT_ABI 换成 v5 地址后无需改读侧代码。
//
// 幂等性：本脚本只部署 + 授权 + 设限额 + 白名单，不迁移资金。旧金库余额用 withdraw 单独处理。
//
// 用法：
//   node scripts/deploy-v5.mjs --dry            # 只做 estimateGas，零 gas，打印预估费用与前后余额
//   node scripts/deploy-v5.mjs                  # 真正部署（会花真钱）
import { loadEnv, getWallet, loadArtifact } from "./lib.mjs";
import { attestedGuardrailHash } from "../challenger/verify.mjs";
import { ContractFactory, Contract } from "ethers";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
loadEnv();
const DRY = process.argv.includes("--dry");

const wallet = getWallet();

const REGISTRY = process.env.REGISTRY || "0x4622D041696942dC873a8A5E54f1e1ca9669c90B";
const VALIDATION = process.env.VALIDATION || "0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa";
const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";
const PREV_VAULT = process.env.QUORUM_VAULT || "0x07Be2FCdAA649F11177AaCCbd68A5bFF36aB65bc";
const AGENT_ID = 1n;
const TEE = wallet.address;
const OWNER = wallet.address;
const CHALLENGER = process.env.CHALLENGER_ADDR || "0x16e619c3d6625f4d6F583791A4C2351D65508a2c";
const PER_TX = 50_000_000_000_000_000n;      // 0.05 MON
const DAILY = 1_000_000_000_000_000_000n;    // 1 MON

const policy = JSON.parse(
  fs.readFileSync(path.join(__dirname, "..", "challenger", "challenger-policy.json"), "utf8")
);
const GUARD = attestedGuardrailHash(policy);

const fee = await wallet.provider.getFeeData();
const maxFee = fee.maxFeePerGas ?? 0n;

const bal = await wallet.provider.getBalance(wallet.address);
const fmt = (v) => (Number(v) / 1e18).toFixed(6);

console.log("=== v5 部署参数 ===");
console.log("deployer    :", wallet.address);
console.log("balance     :", fmt(bal), "MON");
console.log("registry    :", REGISTRY);
console.log("validation  :", VALIDATION);
console.log("challenger  :", CHALLENGER);
console.log("guardrail   :", GUARD);
console.log("maxFeePerGas:", maxFee.toString(), "wei", `(${(Number(maxFee) / 1e9).toFixed(4)} gwei)`);
console.log("");

const art = loadArtifact("AegisVaultQuorum", "artifacts/contracts/AegisVaultQuorum.sol");
const factory = new ContractFactory(art.abi, art.bytecode, wallet);
const deployTx = await factory.getDeployTransaction(REGISTRY, AGENT_ID, TEE, OWNER, VALIDATION);

// 逐项估 gas。estimateGas 是静态调用（eth_estimateGas），不上链、不花 gas。
const deployGas = await wallet.provider.estimateGas({ ...deployTx, from: wallet.address });
const opGas = 400_000n; // setTrustedValidator / setLimits / setTarget 各约 ~70-90k，取宽裕上界
const ops = 3n;         // 授权 challenger + setLimits + WMON 白名单
const totalGas = deployGas + opGas * ops;

const deployCost = deployGas * maxFee;
const opsCost = opGas * ops * maxFee;
const totalCost = totalGas * maxFee;

console.log("=== gas 预估（estimateGas，零 gas） ===");
console.log(`  deploy AegisVaultQuorum : ${deployGas.toString()} gas  ≈ ${fmt(deployCost)} MON`);
console.log(`  3 笔治理调用（上界）    : ${(opGas * ops).toString()} gas  ≈ ${fmt(opsCost)} MON`);
console.log(`  -------------------------------------------------------`);
console.log(`  合计上界                : ${totalGas.toString()} gas  ≈ ${fmt(totalCost)} MON`);

if (DRY) {
  console.log("\n=== DRY RUN 结束（未发任何交易，余额未变） ===");
  console.log("  部署后主钱包余额（预估）:", fmt(bal - totalCost), "MON");
  console.log("  旧金库余额需另行 withdraw 迁移:", PREV_VAULT);
  const prev = new Contract(
    PREV_VAULT,
    ["function perTxLimit() view returns (uint256)", "function dailyLimit() view returns (uint256)"],
    wallet.provider
  );
  const [p, d] = await Promise.all([prev.perTxLimit(), prev.dailyLimit()]);
  console.log("  旧金库限额:", p.toString(), "/", d.toString());
  const oldBal = await wallet.provider.getBalance(PREV_VAULT);
  console.log("  旧金库余额:", fmt(oldBal), "MON（迁移时 owner 调 withdraw）");
  console.log("\n确认后运行：node scripts/deploy-v5.mjs");
  process.exit(0);
}

// ---- 真正部署 ----
if (bal < totalCost * 2n) {
  console.error(`余额不足：预估 ${fmt(totalCost)} MON，建议 ≥ ${fmt(totalCost * 2n)}（留余量）`);
  process.exit(1);
}

console.log("\n== 1/4 部署 AegisVaultQuorum v5 ==");
const vault = await factory.deploy(REGISTRY, AGENT_ID, TEE, OWNER, VALIDATION);
const tx = vault.deploymentTransaction();
console.log("  tx:", tx.hash);
await vault.waitForDeployment();
const addr = await vault.getAddress();
console.log("  AegisVaultQuorum =>", addr);

console.log("\n== 2/4 部署后链上复核 ==");
const vc = new Contract(addr, art.abi, wallet);
const [vr, rg, teeOn, ownerOn, agentOn] = await Promise.all([
  vc.validationRegistry(),
  vc.registry(),
  vc.teeDerivedAddress(),
  vc.owner(),
  vc.agentId(),
]);
const chk = (label, got, want) =>
  console.log(`  ${label}: ${got} ${String(got).toLowerCase() === String(want).toLowerCase() ? "OK" : "MISMATCH"}`);
chk("validationRegistry", vr, VALIDATION);
chk("registry  ", rg, REGISTRY);
chk("tee       ", teeOn, TEE);
chk("owner     ", ownerOn, OWNER);
console.log("  agentId   :", agentOn.toString(), agentOn === AGENT_ID ? "OK" : "MISMATCH");
const countBefore = await vc.trustedValidatorCount();
console.log("  trustedValidatorCount(初始):", countBefore.toString(), countBefore === 0n ? "OK（fail-closed）" : "MISMATCH");

console.log("\n== 3/4 授权 challenger + 设 PACE 限额 ==");
const t1 = await vc.setTrustedValidator(CHALLENGER, true);
console.log("  setTrustedValidator tx:", t1.hash);
await t1.wait();
console.log("  isTrustedValidator:", await vc.isTrustedValidator(CHALLENGER), "count:", (await vc.trustedValidatorCount()).toString());

const t2 = await vc.setLimits(PER_TX, DAILY);
console.log("  setLimits tx:", t2.hash);
await t2.wait();
const [perTx, daily] = await Promise.all([vc.perTxLimit(), vc.dailyLimit()]);
console.log("  perTxLimit:", perTx.toString(), perTx === PER_TX ? "OK" : "MISMATCH");
console.log("  dailyLimit:", daily.toString(), daily === DAILY ? "OK" : "MISMATCH");

console.log("\n== 4/4 金库白名单加 WMON ==");
const t3 = await vc.setTarget(WMON, true);
console.log("  setTarget tx:", t3.hash);
await t3.wait();
console.log("  whitelistedTargets[WMON]:", await vc.whitelistedTargets(WMON));

const balAfter = await wallet.provider.getBalance(wallet.address);
console.log("\n=== 部署完成 ===");
console.log("  QUORUM_VAULT =", addr);
console.log(`  主钱包余额: ${fmt(bal)} → ${fmt(balAfter)} MON （实耗 ${fmt(bal - balAfter)} MON）`);
console.log("\n后续（按序）：");
console.log("  1. 更新 aegis/.env 的 QUORUM_VAULT=" + addr);
console.log("  2. 旧金库余额 withdraw 迁移: node scripts/withdraw-v5.mjs  （如未写则手工 attach 调 withdraw）");
console.log("  3. 金库 deposit 注资（全链 E2E 需要）");
console.log("  4. Tenderly 源码级重新验证（编译器手选 solc 0.8.24）");
console.log("  5. 全链 E2E 复跑");
process.exit(0);
