"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useL } from "@/lib/i18n";
import { api, type IdentityState } from "@/lib/aegis";
import { BadgeCheck, AlertTriangle, Loader2, RefreshCw, ShieldCheck } from "lucide-react";

/**
 * Agent 市场 = ERC-8004 IdentityRegistry 的真实注册表读数（/api/agents）。
 *
 * 这个页面此前是四个编造的 agent：TVL $4.2M / 30 日收益 +12.4% / 胜率 68% /
 * 声誉 94，外加一个死的「投资」按钮。这些数字全部没有数据源 —— 本仓库没有
 * 任何价格、收益率或回测数据管道，链上也没有对应字段。
 *
 * 现在改为如实呈现链上真正有的东西：agentId / owner / agentWallet / tokenURI
 * （EIP-8004 registration JSON，客户端 base64 解码）。没有的字段一律不显示，
 * 而不是拿编造数字填格子。
 *
 * 关键诚实边界：**业绩数据（收益/回撤/胜率）不是"暂时没接"，而是本系统不产生**
 * —— Aegis 记录的是"决策是否可被独立重推导"，不是盈亏。想拿业绩，得先有价格
 * 数据管道，那是另一件事。页面直接写明这一点。
 */
export default function MarketPage() {
  const L = useL();
  const [st, setSt] = useState<IdentityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      setSt(await api.agents());
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
        <ShieldCheck className="h-5 w-5 text-cyan" />
        <div>
          <h1 className="text-lg font-semibold">{L("Agent 市场", "Agent Market")}</h1>
          <p className="text-xs text-tertiary">
            {L(
              "ERC-8004 IdentityRegistry 的链上真实读数（permissionless 注册，含非本团队注册的 agent）",
              "Live reads from the ERC-8004 IdentityRegistry (permissionless — includes agents not registered by this team)"
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

      {/* 诚实边界：业绩数据不是"没接"，是本系统不产生 */}
      <div className="mb-4 flex items-start gap-2 rounded-md border border-amber/40 bg-amber/5 p-3">
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber" />
        <div className="text-[11px] leading-relaxed text-amber">
          {L(
            "本页不展示收益率 / 回撤 / 胜率 / TVL —— 这些数字本系统不产生。Aegis 记录的是「这次决策能否被 challenger 独立重推导出相同结论」，不是盈亏；链上也没有任何价格或业绩字段。要拿业绩需要另建价格数据管道，不在本项目范围内。",
            "No return / drawdown / win-rate / TVL here — this system does not produce those numbers. Aegis records whether a decision is independently re-derivable by a challenger, not profit and loss; there are no price or performance fields on-chain either. Performance data would require a separate price pipeline, which is out of scope."
          )}
        </div>
      </div>

      {err && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber/40 bg-amber/5 p-3 text-xs text-amber">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {L("读取身份注册表失败（orchestrator 不可达或 RPC 抖动）：", "Failed to read the identity registry (orchestrator unreachable or RPC flake):")} {err}
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
          <div className="mb-4 text-[11px] text-tertiary">
            {L("链上已注册 agent 总数（lastId()）", "Total registered agents on-chain (lastId())")}:{" "}
            <span className="mono text-secondary">{st.lastId}</span>
          </div>

          {st.agents.length === 0 && (
            <div className="card p-5 text-xs text-muted">
              {L("身份注册表为空 —— 尚无已注册 agent。", "Identity registry is empty — no agents registered yet.")}
            </div>
          )}

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {st.agents.map((a) => (
              <AgentCard key={a.agentId} agent={a} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function AgentCard({ agent }: { agent: IdentityState["agents"][number] }) {
  const L = useL();
  const meta = decodeTokenURI(agent.tokenURI);

  return (
    <div className="card p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-input text-lg">
          {meta?.name ? meta.name.slice(0, 1).toUpperCase() : "?"}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-sm font-medium">
              {meta?.name || `${L("agentId", "agentId")} ${agent.agentId}`}
            </span>
            {meta && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-cyan" />}
          </div>
          <div className="mono text-[11px] text-muted">ERC-8004 #{agent.agentId}</div>
          {meta?.description && (
            <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-tertiary">{meta.description}</p>
          )}
        </div>
      </div>

      <div className="mt-3 space-y-1 text-[11px]">
        <div className="flex justify-between gap-3">
          <span className="text-tertiary">owner</span>
          <span className="mono truncate text-secondary">{agent.owner ?? "—"}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-tertiary">agentWallet</span>
          <span className="mono truncate text-secondary">{agent.agentWallet ?? "—"}</span>
        </div>
      </div>

      {meta?.registrations && meta.registrations.length > 0 && (
        <div className="mt-2 text-[10px] text-muted">
          {L("注册处", "registrations")}: {meta.registrations.map((r) => `${r.agentRegistry}`).join(", ")}
        </div>
      )}

      {agent.note && <div className="mt-2 text-[10px] text-amber">{agent.note}</div>}

      <div className="mt-3 flex flex-wrap gap-2">
        <Link
          href="/vaults"
          className="rounded-md border border-border-base px-2.5 py-1 text-[11px] text-secondary hover:border-border-hover"
        >
          {L("金库状态 →", "Vault status →")}
        </Link>
        <Link
          href="/policy"
          className="rounded-md border border-border-base px-2.5 py-1 text-[11px] text-secondary hover:border-border-hover"
        >
          {L("策略核对 →", "Policy check →")}
        </Link>
      </div>
    </div>
  );
}

/**
 * EIP-8004 registration JSON 存在 tokenURI 里。本项目自部署的 IdentityRegistry
 * 用 `data:application/json;base64,...`，故客户端直接 atob 解出。
 */
function decodeTokenURI(uri: string | null): {
  name?: string;
  description?: string;
  registrations?: { agentId: number; agentRegistry: string }[];
} | null {
  if (!uri) return null;
  const m = uri.match(/^data:application\/json;base64,(.*)$/);
  if (!m) {
    // 非内联 URI（http/ipfs）：本页不代拉远端内容，如实说明而不是猜
    return { description: `tokenURI: ${uri.slice(0, 120)}` };
  }
  try {
    // atob 返回的是 latin-1 字节串，不是文本。tokenURI 里的 description 含
    // U+2014 破折号，直接 JSON.parse(atob(...)) 会渲染成 "â€""。先按 UTF-8 解码。
    const bin = atob(m[1]);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return JSON.parse(new TextDecoder("utf-8").decode(bytes));
  } catch {
    return null;
  }
}
