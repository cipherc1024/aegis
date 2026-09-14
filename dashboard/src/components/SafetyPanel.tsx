"use client";

import type { AgentStatus } from "./layout/Sidebar";
import { useT, useL } from "@/lib/i18n";
import { CheckCircle2, AlertTriangle, Snowflake, Lock } from "lucide-react";

export function SafetyPanel({
  status,
  perTxUsed,
  dailyUsed,
  sample,
}: {
  status: AgentStatus;
  perTxUsed: number; // 0..1
  dailyUsed: number; // 0..1
  /** true = 用量数字是产品愿景占位，不是链上真实值（评审可分辨） */
  sample?: boolean;
}) {
  const t = useT();
  const L = useL();

  const checks = [
    { key: "safety.freshness", ok: status === "ok" },
    { key: "safety.alive", ok: status !== "frozen" },
    { key: "safety.chain", ok: true },
    { key: "safety.dcap", ok: true },
  ];

  const StatusIcon = status === "ok" ? CheckCircle2 : status === "stale" ? AlertTriangle : Snowflake;
  const statusTone =
    status === "ok" ? "text-green" : status === "stale" ? "text-amber" : "text-red";

  return (
    <div className="card p-4">
      <div className="flex items-center gap-2">
        <StatusIcon className={`h-4 w-4 ${statusTone}`} />
        <span className={`text-sm font-medium ${statusTone}`}>{t(`status.${status}`)}</span>
      </div>

      <div className="mt-4 space-y-2">
        {checks.map((c) => (
          <div key={c.key} className="flex items-center justify-between text-xs">
            <span className="text-secondary">{t(c.key)}</span>
            <span className={c.ok ? "text-green" : "text-amber"}>{c.ok ? "OK" : "—"}</span>
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between">
          <span className="text-[11px] text-muted">{t("dash.perTx")}</span>
          {sample && <span className="rounded bg-input px-1.5 py-0.5 text-[10px] text-muted">{L("示例", "sample")}</span>}
        </div>
        <Bar label={t("dash.perTx")} value={perTxUsed} tone="bg-cyan" />
        <Bar label={t("dash.daily")} value={dailyUsed} tone="bg-purple" />
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-lg bg-green/5 px-3 py-2 text-xs text-green">
        <Lock className="h-3.5 w-3.5" />
        {t("safety.withdrawOpen")}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <button className="rounded-lg border border-border-base px-3 py-2 text-xs text-primary hover:border-border-hover">
          {t("dash.depositWithdraw")}
        </button>
        <button className="rounded-lg border border-border-base px-3 py-2 text-xs text-primary hover:border-border-hover">
          {t("dash.editPolicy")}
        </button>
      </div>
    </div>
  );
}

function Bar({ label, value, tone }: { label: string; value: number; tone: string }) {
  const pct = Math.min(100, Math.round(value * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-tertiary">
        <span>{label}</span>
        <span className="mono">{pct}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-input">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
