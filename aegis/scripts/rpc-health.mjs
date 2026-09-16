// 诊断：分后端探 RPC 健康度，定位 orchestrator "could not coalesce error"。
import { loadEnv } from "./lib.mjs";
import { JsonRpcProvider } from "ethers";
loadEnv();

const BACKENDS = [
  process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz",
  "https://rpc.ankr.com/monad_testnet",
];

for (const url of BACKENDS) {
  process.stdout.write(url.padEnd(45));
  try {
    const p = new JsonRpcProvider(url, 10143);
    const n = await p.getBlockNumber();
    const b = await p.getBlock(n);
    process.stdout.write(`  block=${n} hash=${b.hash?.slice(0, 12)} ts=${b.timestamp}\n`);
  } catch (e) {
    process.stdout.write(`  FAIL: ${String(e?.shortMessage || e?.message || e).slice(0, 120)}\n`);
  }
}
process.exit(0);
