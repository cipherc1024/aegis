"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, X } from "lucide-react";
import { api, type AdminResult, type AdminPreview } from "@/lib/aegis";
import { useL } from "@/lib/i18n";

/** 金额人类可读化：链上都是 wei 字符串 */
export function fmtMon(wei: string | null | undefined, digits = 6): string {
  if (!wei) return "—";
  const n = Number(wei) / 1e18;
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits).replace(/0+$/, "").replace(/\.$/, "");
}

function Row({ k, v, mono = true }: { k: string; v: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-xs">
      <span className="shrink-0 text-tertiary">{k}</span>
      <span className={`break-all text-right ${mono ? "mono" : ""} text-secondary`}>{v}</span>
    </div>
  );
}

/**
 * 治理写操作的统一入口。协议（见 orchestrator 的 adminOp）：
 *   1) 点按钮 → 不带 confirm 请求一次，拿到 preview（链上 estimateGas，零 gas 广播）
 *   2) 弹窗展示：调用目标、金额、预估 gas 与费用、发起钱包余额
 *   3) 用户点「确认并广播」→ 带 confirm:true 重发同一 body → 真实上链
 *
 * 记忆规则（feedback-cost-approval-before-spending）：花钱前必须让用户看到
 * 预估费用与前后余额。这里把 signerBalanceMon 与 estimatedFeeMon 并排显示，
 * 并且**不提供"以后不再询问"的选项**——每次真实上链都要过一遍人工确认。
 */
export function ConfirmTx({
  op,
  params,
  label,
  amountMon,
  register = false,
  children,
  onDone,
  disabled,
  tone = "cyan",
}: {
  op: string;
  params: Record<string, unknown>;
  label: string;
  /** 人类可读金额（MON），无金额的治理操作留空 */
  amountMon?: string;
  /** true = 走 POST /api/agents（注册 agent），false = 走 POST /api/admin/<op> */
  register?: boolean;
  onDone?: (r: AdminResult) => void;
  disabled?: boolean;
  tone?: "cyan" | "amber" | "red";
  children?: React.ReactNode;
}) {
  const L = useL();
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<AdminPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [result, setResult] = useState<AdminResult | null>(null);

  const toneCls =
    tone === "red"
      ? "border-red/40 text-red hover:bg-red/10"
      : tone === "amber"
        ? "border-amber/40 text-amber hover:bg-amber/10"
        : "border-cyan/40 text-cyan hover:bg-cyan/10";

  const fetchPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    setHint(null);
    setResult(null);
    try {
      const r = await api.admin(op, params, register);
      if (!r) {
        setError(L("orchestrator 不可达，无法预估费用。", "orchestrator unreachable."));
      } else if (r.error) {
        setError(r.error);
        setHint(r.hint ?? null);
      } else if (r.preview) {
        setPreview(r.preview);
      } else {
        setError(L("未收到预估信息。", "no preview returned."));
      }
    } finally {
      setLoading(false);
    }
  }, [op, params, register, L]);

  const onOpen = () => {
    setOpen(true);
    setPreview(null);
    void fetchPreview();
  };

  const broadcast = async () => {
    setSending(true);
    setError(null);
    try {
      const r = await api.admin(op, { ...params, confirm: true }, register);
      if (!r) {
        setError(L("广播失败：orchestrator 不可达。", "broadcast failed: orchestrator unreachable."));
      } else if (r.error) {
        setError(r.error);
        setHint(r.hint ?? null);
      } else {
        setResult(r);
        onDone?.(r);
      }
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !sending && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, sending]);

  return (
    <>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className={`rounded-md border px-3 py-1.5 text-xs transition disabled:cursor-not-allowed disabled:opacity-40 ${toneCls}`}
      >
        {children ?? label}
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={() => !sending && setOpen(false)}>
          <div className="card w-full max-w-lg p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between">
              <div>
                <div className="text-sm font-semibold">{label}</div>
                <div className="mono mt-0.5 text-[11px] text-muted">op: {op}</div>
              </div>
              <button type="button" onClick={() => setOpen(false)} disabled={sending} className="text-muted hover:text-primary disabled:opacity-40">
                <X className="h-4 w-4" />
              </button>
            </div>

            {loading && (
              <div className="mt-6 flex items-center gap-2 text-xs text-tertiary">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                {L("正在链上预估 gas（零 gas，未广播）…", "estimating gas on-chain (no broadcast)…")}
              </div>
            )}

            {error && !preview && (
              <div className="mt-5 rounded-md border border-red/40 bg-red/5 p-3">
                <div className="flex items-start gap-2 text-xs text-red">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <div>
                    <div className="mono break-all">{error}</div>
                    {hint && <div className="mt-1.5 text-[11px] text-amber">{hint}</div>}
                  </div>
                </div>
                <button type="button" onClick={fetchPreview} className="mt-3 rounded-md border border-border-base px-2.5 py-1 text-[11px] text-secondary hover:border-border-hover">
                  {L("重试", "retry")}
                </button>
              </div>
            )}

            {preview && !result && (
              <>
                <div className="mt-5 rounded-md border border-border-subtle bg-input p-3">
                  <Row k={L("调用目标", "target")} v={preview.target} />
                  <Row k={L("发起钱包", "signer")} v={preview.signer} />
                  {amountMon && <Row k={L("金额", "amount")} v={`${amountMon} MON`} />}
                  <Row k={L("预估 gas", "est. gas")} v={preview.gasLimit} />
                  <Row k={L("预估费用", "est. fee")} v={`${fmtMon(preview.gasPrice, 0)} wei/gas → ${preview.estimatedFeeMon.toFixed(6)} MON`} />
                  <div className="my-1.5 border-t border-border-subtle" />
                  <Row k={L("钱包余额（发前）", "balance before")} v={`${preview.signerBalanceMon.toFixed(4)} MON`} />
                  <Row
                    k={L("钱包余额（发后，估）", "balance after (est.)")}
                    v={`${(preview.signerBalanceMon - preview.estimatedFeeMon - Number(preview.value) / 1e18).toFixed(4)} MON`}
                  />
                </div>
                <div className="mt-3 text-[11px] leading-relaxed text-tertiary">
                  {L(
                    "这是一笔真实上链交易，会消耗真实 testnet gas。合约通常在 onlyOwner 下只接受 owner 钱包调用；参数不合法或状态已一致会 revert。",
                    "This is a real on-chain transaction costing real testnet gas."
                  )}
                </div>
                {preview.sideEffects && preview.sideEffects.length > 0 && (
                  <div className="mt-3 rounded-md border border-amber/40 bg-amber/5 p-3">
                    <div className="text-[11px] font-medium text-amber">
                      {L("这笔交易不会产生的东西（orchestrator 如实声明）", "What this tx does NOT create (declared by orchestrator)")}
                    </div>
                    <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-[11px] leading-relaxed text-tertiary">
                      {preview.sideEffects.map((s, i) => (
                        <li key={i}>{s}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {result && (
              <div className="mt-5 rounded-md border border-green/40 bg-green/5 p-3">
                <div className="flex items-center gap-2 text-xs text-green">
                  <Check className="h-3.5 w-3.5" />
                  {L("已广播并确认", "broadcast & confirmed")}
                </div>
                <div className="mt-2">
                  <Row k={L("交易哈希", "tx")} v={result.txHash ?? "—"} />
                  <Row k={L("gas 实耗", "gas used")} v={result.gasUsed ?? "—"} />
                  <Row k={L("状态", "status")} v={String(result.status ?? "—")} />
                </div>
              </div>
            )}

            {error && preview && (
              <div className="mt-3 rounded-md border border-red/40 bg-red/5 p-2.5 text-xs text-red">
                <div className="mono break-all">{error}</div>
                {hint && <div className="mt-1.5 text-[11px] text-amber">{hint}</div>}
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={sending}
                className="rounded-md border border-border-base px-3 py-1.5 text-xs text-secondary hover:border-border-hover disabled:opacity-40"
              >
                {result ? L("关闭", "close") : L("取消", "cancel")}
              </button>
              {!result && (
                <button
                  type="button"
                  onClick={broadcast}
                  disabled={!preview || sending}
                  className="flex items-center gap-1.5 rounded-md border border-cyan/40 bg-cyan/10 px-3 py-1.5 text-xs text-cyan disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {sending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  {sending ? L("广播中…", "broadcasting…") : L("确认并广播", "confirm & broadcast")}
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
