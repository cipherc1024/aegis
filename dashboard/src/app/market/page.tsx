"use client";

import { useState } from "react";
import { useT } from "@/lib/i18n";
import { AGENTS } from "@/lib/mock";
import { BadgeCheck } from "lucide-react";
import { SampleBanner } from "@/components/SampleBanner";

const FILTERS = [
  { key: "all", t: "market.filter.all" },
  { key: "highYield", t: "market.filter.highYield" },
  { key: "lowRisk", t: "market.filter.lowRisk" },
  { key: "new", t: "market.filter.new" },
];

export default function MarketPage() {
  const t = useT();
  const [filter, setFilter] = useState("all");

  const agents = AGENTS.filter((a) => {
    if (filter === "highYield") return parseFloat(a.return30d) >= 10;
    if (filter === "lowRisk") return parseFloat(a.maxDrawdown) > -3;
    return true;
  });

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-lg font-semibold">{t("market.title")}</h1>
        <p className="text-xs text-tertiary">{t("market.subtitle")}</p>
      </div>
      <SampleBanner
        note={t("market.sampleNotice")}
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`rounded-lg border px-3 py-1.5 text-xs transition-colors ${
              filter === f.key
                ? "border-cyan/40 bg-cyan/5 text-cyan"
                : "border-border-base text-secondary hover:border-border-hover hover:text-primary"
            }`}
          >
            {t(f.t)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        {agents.map((a) => (
          <div key={a.id} className="card card-hover p-4 transition-transform hover:-translate-y-0.5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-input text-xl">
                {a.avatar}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="truncate text-sm font-medium">{a.name}</span>
                  {a.verified && <BadgeCheck className="h-3.5 w-3.5 text-cyan" />}
                </div>
                <div className="mono text-[11px] text-muted">{a.erc8004Id}</div>
              </div>
              <div className="ml-auto text-right">
                <div className="text-[11px] text-muted">{t("market.reputation")}</div>
                <div className="mono text-sm text-cyan">{a.reputation}</div>
              </div>
            </div>

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <Metric label={t("market.return30d")} value={a.return30d} tone="text-green" />
              <Metric label={t("market.drawdown")} value={a.maxDrawdown} tone="text-red" />
              <Metric label={t("market.winRate")} value={a.winRate} />
            </div>

            <div className="mt-4 flex items-center justify-between">
              <div>
                <div className="text-[11px] text-muted">TVL</div>
                <div className="mono text-sm">{a.tvl}</div>
              </div>
              <button className="rounded-lg bg-cyan px-4 py-2 text-xs font-medium text-base hover:opacity-90">
                {t("market.invest")}
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Metric({ label, value, tone = "text-secondary" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-input py-2">
      <div className="text-[10px] text-muted">{label}</div>
      <div className={`mono text-sm ${tone}`}>{value}</div>
    </div>
  );
}
