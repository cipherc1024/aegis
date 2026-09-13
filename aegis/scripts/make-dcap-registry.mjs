// 把 on-chain-pccs 的 deployment/10143.json 映射成 dcap 脚本期望的
// network-registry/current/10143/onchain_pccs.json
import fs from "node:fs";

const SRC = "C:/Users/12190/Desktop/本科二年级/Monad量化/aegis/vendor/on-chain-pccs-repo/deployment/10143.json";
const DIR = "C:/Users/12190/Desktop/本科二年级/Monad量化/aegis/vendor/dcap-repo/rust-crates/libraries/network-registry/deployment/current/10143";
const OUT = DIR + "/onchain_pccs.json";

const src = JSON.parse(fs.readFileSync(SRC, "utf8"));

const out = {
  AutomataDaoStorage: src.AutomataDaoStorage,
  AutomataDaoStorageV2: src.AutomataDaoStorageV2,
  AutomataPcsDao: src.AutomataPcsDao,
  AutomataPcsDaoV2: src.AutomataPcsDaoV2,
  AutomataPckDao: src.AutomataPckDao,
  AutomataPckDaoV2: src.AutomataPckDaoV2,
  // DeployRouter.run() 读 "AutomataTcbEvalDao"；用我们的 CrlV2 版本占位，随后 updateCrlV2TcbEvalConfig 会重设
  AutomataTcbEvalDao: src.AutomataTcbEvalDaoCrlV2,
  AutomataTcbEvalDaoCrlV2: src.AutomataTcbEvalDaoCrlV2,
  AutomataEnclaveIdentityDaoVersionedCrlV2_tcbeval_20: src.AutomataEnclaveIdentityDaoVersionedCrlV2_tcbeval_20,
  AutomataFmspcTcbDaoVersionedV2CrlV2_tcbeval_20: src.AutomataFmspcTcbDaoVersionedV2CrlV2_tcbeval_20,
  EnclaveIdentityHelper: src.EnclaveIdentityHelper,
  FmspcTcbHelper: src.FmspcTcbHelper,
  FmspcTcbHelperV2: src.FmspcTcbHelperV2,
  PCKHelper: src.PCKHelper,
  TcbEvalHelper: src.TcbEvalHelper,
  X509CRLHelper: src.X509CRLHelper,
  X509CRLHelperV2: src.X509CRLHelperV2,
  PccsDependencyConfig: src.PccsDependencyConfig,
};

fs.mkdirSync(DIR, { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(out, null, 2));
console.log("wrote", OUT);
console.log(JSON.stringify(out, null, 2));
