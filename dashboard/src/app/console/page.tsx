"use client";

import { useState } from "react";
import { useL } from "@/lib/i18n";
import { Cpu, Snowflake, Play, Lock, Check } from "lucide-react";

const PIPELINE = [
  { zh: "可信指令", en: "Trusted command", d: "user → privileged planner" },
  { zh: "隔离 LLM 摘要", en: "Isolated LLM summary", d: "untrusted content, no tools" },
  { zh: "特权 LLM 意图", en: "Privileged LLM intent", d: "typed intent (no raw untrusted)" },
  { zh: "护栏检查", en: "Guardrail check", d: "normalize / blocklist / injection" },
  { zh: "PACE 策略验证", en: "PACE policy verify", d: "deterministic → PDR" },
  { zh: "TEE 生成 quote", en: "TEE quote", d: "get_quote(semanticDigest‖nonce)" },
  { zh: "收据上链", en: "Receipt on-chain", d: "submitReceiptWithQuote" },
];

const METRICS = [
  ["MRTD", "a7f2c8d9e1b4…"],
  ["RTMR0", "7bf063280e94…"],
  ["FMSPC", "20A06F"],
  ["TCB Level", "UpToDate"],
];

export default function ConsolePage() {
  const L = useL();
  const [frozen, setFrozen] = useState(false);

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
      {/* pipeline */}
      <div className="card p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium">
          <Cpu className="h-4 w-4 text-cyan" />
          {L("TEE 内部决策流水线", "TEE decision pipeline")}
        </div>
        <div className="space-y-1">
          {PIPELINE.map((s, i) => (
            <div key={s.en} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan/15 text-[11px] text-cyan">
                  {i < 5 ? <Check className="h-3 w-3" /> : i + 1}
                </div>
                {i < PIPELINE.length - 1 && <div className="my-1 h-6 w-px bg-border-base" />}
              </div>
              <div className="pb-1">
                <div className="text-sm">{L(s.zh, s.en)}</div>
                <div className="mono text-[11px] text-muted">{s.d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* right */}
      <div className="space-y-4">
        <div className="card p-5">
          <div className="mb-3 text-sm font-medium">{L("运行时控制", "Runtime control")}</div>
          <div className="space-y-2 text-xs">
            <Row k={L("状态", "Status")} v={frozen ? L("已冻结", "Frozen") : L("正常", "Healthy")} tone={frozen ? "text-red" : "text-green"} />
            <Row k={L("心跳", "Heartbeat")} v={L("3 秒前", "3s ago")} />
            <Row k={L("冻结", "Frozen")} v={frozen ? "true" : "false"} tone={frozen ? "text-red" : "text-secondary"} />
          </div>
          <div className="mt-4 grid grid-cols-2 gap-2">
            <button
              onClick={() => setFrozen(true)}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-red/40 bg-red/5 py-2 text-xs font-medium text-red hover:bg-red/10"
            >
              <Snowflake className="h-3.5 w-3.5" />
              {L("紧急冻结", "Freeze")}
            </button>
            <button
              onClick={() => setFrozen(false)}
              className="flex items-center justify-center gap-1.5 rounded-lg border border-green/40 bg-green/5 py-2 text-xs font-medium text-green hover:bg-green/10"
            >
              <Play className="h-3.5 w-3.5" />
              {L("解冻", "Resume")}
            </button>
          </div>
        </div>

        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Lock className="h-4 w-4 text-cyan" />
            {L("TEE 度量", "TEE measurements")}
          </div>
          <div className="space-y-2 text-xs">
            {METRICS.map(([k, v]) => (
              <Row key={k} k={k} v={v} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, v, tone = "text-secondary" }: { k: string; v: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-1.5 last:border-0">
      <span className="text-tertiary">{k}</span>
      <span className={`mono ${tone}`}>{v}</span>
    </div>
  );
}
