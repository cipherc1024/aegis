// 共享工具：加载 .env、连接 Monad testnet、加载 artifact、部署/连接合约
import fs from "node:fs";
import path from "node:path";
import { JsonRpcProvider, FallbackProvider, Wallet, ContractFactory, Contract } from "ethers";

export function loadEnv(file = ".env") {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

export const RPC_LIST = [
  process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz",
  "https://rpc.ankr.com/monad_testnet",
];

export function getWallet() {
  const pk = process.env.MONAD_TESTNET_PK;
  if (!pk) throw new Error("MONAD_TESTNET_PK missing in .env");
  const backends = RPC_LIST.map((url) => ({ provider: new JsonRpcProvider(url, 10143, { staticNetwork: true, pollingInterval: 300 }), priority: 1, weight: 1, stallTimeout: 2500 }));
  const provider = new FallbackProvider(backends, 10143, { quorum: 1, cacheTimeout: -1 });
  return new Wallet(pk, provider);
}

export function loadArtifact(name, dir = "dcap-verifier/artifacts-gen") {
  return JSON.parse(fs.readFileSync(path.join(dir, name + ".json"), "utf8"));
}

export async function deploy(wallet, name, args = [], dir) {
  const art = loadArtifact(name, dir);
  const factory = new ContractFactory(art.abi, art.bytecode, wallet);
  const c = await factory.deploy(...args);
  const tx = c.deploymentTransaction();
  if (tx) console.log(`  deploy ${name} tx: ${tx.hash}`);
  await c.waitForDeployment();
  const addr = await c.getAddress();
  console.log(`  ${name} => ${addr}`);
  return c;
}

export function attach(wallet, name, address, dir) {
  const art = loadArtifact(name, dir);
  return new Contract(address, art.abi, wallet);
}
