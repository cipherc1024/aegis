// 用 solc-js + 自定义 import callback 编译 Automata DCAP 验证器（绕过 Hardhat 不支持 remapping）
// 用法: node scripts/compile-dcap.mjs [entry.sol]
import solc from "solc";
import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

// Foundry 风格 remapping -> node_modules 实际路径
const remappings = [
  ["solady/", "node_modules/solady/src/"],
  ["openzeppelin/", "node_modules/@openzeppelin/"],
  ["@automata-network/on-chain-pccs/", "node_modules/@automata-network/on-chain-pccs/src/"],
  ["@automata-network/dcap-attestation/", "node_modules/@automata-network/automata-dcap-attestation/contracts/"],
];

function resolveToReal(importPath) {
  for (const [from, to] of remappings) {
    if (importPath.startsWith(from)) return path.resolve(ROOT, to + importPath.slice(from.length));
  }
  // 裸包名（@scope/pkg/...）-> node_modules
  const nm = path.resolve(ROOT, "node_modules", importPath);
  if (fs.existsSync(nm)) return nm;
  // solc 已按 source root 归一化过的相对路径
  return path.resolve(ROOT, importPath);
}

function readImport(importPath) {
  const real = resolveToReal(importPath);
  try {
    if (fs.existsSync(real)) return { contents: fs.readFileSync(real, "utf8") };
    return { error: `File not found: ${importPath}  ->  ${real}` };
  } catch (e) {
    return { error: e.message };
  }
}

const entries = process.argv.slice(2);
if (entries.length === 0) {
  entries.push(
    "node_modules/@automata-network/automata-dcap-attestation/contracts/verifiers/V4QuoteVerifier.sol",
    "node_modules/@automata-network/automata-dcap-attestation/contracts/PCCSRouter.sol"
  );
}

const sources = {};
for (const e of entries) {
  const key = path.relative(ROOT, path.resolve(ROOT, e)).replace(/\\/g, "/");
  sources[key] = { content: fs.readFileSync(path.resolve(ROOT, e), "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    viaIR: true,
    evmVersion: "shanghai",
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object"] } },
  },
};

console.log("Compiling", entries.length, "entry file(s) with solc", solc.version());
const output = JSON.parse(solc.compile(JSON.stringify(input), { import: readImport }));
const all = output.errors || [];
const fatal = all.filter((e) => e.severity === "error");

if (fatal.length) {
  console.error(`\n${fatal.length} compile ERROR(S):\n`);
  for (const e of fatal) console.error(e.formattedMessage);
  process.exit(1);
}

const outDir = "dcap-verifier/artifacts-gen";
fs.mkdirSync(outDir, { recursive: true });
let n = 0;
for (const [file, cs] of Object.entries(output.contracts)) {
  for (const [name, c] of Object.entries(cs)) {
    if (!c.evm?.bytecode?.object) continue;
    fs.writeFileSync(
      path.join(outDir, `${name}.json`),
      JSON.stringify({ file, contractName: name, abi: c.abi, bytecode: "0x" + c.evm.bytecode.object }, null, 2)
    );
    n++;
  }
}
console.log(`\n✅ Compiled OK. Wrote ${n} contract artifacts to ${outDir}/`);
