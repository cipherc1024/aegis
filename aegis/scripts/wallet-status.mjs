#!/usr/bin/env node
// 查 A 的钱包地址与 testnet 余额；也可查任意地址。
// 用法：
//   node scripts/wallet-status.mjs              # 查 A（.env 的 MONAD_TESTNET_PK）
//   node scripts/wallet-status.mjs 0x某地址      # 查任意地址（如 B 的 challenger 地址）
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Wallet, JsonRpcProvider } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV = path.join(__dirname, "..", ".env");
const m = {};
if (fs.existsSync(ENV)) for (const l of fs.readFileSync(ENV, "utf8").split(/\r?\n/)) {
  const x = l.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/); if (x) m[x[1]] = x[2];
}
const rpc = m.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz";
const faucet = m.MONAD_FAUCET || "https://faucet.monad.xyz";
const provider = new JsonRpcProvider(rpc, 10143, { staticNetwork: true });

const arg = process.argv[2];
let address = arg;
if (!address) {
  if (!m.MONAD_TESTNET_PK) { console.error("未提供地址，且 .env 无 MONAD_TESTNET_PK"); process.exit(1); }
  address = new Wallet(m.MONAD_TESTNET_PK).address;
}
const bal = await provider.getBalance(address);
console.log("address :", address);
console.log("balance :", (Number(bal) / 1e18).toFixed(4), "MON");
console.log("faucet  :", faucet);
if (Number(bal) / 1e18 < 0.4 && !arg) console.log("⚠️ 低于部署门槛 0.4 MON —— 去 faucet 领一点。");
