// 复算 Automata helper 的 CREATE2 地址（确定性部署器 + 官方 salt + 我们的 initcode）
// 用法: 在 vendor/on-chain-pccs-repo 目录下运行: node <path>/compute-helpers.mjs
import fs from "node:fs";
import path from "node:path";
import { keccak256, getCreate2Address, toUtf8Bytes } from "ethers";

const DEPLOYER = "0x4e59b44847b379578588920cA78FbF26c0B4956C";
const helpers = [
  ["EnclaveIdentityHelper", "ENCLAVE_IDENTITY_HELPER_SALT"],
  ["FmspcTcbHelper", "FMSPC_TCB_HELPER_SALT"],
  ["FmspcTcbHelperV2", "FMSPC_TCB_HELPER_V2_SALT"],
  ["PCKHelper", "X509_HELPER_SALT"],
  ["X509CRLHelper", "X509_CRL_HELPER_SALT"],
  ["X509CRLHelperV2", "X509_CRL_HELPER_V2_SALT"],
  ["TcbEvalHelper", "TCB_EVAL_HELPER_SALT"],
  ["PccsDependencyConfig", "PCCS_DEPENDENCY_CONFIG_SALT"],
];

const out = {};
for (const [name, saltStr] of helpers) {
  const p = path.join("out", `${name}.sol`, `${name}.json`);
  if (!fs.existsSync(p)) {
    console.log(`${name.padEnd(24)} artifact missing (${p})`);
    continue;
  }
  const art = JSON.parse(fs.readFileSync(p, "utf8"));
  const bc = art.bytecode?.object;
  if (!bc || bc === "0x") {
    console.log(`${name.padEnd(24)} no bytecode`);
    continue;
  }
  const initCodeHash = keccak256(bc);
  const salt = keccak256(toUtf8Bytes(saltStr));
  const addr = getCreate2Address(DEPLOYER, salt, initCodeHash);
  out[name] = addr;
  console.log(`${name.padEnd(24)} ${addr}`);
}

fs.mkdirSync("deployment", { recursive: true });
fs.writeFileSync("deployment/10143.json", JSON.stringify(out, null, 2));
console.log("\nwrote deployment/10143.json");
