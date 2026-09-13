// 把 tee/collateral.json 的 Intel 签名 collateral 灌进已部署的 DAO（legacy 路径）
import fs from "node:fs";
import { Contract } from "ethers";
import { loadEnv, getWallet } from "./lib.mjs";

loadEnv();
const wallet = getWallet();

const OUT = "vendor/on-chain-pccs-repo/out";
const abiOf = (name) => JSON.parse(fs.readFileSync(`${OUT}/${name}.sol/${name}.json`, "utf8")).abi;
const dep = JSON.parse(fs.readFileSync("vendor/on-chain-pccs-repo/deployment/10143.json", "utf8"));
const collateral = JSON.parse(fs.readFileSync("tee/collateral.json", "utf8"));

const CA = { ROOT: 0, PROCESSOR: 1, PLATFORM: 2, SIGNING: 3 };
const ENCLAVE_TD_QE = 2;
const PCS_API_VERSION = 4;

const ADDR = {
  PcsDao: dep.AutomataPcsDao,
  FmspcTcbDaoV1: "0xf1271d0813AeED748790a8f5157CcB2bF8E5aF1B",
  EnclaveIdDao: "0xC7Ab05a9aCB14c92cE227A0f7E2A8e2630c30210",
};
console.log("wallet:", wallet.address);

function pemToDerList(pem) {
  const parts = pem.split("-----END CERTIFICATE-----").map((s) => s.trim()).filter(Boolean);
  return parts.map((p) => {
    const b64 = p.replace(/-----BEGIN CERTIFICATE-----/g, "").replace(/\s+/g, "");
    return "0x" + Buffer.from(b64, "base64").toString("hex");
  });
}
const bytesToHex = (arr) => "0x" + Buffer.from(arr).toString("hex");

const pckChain = pemToDerList(collateral.pck_certificate_chain).filter((c) => (c.length - 2) / 2 > 0);
const issuerChain = pemToDerList(collateral.tcb_info_issuer_chain).filter((c) => (c.length - 2) / 2 > 0);
console.log("pckChain sizes:", pckChain.map((c) => (c.length - 2) / 2));
console.log("issuerChain sizes:", issuerChain.map((c) => (c.length - 2) / 2));

const pcsDao = new Contract(ADDR.PcsDao, abiOf("AutomataPcsDao"), wallet);
const fmspcDao = new Contract(ADDR.FmspcTcbDaoV1, abiOf("AutomataFmspcTcbDaoVersioned"), wallet);
const enclaveDao = new Contract(ADDR.EnclaveIdDao, abiOf("AutomataEnclaveIdentityDaoVersioned"), wallet);

async function send(label, p) {
  try {
    const tx = await p;
    console.log(`[${label}] tx ${tx.hash}`);
    const r = await tx.wait();
    console.log(`[${label}] status ${r.status}`);
    return r;
  } catch (e) {
    console.log(`[${label}] ERROR: ${e.shortMessage || e.message}`);
    return null;
  }
}

await send("grant fmspc", fmspcDao.grantRoles(wallet.address, 1));
await send("grant enclave", enclaveDao.grantRoles(wallet.address, 1));

// ROOT / SIGNING 取 issuer chain（[signing, root]）；PLATFORM 取 pck 链倒数第二张
const ROOT = issuerChain[issuerChain.length - 1];
const SIGNING = issuerChain[0];
const PLATFORM = pckChain[1]; // leaf=0, intermediate=1, root=2

await send("pcs ROOT", pcsDao.upsertPcsCertificates(CA.ROOT, ROOT));
await send("pcs SIGNING", pcsDao.upsertPcsCertificates(CA.SIGNING, SIGNING));
await send("pcs PLATFORM", pcsDao.upsertPcsCertificates(CA.PLATFORM, PLATFORM));
await send("rootCaCrl", pcsDao.upsertRootCACrl(bytesToHex(collateral.root_ca_crl)));
await send("pckCrl", pcsDao.upsertPckCrl(CA.PLATFORM, bytesToHex(collateral.pck_crl)));
await send("fmspc TCB", fmspcDao.upsertFmspcTcb([collateral.tcb_info, bytesToHex(collateral.tcb_info_signature)]));
await send(
  "enclave QE",
  enclaveDao.upsertEnclaveIdentity(ENCLAVE_TD_QE, PCS_API_VERSION, [
    collateral.qe_identity,
    bytesToHex(collateral.qe_identity_signature),
  ])
);
console.log("done.");
