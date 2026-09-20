"use client";

import { useEffect, useState } from "react";
import { useL } from "@/lib/i18n";
import { api, type ExecStats, type ExecStatsRow } from "@/lib/aegis";
import { shortAddr } from "@/lib/mock";
import { TrendingUp, ShieldCheck, RefreshCw, ExternalLink } from "lucide-react";

const EXPLORER = "https://testnet.monadexplorer.com";

/**
 * 本页不是「跟投」功能页 —— 跟投在本系统里不是「还没做」，而是「结构上不能做」：
 *   AegisVaultQuorum 的 agentId 是 immutable，一个金库只服务一个 agent，且
 *   executeTrade 的出资方是金库自有余额（非 payable），外部调用者无法附带资金；
 *   ValidationRegistry 是单槽裁决（同一 requestHash 只能有一个 validator 裁决）。
 * 所以「把资金跟到一个策略上」在本架构里没有可插入的位置。本页如实说明这一点，
 * 并把当前唯一真实存在的 agent 的执行事实列出来（可逐笔在链上核对）。
 */
export default function CopyPage() {
  const L = useL();
  const [st, setSt] = useState<ExecStats | null>(null);
  const [fetched, setFetched] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    setSt(await api.execStats(1));
    setLoading(false);
    setFetched(true);
  }
  useEffect(() => {
    void load();
  }, []);

  const offline = fetched && !st;
  const trades = (st?.rows ?? []).filter((r) => !r.isHeartbeat);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center gap-3">
        <TrendingUp className="h-5 w-5 text-cyan" />
        <h1 className="text-lg font-semibold">{L("策略跟投", "Copy Strategies")}</h1>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border-base px-2.5 py-1 text-[11px] text-tertiary hover:border-border-hover hover:text-secondary"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {L("刷新", "refresh")}
        </button>
      </div>

      {/* 诚实说明：为什么本页没有「跟投」按钮 */}
      <div className="card mb-4 flex items-start gap-3 border-amber/40 p-5">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
        <div>
          <div className="text-sm">{L("本页没有「跟投」功能——这是设计边界，不是待办", "There is no copy-trade feature here — a design boundary, not a to-do")}</div>
          <ul className="mt-2 space-y-1.5 text-xs text-secondary">
            <li>
              {L(
                "① 一个金库只服务一个 agent：AegisVaultQuorum 的 agentId 是 immutable，金库与 agent 一一绑定，没有「多个资金方共享一个策略金库」的槽位。",
                "① One vault serves exactly one agent: AegisVaultQuorum's agentId is immutable, so vault and agent are 1:1. There is no slot for multiple funders sharing one strategy vault."
              )}
            </li>
            <li>
              {L(
                "② 出资方是金库自有余额：executeTrade 非 payable（刻意的——恶意/失陷 TEE 无法夹带未授权资金），外部调用者无法把资金附到某笔执行上。",
                "② Funding comes from the vault's own balance: executeTrade is non-payable by design (a compromised TEE cannot smuggle unauthorized funds), so an external caller cannot attach funds to an execution."
              )}
            </li>
            <li>
              {L(
                "③ 裁决是单槽的：ValidationRegistry 对同一 requestHash 只保留一个 validator 的裁决，跟投者无法各自独立背书同一笔决策。",
                "③ Adjudication is single-slot: ValidationRegistry keeps one validator's verdict per requestHash, so copiers cannot each independently attest the same decision."
              )}
            </li>
            <li className="text-tertiary">
              {L(
                "要做跟投，需要先改合约（多资金方份额 accounting + 赎回路径 + 每份额独立的验证语义），这是 future work，不是本页可以用前端补上的。",
                "Copy-trading would require contract changes first (multi-funder share accounting + redemption path + per-share verification semantics). That is future work, not something a frontend can supply."
              )}
            </li>
          </ul>
        </div>
      </div>

      {offline ? (
        <div className="card border-red/40 p-4 text-xs text-red">
          {L("orchestrator 不可达 —— 本页不显示任何占位数字。", "orchestrator unreachable — no placeholder numbers shown.")}
        </div>
      ) : !st ? (
        <div className="card p-4 text-xs text-tertiary">{L("读取链上执行事实…", "reading on-chain execution facts…")}</div>
      ) : (
        <>
          {/* 真实存在的 agent：执行事实（非收益率） */}
          <div className="mb-4 grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Stat label={L("Agent", "Agent")} value={`#${st.agentId}`} />
            <Stat label={L("交易收据", "Trade receipts")} value={String(st.tradesSubmitted)} />
            <Stat
              label={L("已获背书", "Attested")}
              value={String(st.validated)}
              tone={st.validated > 0 ? "text-green" : ""}
            />
            <Stat label={L("待背书", "Pending")} value={String(st.pendingValidation)} tone={st.pendingValidation > 0 ? "text-amber" : ""} />
          </div>

          <div className="card p-4">
            <div className="mb-3 text-sm">{L("真实执行记录（链上可逐笔核对）", "Real execution records (verifiable on-chain)")}</div>
            {!trades.length ? (
              <div className="text-xs text-tertiary">
                {L("当前索引窗口内没有交易收据。", "No trade receipts in the current index window.")}
              </div>
            ) : (
              <div className="space-y-2">
                {trades.map((r) => (
                  <TradeRow key={r.receiptHash} r={r} />
                ))}
              </div>
            )}
            <p className="mt-3 text-[11px] text-tertiary">
              {L(
                "本页不展示收益率 / 回撤 / 胜率 / TVL：链上没有价格或业绩字段，这些数字需要另建价格数据管道。Aegis 记录的是「这次决策能否被 challenger 独立重推导出相同结论」。",
                "No returns / drawdown / win-rate / TVL here: there are no price or performance fields on-chain; those numbers would need a separate price pipeline. What Aegis records is whether a challenger can independently re-derive the same verdict for a decision."
              )}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function TradeRow({ r }: { r: ExecStatsRow }) {
  const L = useL();
  const v = r.validation;
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-border-subtle bg-input px-3 py-2 text-xs">
      <span className="mono text-tertiary">#{r.blockHeight}</span>
      <span className="text-secondary">{L("交易", "trade")}</span>
      {!v ? (
        <span className="text-amber">{L("validation 状态读取失败", "validation read failed")}</span>
      ) : v.responded ? (
        <span className={v.response >= 100 ? "text-green" : "text-red"}>
          {v.response >= 100
            ? `${L("已背书 · 同意", "attested · agree")} (response=${v.response})`
            : `${L("已背书 · 拒绝", "attested · reject")} (response=${v.response})`}
          {v.validator && v.validator !== "0x0000000000000000000000000000000000000000" && (
            <span className="ml-1.5 mono text-[10px] text-tertiary">{shortAddr(v.validator)}</span>
          )}
        </span>
      ) : v.requested ? (
        <span className="text-amber">{L("已请求 · 尚未裁决", "requested · no verdict yet")}</span>
      ) : (
        <span className="text-tertiary">{L("待背书（链上尚无 validation 请求）", "pending (no validation request on-chain)")}</span>
      )}
      <a
        href={`${EXPLORER}/tx/${r.txHash}`}
        target="_blank"
        rel="noreferrer"
        className="ml-auto inline-flex items-center gap-1 text-cyan hover:underline"
      >
        <ExternalLink className="h-3 w-3" />
        {L("交易", "tx")}
      </a>
    </div>
  );
}

function Stat({ label, value, tone = "text-secondary" }: { label: string; value: string; tone?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-tertiary">{label}</div>
      <div className={`mono mt-2 text-xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}
