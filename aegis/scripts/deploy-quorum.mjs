// 部署 AegisVaultQuorum（proposer/challenger 互证金库）到 Monad testnet
import { loadEnv, getWallet, deploy } from "./lib.mjs";
loadEnv();
const wallet = getWallet();

const REGISTRY = "0x91482e67998a01C0A33Fe12ec01A6A43177A7181"; // ReceiptRegistry
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
