// Phase 4：把官方 canonical WMON 加入金库白名单（owner 交易，~43k gas）
// WMON = 0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541（docs.monad.xyz canonical，链上已核实）
import { JsonRpcProvider, FallbackProvider, Wallet, Contract } from "ethers";
import { loadEnv } from "./lib.mjs";

loadEnv();

const WMON = "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541";
const VAULT = process.env.QUORUM_VAULT;

const provider = new FallbackProvider(
  [
    { provider: new JsonRpcProvider(process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz", 10143, { staticNetwork: true }), priority: 1, weight: 1, stallTimeout: 2500 },
    { provider: new JsonRpcProvider("https://rpc.ankr.com/monad_testnet", 10143, { staticNetwork: true }), priority: 1, weight: 1, stallTimeout: 2500 },
  ],
  10143,
  { quorum: 1, cacheTimeout: -1 }
);

const vault = new Contract(VAULT, [
  "function setTarget(address,bool)",
  "function whitelistedTargets(address) view returns (bool)",
], provider);

const before = await vault.whitelistedTargets(WMON);
console.log(`vault=${VAULT}\nWMON whitelisted before: ${before}`);

if (before) {
  console.log("WMON 已在白名单，无需交易");
  process.exit(0);
}

const wallet = new Wallet(process.env.MONAD_TESTNET_PK, provider);
const tx = await vault.connect(wallet).setTarget(WMON, true);
const r = await tx.wait();
console.log("setTarget tx:", tx.hash, "status:", r.status, "gas:", r.gasUsed.toString());

const after = await vault.whitelistedTargets(WMON);
console.log("WMON whitelisted after :", after);
if (!after) process.exit(1);
console.log("✅ WMON 已加入金库链上白名单");
