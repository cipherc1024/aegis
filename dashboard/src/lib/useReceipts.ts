"use client";

import { useEffect, useState } from "react";
import { getReceiptViews } from "./chain";
import { RECEIPTS, type Receipt } from "./mock";

/** 优先用链上真实收据；链上暂无可读时回退 mock（保证演示不空） */
export function useReceipts(agentId = 1n): { receipts: Receipt[]; live: boolean } {
  const [receipts, setReceipts] = useState<Receipt[]>(RECEIPTS);
  const [live, setLive] = useState(false);

  useEffect(() => {
    let alive = true;
    getReceiptViews(agentId).then((r) => {
      if (!alive) return;
      if (r.length) {
        setReceipts(r);
        setLive(true);
      }
    });
    return () => {
      alive = false;
    };
  }, [agentId]);

  return { receipts, live };
}
