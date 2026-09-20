// 为 Tenderly 源码验证生成三合约的 standard JSON input，
// 并用**部署交易 calldata**（creation code + 构造参数）做真实比对：keccak256(onchain input) == keccak256(compiled init+args)。
// 这比 runtime 比对更强——runtime 里 immutable 槽位被写入，creation code 不带该差异。
//
// 用法: node scripts/tenderly-prep-w11.mjs
import solc from "solc";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ethers } from "ethers";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const BUILD_INFO = "artifacts/build-info/2b0b82ef1a9ee20440f585ac7703894f.json";
const OUT_DIR = path.join(ROOT, ".tenderly-verify");

const TARGETS = [
  { name: "CommittedOracle", addr: "0xe3D4a4F8DA20654dC2D845F130C654beb75C8967",
    deployTx: "0x4ae38837b87ed0ca61d14917ea883bc938ce37e13fb57983cee46d72168b91d7", args: [] },
  { name: "AtomicExecutor", addr: "0x0861C00133eCDf67fE61501F61D3fB8969A0e3D6",
    deployTx: "0x979e8ca8c7ae3a9817869048c26d6b0806190d3fb76c1cba2f46dcc9b2d8bf8b",
    args: ["0xe3D4a4F8DA20654dC2D845F130C654beb75C8967", "0xFb8bf4c1CC7a94c73D209a149eA2AbEa852BC541",
           ethers.keccak256(ethers.toUtf8Bytes("WMON/MON")), 50_000_000_000_000_000n] },
  { name: "AuditDraw", addr: "0x4EabbF03aa526D4B5C012Cd176D69025Cc52CE45",
    deployTx: "0x98280ea8a9e7376ebf7ef4608fdca8785d3e457502bbd4143fc7e264544bf950", args: [] },
];

const bi = JSON.parse(fs.readFileSync(path.join(ROOT, BUILD_INFO), "utf8"));
console.log("build-info solc:", bi.solcLongVersion, "| local solc:", solc.version());
console.log("evmVersion:", bi.input.settings.evmVersion, "| optimizer:", JSON.stringify(bi.input.settings.optimizer),
            "| viaIR:", bi.input.settings.viaIR);
console.log("");

const out = JSON.parse(solc.compile(JSON.stringify(bi.input)));
const errs = (out.errors || []).filter((e) => e.severity === "error");
if (errs.length) { for (const e of errs) console.error(e.formattedMessage); process.exit(1); }

fs.mkdirSync(OUT_DIR, { recursive: true });
// 三合约同属一个 source unit 集合，standard input 共用一份（Tenderly JSON Upload 可逐个合约选）
const inputPath = path.join(OUT_DIR, "w11-standard-input.json");
fs.writeFileSync(inputPath, JSON.stringify(bi.input));
console.log("dumped standard input ->", path.relative(ROOT, inputPath));

const provider = new ethers.JsonRpcProvider(process.env.MONAD_TESTNET_RPC || "https://testnet-rpc.monad.xyz", 10143, { staticNetwork: true });

let allOk = true;
for (const t of TARGETS) {
  const file = `contracts/${t.name}.sol`;
  const c = out.contracts[file][t.name];
  const init = "0x" + c.evm.bytecode.object;
  const iface = new ethers.Interface(c.abi);
  const encoded = iface.encodeDeploy(t.args).slice(2);
  const expected = (init + encoded).toLowerCase();

  const tx = await provider.getTransaction(t.deployTx);
  const onchain = tx.data.toLowerCase();
  const match = onchain === expected;
  if (!match) allOk = false;

  // 单合约 standard input（Tenderly 也支持只上传一个合约的 input）
  const single = {
    language: "Solidity",
    sources: { [file]: { content: bi.input.sources[file].content } },
    settings: bi.input.settings,
  };
  const sp = path.join(OUT_DIR, `w11-${t.name}-standard-input.json`);
  fs.writeFileSync(sp, JSON.stringify(single));

  console.log(`== ${t.name} @ ${t.addr}`);
  console.log(`   部署 tx      : ${t.deployTx}`);
  console.log(`   链上 input   : ${onchain.length / 2 - 1} bytes`);
  console.log(`   重编译 input : ${expected.length / 2 - 1} bytes`);
  console.log(`   keccak 一致  : ${match ? "MATCH ✓" : "MISMATCH ✗"}`);
  console.log(`   standard input -> ${path.relative(ROOT, sp)}`);
  console.log("");
}

console.log(allOk ? "全部三合约 creation-input 逐字节一致 → Tenderly 源码验证可行" : "存在不一致，需排查");
process.exit(allOk ? 0 : 1);
