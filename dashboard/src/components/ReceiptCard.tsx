"use client";

import type { Receipt } from "@/lib/mock";
import { shortHash } from "@/lib/mock";
import { ShieldCheck, Ban, HeartPulse, ChevronDown } from "lucide-react";
import { useState } from "react";

const TYPE_META = {
  trade: { bar: "bg-green", icon: ShieldCheck, iconTone: "text-green" },
  rejected: { bar: "bg-red", icon: Ban, iconTone: "text-red" },
  heartbeat: { bar: "bg-muted", icon: HeartPulse, iconTone: "text-tertiary" },
} as const;

export function ReceiptCard({ r }: { r: Receipt }) {
  const [open, setOpen] = useState(false);
  const m = TYPE_META[r.type];
  const Icon = m.icon;
  const time = new Date(r.timestamp).toLocaleTimeString("zh-CN", { hour12: false });

  return (
    <div
      className={`card card-hover animate-slide-in overflow-hidden ${r.type === "rejected" ? "bg-red/5" : ""}`}
    >
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-3 p-3 text-left"
        aria-expanded={open}
      >
        <span className={`h-7 w-[3px] shrink-0 rounded-full ${m.bar}`} />
        <Icon className={`h-4 w-4 shrink-0 ${m.iconTone}`} />
        <span className="mono text-xs text-muted">#{r.id}</span>
        <span className="truncate text-sm">{r.action}</span>
        {r.amount && <span className="mono text-xs text-secondary">{r.amount}</span>}
        <span className="mono ml-auto hidden text-xs text-muted sm:inline">
          block {r.blockHeight}
        </span>
        <span className="mono hidden text-xs text-muted md:inline">{time}</span>
        <ChevronDown className={`h-4 w-4 text-muted transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="border-t border-border-subtle px-4 py-3">
          {r.type === "rejected" && r.rejectedReason && (
            <div className="mb-3 rounded-lg bg-red/10 px-3 py-2 text-xs text-red">
              拦截原因：{r.rejectedReason}
            </div>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            <Row k="block hash" v={shortHash(r.blockHash)} />
            <Row k="execution hash" v={shortHash(r.executionHash)} />
            <Row k="nonce" v={shortHash(r.nonce)} />
            <Row k="guardrail hash" v={shortHash(r.guardrailHash)} />
            <Row k="prev receipt" v={shortHash(r.prevReceiptHash)} />
            <Row k="receipt hash" v={shortHash(r.receiptHash)} />
          </dl>
          <div className="mt-3 flex gap-2">
            <button className="rounded-lg border border-cyan/40 bg-cyan/5 px-3 py-1.5 text-xs font-medium text-cyan hover:bg-cyan/10">
              验证这张收据
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-muted">{k}</dt>
      <dd className="mono text-secondary">{v}</dd>
    </div>
  );
}
