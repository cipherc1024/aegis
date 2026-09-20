"use client";

import { useCallback, useEffect, useState } from "react";
import { useL } from "@/lib/i18n";
import { api, type IdentityState } from "@/lib/aegis";
import { ConfirmTx } from "@/components/ConfirmTx";
import { Sparkles, RefreshCw, Loader2, Check, AlertTriangle } from "lucide-react";

/**
 * 创建 Agent = 往 ERC-8004 IdentityRegistry 写一条身份。
 *
 * 本页只做"注册"这一件事。注册**不产生**金库、不产生 TEE 测量、不产生挑战者策略
 * ——合约里 AegisVaultQuorum.agentId 是 immutable，一个金库只服务一个 agent。
 * 所以注册成功后页面把剩下三件事显式列成待办，而不是画一条假的四步进度条。
 */
export default function CreateAgentPage() {
  const L = useL();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [ident, setIdent] = useState<IdentityState | null>(null);
  const [loading, setLoading] = useState(true);
  const [lastNewId, setLastNewId] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    const s = await api.agents();
    setIdent(s);
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const trimmed = name.trim();
  const online = ident !== null;

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-5 flex items-center gap-2">
        <Sparkles className="h-5 w-5 text-cyan" />
        <h1 className="text-lg font-semibold">{L("创建 Agent", "Create Agent")}</h1>
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
          {L(
            "orchestrator 不可达，读不到身份注册表，也无法发起注册。",
            "orchestrator unreachable — cannot read the identity registry nor register."
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.4fr_1fr]">
        {/* 注册表单 */}
        <div className="card space-y-4 p-5">
          <Field label={L("名称", "Name")}>
            <input
              className="inp"
              placeholder="Aegis Beta"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={64}
            />
          </Field>
          <Field label={L("描述（可选，写入 tokenURI 的 data: JSON）", "Description (optional, in tokenURI data: JSON)")}>
            <textarea
              className="inp min-h-[72px]"
              placeholder={L("策略简介…", "Strategy summary…")}
              value={desc}
              onChange={(e) => setDesc(e.target.value)}
              maxLength={280}
            />
          </Field>

          <div className="rounded-md border border-border-subtle bg-input p-3 text-[11px] leading-relaxed text-tertiary">
            {L(
              "注册只写 ERC-8004 IdentityRegistry（permissionless，任何人可注册，仅产生身份）。以下三项注册不会产生，需另行完成：",
              "Registration only writes the ERC-8004 IdentityRegistry (permissionless, identity only). These three are NOT created by registering:"
            )}
            <ul className="mt-2 list-disc space-y-1 pl-4">
              <li>{L("金库 —— 需独立部署 AegisVaultQuorum（合约 agentId 是 immutable）", "Vault — deploy a separate AegisVaultQuorum (agentId is immutable)")}</li>
              <li>{L("TEE 测量 —— 当前单 CVM 架构，第二台 TEE 未接", "TEE measurement — single-CVM today; a second TEE is not wired")}</li>
              <li>{L("挑战者策略 —— 缺 challenger-policy-<id>.json 则 challenger 跳过该 agent，不签发 validation", "Challenger policy — without challenger-policy-<id>.json the challenger skips this agent and signs nothing")}</li>
            </ul>
          </div>

          <ConfirmTx
            op="register-agent"
            params={{ name: trimmed, description: desc }}
            register
            label={L(`注册 Agent「${trimmed || "…"}」`, `Register agent "${trimmed || "…"}"`)}
            disabled={!online || trimmed.length === 0}
            onDone={(r) => {
              setLastNewId(r.newAgentId ?? null);
              setName("");
              setDesc("");
              void refresh();
            }}
          >
            <span className="flex items-center justify-center gap-1.5 text-sm font-medium">
              {L("注册 Agent（真实上链）", "Register agent (real on-chain tx)")}
            </span>
          </ConfirmTx>

          {lastNewId !== null && (
            <div className="rounded-md border border-green/40 bg-green/5 p-3 text-xs text-green">
              <div className="flex items-center gap-2">
                <Check className="h-3.5 w-3.5" />
                {L(`agentId ${lastNewId} 已注册`, `agentId ${lastNewId} registered`)}
              </div>
              <div className="mt-2 text-[11px] leading-relaxed text-amber">
                {L("该 agent 现在只有身份。要让它真正能交易，还需要：", "It has an identity only. To actually trade it still needs:")}
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  <li>部署 AegisVaultQuorum(agentId={lastNewId}) → 地址写入 .env 的 QUORUM_VAULT_{lastNewId}</li>
                  <li>challenger/challenger-policy-{lastNewId}.json</li>
                  <li>以 agentId={lastNewId} 跑 policy-attest.mjs --execute</li>
                </ul>
              </div>
            </div>
          )}

          <div className="text-[11px] leading-relaxed text-muted">
            {L(
              "本页不提供「策略类型 / 初始资金 / 派生地址 / 度量白名单」输入框——这些在注册这一步没有任何链上落点，填了也只是本地字符串。",
              "No strategy-type / capital / derived-address / measurement fields here — none of them have an on-chain landing point at registration; they would be local strings only."
            )}
          </div>
        </div>

        {/* 注册表真实读数 */}
        <div className="card p-5">
          <div className="mb-1 text-sm font-medium">{L("已注册 Agent（链上真实读数）", "Registered agents (live chain reads)")}</div>
          <div className="mb-4 text-[11px] text-muted">
            {L("ERC-8004 IdentityRegistry.lastId()", "ERC-8004 IdentityRegistry.lastId()")}
            {": "}
            <span className="mono text-secondary">{loading ? "…" : ident ? ident.lastId : "—"}</span>
          </div>
          {loading && (
            <div className="flex items-center gap-2 text-xs text-tertiary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {L("读取中…", "loading…")}
            </div>
          )}
          {!loading && !ident && <div className="text-xs text-muted">{L("不可达", "unreachable")}</div>}
          {ident && ident.agents.length === 0 && (
            <div className="text-xs text-muted">{L("注册表为空", "registry is empty")}</div>
          )}
          <div className="space-y-2.5">
            {ident?.agents.map((a) => {
              const uri = a.tokenURI ?? "";
              const isData = uri.startsWith("data:application/json;base64,");
              let label = L("（非 data: URI）", "(non-data: URI)");
              if (isData) {
                try {
                  // atob 给的是 latin-1 字节串；tokenURI 里可能有非 ASCII（U+2014 等），
                  // 不按 UTF-8 解码会渲染成乱码。
                  const bin = atob(uri.slice("data:application/json;base64,".length));
                  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
                  const j = JSON.parse(new TextDecoder("utf-8").decode(bytes));
                  label = String(j.name || "（无名）");
                } catch {
                  label = L("（tokenURI 解码失败）", "(tokenURI decode failed)");
                }
              }
              return (
                <div key={a.agentId} className="rounded-md border border-border-subtle bg-input p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">
                      agentId {a.agentId} · {label}
                    </span>
                    {a.owner === null && <span className="text-[10px] text-red">{L("不可读", "unreadable")}</span>}
                  </div>
                  <div className="mono mt-1 break-all text-[10px] text-muted">owner {a.owner ?? "—"}</div>
                  <div className="mono break-all text-[10px] text-muted">wallet {a.agentWallet ?? "—"}</div>
                </div>
              );
            })}
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
