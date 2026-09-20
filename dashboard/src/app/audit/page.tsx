"use client";

import { useMemo, useState } from "react";
import { useL } from "@/lib/i18n";
import { useReceipts } from "@/lib/useReceipts";
import type { Receipt } from "@/lib/mock";
import { ClipboardList, FileText, FileJson, Copy, Check } from "lucide-react";

/**
 * 审计导出：数据来自 useReceipts（两条真实来源：浏览器直读 ReceiptSubmitted
 * 富事件 + orchestrator 索引器），在浏览器内生成文件，不经任何服务端。
 * 导出内容即页面所见 —— 没有值的字段写 "—"（索引器来源的粗粒度视图），
 * 不填充、不猜测。
 */
export default function AuditPage() {
  const L = useL();
  const { receipts, live, loading } = useReceipts(1);
  const [copied, setCopied] = useState(false);

  const stats = useMemo(() => {
    const trades = receipts.filter((r) => !r.isHeartbeat).length;
    const heartbeats = receipts.length - trades;
    const blocks = receipts.map((r) => r.blockHeight).filter((b) => b > 0);
    return {
      total: receipts.length,
      trades,
      heartbeats,
      from: blocks.length ? Math.min(...blocks) : 0,
      to: blocks.length ? Math.max(...blocks) : 0,
    };
  }, [receipts]);

  const json = useMemo(() => JSON.stringify(receipts, null, 2), [receipts]);
  const csv = useMemo(() => toCsv(receipts), [receipts]);

  function download(name: string, mime: string, text: string) {
    const blob = new Blob([text], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(json);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* 剪贴板不可用时静默：用户仍可下载 */
    }
  }

  const ready = !loading && receipts.length > 0;

  const options = [
    {
      icon: FileText,
      zh: "导出 CSV",
      en: "Export CSV",
      descZh: `全部收据字段，${stats.total} 行`,
      descEn: `All receipt fields, ${stats.total} rows`,
      run: () => download("aegis-receipts.csv", "text/csv", csv),
    },
    {
      icon: FileJson,
      zh: "导出 JSON",
      en: "Export JSON",
      descZh: "完整对象数组，含区块与交易哈希",
      descEn: "Full object array with block and tx hashes",
      run: () => download("aegis-receipts.json", "application/json", json),
    },
    {
      icon: copied ? Check : Copy,
      zh: copied ? "已复制" : "复制 JSON",
      en: copied ? "Copied" : "Copy JSON",
      descZh: "复制到剪贴板，便于贴进报告",
      descEn: "Copy to clipboard for pasting into reports",
      run: copyJson,
    },
  ];

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-cyan" />
        <h1 className="text-lg font-semibold">{L("审计日志", "Audit Log")}</h1>
        <span className={`ml-auto text-[11px] ${live ? "text-green" : "text-amber"}`}>
          {live ? L("链上", "on-chain") : loading ? L("读取中", "loading") : L("离线", "offline")}
        </span>
      </div>

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat
          k={L("可导出记录", "Exportable records")}
          v={loading ? "—" : String(stats.total)}
          sub={ready ? L(`交易 ${stats.trades} · 心跳 ${stats.heartbeats}`, `${stats.trades} trades · ${stats.heartbeats} heartbeats`) : undefined}
        />
        <Stat
          k={L("区块范围", "Block range")}
          v={stats.total ? `${stats.from} – ${stats.to}` : "—"}
        />
        <Stat k={L("格式", "Formats")} v="CSV / JSON" />
      </div>

      <div className="space-y-2">
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <button
              key={o.en}
              disabled={!ready}
              onClick={o.run}
              title={ready ? undefined : L("暂无收据可导出", "No receipts to export")}
              className={`card flex w-full items-center gap-3 p-4 text-left transition ${
                ready ? "hover:border-border-hover" : "cursor-not-allowed opacity-50"
              }`}
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-input">
                <Icon className="h-4 w-4 text-cyan" />
              </div>
              <div className="min-w-0">
                <div className="text-sm">{L(o.zh, o.en)}</div>
                <div className="text-xs text-secondary">{ready ? L(o.descZh, o.descEn) : L("暂无数据", "no data")}</div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-[11px] leading-relaxed text-muted">
        {L(
          "导出在浏览器内完成，不经服务端。字段真值两档：浏览器直读 ReceiptSubmitted 富事件（含 executionHash/nonce/guardrailHash，仅最近约 4000 块）；orchestrator 索引器（深历史，仅 4 字段，其余显示为「—」）。",
          "Export happens in the browser, not on any server. Fields come from two real sources: direct reads of the ReceiptSubmitted rich event (executionHash/nonce/guardrailHash, last ~4000 blocks), and the orchestrator indexer (deep history, 4 fields only, the rest shown as \"—\")."
        )}
      </p>
    </div>
  );
}

function Stat({ k, v, sub }: { k: string; v: string; sub?: string }) {
  return (
    <div className="card p-4">
      <div className="text-xs text-tertiary">{k}</div>
      <div className="mono mt-2 text-sm text-primary">{v}</div>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

const CSV_COLS: (keyof Receipt)[] = [
  "id",
  "type",
  "blockHeight",
  "blockHash",
  "receiptHash",
  "executionHash",
  "nonce",
  "guardrailHash",
  "prevReceiptHash",
  "txHash",
];

function toCsv(rows: Receipt[]): string {
  const esc = (x: unknown) => {
    const s = x === null || x === undefined ? "" : String(x);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const head = CSV_COLS.join(",");
  const body = rows.map((r) => CSV_COLS.map((c) => esc(r[c])).join(",")).join("\n");
  return `${head}\n${body}\n`;
}
