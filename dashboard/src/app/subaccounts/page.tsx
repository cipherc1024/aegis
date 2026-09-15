"use client";

import { useL } from "@/lib/i18n";
import { Users, Plus } from "lucide-react";
import { SampleBanner } from "@/components/SampleBanner";

const SUBS = [
  { name: "Trading Bot", addr: "0x1a2b…9f0e", bal: "$3,200", perm: "trade" },
  { name: "Treasury", addr: "0x77c1…02ab", bal: "$8,100", perm: "hold" },
  { name: "Sandbox", addr: "0xdead…beef", bal: "$118", perm: "read" },
];

export default function SubaccountsPage() {
  const L = useL();
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users className="h-5 w-5 text-cyan" />
          <h1 className="text-lg font-semibold">{L("子账户", "Sub-accounts")}</h1>
        </div>
        <button className="flex items-center gap-1.5 rounded-lg bg-cyan px-3 py-1.5 text-xs font-medium text-base hover:opacity-90">
          <Plus className="h-3.5 w-3.5" />
          {L("创建子账户", "New sub-account")}
        </button>
      </div>

      <SampleBanner />
      <div className="mb-4 grid grid-cols-2 gap-4">
        <div className="card p-4">
          <div className="text-xs text-tertiary">{L("总资产", "Total assets")}</div>
          <div className="mono mt-2 text-xl font-semibold">$11,418</div>
        </div>
        <div className="card p-4">
          <div className="text-xs text-tertiary">{L("子账户数", "Sub-accounts")}</div>
          <div className="mono mt-2 text-xl font-semibold">3</div>
        </div>
      </div>

      <div className="card p-2">
        {SUBS.map((s) => (
          <div key={s.addr} className="flex items-center gap-3 border-b border-border-subtle p-3 text-xs last:border-0">
            <div className="h-7 w-7 rounded-lg bg-input" />
            <span className="text-sm">{s.name}</span>
            <span className="mono text-muted">{s.addr}</span>
            <span className="mono ml-auto">{s.bal}</span>
            <span className="rounded-md bg-input px-2 py-0.5 text-[10px] text-tertiary">{s.perm}</span>
          </div>
        ))}
      </div>

      <div className="card mt-4 p-5 text-xs text-secondary">
        {L(
          "子账户能力（即将推出）：独立限额、独立 TEE 度量、权限隔离（trade/hold/read），用于策略隔离与团队协作。",
          "Sub-account capabilities (coming soon): independent limits, independent TEE measurements, permission isolation (trade/hold/read)."
        )}
      </div>
    </div>
  );
}
