// 查任意 tx 的链上结局（绕过 FallbackProvider，直连单后端重试）。
import { loadEnv } from "./lib.mjs";
import { JsonRpcProvider } from "ethers";
loadEnv();

const hash = process.argv[2];
if (!hash) {
  console.error("usage: node scripts/check-tx.mjs <txHash>");
  process.exit(1);
}
const urls = [
  process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz",
  "https://rpc.ankr.com/monad_testnet",
  "https://rpc-testnet.monadinfra.com",
];

for (const url of urls) {
  process.stdout.write(url.padEnd(42));
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const p = new JsonRpcProvider(url, 10143);
      const r = await p.getTransactionReceipt(hash);
      if (!r) {
        process.stdout.write("  receipt=null (未打包或后端滞后)");
      } else {
        process.stdout.write(
          `  status=${r.status} block=${r.blockNumber} gas=${r.gasUsed} from=${r.from.slice(0, 10)} to=${r.to?.slice(0, 10)}`
        );
      }
      process.stdout.write("\n");
      break;
    } catch (e) {
      if (attempt === 2) process.stdout.write(`  FAIL: ${String(e?.message || e).slice(0, 90)}\n`);
      else await new Promise((r) => setTimeout(r, 1200));
    }
  }
}
process.exit(0);
