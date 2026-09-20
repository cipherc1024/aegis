"use client";

import { useT, useL } from "@/lib/i18n";
import { useAgentStatus } from "@/lib/useAgentStatus";
import { useReceipts } from "@/lib/useReceipts";
import { useVault } from "@/lib/useVault";
import { StatCard } from "@/components/StatCard";
import { ReceiptCard } from "@/components/ReceiptCard";
import { HashChain } from "@/components/HashChain";
import { SafetyPanel } from "@/components/SafetyPanel";
import { fmtMon } from "@/components/ConfirmTx";
import { Wallet, TrendingUp, Gauge, Activity } from "lucide-react";

export default function DashboardPage() {
  const t = useT();
  const L = useL();
  const s = useAgentStatus(1n);
  const { receipts, live, loading } = useReceipts(1);
  const { vault, fetched: vaultFetched } = useVault();
  const status = !s || !s.online ? "ok" : !s.alive ? "frozen" : !s.fresh ? "stale" : "ok";
  const statusEmoji = status === "ok" ? "🟢" : status === "stale" ? "⚠️" : "🥶";

  const tradeCount = receipts.filter((r) => !r.isHeartbeat).length;
  const heartbeatCount = receipts.filter((r) => r.isHeartbeat).length;

  return (
    <div>
      {/* stats —— 全部来自链上真实读数；orchestrator 不可达时显示 "—"（离线） */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={L("金库余额", "Vault balance")}
          value={vault ? `${fmtMon(vault.balanceMon)} MON` : "—"}
          icon={Wallet}
          tone="text-cyan"
          sub={vault?.configured ? `agentId ${vault.agentId}` : vaultFetched ? L("离线", "offline") : L("读取中", "loading")}
        />
        <StatCard
          label={L("今日已用（PACE 日限）", "Spent today (PACE daily)")}
          value={vault ? `${fmtMon(vault.dailySpentToday)} / ${fmtMon(vault.dailyLimit)} MON` : "—"}
          icon={TrendingUp}
          tone="text-green"
          sub={vault ? L(`窗口日 ${vault.dailyWindowDay}`, `window day ${vault.dailyWindowDay}`) : undefined}
        />
        <StatCard
          label={L("单笔上限", "Per-tx limit")}
          value={vault ? `${fmtMon(vault.perTxLimit)} MON` : "—"}
          icon={Gauge}
          tone="text-purple"
          sub={vault ? (vault.frozen ? L("已冻结", "frozen") : L("可交易", "trading open")) : undefined}
        />
        <StatCard
          label={t("dash.agentStatus")}
          value={statusEmoji}
          icon={Activity}
          tone="text-green"
          sub={s?.online ? `block ${s.currentBlock.toLocaleString()}` : L("离线", "offline")}
        />
      </div>

      {/* main grid */}
      <div className="mt-6 grid grid-cols-1 gap-4 xl:grid-cols-[1.6fr_1fr]">
        <div className="space-y-4">
          <div className="card p-4">
            <div className="mb-3 flex items-center gap-2 text-sm">
              <span className="h-2 w-2 rounded-full bg-green dot-pulse" />
              {t("dash.receiptStream")}
              <span className={`ml-auto text-[11px] ${live ? "text-green" : "text-amber"}`}>
                {live ? L("链上", "on-chain") : loading ? L("读取中", "loading") : L("离线", "offline")}
              </span>
            </div>
            <div className="space-y-2">
              {receipts.slice(0, 4).map((r) => (
                <ReceiptCard key={r.id + r.receiptHash} r={r} />
              ))}
              {!loading && receipts.length === 0 && (
                <div className="py-6 text-center text-xs text-muted">
                  {L("orchestrator 不可达或无收据记录。", "orchestrator unreachable, or no receipts recorded.")}
                </div>
              )}
            </div>
          </div>

          <div className="card p-4">
            <div className="mb-2 flex items-center gap-2 text-sm">
              {t("dash.hashChain")}
              <span className="ml-auto text-[11px] text-muted">
                {L(`交易 ${tradeCount} · 心跳 ${heartbeatCount}`, `${tradeCount} trades · ${heartbeatCount} heartbeats`)}
              </span>
            </div>
            <HashChain receipts={receipts} />
            <div className="mt-2 flex gap-4 text-[11px] text-muted">
              <Legend className="bg-cyan" label="交易" />
              <Legend className="border border-muted" label="心跳" />
              <Legend className="bg-red" label="拒绝" />
            </div>
          </div>
        </div>

        <div>
          <SafetyPanel status={status} vault={vault} vaultFetched={vaultFetched} />
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
