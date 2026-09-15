"use client";

import { useL } from "@/lib/i18n";
import { AGENTS } from "@/lib/mock";
import { ShieldCheck } from "lucide-react";
import { SampleBanner } from "@/components/SampleBanner";

export default function CopyPage() {
  const L = useL();
  const alloc = [
    { name: "Aegis Alpha", pct: 45, color: "bg-cyan" },
    { name: "Steady Vault", pct: 35, color: "bg-purple" },
    { name: "Monad Momentum", pct: 20, color: "bg-green" },
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-lg font-semibold">{L("策略跟投", "Copy Strategies")}</h1>
      <SampleBanner />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {AGENTS.slice(0, 4).map((a) => (
          <div key={a.id} className="card card-hover p-4">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-input text-xl">{a.avatar}</div>
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{a.name}</div>
                <div className="text-[11px] text-muted">{L("声誉", "Reputation")} {a.reputation}</div>
              </div>
              <button className="ml-auto rounded-lg bg-cyan px-3 py-1.5 text-xs font-medium text-base hover:opacity-90">
                {L("跟投", "Copy")}
              </button>
            </div>
            <div className="mt-3 grid grid-cols-4 gap-2 text-center text-[10px]">
              <Cell k="30d" v={a.return30d} tone="text-green" />
              <Cell k={L("回撤", "DD")} v={a.maxDrawdown} tone="text-red" />
              <Cell k={L("胜率", "Win")} v={a.winRate} />
              <Cell k={L("收据", "Receipts")} v={String(a.totalReceipts)} />
            </div>
          </div>
        ))}
      </div>

      <div className="card mt-4 p-5">
        <div className="mb-3 flex items-center justify-between text-sm">
          <span>{L("我的跟投配置", "My copy allocation")}</span>
          <span className="mono text-xs text-muted">$8,200 / $12,000</span>
        </div>
        <div className="flex h-3 overflow-hidden rounded-full bg-input">
          {alloc.map((s) => (
            <div key={s.name} className={`${s.color} h-full`} style={{ width: `${s.pct}%` }} />
          ))}
        </div>
        <div className="mt-3 flex gap-4 text-[11px] text-muted">
          {alloc.map((s) => (
            <span key={s.name} className="flex items-center gap-1.5">
              <span className={`h-2.5 w-2.5 rounded-full ${s.color}`} />
              {s.name} {s.pct}%
            </span>
          ))}
        </div>
      </div>

      <div className="card mt-4 flex items-start gap-3 p-5">
        <ShieldCheck className="mt-0.5 h-4 w-4 text-cyan" />
        <div>
          <div className="text-sm">{L("为什么比传统跟单更安全", "Why safer than traditional copy-trading")}</div>
          <p className="mt-1 text-xs text-secondary">
            {L(
              "传统跟单你只能「相信」操盘手；这里每笔跟单都对应可独立验证的 TEE 收据，且链上硬约束锁死你的损失上限。",
              "Traditional copy-trading asks you to \"trust\" the manager; here every copy corresponds to an independently verifiable TEE receipt, with on-chain hard limits capping your downside."
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function Cell({ k, v, tone = "text-secondary" }: { k: string; v: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-input py-1.5">
      <div className="text-muted">{k}</div>
      <div className={`mono ${tone}`}>{v}</div>
    </div>
  );
}
