"use client";

import { useState } from "react";
import { useL } from "@/lib/i18n";
import { Lock, Unlock, ShieldCheck } from "lucide-react";

export default function PolicyPage() {
  const L = useL();
  const [perTx, setPerTx] = useState("1");
  const [daily, setDaily] = useState("5");
  const [slippage, setSlippage] = useState("50");
  const [whitelist, setWhitelist] = useState("0x0000…bEEF, 0xKuruRouter…");

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center justify-between">
        <h1 className="text-lg font-semibold">{L("策略编辑器", "Policy Editor")}</h1>
        <div className="flex gap-2">
          <button className="rounded-lg border border-border-base px-3 py-1.5 text-xs text-primary hover:border-border-hover">
            {L("保存（收紧·立即）", "Save (tighten · instant)")}
          </button>
          <button className="rounded-lg bg-cyan px-3 py-1.5 text-xs font-medium text-base hover:opacity-90">
            {L("提交放宽（时间锁）", "Submit loosen (timelock)")}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* basic params */}
        <div className="card space-y-4 p-5">
          <div className="text-sm font-medium">{L("基础参数", "Base parameters")}</div>
          <Field label={L("单笔限额 (MON)", "Per-tx limit (MON)")}>
            <input value={perTx} onChange={(e) => setPerTx(e.target.value)} className="inp mono" />
          </Field>
          <Field label={L("每日限额 (MON)", "Daily limit (MON)")}>
            <input value={daily} onChange={(e) => setDaily(e.target.value)} className="inp mono" />
          </Field>
          <Field label={L("最大滑点 (bps)", "Max slippage (bps)")}>
            <input value={slippage} onChange={(e) => setSlippage(e.target.value)} className="inp mono" />
          </Field>
          <Field label={L("白名单标的", "Whitelisted targets")}>
            <textarea value={whitelist} onChange={(e) => setWhitelist(e.target.value)} className="inp mono min-h-[64px]" />
          </Field>
        </div>

        {/* guardrail */}
        <div className="card space-y-4 p-5">
          <div className="text-sm font-medium">{L("护栏规则", "Guardrail rules")}</div>
          <Row k={L("护栏版本", "Guardrail version")} v="v1" />
          <div className="flex items-center justify-between rounded-lg bg-green/5 px-3 py-2 text-xs">
            <span className="flex items-center gap-2 text-green">
              <ShieldCheck className="h-3.5 w-3.5" /> Membrane
            </span>
            <span className="text-green">{L("已启用", "Enabled")}</span>
          </div>
          <div className="flex items-center justify-between rounded-lg bg-input px-3 py-2 text-xs">
            <span className="text-secondary">OPA</span>
            <span className="text-tertiary">{L("待接入", "Pending")}</span>
          </div>
          <div className="mono rounded-lg bg-input px-3 py-2 text-[11px] text-muted">
            guardrailHash = 0xd72be318…
          </div>
        </div>
      </div>

      {/* asymmetric */}
      <div className="card mt-4 p-5">
        <div className="mb-2 text-sm font-medium">{L("非对称升级", "Asymmetric upgrade")}</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="flex items-center gap-3 rounded-lg bg-green/5 px-3 py-3">
            <Lock className="h-4 w-4 text-green" />
            <div>
              <div className="text-xs text-green">{L("收紧（降限额/缩白名单）", "Tighten (lower limits / shrink whitelist)")}</div>
              <div className="text-[11px] text-muted">{L("即时生效", "Takes effect instantly")}</div>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-lg bg-amber/5 px-3 py-3">
            <Unlock className="h-4 w-4 text-amber" />
            <div>
              <div className="text-xs text-amber">{L("放宽（提限额）", "Loosen (raise limits)")}</div>
              <div className="text-[11px] text-muted">{L("需时间锁 + 用户确认", "Requires timelock + user confirmation")}</div>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        .inp {
          width: 100%;
          background: var(--bg-input);
          border: 1px solid var(--border-base);
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 13px;
          outline: none;
        }
        .inp:focus {
          border-color: rgba(0, 229, 204, 0.4);
        }
      `}</style>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs text-tertiary">{label}</span>
      {children}
    </label>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between text-xs">
      <span className="text-tertiary">{k}</span>
      <span className="mono text-secondary">{v}</span>
    </div>
  );
}
