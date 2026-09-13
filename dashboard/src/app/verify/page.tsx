"use client";

import { useState } from "react";
import { useL } from "@/lib/i18n";
import { verifyLatest, type VerifyCheck } from "@/lib/chain";
import { ShieldCheck, Loader2, CheckCircle2, XCircle, Clock, ScanSearch } from "lucide-react";

export default function VerifyPage() {
  const L = useL();
  const [query, setQuery] = useState("1");
  const [running, setRunning] = useState(false);
  const [checks, setChecks] = useState<VerifyCheck[] | null>(null);

  const start = async () => {
    setRunning(true);
    setChecks(null);
    const agentId = BigInt(query.replace(/[^0-9]/g, "") || "1");
    const result = await verifyLatest(agentId);
    setChecks(result);
    setRunning(false);
  };

  const passed = checks?.filter((c) => c.state === "pass").length ?? 0;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="py-10 text-center">
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-border-base bg-card px-3 py-1 text-xs text-secondary">
          <ScanSearch className="h-3.5 w-3.5 text-cyan" />
          {L("不依赖我们的前端 / 服务器 / TEE", "No trust in our frontend / server / TEE")}
        </div>
        <h1 className="text-3xl font-semibold tracking-tight">{L("不要信任我们。自己验证。", "Don't trust us. Verify.")}</h1>
        <p className="mt-3 text-sm text-secondary">
          {L("输入 Agent ID，浏览器将用公共 RPC 独立完成链上验证。", "Enter an Agent ID; your browser performs on-chain checks via public RPC.")}
        </p>
      </div>

      <div className="mb-6 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="mono flex-1 rounded-lg border border-border-base bg-input px-3 py-2.5 text-sm outline-none focus:border-cyan/40"
          placeholder="agentId (如 1)"
        />
        <button
          onClick={start}
          disabled={running}
          className="flex items-center gap-2 rounded-lg bg-cyan px-5 py-2.5 text-sm font-medium text-base hover:opacity-90 disabled:opacity-50"
        >
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}
          {L("开始验证", "Verify")}
        </button>
      </div>

      {checks && (
        <div className="card p-5">
          <div className="mb-4 flex items-center justify-between">
            <div className="text-sm">
              {L("验证结果", "Result")} · <span className="mono text-muted">agent #{query}</span>
            </div>
            <span className="rounded-md bg-cyan/10 px-2 py-1 text-xs text-cyan">
              {passed}/{checks.length} {L("通过", "passed")}
            </span>
          </div>

          <div className="space-y-1">
            {checks.map((c) => {
              const Icon = c.state === "pass" ? CheckCircle2 : c.state === "fail" ? XCircle : Clock;
              const tone = c.state === "pass" ? "text-green" : c.state === "fail" ? "text-red" : "text-amber";
              return (
                <div key={c.key} className="flex items-start gap-3 py-2">
                  <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} />
                  <div className="min-w-0">
                    <div className="text-sm">{L(c.labelZh, c.labelEn)}</div>
                    <div className="mono text-[11px] text-muted">{c.detail}</div>
                  </div>
                  <span className={`mono ml-auto text-xs ${tone}`}>
                    {c.state === "pass" ? "OK" : c.state === "fail" ? "FAIL" : "N/A"}
                  </span>
                </div>
              );
            })}
          </div>

          <div className="mt-5 rounded-lg bg-input px-3 py-2 text-center text-[11px] text-muted">
            {L(
              "全部验证在你的浏览器本地完成 · 数据源：Monad RPC · 无需信任 Aegis 的任何服务器",
              "All checks run locally in your browser · source: Monad RPC · zero trust in any Aegis server"
            )}
          </div>
        </div>
      )}
    </div>
  );
}
