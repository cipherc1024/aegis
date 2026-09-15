"use client";

import { useState } from "react";
import { useL } from "@/lib/i18n";
import { Lock, ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import { SampleBanner } from "@/components/SampleBanner";

const RECENT = [
  { type: "deposit", amount: "+2.0 MON", time: "2026-09-11 14:02", hash: "0x9a1c…77b2" },
  { type: "withdraw", amount: "-0.5 MON", time: "2026-09-10 09:31", hash: "0x3f81…a9d4" },
  { type: "deposit", amount: "+1.0 MON", time: "2026-09-08 18:20", hash: "0xbc02…1e55" },
];

export default function FundsPage() {
  const L = useL();
  const [deposit, setDeposit] = useState("");
  const [withdraw, setWithdraw] = useState("");

  return (
    <div className="mx-auto max-w-5xl">
      <h1 className="mb-5 text-lg font-semibold">{L("存取款", "Deposit / Withdraw")}</h1>
      <SampleBanner />
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* deposit */}
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <ArrowDownToLine className="h-4 w-4 text-cyan" />
            {L("存款", "Deposit")}
          </div>
          <AmountInput value={deposit} onChange={setDeposit} />
          <div className="mt-3 space-y-1 text-xs text-tertiary">
            <div className="flex justify-between">
              <span>{L("预计权益", "Estimated equity")}</span>
              <span className="mono text-secondary">${(12480 + Number(deposit || 0) * 1).toFixed(0)}</span>
            </div>
            <div className="flex justify-between">
              <span>{L("网络", "Network")}</span>
              <span className="mono text-secondary">Monad Testnet · 10143</span>
            </div>
          </div>
          <button className="mt-4 w-full rounded-lg bg-cyan py-2.5 text-sm font-medium text-base hover:opacity-90">
            {L("存入", "Deposit")}
          </button>
        </div>

        {/* withdraw */}
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <ArrowUpFromLine className="h-4 w-4 text-green" />
            {L("提现", "Withdraw")}
            <span className="ml-auto flex items-center gap-1 rounded-md bg-green/10 px-2 py-0.5 text-[10px] text-green">
              <Lock className="h-3 w-3" />
              {L("永不冻结", "Always open")}
            </span>
          </div>
          <AmountInput value={withdraw} onChange={setWithdraw} />
          <div className="mt-3 space-y-1 text-xs text-tertiary">
            <div className="flex justify-between">
              <span>{L("可提取", "Available")}</span>
              <span className="mono text-secondary">$12,480</span>
            </div>
            <div className="flex justify-between">
              <span>{L("状态", "Status")}</span>
              <span className="text-green">{L("始终可用", "Always available")}</span>
            </div>
          </div>
          <button className="mt-4 w-full rounded-lg border border-green/40 bg-green/5 py-2.5 text-sm font-medium text-green hover:bg-green/10">
            {L("提现", "Withdraw")}
          </button>
        </div>
      </div>

      {/* recent */}
      <div className="card mt-4 p-4">
        <div className="mb-3 text-sm">{L("最近交易记录", "Recent transactions")}</div>
        <div className="space-y-1">
          {RECENT.map((t, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-border-subtle py-2 text-xs last:border-0">
              <span className={`h-2 w-2 rounded-full ${t.type === "withdraw" ? "bg-green" : "bg-cyan"}`} />
              <span className="text-secondary">{t.type === "withdraw" ? L("提现", "Withdraw") : L("存款", "Deposit")}</span>
              <span className={`mono ${t.type === "withdraw" ? "text-green" : "text-cyan"}`}>{t.amount}</span>
              <span className="ml-auto text-muted">{t.time}</span>
              <span className="mono text-muted">{t.hash}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function AmountInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 rounded-lg border border-border-base bg-input px-3 py-2.5 focus-within:border-cyan/40">
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          placeholder="0.0"
          className="mono min-w-0 flex-1 bg-transparent text-sm outline-none"
        />
        <span className="mono text-xs text-muted">MON</span>
      </div>
      <div className="mt-2 flex gap-2">
        {[25, 50, 75, 100].map((p) => (
          <button
            key={p}
            onClick={() => onChange(String((p / 100) * 10))}
            className="flex-1 rounded-md border border-border-base py-1 text-[11px] text-tertiary hover:border-border-hover hover:text-secondary"
          >
            {p}%
          </button>
        ))}
      </div>
    </div>
  );
}
