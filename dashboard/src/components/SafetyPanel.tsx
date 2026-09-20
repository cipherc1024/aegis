"use client";

import Link from "next/link";
import type { AgentStatus } from "./layout/Sidebar";
import type { VaultState } from "@/lib/aegis";
import { useT, useL } from "@/lib/i18n";
import { fmtMon } from "./ConfirmTx";
import { CheckCircle2, AlertTriangle, Snowflake, Lock } from "lucide-react";

export function SafetyPanel({
  status,
  vault,
  vaultFetched,
}: {
  status: AgentStatus;
  /** 链上金库真实状态；null = orchestrator 不可达 */
  vault: VaultState | null;
  /** 是否已尝试拉取（区分"读取中"与"离线"） */
  vaultFetched: boolean;
}) {
  const t = useT();
  const L = useL();

  // 四项检查全部来自真实读数，不再有硬编码 true
  const checks = [
    { key: "safety.freshness", ok: status === "ok", detail: null as string | null },
    { key: "safety.alive", ok: status !== "frozen", detail: null },
    {
      key: "safety.chain",
      ok: vault?.configured === true,
      detail: vault?.configured ? `agentId ${vault.agentId}` : null,
    },
    {
      key: "safety.dcap",
      ok: (vault?.trustedValidatorCount ?? 0) > 0,
      detail: vault ? `${L("验证者", "validators")} ${vault.trustedValidatorCount}` : null,
    },
  ];

  const StatusIcon = status === "ok" ? CheckCircle2 : status === "stale" ? AlertTriangle : Snowflake;
  const statusTone =
    status === "ok" ? "text-green" : status === "stale" ? "text-amber" : "text-red";

  const perTxPct = vault && Number(vault.perTxLimit) > 0
    ? Math.min(1, Number(vault.perTxLimit) / Number(vault.dailyLimit || vault.perTxLimit))
    : 0;
  const dailyPct = vault && Number(vault.dailyLimit) > 0
    ? Math.min(1, Number(vault.dailySpentToday) / Number(vault.dailyLimit))
    : 0;

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
            <span className={c.ok ? "text-green" : "text-amber"}>
              {c.ok ? "OK" : "—"}
              {c.detail && <span className="ml-1.5 text-muted">{c.detail}</span>}
            </span>
          </div>
        ))}
      </div>

      <div className="mt-5 space-y-3">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-muted">{t("dash.perTx")} / {t("dash.daily")}</span>
          {!vaultFetched && <span className="text-muted">{L("读取中", "loading")}</span>}
          {vaultFetched && !vault && <span className="text-amber">{L("离线", "offline")}</span>}
        </div>
        <Bar
          label={L("单笔上限 / 日限", "per-tx / daily limit")}
          value={perTxPct}
          right={vault ? `${fmtMon(vault.perTxLimit)} / ${fmtMon(vault.dailyLimit)} MON` : "—"}
          tone="bg-cyan"
        />
        <Bar
          label={L("今日已用 / 日限", "spent today / daily")}
          value={dailyPct}
          right={vault ? `${fmtMon(vault.dailySpentToday)} / ${fmtMon(vault.dailyLimit)} MON` : "—"}
          tone="bg-purple"
        />
      </div>

      <div className="mt-5 flex items-center gap-2 rounded-lg bg-green/5 px-3 py-2 text-xs text-green">
        <Lock className="h-3.5 w-3.5" />
        {t("safety.withdrawOpen")}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <Link
          href="/funds"
          className="rounded-lg border border-border-base px-3 py-2 text-center text-xs text-primary hover:border-border-hover"
        >
          {t("dash.depositWithdraw")}
        </Link>
        <Link
          href="/policy"
          className="rounded-lg border border-border-base px-3 py-2 text-center text-xs text-primary hover:border-border-hover"
        >
          {t("dash.editPolicy")}
        </Link>
      </div>
    </div>
  );
}

function Bar({
  label,
  value,
  right,
  tone,
}: {
  label: string;
  value: number;
  right: string;
  tone: string;
}) {
  const pct = Math.min(100, Math.round(value * 100));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-[11px] text-tertiary">
        <span>{label}</span>
        <span className="mono">{right}</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-input">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
