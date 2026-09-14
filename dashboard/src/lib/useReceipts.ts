"use client";

import { useEffect, useState } from "react";
import { api, type ChainReceipt } from "./aegis";
import type { Receipt } from "./mock";

/**
 * 收据数据走统一入口：orchestrator 的 /api/receipts（索引器产物，真实链上哈希 + tx 哈希）。
 * 浏览器内不再扫 getLogs —— Monad 的 eth_getLogs 严格限 100 块，浏览器分窗扫描每个
 * 窗口都会失败，旧实现会静默回退到 mock（假哈希假金额）。orchestrator 不可达时返回
 * 空列表，由页面显示"离线"，绝不回退到看起来像真数据的占位值。
 */
export function useReceipts(agentId = 1): { receipts: Receipt[]; live: boolean } {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    api.receipts(agentId).then((r) => {
      if (!alive) return;
      if (r && r.length) {
        setReceipts(r.map(toView));
        setLive(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [agentId]);

  return { receipts, live };
}

function toView(c: ChainReceipt): Receipt {
  return {
    id: c.receiptHash.slice(2, 6),
    type: c.isHeartbeat ? "heartbeat" : "trade",
    action: c.isHeartbeat ? "心跳" : "交易",
    blockHeight: c.blockHeight,
    // 索引器未覆盖的字段诚实显示"—"（真实值可点 tx 哈希去区块浏览器核对）
    blockHash: "—",
    executionHash: "—",
    nonce: "—",
    guardrailHash: "—",
    prevReceiptHash: "—",
    receiptHash: c.receiptHash,
    isHeartbeat: c.isHeartbeat,
    timestamp: Date.now(),
    txHash: c.txHash,
  };
}
