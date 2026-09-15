"use client";

import { useL } from "@/lib/i18n";
import { Landmark } from "lucide-react";
import { SampleBanner } from "@/components/SampleBanner";

export default function VaultsPage() {
  const L = useL();
  const vaults = [
    { name: L("稳定币策略", "Stablecoin"), risk: L("低风险", "Low risk"), apy: "6.2%", tvl: "$12.4M", dd: "-0.8%", tone: "text-green" },
    { name: L("MON 生态指数", "MON Ecosystem"), risk: L("中风险", "Medium"), apy: "14.7%", tvl: "$6.1M", dd: "-6.3%", tone: "text-amber" },
    { name: L("高波动趋势", "High-vol Trend"), risk: L("高风险", "High"), apy: "31.5%", tvl: "$2.2M", dd: "-14.2%", tone: "text-red" },
  ];
  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-lg font-semibold">{L("收益金库", "Vaults")}</h1>
      <SampleBanner />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {vaults.map((v) => (
          <div key={v.name} className="card card-hover p-5">
            <div className="flex items-center gap-2">
              <Landmark className="h-4 w-4 text-cyan" />
              <span className="text-sm font-medium">{v.name}</span>
            </div>
            <div className={`mt-1 text-[11px] ${v.tone}`}>{v.risk}</div>
            <div className="mono mt-4 text-2xl font-semibold text-green">{v.apy}</div>
            <div className="text-[11px] text-muted">{L("年化收益", "APY")}</div>
            <div className="mt-3 space-y-1 text-[11px] text-tertiary">
              <div className="flex justify-between"><span>TVL</span><span className="mono text-secondary">{v.tvl}</span></div>
              <div className="flex justify-between"><span>{L("最大回撤", "Max drawdown")}</span><span className="mono text-red">{v.dd}</span></div>
            </div>
            <button className="mt-4 w-full rounded-lg border border-cyan/40 bg-cyan/5 py-2 text-xs font-medium text-cyan hover:bg-cyan/10">
              {L("存入", "Deposit")}
            </button>
          </div>
        ))}
      </div>
      <div className="card mt-4 p-5">
        <div className="text-sm">{L("与中心化平台理财的差异", "How this differs from CeFi yield")}</div>
        <p className="mt-1 text-xs text-secondary">
          {L(
            "这里没有「平台跑路」或「暗箱操作」——策略执行在 TEE 内、受链上硬约束，且每步都可验证。",
            "No platform risk or black-box operation — strategy runs inside a TEE under on-chain hard limits, and every step is verifiable."
          )}
        </p>
      </div>
    </div>
  );
}
