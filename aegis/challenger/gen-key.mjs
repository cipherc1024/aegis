// 生成 challenger 独立钱包（在队友机器上运行；切勿复用 proposer 的任何 key）
import { Wallet } from "ethers";
const w = Wallet.createRandom();
console.log("address :", w.address);
console.log("private :", w.privateKey);
console.log("\n把 private 写入本目录 .env 的 CHALLENGER_PK，然后去 faucet 领 testnet MON：");
console.log("  https://faucet.monad.xyz");
console.log("⚠️ 私钥只存在这台机器；不要提交、不要发聊天窗口。");
