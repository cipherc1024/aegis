"use client";

import { useCallback, useEffect, useState } from "react";
import { useL } from "@/lib/i18n";
import { api, type PolicyState, type VaultState } from "@/lib/aegis";
import { ConfirmTx } from "@/components/ConfirmTx";
import { AlertTriangle, Check, Loader2, RefreshCw, ShieldCheck, FileJson } from "lucide-react";

/**
 * 策略编辑器 = 「链上已认证的 guardrailHash」与「challenger 自持策略文件」的对账页，
 * 加一个把两者对齐的治理动作（attest-guardrail）。
 *
 * 这里刻意不提供"在网页上编辑策略内容"的表单：策略内容在 challenger 侧的
 * challenger-policy-<id>.json，本进程（proposer）连写它的接口都没有。
 * 做一个能改内容的表单会制造"改完就生效"的错觉，而链上权威是 guardrailHash。
 * 所以本页做的是它真正能做的事：如实显示两侧当前值 + 在它们不一致时把认证值推上链。
 */
export default function PolicyPage() {
  const L = useL();
  const [st, setSt] = useState<PolicyState | null>(null);
  const [vault, setVault] = useState<VaultState | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [p, v] = await Promise.all([api.policy(1), api.vault(1)]);
    setSt(p);
    setVault(v);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const online = st !== null;
  const pol = st?.policy ?? null;
  const inSync = st?.inSync ?? null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-cyan" />
        <h1 className="text-lg font-semibold">{L("策略编辑器", "Policy Editor")}</h1>
        <button
          onClick={() => void refresh()}
          disabled={loading}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border-base px-2.5 py-1.5 text-xs text-secondary hover:border-border-hover disabled:opacity-40"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          {L("刷新", "Refresh")}
        </button>
      </div>

      {!online && !loading && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber/40 bg-amber/5 p-3 text-xs text-amber">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {L("orchestrator 不可达，读不到策略与链上认证值。", "orchestrator unreachable — cannot read policy or the attested hash.")}
        </div>
      )}

      {/* 对账状态：本页最重要的一行 */}
      {st && (
        <div
          className={`mb-4 rounded-md border p-4 ${
            !pol ? "border-amber/40 bg-amber/5" : inSync ? "border-green/40 bg-green/5" : "border-red/40 bg-red/5"
          }`}
        >
          <div className={`flex items-center gap-2 text-sm font-medium ${!pol ? "text-amber" : inSync ? "text-green" : "text-red"}`}>
            {!pol ? <AlertTriangle className="h-4 w-4" /> : inSync ? <Check className="h-4 w-4" /> : <AlertTriangle className="h-4 w-4" />}
            {!pol
              ? L(`agentId ${st.agentId} 没有挑战者策略文件`, `agentId ${st.agentId} has no challenger policy file`)
              : inSync
                ? L("链上认证值与策略文件一致", "On-chain attested value matches the policy file")
                : L("链上认证值与策略文件不一致 —— challenger 会拒绝该 agent 的所有收据", "Mismatch — the challenger will reject every receipt for this agent")}
          </div>
          <div className="mt-2 space-y-1 text-[11px] text-tertiary">
            <div className="mono break-all">
              {L("链上 on-chain", "on-chain")}: {st.onChainGuardrailHash}
            </div>
            <div className="mono break-all">
              {L("策略算出 attested", "attested")}: {st.attestedGuardrailHash ?? "—"}
            </div>
            <div className="mono break-all">
              {L("策略文件", "policy file")}: {st.policyFile ?? "—"}
            </div>
            <div className="mono break-all">
              {L("收据注册表", "receipt registry")}: {st.registry}
            </div>
          </div>
          <div className="mt-2 text-[11px] leading-relaxed text-muted">{st.note}</div>

          {pol && !inSync && (
            <div className="mt-3">
              <ConfirmTx
                op="attest-guardrail"
                params={{ agentId: st.agentId }}
                tone="amber"
                label={L(`把 agentId ${st.agentId} 的认证哈希推上链`, `Attest agentId ${st.agentId} on-chain`)}
                onDone={() => void refresh()}
              >
                <span className="flex items-center gap-1.5 text-xs font-medium">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  {L("重新认证（真实上链）", "Re-attest (real on-chain tx)")}
                </span>
              </ConfirmTx>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* 链上权威边界（读 /api/vault + /api/policy） */}
        <div className="card space-y-3 p-5">
          <div className="text-sm font-medium">{L("链上强制边界（真实读数）", "On-chain enforced bounds (live reads)")}</div>
          <div className="text-[11px] leading-relaxed text-muted">
            {L(
              "这两条是金库合约里的硬约束，越界由合约 revert，不依赖任何前端。",
              "These two are hard contract constraints; out-of-bounds reverts on-chain, independent of any frontend."
            )}
          </div>
          <Row k={L("单笔限额（金库 perTxLimit）", "Per-tx limit (vault)")} v={vault?.perTxLimit ? `${Number(vault.perTxLimit) / 1e18} MON` : "—"} />
          <Row k={L("每日限额（金库 dailyLimit）", "Daily limit (vault)")} v={vault?.dailyLimit ? `${Number(vault.dailyLimit) / 1e18} MON` : "—"} />
          <Row k={L("今日已用", "spent today")} v={vault?.dailySpentToday ? `${Number(vault.dailySpentToday) / 1e18} MON` : "—"} />
          <Row k={L("白名单（金库 isTargetAllowed）", "Whitelist (vault)")} v={vault ? String(vault.targets.filter((t) => t.whitelisted).length) : "—"} />
        </div>

        {/* challenger 策略内容（读策略文件） */}
        <div className="card space-y-3 p-5">
          <div className="flex items-center gap-2">
            <FileJson className="h-4 w-4 text-tertiary" />
            <div className="text-sm font-medium">{L("挑战者策略内容", "Challenger policy content")}</div>
          </div>
          {!pol && (
            <div className="text-xs text-amber">
              {L("该 agent 无策略文件。", "No policy file for this agent.")}
            </div>
          )}
          {pol && (
            <>
              <Row k={L("单笔限额", "per-tx limit")} v={pol.perTxLimit ? `${Number(pol.perTxLimit) / 1e18} MON` : "—"} />
              <Row k={L("每日限额", "daily limit")} v={pol.dailyLimit ? `${Number(pol.dailyLimit) / 1e18} MON` : "—"} />
              <Row k={L("最大滑点", "max slippage")} v={`${pol.maxSlippageBps} bps`} />
              <div className="pt-1">
                <div className="mb-1 text-[11px] text-tertiary">{L("允许标的", "allowed assets")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {pol.allowedAssets.map((a) => (
                    <span key={a} className="mono rounded border border-border-subtle bg-input px-1.5 py-0.5 text-[10px] text-secondary">
                      {a}
                    </span>
                  ))}
                </div>
              </div>
              <div className="pt-1">
                <div className="mb-1 text-[11px] text-tertiary">{L("白名单地址", "whitelisted targets")}</div>
                <div className="space-y-0.5">
                  {pol.whitelist.map((w) => (
                    <div key={w} className="mono break-all text-[10px] text-muted">
                      {w}
                    </div>
                  ))}
                </div>
              </div>
              <div className="pt-1">
                <div className="mb-1 text-[11px] text-tertiary">{L("注入黑名单（护栏子串）", "Injection blocklist")}</div>
                <div className="flex flex-wrap gap-1.5">
                  {pol.blocklist.map((b) => (
                    <span key={b} className="mono rounded border border-red/30 bg-red/5 px-1.5 py-0.5 text-[10px] text-red">
                      {b}
                    </span>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* 为什么没有"编辑策略内容"的表单 */}
      <div className="card mt-4 p-5">
        <div className="mb-2 text-sm font-medium">{L("为什么这里不能直接改策略内容", "Why you cannot edit policy content here")}</div>
        <div className="space-y-2 text-[11px] leading-relaxed text-tertiary">
          <p>
            {L(
              "策略内容（限额/白名单/黑名单）存放在 challenger 侧自己的文件 challenger-policy-<id>.json 里，由独立进程持有。本进程是 proposer，对那个文件没有写接口——这是角色分离的一部分：proposer 能改 challenger 的策略，就等于 challenger 不再独立。",
              "Policy content lives in the challenger's own file, challenger-policy-<id>.json, held by an independent process. This process is the proposer and has no write path to it — that is the point of role separation."
            )}
          </p>
          <p>
            {L(
              "真实的变更流程是三步：① 改 challenger-policy-<id>.json；② 本页会立即显示 inSync=false（两侧哈希因此不同）；③ 点上面的「重新认证」把新哈希推上链，或在 challenger 机器上跑 challenger/policy-attest.mjs --execute。",
              "Real change flow: (1) edit challenger-policy-<id>.json; (2) this page immediately shows inSync=false; (3) press Re-attest above, or run challenger/policy-attest.mjs --execute on the challenger host."
            )}
          </p>
          <p className="text-muted">
            {L(
              "另：非对称升级（收紧即时 / 放宽需时间锁）是设计意图，链上目前没有时间锁合约，故本页不把它画成已生效的能力。",
              "Note: the asymmetric upgrade (instant tighten / timelocked loosen) is design intent; no timelock contract exists on-chain, so it is not shown as a live capability."
            )}
          </p>
        </div>
      </div>
    </div>
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
