"use client";

import { useL } from "@/lib/i18n";
import { SampleBanner } from "@/components/SampleBanner";
import { ClipboardList, FileText, FileJson, BadgeCheck } from "lucide-react";

export default function AuditPage() {
  const L = useL();
  const stats = [
    { k: L("可导出记录", "Exportable records"), v: "—" },
    { k: L("时间范围", "Time range"), v: "—" },
    { k: L("格式", "Formats"), v: "CSV / JSON" },
  ];
  const options = [
    { icon: FileText, zh: "导出 CSV", en: "Export CSV", descZh: "全部收据字段，便于表格分析", descEn: "All receipt fields for spreadsheets" },
    { icon: FileJson, zh: "导出 JSON", en: "Export JSON", descZh: "含 quote 原始字节，可离线复验", descEn: "Includes raw quote bytes, offline-verifiable" },
    { icon: BadgeCheck, zh: "生成验证凭证", en: "Generate attestation", descZh: "链上验证凭证，供合规/机构使用", descEn: "On-chain verification proof for compliance" },
  ];
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center gap-2">
        <ClipboardList className="h-5 w-5 text-cyan" />
        <h1 className="text-lg font-semibold">{L("审计日志", "Audit Log")}</h1>
      </div>

      <SampleBanner
        note={L(
          "本页为界面占位：导出按钮尚未接线，记录数与时间范围无真实数据源。真实收据数据见「收据流」（含 explorer 链接）与 orchestrator 的 /api/receipts。",
          "Placeholder UI: the export buttons are not wired up, and neither the record count nor the time range has a real data source. For real receipts see Receipts (with explorer links) and the orchestrator's /api/receipts."
        )}
      />

      <div className="mb-4 grid grid-cols-1 gap-4 sm:grid-cols-3">
        {stats.map((s) => (
          <div key={s.k} className="card p-4">
            <div className="text-xs text-tertiary">{s.k}</div>
            <div className="mono mt-2 text-sm text-muted">{s.v}</div>
          </div>
        ))}
      </div>

      <div className="space-y-2">
        {options.map((o) => {
          const Icon = o.icon;
          return (
            <button
              key={o.en}
              disabled
              title={L("尚未实现", "Not implemented yet")}
              className="card flex w-full cursor-not-allowed items-center gap-3 p-4 text-left opacity-60"
            >
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-input">
                <Icon className="h-4 w-4 text-cyan" />
              </div>
              <div className="min-w-0">
                <div className="text-sm">{L(o.zh, o.en)}</div>
                <div className="text-xs text-secondary">{L(o.descZh, o.descEn)}</div>
              </div>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-center text-[11px] text-muted">
        {L(
          "设计意图：导出记录将携带收据摘要与哈希链前驱，可被第三方独立复核；当前尚未实现。",
          "Design intent: exports would carry the receipt digest and hash-chain predecessor for independent verification; not implemented yet."
        )}
      </p>
    </div>
  );
}
