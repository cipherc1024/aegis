"use client";

import type { LucideIcon } from "lucide-react";
import { useL } from "@/lib/i18n";
import { AnimatedNumber } from "./motion";

export function StatCard({
  label,
  value,
  count,
  prefix = "",
  suffix = "",
  icon: Icon,
  tone = "text-cyan",
  sub,
  sample,
}: {
  label: string;
  value?: string;
  count?: number;
  prefix?: string;
  suffix?: string;
  icon?: LucideIcon;
  tone?: string;
  sub?: string;
  /** true = 这个数字是产品愿景占位，不是链上真实值（评审可分辨） */
  sample?: boolean;
}) {
  const L = useL();
  return (
    <div className="card card-hover p-4">
      <div className="flex items-start justify-between">
        {Icon && <Icon className={`h-4 w-4 ${tone}`} />}
        {sample && (
          <span className="rounded bg-input px-1.5 py-0.5 text-[10px] text-muted">{L("示例", "sample")}</span>
        )}
      </div>
      <div className="mono mt-3 text-2xl font-semibold">
        {count !== undefined ? (
          <AnimatedNumber value={count} format={(n) => `${prefix}${Math.round(n).toLocaleString()}${suffix}`} />
        ) : (
          value
        )}
      </div>
      <div className="mt-1 text-xs text-tertiary">{label}</div>
      {sub && <div className={`mono mt-1 text-[11px] ${tone}`}>{sub}</div>}
    </div>
  );
}
