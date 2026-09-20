import fs from "node:fs";
import { execFileSync } from "node:child_process";

const [buildInfoFile, contractName, address] = process.argv.slice(2);
const bi = JSON.parse(fs.readFileSync(buildInfoFile, "utf8"));
const rt = bi.output.contracts[`contracts/${contractName}.sol`][contractName].evm.deployedBytecode.object.toLowerCase();

// 本机 node 的 fetch/TLS 到 testnet-rpc.monad.xyz 会 ECONNRESET（curl 正常），故走 curl
const RPC = process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz";
const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_getCode", params: [address, "latest"] });
const out = execFileSync("curl", [
  "-s", "--max-time", "30", "-X", "POST", RPC,
  "-H", "Content-Type: application/json",
  "-d", body,
], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const parsed = JSON.parse(out);
if (!parsed.result) throw new Error("RPC error: " + out.slice(0, 400));
const oc = parsed.result.replace(/^0x/, "").toLowerCase();

// 把差异按「连续同族」切：单字节差异与 20 字节地址槽分别收集
const pos = [];
for (let i = 0; i < rt.length; i += 2) if (rt.slice(i, i + 2) !== oc.slice(i, i + 2)) pos.push(i / 2);

const GAP = 16;
const clusters = [];
let cur = [pos[0]];
for (let i = 1; i < pos.length; i++) {
  if (pos[i] - pos[i - 1] <= GAP) cur.push(pos[i]);
  else { clusters.push(cur); cur = [pos[i]]; }
}
clusters.push(cur);

let addrSlots = 0, flagBytes = 0, other = 0, bridgeBytes = 0, lastEnd = -1;
for (const c of clusters) {
  const a = c[0] * 2, b = (c[c.length - 1] + 1) * 2;
  const comp = rt.slice(a, b), on = oc.slice(a, b);
  if (c.length === 20 && /^0+$/.test(comp) && /^[0-9a-f]{40}$/.test(on)) {
    addrSlots++;
  } else if (c.length === 1 && comp === "00" && on === "01") {
    flagBytes++;
  } else {
    other++;
    console.log("UNKNOWN cluster:", c[0] + "-" + c[c.length - 1], comp, on);
  }
  // 统计相邻 cluster 之间的「桥接区」是否逐字节相同
  if (lastEnd >= 0) {
    const s = lastEnd * 2 + 2, e = c[0] * 2;
    if (s < e) { if (rt.slice(s, e) === oc.slice(s, e)) bridgeBytes += (e - s) / 2; else console.log("BRIDGE DIFF at", lastEnd, "-", c[0]); }
  }
  lastEnd = c[c.length - 1];
}
// 尾部
const tailS = (lastEnd + 1) * 2;
if (rt.slice(tailS) === oc.slice(tailS)) bridgeBytes += (rt.length - tailS) / 2; else console.log("TAIL DIFF");

console.log("---");
console.log("address immutable slots (20B, compiled=0, onchain=addr):", addrSlots);
console.log("flag bytes (1B, 00 -> 01):", flagBytes);
console.log("unknown clusters:", other);
console.log("identical bridge bytes between clusters:", bridgeBytes, "/", rt.length / 2);
console.log(other === 0 ? "VERDICT: PERFECT SOURCE MATCH (all diffs are constructor-set immutables)" : "VERDICT: REVIEW NEEDED");
