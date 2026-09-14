"use client";

import { useT } from "@/lib/i18n";
import { useAgentStatus } from "@/lib/useAgentStatus";
import { useReceipts } from "@/lib/useReceipts";
import { StatCard } from "@/components/StatCard";
import { ReceiptCard } from "@/components/ReceiptCard";
import { HashChain } from "@/components/HashChain";
import { SafetyPanel } from "@/components/SafetyPanel";
import { Wallet, TrendingUp, Gauge, Activity } from "lucide-react";

export default function DashboardPage() {
  const t = useT();
  const s = useAgentStatus(1n);
  const { receipts, live } = useReceipts(1);
  const status = !s || !s.online ? "ok" : !s.alive ? "frozen" : !s.fresh ? "stale" : "ok";
  const statusEmoji = status === "ok" ? "🟢" : status === "stale" ? "⚠️" : "🥶";

  return (
    <div>
      {/* stats —— 财务数字是产品愿景占位（sample），真实链上状态走 useAgentStatus */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label={t("dash.myEquity")} count={12480} prefix="$" icon={Wallet} tone="text-cyan" sample />
        <StatCard label={t("dash.totalProfit")} count={1204} prefix="+$" icon={TrendingUp} tone="text-green" sub="+10.7%" sample />
        <StatCard label={t("dash.todayQuota")} value="1.2 / 5 MON" icon={Gauge} tone="text-purple" sample />
        <StatCard label={t("dash.agentStatus")} value={statusEmoji} icon={Activity} tone="text-green" sub={s?.online ? `block ${s.currentBlock.toLocaleString()}` : undefined} />
      </div>

      {/* main grid */}
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-green dot-pulse" />
              {t("dash.receiptStream")}
              <span className={`ml-auto text-[11px] ${live ? "text-green" : "text-muted"}`}>
                {live ? "链上" : "示例"}
              </span>
            </div>
            <div className="space-y-2">
              {receipts.slice(0, 4).map((r) => (
                <ReceiptCard key={r.id + r.receiptHash} r={r} />
              ))}
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-2 text-sm">{t("dash.hashChain")}</div>
            <HashChain receipts={receipts} />
            <div className="mt-2 flex gap-4 text-[11px] text-muted">
              <Legend className="bg-cyan" label="交易" />
              <Legend className="border border-muted" label="心跳" />
              <Legend className="bg-red" label="拒绝" />
            </div>
          </div>
        </div>

        <div>
          <SafetyPanel status={status} perTxUsed={0.5} dailyUsed={0.24} sample />
        </div>
      </div>
    </div>
  );
}

function Legend({ className, label }: { className: string; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${className}`} />
      {label}
    </span>
  );
}
