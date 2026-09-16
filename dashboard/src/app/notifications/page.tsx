"use client";

import { useL } from "@/lib/i18n";
import { SampleBanner } from "@/components/SampleBanner";
import { Snowflake, AlertTriangle, Ban, CheckCircle2 } from "lucide-react";

const NOTIFS = [
  { type: "freeze", zh: "Agent 已冻结", en: "Agent frozen", descZh: "TEE 失联超过 18 秒，交易已自动冻结", descEn: "TEE offline >18s; trading auto-frozen", time: "2 分钟前" },
  { type: "warn", zh: "收据即将过期", en: "Receipts going stale", descZh: "最近收据距今 6 个块", descEn: "Latest receipt is 6 blocks old", time: "8 分钟前" },
  { type: "block", zh: "拦截一笔交易", en: "Trade blocked", descZh: "$SCAM 不在白名单", descEn: "$SCAM not in whitelist", time: "1 小时前" },
  { type: "ok", zh: "提现完成", en: "Withdrawal complete", descZh: "0.5 MON 已到账", descEn: "0.5 MON settled", time: "昨天" },
];

const META = {
  freeze: { icon: Snowflake, tone: "text-red", bg: "bg-red/10" },
  warn: { icon: AlertTriangle, tone: "text-amber", bg: "bg-amber/10" },
  block: { icon: Ban, tone: "text-red", bg: "bg-red/10" },
  ok: { icon: CheckCircle2, tone: "text-green", bg: "bg-green/10" },
} as const;

export default function NotificationsPage() {
  const L = useL();
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-5 text-lg font-semibold">{L("通知中心", "Notifications")}</h1>
      <SampleBanner
        note={L(
          "本页为界面占位：下方通知是写死的示例条目，非真实事件流（其中「提现完成 / 0.5 MON 已到账」等资金事件均未发生）。",
          "Placeholder UI: the notifications below are hard-coded samples, not a real event stream (the funding events such as \"Withdrawal complete / 0.5 MON settled\" never happened)."
        )}
      />
      <div className="space-y-2">
        {NOTIFS.map((n, i) => {
          const m = META[n.type as keyof typeof META];
          const Icon = m.icon;
          return (
            <div key={i} className="card card-hover flex items-start gap-3 p-4">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${m.bg}`}>
                <Icon className={`h-4 w-4 ${m.tone}`} />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{L(n.zh, n.en)}</span>
                  <span className="text-[11px] text-muted">{n.time}</span>
                </div>
                <div className="text-xs text-secondary">{L(n.descZh, n.descEn)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
