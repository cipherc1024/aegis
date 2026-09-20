"use client";

import { useState } from "react";
import { useL } from "@/lib/i18n";
import { Lock, ArrowDownToLine, ArrowUpFromLine, RefreshCw } from "lucide-react";
import { ConfirmTx, fmtMon } from "@/components/ConfirmTx";
import { useVault } from "@/lib/useVault";
import type { AdminResult } from "@/lib/aegis";

function monToWei(s: string): string | null {
  if (!s.trim()) return null;
  const n = Number(s);
  if (!Number.isFinite(n) || n <= 0) return null;
  // 避免浮点误差：按 18 位小数展开
  const [int, frac = ""] = s.trim().split(".");
  const fracPadded = (frac + "0".repeat(18)).slice(0, 18);
  try {
    return (BigInt(int || "0") * 10n ** 18n + BigInt(fracPadded || "0")).toString();
  } catch {
    return null;
  }
}

export default function FundsPage() {
  const L = useL();
  const { vault, loading, fetched, refresh } = useVault();
  const [deposit, setDeposit] = useState("");
  const [withdraw, setWithdraw] = useState("");
  const [lastTx, setLastTx] = useState<AdminResult | null>(null);

  const offline = fetched && !vault;
  const depWei = monToWei(deposit);
  const wdWei = monToWei(withdraw);
  const withdrawable = vault?.balanceMon ?? null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center gap-3">
        <h1 className="text-lg font-semibold">{L("存取款", "Deposit / Withdraw")}</h1>
        <button
          type="button"
          onClick={() => void refresh()}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border-base px-2.5 py-1 text-[11px] text-tertiary hover:border-border-hover hover:text-secondary"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {L("刷新", "refresh")}
        </button>
      </div>

      {/* 金库真实状态条 */}
      <div className="card mb-4 p-4">
        {offline ? (
          <div className="text-xs text-red">
            {L("orchestrator 不可达 —— 页面不显示任何占位数字。", "orchestrator unreachable — no placeholder numbers shown.")}
          </div>
        ) : !vault ? (
          <div className="text-xs text-tertiary">{L("读取链上金库状态…", "reading on-chain vault state…")}</div>
        ) : (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 md:grid-cols-4">
            <Field label={L("金库余额", "Vault balance")} value={`${fmtMon(vault.balanceMon)} MON`} tone="text-cyan" />
            <Field label={L("单笔上限", "Per-tx limit")} value={`${fmtMon(vault.perTxLimit)} MON`} />
            <Field label={L("日限剩余", "Daily remaining")} value={`${fmtMon(vault.dailyRemaining)} MON`} />
            <Field
              label={L("交易状态", "Trading")}
              value={vault.frozen ? L("已冻结", "FROZEN") : L("正常", "active")}
              tone={vault.frozen ? "text-red" : "text-green"}
            />
            <div className="col-span-2 md:col-span-4">
              <div className="mono break-all text-[11px] text-muted">
                {L("金库地址", "vault")} {vault.address} · agentId {vault.agentId} · owner {vault.owner}
              </div>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* deposit */}
        <div className="card p-5">
          <div className="mb-4 flex items-center gap-2 text-sm font-medium">
            <ArrowDownToLine className="h-4 w-4 text-cyan" />
            {L("存款", "Deposit")}
          </div>
          <AmountInput value={deposit} onChange={setDeposit} maxMon={undefined} />
          <div className="mt-3 space-y-1 text-xs text-tertiary">
            <div className="flex justify-between">
              <span>{L("出资方", "Funded by")}</span>
              <span className="mono text-secondary">owner {L("钱包", "wallet")}</span>
            </div>
            <div className="flex justify-between">
              <span>{L("网络", "Network")}</span>
              <span className="mono text-secondary">Monad Testnet · 10143</span>
            </div>
            <div className="flex justify-between">
              <span>{L("存入后金库余额", "Vault after")}</span>
              <span className="mono text-secondary">
                {vault ? `${fmtMon(vault.balanceMon)} → ${fmtMon(((BigInt(vault.balanceMon ?? "0") + BigInt(depWei ?? "0"))).toString())} MON` : "—"}
              </span>
            </div>
          </div>
          <div className="mt-4">
            <ConfirmTx
              op="deposit"
              params={{ amount: depWei ?? "0" }}
              label={L("金库注资", "Deposit to vault")}
              amountMon={deposit || "0"}
              disabled={!depWei || offline}
              onDone={(r) => {
                setLastTx(r);
                setDeposit("");
                void refresh();
              }}
            >
              {L("存入", "Deposit")}
            </ConfirmTx>
          </div>
          <div className="mt-3 text-[11px] text-muted">
            {L(
              "资金从 owner 钱包进入金库自有余额；executeTrade 只能动用金库余额，且受 PACE 限额约束。",
              "Funds move from the owner wallet into the vault. executeTrade can only spend vault balance, capped by PACE."
            )}
          </div>
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
          <AmountInput value={withdraw} onChange={setWithdraw} maxMon={vault?.balanceMon} />
          <div className="mt-3 space-y-1 text-xs text-tertiary">
            <div className="flex justify-between">
              <span>{L("可提取（金库余额）", "Available")}</span>
              <span className="mono text-secondary">{vault ? `${fmtMon(withdrawable)} MON` : "—"}</span>
            </div>
            <div className="flex justify-between">
              <span>{L("状态", "Status")}</span>
              <span className="text-green">{L("owner-only，冻结时仍可用", "owner-only, open even when frozen")}</span>
            </div>
            <div className="flex justify-between">
              <span>{L("提取后金库余额", "Vault after")}</span>
              <span className="mono text-secondary">
                {vault ? `${fmtMon(vault.balanceMon)} → ${fmtMon(((BigInt(vault.balanceMon ?? "0") - BigInt(wdWei ?? "0"))).toString())} MON` : "—"}
              </span>
            </div>
          </div>
          <div className="mt-4">
            <ConfirmTx
              op="withdraw"
              params={{ amount: wdWei ?? "0" }}
              label={L("从金库提取", "Withdraw from vault")}
              amountMon={withdraw || "0"}
              tone="amber"
              disabled={!wdWei || offline || (withdrawable !== null && withdrawable !== undefined && BigInt(wdWei) > BigInt(withdrawable))}
              onDone={(r) => {
                setLastTx(r);
                setWithdraw("");
                void refresh();
              }}
            >
              {L("提现", "Withdraw")}
            </ConfirmTx>
          </div>
          <div className="mt-3 text-[11px] text-muted">
            {L(
              "withdraw 是独立逃生通道：onlyOwner，且在 tradingFrozen 时依然可用。",
              "withdraw is an independent escape hatch: onlyOwner, still callable while tradingFrozen."
            )}
          </div>
        </div>
      </div>

      {/* 白名单标的余额（真实链上读回） */}
      <div className="card mt-4 p-4">
        <div className="mb-3 text-sm">{L("白名单标的余额", "Whitelisted target balances")}</div>
        {!vault ? (
          <div className="text-xs text-tertiary">{offline ? L("离线下无法读取。", "offline.") : L("读取中…", "loading…")}</div>
        ) : (
          <div className="space-y-1">
            {(vault.targets ?? []).map((t) => (
              <div key={t.address} className="flex items-center gap-3 border-b border-border-subtle py-2 text-xs last:border-0">
                <span className={`h-2 w-2 rounded-full ${t.whitelisted ? "bg-cyan" : "bg-red"}`} />
                <span className="w-16 text-secondary">{t.symbol}</span>
                <span className="mono text-[11px] text-muted">{t.address}</span>
                <span className={`ml-auto rounded px-1.5 py-0.5 text-[10px] ${t.whitelisted ? "bg-cyan/10 text-cyan" : "bg-red/10 text-red"}`}>
                  {t.whitelisted === null ? L("未读", "n/a") : t.whitelisted ? L("白名单内", "whitelisted") : L("不在白名单", "not whitelisted")}
                </span>
                <span className="mono w-32 text-right text-secondary">
                  {t.balance === null ? L("不可读", "unreadable") : `${Number(t.balance) / 10 ** t.decimals}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>

      {lastTx?.txHash && (
        <div className="card mt-4 p-4">
          <div className="mb-2 text-sm">{L("最近一笔治理交易", "Last governance tx")}</div>
          <div className="mono break-all text-xs text-secondary">{lastTx.txHash}</div>
          <div className="mono mt-1 text-[11px] text-muted">gas used {lastTx.gasUsed} · status {String(lastTx.status)}</div>
        </div>
      )}
    </div>
  );
}

function Field({ label, value, tone = "text-secondary" }: { label: string; value: string; tone?: string }) {
  return (
    <div>
      <div className="text-[11px] text-tertiary">{label}</div>
      <div className={`mono mt-1 text-sm ${tone}`}>{value}</div>
    </div>
  );
}

function AmountInput({ value, onChange, maxMon }: { value: string; onChange: (v: string) => void; maxMon?: string | null }) {
  const max = maxMon ? Number(maxMon) / 1e18 : null;
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
            type="button"
            onClick={() => {
              if (max !== null) onChange(String(Number(((p / 100) * max).toFixed(6))));
              else onChange(String(p / 100));
            }}
            className="flex-1 rounded-md border border-border-base py-1 text-[11px] text-tertiary hover:border-border-hover hover:text-secondary"
          >
            {p}%
          </button>
        ))}
      </div>
    </div>
  );
}
