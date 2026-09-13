// 验证 Monad testnet 是否支持 Cancun 的 MCOPY（loopBack 作对照）
// 用法: node scripts/probe-cancun.mjs
import { loadEnv, getWallet, deploy } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
console.log("deployer:", wallet.address);

const c = await deploy(wallet, "McopyProbe", []);
const input = "0x" + "ab".repeat(40);

try {
  const loop = await c.loopBack(input);
  console.log("loopBack:", loop, loop === input ? "✅" : "❌");
  const g = await c.loopBack.estimateGas(input);
  console.log("  loopBack gas:", g.toString());
} catch (e) {
  console.log("loopBack error:", e.shortMessage || e.message);
}

try {
  const copy = await c.copyBack(input);
  console.log("copyBack:", copy, copy === input ? "✅" : "❌");
  const g = await c.copyBack.estimateGas(input);
  console.log("  copyBack gas:", g.toString());
} catch (e) {
  console.log("copyBack error:", e.shortMessage || e.message);
}
