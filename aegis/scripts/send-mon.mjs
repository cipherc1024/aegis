// 给指定地址转 testnet MON（默认从 challenger 钱包出，用于给第二台机器的 challenger 新钱包注资，省去 faucet）
// 用法: node scripts/send-mon.mjs <to> <amountMON> [--from main|challenger]
import { FallbackProvider, JsonRpcProvider, Wallet, getAddress, parseEther, formatEther } from "ethers";
import { loadEnv } from "./lib.mjs";

loadEnv();

const positional = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const fromIdx = process.argv.indexOf("--from");
const fromFlag = fromIdx > -1 ? process.argv[fromIdx + 1] : "challenger";

if (positional.length < 2 || !["main", "challenger"].includes(fromFlag)) {
  console.log("usage: node scripts/send-mon.mjs <to> <amountMON> [--from main|challenger]");
  process.exit(1);
}

const to = getAddress(positional[0]);
const amount = positional[1];
const pk = fromFlag === "main" ? process.env.MONAD_TESTNET_PK : process.env.CHALLENGER_PK;
if (!pk) throw new Error(`${fromFlag === "main" ? "MONAD_TESTNET_PK" : "CHALLENGER_PK"} missing in .env`);

const urls = [process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz", "https://rpc.ankr.com/monad_testnet"];
const provider = new FallbackProvider(
  urls.map((url) => ({ provider: new JsonRpcProvider(url, 10143, { staticNetwork: true, pollingInterval: 300 }), priority: 1, weight: 1, stallTimeout: 2500 })),
  10143,
  { quorum: 1, cacheTimeout: -1 }
);
const wallet = new Wallet(pk, provider);

const [balFrom, balTo] = await Promise.all([provider.getBalance(wallet.address), provider.getBalance(to)]);
console.log(`from ${wallet.address} (${fromFlag})  ${formatEther(balFrom)} MON`);
console.log(`to   ${to}  ${formatEther(balTo)} MON`);

const value = parseEther(amount);
if (balFrom < value) throw new Error(`insufficient balance: have ${formatEther(balFrom)}, need ${amount}`);

const tx = await wallet.sendTransaction({ to, value });
console.log(`tx: ${tx.hash}`);
const rc = await tx.wait();
console.log(`mined @${rc.blockNumber}, gas ${rc.gasUsed}`);

const [after] = await Promise.all([provider.getBalance(to)]);
console.log(`done. ${to} now has ${formatEther(after)} MON`);
