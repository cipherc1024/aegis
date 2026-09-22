/**
 * 静态导出模式的缺省读数（离线快照）。
 *
 * 为什么要有这个文件：静态导出后没有 orchestrator，也不该回退到"看起来像真数据的
 * 占位值"（lib/aegis.ts 的硬规则）。这里的每个值都**有可核实的来源**，且在 UI 上
 * 必须与实时读数区分标注（见 /architecture 的「静态导出模式」说明行）：
 *
 *   - devices：与 orchestrator `GET /api/config` 的 trustBoundary.devices 同一份文本
 *     （见 aegis/orchestrator/server.mjs 的 trustBoundary 构造），逐字对齐。
 *   - contracts：与 lib/chain.ts 的 ADDR 同源——那里的地址是"已部署且链上核实过"的
 *     默认值（v5 金库 0x3aBbb284…、registry 0x4622D041…），不是猜的。
 *   - whitelist：静态导出**刻意不给**（空数组）。白名单首项是 /architecture 跑负例
 *     时读策略目标址的来源，硬编码会在策略变更后静默指向链上已不在白名单里的地址，
 *     让"目标未授权"的负例因错误原因"通过"。读不到就不跑 —— 这是那条注释的原始理由，
 *     静态导出不能把它绕过去。
 */
import type { TrustDevice } from "./aegis";

/** 与 orchestrator /api/config 的 trustBoundary.devices 同文本；顺序即渲染顺序 */
export const SNAPSHOT_DEVICES: TrustDevice[] = [
  {
    role: "proposer",
    name: "Proposer 机器（本机）",
    holds: ["MONAD_TESTNET_PK"],
    note: "双 LLM 管线 + 确定性 δ 预览；持有 TEE 私钥，可提交收据",
  },
  {
    role: "challenger",
    name: "Challenger 机器（独立）",
    holds: ["CHALLENGER_PK"],
    note: "独立钱包上链 validation；verify.mjs 只依赖 ethers + 自己的 objective.mjs（单向零依赖）；可选跨家族模型层默认关闭（非 L5，L5 专指目标层）",
  },
  {
    role: "tee",
    name: "Phala CVM（TDX）",
    holds: [],
    note: "实时生成绑定 digest 的 TDX quote，链上 DCAP 验真",
  },
];

/**
 * 静态导出下的合约地址缺省值。与 lib/chain.ts 的 ADDR 默认值同源，
 * 但这里**不含 gate/verifier**（本页不展示那两个）。
 * RPC 直读路径（/verify）不用这些常量，它走 chain.ts 的 ADDR。
 */
export const SNAPSHOT_CONTRACTS = {
  receiptRegistry: "0x4622D041696942dC873a8A5E54f1e1ca9669c90B",
  vaultQuorum: "0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De",
  validationRegistry: "0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa",
} as const;
