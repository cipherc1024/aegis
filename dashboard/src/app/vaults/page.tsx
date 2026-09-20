"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useL } from "@/lib/i18n";
import { api, type VaultListState } from "@/lib/aegis";
import { AlertTriangle, Check, Landmark, Loader2, RefreshCw, ExternalLink } from "lucide-react";

/**
 * 金库清单 = 链上真实读数（/api/vaults）。
 *
 * 这个页面此前是三个编造的金库（APY 6.2% / TVL $12.4M / 一个死的"存入"按钮）。
 * 真实情况是：AegisVaultQuorum 的 agentId 是 immutable，一个金库只服务一个 agent，
 * 所以清单长度 = 已部署的金库数，通常只有 1 个。页面如实展示，不凑数。
 */
export default function VaultsPage() {
  const L = useL();
  const [st, setSt] = useState<VaultListState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const v = await api.vaults();
    setSt(v);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center gap-2">
        <Landmark className="h-5 w-5 text-cyan" />
        <h1 className="text-lg font-semibold">{L("金库", "Vaults")}</h1>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border-base px-2.5 py-1.5 text-xs text-secondary hover:border-border-hover disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {L("刷新", "Refresh")}
        </button>
      </div>

      {!st && !loading && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber/40 bg-amber/5 p-3 text-xs text-amber">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {L("orchestrator 不可达，读不到金库清单。", "orchestrator unreachable — cannot read the vault list.")}
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
          <div className="mb-4 rounded-md border border-border-subtle bg-input p-3 text-[11px] leading-relaxed text-tertiary">
            {L(
              "AegisVaultQuorum 的 agentId 是 immutable —— 一个金库只服务一个 agent。因此本清单的行数 = 已部署的金库数，而不是产品目录里的可选策略数。每个 agent 的「策略」是它自己的 challenger 策略文件，见策略编辑器。",
              "AegisVaultQuorum's agentId is immutable — one vault serves exactly one agent. So this list has as many rows as there are deployed vaults, not curated strategies. Each agent's strategy is its own challenger policy file (see Policy Editor)."
            )}
          </div>

          <div className="space-y-3">
            {st.vaults.length === 0 && (
              <div className="card p-5 text-xs text-muted">
                {L("身份注册表为空 —— 尚无已注册 agent。", "Identity registry is empty — no agents registered yet.")}
              </div>
            )}
            {st.vaults.map((a) => {
              const v = a.vault;
              // 三态而非两态：configured / 读失败 / 确实没有。把读失败渲染成"无金库"
              // 是在编造结论——地址明明匹配上了，只是这一次 RPC 读没回来。
              const readError = !v?.configured && v?.readError ? v.readError : null;
              return (
                <div key={a.agentId} className="card p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Landmark className="h-4 w-4 text-cyan" />
                    <span className="text-sm font-medium">
                      {L("agentId", "agentId")} {a.agentId}
                    </span>
                    {v?.configured ? (
                      <span className="flex items-center gap-1 rounded border border-green/40 bg-green/5 px-1.5 py-0.5 text-[10px] text-green">
                        <Check className="h-3 w-3" />
                        {L("金库已配置", "vault configured")}
                      </span>
                    ) : readError ? (
                      <span className="flex items-center gap-1 rounded border border-amber/40 bg-amber/5 px-1.5 py-0.5 text-[10px] text-amber">
                        <AlertTriangle className="h-3 w-3" />
                        {L("状态读取失败", "read failed")}
                      </span>
                    ) : (
                      <span className="flex items-center gap-1 rounded border border-amber/40 bg-amber/5 px-1.5 py-0.5 text-[10px] text-amber">
                        <AlertTriangle className="h-3 w-3" />
                        {L("无金库", "no vault")}
                      </span>
                    )}
                    {v?.frozen && (
                      <span className="rounded border border-red/40 bg-red/5 px-1.5 py-0.5 text-[10px] text-red">
                        {L("已冻结", "frozen")}
                      </span>
                    )}
                  </div>

                  {!v?.configured && (
                    <div className="mt-2 text-[11px] leading-relaxed text-amber">
                      {a.vaultNote ?? "—"}
                      {readError && (
                        <button
                          onClick={() => void refresh()}
                          className="ml-2 rounded border border-amber/40 px-1.5 py-0.5 text-[10px] hover:bg-amber/10"
                        >
                          {L("重试", "retry")}
                        </button>
                      )}
                    </div>
                  )}

                  {/* 地址已匹配：即使状态读失败也如实显示地址，不隐藏 */}
                  {v && !v.configured && (
                    <div className="mono mt-2 break-all text-[10px] text-muted">
                      {v.address}
                      <span className="ml-1.5 text-tertiary">({v.source})</span>
                    </div>
                  )}

                  {v?.configured && (
                    <>
                      <div className="mono mt-2 break-all text-[10px] text-muted">
                        {v.address}
                        <a
                          href={`https://testnet.monadexplorer.com/address/${v.address}`}
                          target="_blank"
                          rel="noreferrer"
                          className="ml-1.5 inline-flex items-center gap-0.5 text-cyan hover:underline"
                        >
                          {L("浏览器", "explorer")}
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1.5 text-[11px] sm:grid-cols-3">
                        <Stat k={L("MON 余额", "MON balance")} v={v.balanceMonHuman !== undefined ? `${v.balanceMonHuman} MON` : "—"} />
                        <Stat k={L("单笔限额", "per-tx limit")} v={v.perTxLimit ? `${Number(v.perTxLimit) / 1e18} MON` : "—"} />
                        <Stat k={L("每日限额", "daily limit")} v={v.dailyLimit ? `${Number(v.dailyLimit) / 1e18} MON` : "—"} />
                        <Stat k={L("今日已用", "spent today")} v={v.dailySpentToday ? `${Number(v.dailySpentToday) / 1e18} MON` : "—"} />
                        <Stat k={L("可信验证者数", "trusted validators")} v={v.trustedValidatorCount !== undefined ? String(v.trustedValidatorCount) : "—"} />
                        <Stat
                          k={L("白名单标的", "whitelisted targets")}
                          v={String(v.targets.filter((t) => t.whitelisted).length)}
                        />
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Link
                          href="/funds"
                          className="rounded-md border border-cyan/40 bg-cyan/5 px-2.5 py-1 text-[11px] text-cyan hover:bg-cyan/10"
                        >
                          {L("存取款 →", "Deposit / withdraw →")}
                        </Link>
                        <Link
                          href="/policy"
                          className="rounded-md border border-border-base px-2.5 py-1 text-[11px] text-secondary hover:border-border-hover"
                        >
                          {L("策略编辑器 →", "Policy editor →")}
                        </Link>
                      </div>
                    </>
                  )}

                  <div className="mono mt-2 break-all text-[10px] text-muted">
                    owner {a.owner ?? "—"}
                  </div>
                </div>
              );
            })}
          </div>

          {/* 扫描口径如实说明：链上没有 agentId → vault 索引 */}
          <div className="card mt-4 p-5">
            <div className="text-sm">{L("本清单是怎么扫出来的", "How this list is discovered")}</div>
            <div className="mt-1 text-[11px] leading-relaxed text-tertiary">{st.scan.note}</div>
            <div className="mt-2 space-y-1 text-[11px]">
              <div className="text-tertiary">
                {L("候选地址（来自配置）", "Candidate addresses (from config)")}:
              </div>
              {st.scan.candidates.map((c) => (
                <div key={`${c.source}-${c.address}`} className="mono break-all text-[10px] text-muted">
                  {c.source} → {c.address}
                  {c.declaredAgentId !== null ? ` (declared agentId ${c.declaredAgentId})` : ""}
                </div>
              ))}
              {st.scan.candidates.length === 0 && (
                <div className="text-[10px] text-muted">{L("（无）", "(none)")}</div>
              )}
            </div>
            {st.scan.unroutedCandidates.length > 0 && (
              <div className="mt-3 rounded-md border border-amber/40 bg-amber/5 p-2.5">
                <div className="text-[11px] text-amber">
                  {L("已配置但未匹配到任何 agent 的地址", "Configured but matched no agent")}
                </div>
                {st.scan.unroutedCandidates.map((u) => (
                  <div key={`${u.address}-${u.onchainAgentId}`} className="mono break-all text-[10px] text-muted">
                    {u.address} → {L("链上 agentId", "on-chain agentId")} {u.onchainAgentId}（{u.source}）
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-tertiary">{k}</span>
      <span className="mono text-secondary">{v}</span>
    </div>
  );
}
