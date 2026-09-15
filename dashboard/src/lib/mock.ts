export type ReceiptType = "trade" | "rejected" | "heartbeat";

export interface Receipt {
  id: string;
  type: ReceiptType;
  action: string;
  amount?: string;
  blockHeight: number;
  blockHash: string;
  executionHash: string;
  nonce: string;
  guardrailHash: string;
  prevReceiptHash: string;
  receiptHash: string;
  isHeartbeat: boolean;
  timestamp: number;
  rejectedReason?: string;
  txHash?: string;
}

export interface Agent {
  id: string;
  name: string;
  avatar: string;
  erc8004Id: string;
  tvl: string;
  return30d: string;
  maxDrawdown: string;
  winRate: string;
  reputation: number;
  verified: boolean;
  totalReceipts: number;
}

const h = (s: string) => "0x" + s.padEnd(64, "0").slice(0, 64);

// 本文件全部为产品愿景占位数据：不是链上真实读数，也不是本项目已部署的 agent。
// 展示这些数据的页面必须在标题处显著标注「示例」，避免评审误认为已上线运营数据。
// 真实读数一律走 orchestrator（useAgentStatus / useReceipts / api.*）。
export const MOCK_DATA_NOTICE = "本页为产品愿景占位数据，非链上真实读数";

export const AGENTS: Agent[] = [
  { id: "42", name: "Aegis Alpha", avatar: "🛡️", erc8004Id: "Agent #42", tvl: "$4.2M", return30d: "+12.4%", maxDrawdown: "-3.2%", winRate: "68%", reputation: 94, verified: true, totalReceipts: 8421 },
  { id: "7", name: "Monad Momentum", avatar: "⚡", erc8004Id: "Agent #7", tvl: "$1.8M", return30d: "+9.1%", maxDrawdown: "-5.6%", winRate: "61%", reputation: 88, verified: true, totalReceipts: 5210 },
  { id: "19", name: "Steady Vault", avatar: "🏦", erc8004Id: "Agent #19", tvl: "$6.5M", return30d: "+4.7%", maxDrawdown: "-1.1%", winRate: "74%", reputation: 96, verified: true, totalReceipts: 12033 },
  { id: "88", name: "Trend Rider", avatar: "📈", erc8004Id: "Agent #88", tvl: "$0.9M", return30d: "+21.3%", maxDrawdown: "-12.4%", winRate: "55%", reputation: 79, verified: true, totalReceipts: 2104 },
];

export const RECEIPTS: Receipt[] = [
  { id: "1046", type: "trade", action: "买入 MON", amount: "0.5 MON", blockHeight: 61753445, blockHash: h("8f3ac12d"), executionHash: h("3fa9"), nonce: h("7eb2"), guardrailHash: h("d72be318"), prevReceiptHash: h("04ceda08"), receiptHash: h("b28e3ec3"), isHeartbeat: false, timestamp: Date.now() - 12_000 },
  { id: "1045", type: "rejected", action: "拦截 $SCAM", amount: "拒绝", blockHeight: 61753440, blockHash: h("a1b2c3d4"), executionHash: h("0000"), nonce: h("9f1a"), guardrailHash: h("d72be318"), prevReceiptHash: h("b28e3ec3"), receiptHash: h("c3d4e5f6"), isHeartbeat: false, timestamp: Date.now() - 40_000, rejectedReason: "标的不在白名单 / blocklist:$SCAM" },
  { id: "1044", type: "trade", action: "卖出 USDC", amount: "120 USDC", blockHeight: 61753433, blockHash: h("e5f6a7b8"), executionHash: h("aabb"), nonce: h("1122"), guardrailHash: h("d72be318"), prevReceiptHash: h("c3d4e5f6"), receiptHash: h("04ceda08"), isHeartbeat: false, timestamp: Date.now() - 80_000 },
  { id: "1043", type: "heartbeat", action: "心跳", amount: "—", blockHeight: 61753420, blockHash: h("c9d0e1f2"), executionHash: h("0000"), nonce: h("3344"), guardrailHash: h("d72be318"), prevReceiptHash: h("04ceda08"), receiptHash: h("77aa11bb"), isHeartbeat: true, timestamp: Date.now() - 140_000 },
  { id: "1042", type: "trade", action: "买入 MON", amount: "0.3 MON", blockHeight: 61753410, blockHash: h("3322aabb"), executionHash: h("ccdd"), nonce: h("5566"), guardrailHash: h("d72be318"), prevReceiptHash: h("77aa11bb"), receiptHash: h("04ceda08"), isHeartbeat: false, timestamp: Date.now() - 200_000 },
];

export const shortHash = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
export const shortAddr = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
