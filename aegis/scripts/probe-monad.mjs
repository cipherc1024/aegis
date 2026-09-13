// D3 免费探测：Monad testnet 区块 gas 上限 + P-256(RIP-7212) 预编译是否存在
// 用法: node scripts/probe-monad.mjs
import crypto from "node:crypto";
import { JsonRpcProvider } from "ethers";

const RPC = process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz";
const provider = new JsonRpcProvider(RPC);

console.log("RPC:", RPC);

// ---------- 1) 区块 gas 上限 ----------
const blk = await provider.getBlock("latest");
console.log("\n[1] block number:", blk.number);
console.log("    gasLimit:", blk.gasLimit.toString(), `(${(Number(blk.gasLimit) / 1e6).toFixed(1)}M)`);
if (blk.baseFeePerGas) console.log("    baseFeePerGas:", blk.baseFeePerGas.toString());

// ---------- 2) P-256 / RIP-7212 预编译 @ 0x100 ----------
const P256 = "0x0000000000000000000000000000000000000100";
const message = Buffer.from("aegis-p256-probe");
const digest = crypto.createHash("sha256").update(message).digest();

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const der = crypto.sign("sha256", message, privateKey); // ECDSA-P256 over sha256(message)

function readDerSig(buf) {
  let i = 0;
  if (buf[i++] !== 0x30) throw new Error("bad DER seq");
  let len = buf[i++];
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let k = 0; k < n; k++) len = (len << 8) | buf[i++];
  }
  if (buf[i++] !== 0x02) throw new Error("bad DER r");
  const rlen = buf[i++];
  const r = buf.subarray(i, i + rlen);
  i += rlen;
  if (buf[i++] !== 0x02) throw new Error("bad DER s");
  const slen = buf[i++];
  const s = buf.subarray(i, i + slen);
  return { r: to32(r), s: to32(s) };
}
function to32(b) {
  while (b.length > 1 && b[0] === 0) b = b.subarray(1);
  if (b.length > 32) throw new Error("int too long");
  const out = Buffer.alloc(32);
  b.copy(out, 32 - b.length);
  return out;
}

const { r, s } = readDerSig(der);
const N = BigInt("0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551");
const HALF = N >> 1n;
let sBig = BigInt("0x" + s.toString("hex"));
if (sBig > HALF) sBig = N - sBig; // low-s 规范化
const sBuf = Buffer.from(sBig.toString(16).padStart(64, "0"), "hex");

const jwk = publicKey.export({ format: "jwk" });
const x = Buffer.from(jwk.x, "base64url");
const y = Buffer.from(jwk.y, "base64url");

const input = "0x" + Buffer.concat([digest, r, sBuf, x, y]).toString("hex");
console.log("\n[2] P-256 precompile probe @ 0x100");
console.log("    input bytes:", (input.length - 2) / 2);

try {
  const ret = await provider.call({ to: P256, data: input });
  console.log("    returnData:", ret);
  if (ret === "0x" + "00".repeat(31) + "01") {
    console.log("    => ✅ P-256 预编译【支持】(有效签名被接受)");
  } else if (ret === "0x") {
    console.log("    => ❌ 未检测到 P-256 预编译 (对无代码地址调用返回空)");
  } else {
    console.log("    => ⚠️ 返回了非预期数据，需人工判断");
  }
} catch (e) {
  console.log("    => ⚠️ 调用 revert/报错:", e.shortMessage || e.message);
}

try {
  const est = await provider.estimateGas({ to: P256, data: input });
  console.log("    estimateGas:", est.toString());
} catch (e) {
  console.log("    estimateGas:", e.shortMessage || e.message);
}
