"use client";

import type { Receipt } from "@/lib/mock";

const DOT = {
  trade: "bg-cyan",
  rejected: "bg-red",
  heartbeat: "border border-muted bg-transparent",
} as const;

export function HashChain({ receipts, max = 12 }: { receipts: Receipt[]; max?: number }) {
  const ordered = [...receipts].reverse().slice(-max);
  return (
    <div className="flex items-center overflow-x-auto py-2">
      {ordered.map((r, i) => (
        <div key={r.id} className="flex items-center">
          {i > 0 && <span className="h-px w-8 shrink-0 bg-border-hover" />}
          <div className="group relative flex flex-col items-center">
            <span
              className={`h-3 w-3 rounded-full transition-transform group-hover:scale-150 ${DOT[r.type]}`}
            />
            <span className="mono mt-2 whitespace-nowrap text-[10px] text-muted">#{r.id}</span>
            <span className="pointer-events-none absolute -top-9 hidden whitespace-nowrap rounded-md border border-border-base bg-card px-2 py-1 text-[10px] text-secondary group-hover:block">
              {r.action}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
