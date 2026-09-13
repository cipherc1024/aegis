// 生成一个新的 Monad testnet 专用丢弃钱包，私钥写入 .env（不打印私钥）
// 用法: node scripts/new-wallet.mjs
import fs from "node:fs";
import { Wallet } from "ethers";

const envPath = ".env";

if (fs.existsSync(envPath) && /^MONAD_TESTNET_PK=/m.test(fs.readFileSync(envPath, "utf8"))) {
  console.error(".env 已包含 MONAD_TESTNET_PK，停止以免覆盖你已有的钱包。");
  console.error("若确实要重来，请先手动删除 .env 里那一行。");
  process.exit(1);
}

const w = Wallet.createRandom();
const env = [
  "",
  `MONAD_TESTNET_PK=${w.privateKey}`,
  "MONAD_TESTNET_RPC=https://testnet-rpc.monad.xyz",
  "MONAD_TESTNET_CHAIN_ID=10143",
  "",
].join("\n");
fs.writeFileSync(envPath, env);

console.log("已生成新的测试钱包（私钥已写入 .env，未打印）。");
console.log("地址:", w.address);
console.log("");
console.log("下一步：去 https://faucet.monad.xyz （Monad Testnet, Chain ID 10143）给这个地址领测试 MON。");
