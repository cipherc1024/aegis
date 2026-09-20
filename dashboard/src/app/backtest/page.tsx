"use client";

import { useCallback, useEffect, useState } from "react";
import { useL } from "@/lib/i18n";
import { api, type ExecStats, type ExecStatsRow } from "@/lib/aegis";
import { Activity, AlertTriangle, Loader2, RefreshCw, ExternalLink, ShieldCheck, XCircle, Clock } from "lucide-react";

/**
 * 执行统计 = 真实收据流的聚合（/api/exec-stats）。
 *
 * 这个页面此前是编造的回测：+18.6% 累计收益 / -7.2% 最大回撤 / 63% 胜率 /
 * 12 根编造的收益柱 / 128 笔交易 / 夏普 1.82，配一句"回测基于链上真实收据"——
 * 数字和文案互相矛盾，没有一行来自链上。
 *
 * 现在的定位说清楚：**收益回测做不了**，因为本系统不产生价格数据（链上没有价格
 * 字段，仓库里也没有行情管道）。能如实给出的是**执行事实**：提交了多少收据、
 * 多少笔交易拿到了 challenger 的独立背书、背书是同意还是拒绝——逐笔链上可核对。
 * 这不是退而求其次，而是这套系统真正在证明的东西：决策可被独立重推导。
 */
export default function ExecStatsPage() {
  const L = useL();
  const [st, setSt] = useState<ExecStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setSt(await api.execStats(1));
    } catch (e) {
      setSt(null);
      setErr(String((e as Error)?.message || e));
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center gap-2">
        <Activity className="h-5 w-5 text-cyan" />
        <div>
          <h1 className="text-lg font-semibold">{L("执行统计", "Execution Stats")}</h1>
          <p className="text-xs text-tertiary">
            {L(
              "收据流聚合 + 链上 validation 状态直读（逐笔可核对）",
              "Aggregated from the receipt stream + live on-chain validation status (verifiable per row)"
            )}
          </p>
        </div>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border-base px-2.5 py-1.5 text-xs text-secondary hover:border-border-hover disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {L("刷新", "Refresh")}
        </button>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-md border border-amber/40 bg-amber/5 p-3">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" />
        <div className="text-[11px] leading-relaxed text-amber">
          {L(
            "本页不是收益回测。收益率 / 最大回撤 / 胜率 / 夏普需要一个价格数据管道，本系统不产生（链上也没有价格字段）——那属于另一件事。这里给的是执行事实：每笔交易的决策是否被独立 challenger 重推导并背书。",
            "This is not a return backtest. Return / max drawdown / win rate / Sharpe require a price pipeline that this system does not have (and there are no price fields on-chain) — that would be a separate effort. What is shown here are execution facts: whether each trade's decision was independently re-derived and endorsed by a challenger."
          )}
        </div>
      </div>

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber/40 bg-amber/5 p-3 text-xs text-amber">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {L("读取失败（orchestrator 不可达或 RPC 抖动）：", "Read failed (orchestrator unreachable or RPC flake):")} {err}
          <button onClick={() => void refresh()} className="ml-2 rounded border border-amber/40 px-1.5 py-0.5 text-[10px] hover:bg-amber/10">
            {L("重试", "retry")}
          </button>
        </div>
      )}

      {loading && !st && (
        <div className="flex items-center gap-2 text-xs text-tertiary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          {L("读取中…", "loading…")}
        </div>
      )}

      {st && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card k={L("收据总数", "Receipts")} v={String(st.receiptsTotal)} />
            <Card k={L("交易收据", "Trade receipts")} v={String(st.tradesSubmitted)} />
            <Card k={L("已获背书", "Endorsed")} v={String(st.validated)} tone="text-green" />
            <Card k={L("待背书", "Pending endorsement")} v={String(st.pendingValidation)} tone={st.pendingValidation > 0 ? "text-amber" : undefined} />
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-3">
            <Card k={L("challenger 同意 (≥100)", "challenger agreed (≥100)")} v={String(st.agreed)} tone="text-green" />
            <Card k={L("challenger 拒绝", "challenger rejected")} v={String(st.rejected)} tone="text-red" />
            <Card k={L("心跳收据", "Heartbeats")} v={String(st.heartbeats)} />
          </div>

          <div className="card mb-4 p-4 text-[11px] leading-relaxed text-tertiary">
            {L("覆盖区块", "Block coverage")}: <span className="mono text-secondary">{st.firstBlock ?? "—"}</span>
            {" — "}
            <span className="mono text-secondary">{st.lastBlock ?? "—"}</span>
            <div className="mt-1.5">{st.note}</div>
          </div>

          <div className="card overflow-hidden">
            <div className="border-b border-border-subtle px-4 py-3 text-sm">
              {L("逐笔明细（validation 直读 ValidationRegistry）", "Per-receipt detail (validation read live from ValidationRegistry)")}
            </div>
            {st.rows.length === 0 && (
              <div className="p-4 text-xs text-muted">
                {L("索引器内没有该 agent 的收据。", "No receipts for this agent in the index.")}
              </div>
            )}
            <div className="divide-y divide-border-subtle">
              {st.rows.map((r) => (
                <Row key={r.receiptHash} r={r} />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Row({ r }: { r: ExecStatsRow }) {
  const L = useL();
  const v = r.validation;
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-4 py-2.5 text-[11px]">
      <span className="mono text-tertiary">{r.blockHeight}</span>
      <span className={r.isHeartbeat ? "text-muted" : "text-secondary"}>
        {r.isHeartbeat ? L("心跳", "heartbeat") : L("交易", "trade")}
      </span>

      {r.isHeartbeat ? (
        <span className="text-muted">{L("心跳不做 validation 重推导（无 transcript 绑定）", "heartbeats are not re-derived (no transcript binding)")}</span>
      ) : !v ? (
        <span className="flex items-center gap-1 text-amber">
          <AlertTriangle className="h-3 w-3" />
          {L("validation 状态读取失败", "validation status read failed")}
        </span>
      ) : v.responded ? (
        v.response >= 100 ? (
          <span className="flex items-center gap-1 text-green">
            <ShieldCheck className="h-3 w-3" />
            {L("已背书 · 同意", "endorsed · agreed")} (response={v.response})
            {v.tag && <span className="text-tertiary">tag={v.tag}</span>}
          </span>
        ) : (
          <span className="flex items-center gap-1 text-red">
            <XCircle className="h-3 w-3" />
            {L("已背书 · 拒绝", "endorsed · rejected")} (response={v.response})
            {v.tag && <span className="text-tertiary">tag={v.tag}</span>}
          </span>
        )
      ) : (
        <span className="flex items-center gap-1 text-amber">
          <Clock className="h-3 w-3" />
          {L("待背书（链上尚无 validation 裁决）", "pending (no on-chain validation yet)")}
        </span>
      )}

      {v?.validator && v.validator !== "0x0000000000000000000000000000000000000000" && (
        <span className="mono text-muted">{L("验证者", "validator")} {v.validator.slice(0, 10)}…</span>
      )}

      <a
        href={`https://testnet.monadexplorer.com/tx/${r.txHash}`}
        target="_blank"
        rel="noreferrer"
        className="ml-auto inline-flex items-center gap-0.5 text-cyan hover:underline"
      >
        {r.txHash.slice(0, 10)}…
        <ExternalLink className="h-2.5 w-2.5" />
      </a>
    </div>
  );
}

function Card({ k, v, tone = "text-secondary" }: { k: string; v: string; tone?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-tertiary">{k}</div>
      <div className={`mono mt-2 text-xl font-semibold ${tone}`}>{v}</div>
    </div>
  );
}
