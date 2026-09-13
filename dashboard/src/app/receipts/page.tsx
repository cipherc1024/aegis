"use client";

import { useState } from "react";
import { useL } from "@/lib/i18n";
import { shortHash } from "@/lib/mock";
import { useReceipts } from "@/lib/useReceipts";
import { CheckCircle2, Lock } from "lucide-react";

export default function ReceiptsPage() {
  const L = useL();
  const { receipts } = useReceipts(1n);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const r = receipts.find((x) => x.receiptHash === selectedHash) ?? receipts[0];

  const rows: [string, string][] = [
    [L("区块高度", "Block height"), String(r.blockHeight)],
    [L("区块哈希", "Block hash"), r.blockHash],
    [L("执行动作", "Action"), r.action],
    [L("金额", "Amount"), r.amount ?? "—"],
    [L("nonce", "nonce"), r.nonce],
    [L("护栏哈希", "Guardrail hash"), r.guardrailHash],
    [L("前序收据", "Prev receipt"), r.prevReceiptHash],
    [L("收据哈希", "Receipt hash"), r.receiptHash],
  ];

  const dcap: [string, string][] = [
    [L("Quote 类型", "Quote type"), "TDX v4"],
    ["FMSPC", "20A06F"],
    ["TCB Status", "OK"],
    ["report_data[0:32]", shortHash(r.receiptHash)],
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
      {/* list */}
      <div className="card p-3">
        <div className="mb-2 px-1 text-sm">{L("收据列表", "Receipts")}</div>
        <div className="space-y-1">
          {receipts.map((x) => (
            <button
              key={x.receiptHash}
              onClick={() => setSelectedHash(x.receiptHash)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                r.receiptHash === x.receiptHash ? "bg-hover text-primary" : "text-secondary hover:bg-hover"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  x.type === "rejected" ? "bg-red" : x.type === "heartbeat" ? "border border-muted" : "bg-cyan"
                }`}
              />
              <span className="mono text-muted">#{x.id}</span>
              <span className="truncate">{x.action}</span>
            </button>
          ))}
        </div>
      </div>

      {/* detail */}
      <div className="space-y-4">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">
              {L("收据摘要", "Receipt summary")} · <span className="mono text-muted">#{r.id}</span>
            </div>
            <button className="rounded-lg border border-cyan/40 bg-cyan/5 px-3 py-1.5 text-xs font-medium text-cyan hover:bg-cyan/10">
              {L("验证这张收据", "Verify this receipt")}
            </button>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-border-subtle py-1.5">
                <dt className="text-muted">{k}</dt>
                <dd className="mono truncate text-secondary">{v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Lock className="h-4 w-4 text-cyan" />
            {L("DCAP 验证", "DCAP verification")}
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {dcap.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-border-subtle py-1.5">
                <dt className="text-muted">{k}</dt>
                <dd className="mono text-secondary">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-green/5 px-3 py-2 text-xs text-green">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {L("链上验证通过：真实 Intel TDX · report_data 绑定本收据", "On-chain verified: genuine Intel TDX · report_data bound to this receipt")}
          </div>
        </div>
      </div>
    </div>
  );
}
