"use client";

import { useEffect, useState } from "react";
import { api, type ChainReceipt } from "./aegis";
import { getReceiptViews } from "./chain";
import type { Receipt } from "./mock";

/**
 * 两级来源（都是真实链上读数，绝不回退 mock）：
 *   ① 浏览器内直读 ReceiptSubmitted 富事件（getReceiptViews）——executionHash/nonce/
 *      guardrailHash 是事件里带的真值，字段最全；但只看最近 4000 块（40×100），
 *      这段时间没有收据时它合法地返回空。全部 getLogs 都成功时也不会提前退出，
 *      40 个窗口串行实测约 30s。
 *   ② orchestrator 索引器（/api/receipts）——覆盖深历史，但只带 4 个字段；实测 ~22ms。
 *
 * 两条路并发跑，不能让 ① 的慢挡住 ②：
 *   - ② 先回来就先把 4 字段的收据画出来，页面不再出现"有数据却报离线"的假象；
 *   - ① 若随后在窗口内命中，则用字段更全的结果替换（升级视图）。
 * 只把"还在查"（loading）与"两条路都空"（offline）分开：前者页面显示加载态，
 * 后者才是真的离线。空结果本身不代表离线 —— 它可能只是窗口内没有收据。
 */
export interface ReceiptsState {
  receipts: Receipt[];
  live: boolean;
  /** 仍在取数且尚无任何结果时为 true —— 页面据此显示加载态，而非"离线" */
  loading: boolean;
}

export function useReceipts(agentId = 1): ReceiptsState {
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [live, setLive] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setReceipts([]);
    setLive(false);
    setLoading(true);

    // ① 字段最全但慢（窗口扫描）。命中即替换 ② 的粗粒度结果。
    const rich = (async (): Promise<Receipt[] | null> => {
      try {
        const rows = await getReceiptViews(BigInt(agentId));
        return rows.length ? rows : null;
      } catch {
        return null;
      }
    })();

    // ② 快（索引器），先画。
    const fast = (async (): Promise<Receipt[] | null> => {
      const r = await api.receipts(agentId);
      return r && r.length ? r.map(toView) : null;
    })();

    (async () => {
      const fastRows = await fast;
      if (!alive) return;
      if (fastRows) {
        setReceipts(fastRows);
        setLive(true);
        setLoading(false);
      }
      const richRows = await rich;
      if (!alive) return;
      if (richRows) {
        setReceipts(richRows);
        setLive(true);
      }
      setLoading(false);
    })();

    return () => {
      alive = false;
    };
  }, [agentId]);

  return { receipts, live, loading };
}

function toView(c: ChainReceipt): Receipt {
  return {
    id: c.receiptHash.slice(2, 6),
    type: c.isHeartbeat ? "heartbeat" : "trade",
    action: c.isHeartbeat ? "心跳" : "交易",
    blockHeight: c.blockHeight,
    // 索引器接口只带 4 个字段；这些字段的真值由上面 ① 的富事件路径提供
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
