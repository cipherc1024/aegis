// 用 build-info 的 standard JSON input 本地重编译，与链上 runtime bytecode 逐字节 diff（immutable 槽位允许少量差异）
// 用法: node scripts/tenderly-prep.mjs <buildInfoFile> <ContractName> <0xAddress> [--dump <out.json>]
import solc from "solc";
import fs from "node:fs";
import { ethers } from "ethers";

const [buildInfoFile, contractName, address, dumpFlag, dumpPath] = process.argv.slice(2);
if (!buildInfoFile || !contractName || !address) {
  console.error("usage: node scripts/tenderly-prep.mjs <buildInfoFile> <ContractName> <0xAddress> [--dump out.json]");
  process.exit(1);
}

const bi = JSON.parse(fs.readFileSync(buildInfoFile, "utf8"));
console.log("build-info solc:", bi.solcLongVersion, "| local solc:", solc.version());
console.log("settings:", JSON.stringify(bi.input.settings));

const out = JSON.parse(solc.compile(JSON.stringify(bi.input)));
const errs = (out.errors || []).filter((e) => e.severity === "error");
if (errs.length) {
  for (const e of errs) console.error(e.formattedMessage);
  process.exit(1);
}

let target = null;
for (const [file, cs] of Object.entries(out.contracts)) {
  if (cs[contractName]) target = { file, c: cs[contractName] };
}
if (!target) {
  console.error("contract not found in output:", contractName);
  process.exit(1);
}
const runtime = "0x" + target.c.evm.deployedBytecode.object;
console.log("compiled:", contractName, "in", target.file, "| runtime bytes:", (runtime.length - 2) / 2);

const provider = new ethers.JsonRpcProvider(process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz");
const onchain = await provider.getCode(address);
console.log("onchain runtime bytes:", (onchain.length - 2) / 2);

if (onchain.length !== runtime.length) {
  console.log("MISMATCH: length differs");
} else {
  let diff = 0;
  const positions = [];
  for (let i = 2; i < runtime.length; i += 2) {
    if (runtime.slice(i, i + 2).toLowerCase() !== onchain.slice(i, i + 2).toLowerCase()) {
      diff++;
      if (positions.length < 16) positions.push((i - 2) / 2);
    }
  }
  console.log("differing bytes:", diff, "at offsets:", positions.join(","));
  if (diff === 0) console.log("PERFECT MATCH");
  else if (diff <= 128) console.log("LIKELY MATCH (immutable slots)");
  else console.log("MISMATCH: too many differing bytes");
}

if (dumpFlag === "--dump" && dumpPath) {
  fs.mkdirSync(".tenderly-verify", { recursive: true });
  fs.writeFileSync(".tenderly-verify/" + dumpPath, JSON.stringify(bi.input));
  console.log("dumped standard input -> .tenderly-verify/" + dumpPath);
}
