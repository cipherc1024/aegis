import { Contract, Interface } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();
const provider = wallet.provider;
const IDENTITY = "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432";
const idIface = new Interface([
  "function register(string agentURI) returns (uint256 agentId)",
  "function register() returns (uint256 agentId)",
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function owner() view returns (address)",
  "function getAgentWallet(uint256) view returns (address)",
]);

async function call(to, data) {
  try {
    const r = await provider.call({ to, data });
    return { ok: true, data: r };
  } catch (e) {
    return { ok: false, reason: e.reason, data: e.data, short: e.shortMessage, err: JSON.stringify(e.error ?? {}).slice(0, 300) };
  }
}

console.log("codeLen:", ((await provider.getCode(IDENTITY)).length - 2) / 2);
for (const sig of ["name()", "symbol()", "owner()"]) {
  const r = await call(IDENTITY, idIface.encodeFunctionData(sig));
  console.log(sig, "=>", JSON.stringify(r).slice(0, 200));
}

const agentURI = "data:application/json;base64," + Buffer.from(JSON.stringify({ name: "Aegis Alpha" })).toString("base64");
const d1 = idIface.encodeFunctionData("register(string)", [agentURI]);
const r1 = await call(IDENTITY, d1);
console.log("register(string) =>", JSON.stringify(r1).slice(0, 400));
const d2 = idIface.encodeFunctionData("register()");
const r2 = await call(IDENTITY, d2);
console.log("register() =>", JSON.stringify(r2).slice(0, 400));
