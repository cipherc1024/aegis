// 部署 AegisVaultQuorum（proposer/challenger 互证金库）到 Monad testnet
import { loadEnv, getWallet, deploy } from "./lib.mjs";
loadEnv();
const wallet = getWallet();

const REGISTRY = "0x4622D041696942dC873a8A5E54f1e1ca9669c90B"; // ReceiptRegistry v2（旧 v1 已废弃）
const VALIDATION = "0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa"; // ERC-8004 ValidationRegistry
const AGENT_ID = 1n;
const TEE = "0x2a0eECA027B617F5e6f631a5475dc283294Ff0a9"; // proposer TEE signer（主钱包代）
const OWNER = "0x2a0eECA027B617F5e6f631a5475dc283294Ff0a9"; // 主钱包为 owner

console.log("deployer:", wallet.address);
const vault = await deploy(wallet, "AegisVaultQuorum", [REGISTRY, AGENT_ID, TEE, OWNER, VALIDATION], "artifacts/contracts/AegisVaultQuorum.sol");
const addr = await vault.getAddress();
console.log("AegisVaultQuorum:", addr);

const vr = await vault.validationRegistry();
console.log("validationRegistry set:", vr);
process.exit(0);
