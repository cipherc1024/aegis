// Phase 4 前置核实：候选 DEX/协议合约在 Monad testnet 上是否有代码（只读，零 gas）
// 用 ethers 而非 shell 内联，避开引号与错误响应误判。
import { JsonRpcProvider } from "ethers";
import { loadEnv } from "./lib.mjs";

loadEnv();
const RPC = process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz";
const p = new JsonRpcProvider(RPC, undefined, { staticNetwork: true });

const CANDIDATES = [
  ["WMON (官方文档 canonical)", "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541"],
  ["Permit2 (canonical)", "0x000000000022D473030f116dDEE9F6b43aC78BA3"],
  ["CreateX (canonical)", "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed"],
  ["v4 PoolManager (canonical)", "0x000000000004444c5dc75cB358380D2e3dE08A90"],
  ["v3 Factory (canonical)", "0x1F98431c8aD98523631AE4a59f267346ea31F984"],
  ["Router02 (canonical)", "0xEfF92A263d31888d860bD50809A8D171709b7b1c"],
  ["UR v2/v3 (canonical)", "0x3fc91a3afd70395cd496c647d5a7cc6c4b2c729"],
];

for (const [name, addr] of CANDIDATES) {
  try {
    const code = await p.getCode(addr);
    console.log(`${name.padEnd(30)} ${addr} codeLen=${(code.length - 2) / 2}`);
  } catch (e) {
    console.log(`${name.padEnd(30)} ${addr} ERROR: ${String(e?.message || e).slice(0, 80)}`);
  }
}

// WMON 合约元数据核实（name/symbol/decimals）
const wmon = new (await import("ethers")).Contract(
  "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541",
  ["function name() view returns (string)", "function symbol() view returns (string)", "function decimals() view returns (uint8)", "function totalSupply() view returns (uint256)"],
  p
);
try {
  const [n, s, d, ts] = await Promise.all([wmon.name(), wmon.symbol(), wmon.decimals(), wmon.totalSupply()]);
  console.log(`\nWMON: name=${n} symbol=${s} decimals=${d} totalSupply=${ts}`);
} catch (e) {
  console.log(`WMON metadata ERROR: ${String(e?.message || e).slice(0, 120)}`);
}
