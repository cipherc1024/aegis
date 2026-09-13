"use client";

import type { LucideIcon } from "lucide-react";
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
}: {
  label: string;
  value?: string;
  count?: number;
  prefix?: string;
  suffix?: string;
  icon?: LucideIcon;
  tone?: string;
  sub?: string;
}) {
  return (
    <div className="card card-hover p-4">
      {Icon && <Icon className={`h-4 w-4 ${tone}`} />}
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
