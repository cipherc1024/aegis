"use client";

import { useL } from "@/lib/i18n";
import { useAgentStatus } from "@/lib/useAgentStatus";
import { useVault } from "@/lib/useVault";
import { ConfirmTx, fmtMon } from "@/components/ConfirmTx";
import { Cpu, Snowflake, Play, ShieldCheck } from "lucide-react";

const PIPELINE = [
  { zh: "可信指令", en: "Trusted command", d: "user → privileged planner" },
  { zh: "隔离 LLM 摘要", en: "Isolated LLM summary", d: "untrusted content, no tools" },
  { zh: "特权 LLM 意图", en: "Privileged LLM intent", d: "typed intent (no raw untrusted)" },
  { zh: "护栏检查", en: "Guardrail check", d: "normalize / blocklist / injection" },
  { zh: "PACE 策略验证", en: "PACE policy verify", d: "deterministic → PDR" },
  { zh: "TEE 生成 quote", en: "TEE quote", d: "get_quote(semanticDigest‖nonce)" },
  { zh: "收据上链", en: "Receipt on-chain", d: "submitReceiptWithQuote" },
];

export default function ConsolePage() {
  const L = useL();
  const s = useAgentStatus(1n);
  const { vault, fetched, refresh } = useVault();

  const online = !!s?.online;
  const frozen = vault?.frozen ?? null;

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
      {/* pipeline */}
      <div className="card p-5">
        <div className="mb-4 flex items-center gap-2 text-sm font-medium">
          <Cpu className="h-4 w-4 text-cyan" />
          {L("TEE 内部决策流水线", "TEE decision pipeline")}
        </div>
        <div className="space-y-1">
          {PIPELINE.map((step, i) => (
            <div key={step.en} className="flex gap-3">
              <div className="flex flex-col items-center">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-cyan/15 text-[11px] text-cyan">
                  {i + 1}
                </div>
                {i < PIPELINE.length - 1 && <div className="my-1 h-6 w-px bg-border-base" />}
              </div>
              <div className="pb-1">
                <div className="text-sm">{L(step.zh, step.en)}</div>
                <div className="mono text-[11px] text-muted">{step.d}</div>
              </div>
            </div>
          ))}
        </div>
        <p className="mt-4 text-[11px] leading-relaxed text-muted">
          {L(
            "流水线是设计结构，不是实时进度条 —— 每一步的产物（语义摘要、PDR、收据）可在「收据流」与「验证器」页按真实哈希核对。",
            "The pipeline shows design structure, not live progress. Each step's artifact (semantic digest, PDR, receipt) can be checked by real hash on Receipts and Verifier."
          )}
        </p>
      </div>

      {/* right */}
      <div className="space-y-4">
        <div className="card p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <ShieldCheck className="h-4 w-4 text-cyan" />
            {L("运行时控制", "Runtime control")}
          </div>
          <div className="space-y-2 text-xs">
            <Row
              k={L("状态", "Status")}
              v={!online ? L("离线", "offline") : frozen === null ? L("读取中", "loading") : frozen ? L("已冻结", "Frozen") : L("正常", "Healthy")}
              tone={!online || frozen ? "text-red" : frozen === null ? "text-muted" : "text-green"}
            />
            <Row
              k={L("链头 / 最后收据", "Head / last receipt")}
              v={online ? `${s.currentBlock} / ${s.lastReceiptBlock}` : "—"}
              tone="text-secondary"
            />
            <Row
              k={L("收据新鲜", "Receipt fresh")}
              v={online ? (s.fresh ? "true" : "false") : "—"}
              tone={s?.fresh ? "text-green" : "text-amber"}
            />
            <Row
              k={L("金库余额", "Vault balance")}
              v={vault ? `${fmtMon(vault.balanceMon)} MON` : fetched ? "—" : L("读取中", "loading")}
              tone="text-secondary"
            />
            <Row
              k={L("验证者白名单", "Trusted validators")}
              v={vault ? String(vault.trustedValidatorCount) : "—"}
              tone={vault && vault.trustedValidatorCount > 0 ? "text-green" : "text-amber"}
            />
            <Row
              k={L("tradingFrozen", "tradingFrozen")}
              v={frozen === null ? "—" : String(frozen)}
              tone={frozen ? "text-red" : "text-secondary"}
            />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-2">
            <ConfirmTx
              op="pause"
              params={{}}
              label={L("紧急冻结", "Freeze")}
              tone="red"
              disabled={!vault?.configured || frozen === true}
              onDone={() => void refresh()}
            >
              <span className="flex items-center justify-center gap-1.5 text-xs font-medium">
                <Snowflake className="h-3.5 w-3.5" />
                {L("紧急冻结", "Freeze")}
              </span>
            </ConfirmTx>
            <ConfirmTx
              op="resume"
              params={{}}
              label={L("解冻", "Resume")}
              tone="cyan"
              disabled={!vault?.configured || frozen === false}
              onDone={() => void refresh()}
            >
              <span className="flex items-center justify-center gap-1.5 text-xs font-medium">
                <Play className="h-3.5 w-3.5" />
                {L("解冻", "Resume")}
              </span>
            </ConfirmTx>
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            {L(
              "两个按钮都会真实发交易（emergencyPause / resumeTrading，onlyOwner）。冻结只停 executeTrade，owner 的 withdraw 永不冻结。",
              "Both buttons send real transactions (emergencyPause / resumeTrading, onlyOwner). Freezing only halts executeTrade; the owner's withdraw is never frozen."
            )}
          </p>
        </div>

        <div className="card p-5">
          <div className="mb-3 text-sm font-medium">{L("当前策略与实际限额", "Current policy and limits")}</div>
          <div className="space-y-2 text-xs">
            <Row k={L("单笔上限", "Per-tx limit")} v={vault ? `${fmtMon(vault.perTxLimit)} MON` : "—"} tone="text-secondary" />
            <Row k={L("日限", "Daily limit")} v={vault ? `${fmtMon(vault.dailyLimit)} MON` : "—"} tone="text-secondary" />
            <Row
              k={L("今日已用", "Spent today")}
              v={vault ? `${fmtMon(vault.dailySpentToday)} MON` : "—"}
              tone="text-secondary"
            />
            <Row k={L("窗口日", "Window day")} v={vault ? String(vault.dailyWindowDay) : "—"} tone="text-secondary" />
            <Row k={L("金库地址", "Vault")} v={vault ? `${vault.address.slice(0, 10)}…` : "—"} tone="text-muted" />
          </div>
          <p className="mt-3 text-[11px] leading-relaxed text-muted">
            {L(
              "改动限额与白名单在「策略」页；本页只做冻结/解冻这类应急动作。",
              "Change limits and the whitelist on the Policy page; this page only performs emergency actions such as freeze/resume."
            )}
          </p>
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
