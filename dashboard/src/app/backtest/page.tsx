"use client";

import { useL } from "@/lib/i18n";
import { LineChart, ShieldCheck } from "lucide-react";
import { SampleBanner } from "@/components/SampleBanner";

const BARS = [12, 18, -6, 22, 30, -9, 25, 41, 35, -4, 28, 52];

export default function BacktestPage() {
  const L = useL();
  const stats = [
    { k: L("回测区间", "Period"), v: "90d" },
    { k: L("累计收益", "Total return"), v: "+18.6%", tone: "text-green" },
    { k: L("最大回撤", "Max drawdown"), v: "-7.2%", tone: "text-red" },
    { k: L("胜率", "Win rate"), v: "63%" },
  ];
  const max = Math.max(...BARS.map((b) => Math.abs(b)));

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center gap-2">
        <LineChart className="h-5 w-5 text-cyan" />
        <h1 className="text-lg font-semibold">{L("策略回测", "Backtest")}</h1>
      </div>
      <SampleBanner />

      <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.k} className="card p-4">
            <div className="text-xs text-tertiary">{s.k}</div>
            <div className={`mono mt-2 text-xl font-semibold ${s.tone ?? ""}`}>{s.v}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <div className="card p-4">
          <div className="mb-3 text-sm">{L("收益曲线", "Equity curve")}</div>
          <div className="flex h-40 items-end gap-1.5">
            {BARS.map((b, i) => (
              <div key={i} className="flex flex-1 flex-col justify-end" style={{ height: "100%" }}>
                <div
                  className={b >= 0 ? "bg-cyan/70" : "bg-red/70"}
                  style={{ height: `${(Math.abs(b) / max) * 100}%` }}
                  title={`${b}%`}
                />
              </div>
            ))}
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-3 text-sm">{L("回测结果", "Results")}</div>
          <div className="space-y-2 text-xs">
            <Row k={L("总交易", "Trades")} v="128" />
            <Row k={L("盈利", "Wins")} v="81" tone="text-green" />
            <Row k={L("亏损", "Losses")} v="47" tone="text-red" />
            <Row k={L("平均盈亏", "Avg P/L")} v="+0.31%" />
            <Row k={L("夏普比率", "Sharpe")} v="1.82" />
          </div>
        </div>
      </div>

      <div className="card mt-4 flex items-start gap-3 p-5">
        <ShieldCheck className="mt-0.5 h-4 w-4 text-cyan" />
        <div>
          <div className="text-sm">{L("为什么比传统回测更可信", "Why this backtest is more credible")}</div>
          <p className="mt-1 text-xs text-secondary">
            {L(
              "回测基于链上真实收据（含被拦截的拒绝收据），而非策略作者自报的理想曲线——每一笔都可回溯验证。",
              "The backtest runs on real on-chain receipts (including blocked ones), not a self-reported ideal curve — every trade is traceable and verifiable."
            )}
          </p>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, tone = "text-secondary" }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-1.5 last:border-0">
      <span className="text-tertiary">{k}</span>
      <span className={`mono ${tone}`}>{v}</span>
    </div>
  );
}
