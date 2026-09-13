// challenger → 主钱包回转 gas 资金（测试网内部转账，沿用此前惯例）
import { loadEnv, getWallet } from "./lib.mjs";
import { Wallet, parseEther, formatEther } from "ethers";
loadEnv();
const main = getWallet();
const challenger = new Wallet(process.env.CHALLENGER_PK, main.provider);
const AMT = parseEther("1.5");
const bal = await challenger.provider.getBalance(challenger.address);
console.log("challenger:", challenger.address, formatEther(bal), "MON");
console.log("main      :", main.address, formatEther(await main.provider.getBalance(main.address)), "MON");
const tx = await challenger.sendTransaction({ to: main.address, value: AMT });
const r = await tx.wait();
console.log("transfer tx:", tx.hash, "status:", r.status);
console.log("main now  :", formatEther(await main.provider.getBalance(main.address)), "MON");
console.log("challenger now:", formatEther(await challenger.provider.getBalance(challenger.address)), "MON");
process.exit(0);
