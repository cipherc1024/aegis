// Aegis SOA-lite 签名器 —— 「用户」角色把目标草案变成【签署目标】（draft-then-sign 的 sign 半步）
//
// 在真实部署中，本脚本应运行在用户自己的设备上（用户私钥不离开用户设备）；
// demo 中放在同一仓库是为了可复现（密钥仅在 aegis/.env，绝不外传）。
//
// 用法：
//   node scripts/soa-sign.mjs draft.json          # 草案来自文件
//   cat draft.json | node scripts/soa-sign.mjs    # 草案来自 stdin
//   （草案可由 orchestrator POST /api/objective/draft 产出，或手工编写）
// 输出（stdout，JSON）：{ objective, objectiveSignature, canonical, objectiveHash }
//
// 签署内容 = canonicalObjective(objective) 的 EIP-191 personal_sign（UTF-8 字节）。
// 任何字段被改动 → 签名失效 → challenger L5 判 objective_bad_signature。
import fs from "node:fs";
import { Wallet } from "ethers";
import { loadEnv } from "./lib.mjs";
import { canonicalObjective, objectiveHash } from "../tee-runtime/objective.mjs";

loadEnv();

const pk = process.env.SOA_USER_PK;
if (!pk) {
  console.error("[soa-sign] 缺 SOA_USER_PK（aegis/.env）—— 这是「用户」角色的私钥，只签名、不需要资金");
  process.exit(1);
}
const wallet = new Wallet(pk);

const fileArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const raw = fileArg ? fs.readFileSync(fileArg, "utf8") : fs.readFileSync(0, "utf8");
let parsed;
try {
  parsed = JSON.parse(raw);
} catch (e) {
  console.error("[soa-sign] 草案不是合法 JSON: " + String(e?.message || e).slice(0, 120));
  process.exit(1);
}

// 兼容 orchestrator /api/objective/draft 的响应体（{kind:"objective", draft:{...}}）与裸 draft
const draft = parsed.draft || parsed;
if (draft.user && String(draft.user).toLowerCase() !== wallet.address.toLowerCase()) {
  console.error(`[soa-sign] 草案已带 user=${draft.user}，与本机 SOA_USER_PK 地址 ${wallet.address} 不一致 —— 拒绝代签`);
  process.exit(1);
}
const objective = { ...draft, user: wallet.address };

let canonical;
try {
  canonical = canonicalObjective(objective);
} catch (e) {
  console.error("[soa-sign] 目标字段不完整/畸形（canonical 失败）: " + String(e?.message || e).slice(0, 120));
  process.exit(1);
}

const objectiveSignature = await wallet.signMessage(canonical);
console.log(
  JSON.stringify(
    { objective, objectiveSignature, canonical, objectiveHash: objectiveHash(objective), signer: wallet.address },
    null,
    2
  )
);
