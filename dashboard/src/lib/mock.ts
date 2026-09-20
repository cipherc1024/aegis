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

// 占位 fixture 已全部删除（AGENTS / RECEIPTS / MOCK_DATA_NOTICE）：
// 每个曾用它们的页面都已改为从 orchestrator 读真实链上数据（/market、/copy、
// /backtest、/receipts、/audit…），留着未引用的编造数字只会再次被误用。
// 本文件现在只保留「链上真实数据也在用的形状与格式化工具」。

export const shortHash = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
export const shortAddr = (s: string) => `${s.slice(0, 6)}…${s.slice(-4)}`;
