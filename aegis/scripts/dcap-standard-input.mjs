// 生成 DcapGate 的 solc standard JSON input（供 Tenderly JSON Upload 验证用）
// 并本地对编译产物与链上 runtime bytecode 做逐字节 diff（immutable 槽位会有少量差异）
import solc from "solc";
import fs from "node:fs";
import path from "node:path";
import { ethers } from "ethers";

const ROOT = process.cwd();
const SRC_KEY = "dcap-verifier/contracts/DcapGate.sol"; // 必须与原始编译的 source unit 名一致（影响 metadata hash）
const ONCHAIN = "0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F";
const OUT_DIR = ".tenderly-verify";

const source = fs.readFileSync(path.resolve(ROOT, SRC_KEY), "utf8");
const input = {
  language: "Solidity",
  sources: { [SRC_KEY]: { content: source } },
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object", "metadata"] } },
  },
};

const out = JSON.parse(solc.compile(JSON.stringify(input)));
const errs = (out.errors || []).filter((e) => e.severity === "error");
if (errs.length) {
  for (const e of errs) console.error(e.formattedMessage);
  process.exit(1);
}

const c = out.contracts[SRC_KEY].DcapGate;
const runtime = "0x" + c.evm.deployedBytecode.object;
const init = "0x" + c.evm.bytecode.object;
const meta = JSON.parse(c.metadata);
console.log("solc:", solc.version());
console.log("source unit key:", SRC_KEY);
console.log("metadata sources:", Object.keys(meta.sources));
console.log("compiled runtime bytes:", (runtime.length - 2) / 2);
console.log("compiled init bytes:", (init.length - 2) / 2);

fs.mkdirSync(path.resolve(ROOT, OUT_DIR), { recursive: true });
fs.writeFileSync(path.resolve(ROOT, OUT_DIR, "dcap-standard-input.json"), JSON.stringify(input));

const provider = new ethers.JsonRpcProvider(process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz");
const onchain = await provider.getCode(ONCHAIN);
console.log("onchain runtime bytes:", (onchain.length - 2) / 2);

if (onchain.length !== runtime.length) {
  console.log("MISMATCH: length differs -> Tenderly 验证会失败（源码/settings 与部署时不符）");
  const m = runtime.length < onchain.length ? runtime : onchain;
  console.log("common prefix byte match:", m === (onchain.slice(0, m.length) === m ? m : ""));
} else {
  let diff = 0;
  const positions = [];
  for (let i = 2; i < runtime.length; i += 2) {
    if (runtime.slice(i, i + 2).toLowerCase() !== onchain.slice(i, i + 2).toLowerCase()) {
      diff++;
      if (positions.length < 12) positions.push((i - 2) / 2);
    }
  }
  console.log("differing bytes:", diff, "at offsets:", positions.join(","));
  if (diff === 0) console.log("PERFECT MATCH: runtime bytecode 与链上逐字节一致");
  else if (diff <= 128) console.log("LIKELY MATCH: 差异仅 immutable 槽位（Tenderly 从 creation input 侧比对，可验证）");
  else console.log("MISMATCH: 差异过大");
}
