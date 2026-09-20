"use client";

import { useL } from "@/lib/i18n";
import { useAgentStatus } from "@/lib/useAgentStatus";
import { useReceipts } from "@/lib/useReceipts";
import { useVault } from "@/lib/useVault";
import { Snowflake, AlertTriangle, Activity, CheckCircle2, Lock, Info } from "lucide-react";

/**
 * 通知由真实读数派生，不是事件流存储 —— 这里只陈述"当前链上状态意味着什么"，
 * 每条都带据以判断的数值。没有读数就没有通知（显示离线），不编造历史事件。
 */

type Kind = "freeze" | "warn" | "info" | "ok";

const META = {
  freeze: { icon: Snowflake, tone: "text-red", bg: "bg-red/10" },
  warn: { icon: AlertTriangle, tone: "text-amber", bg: "bg-amber/10" },
  info: { icon: Activity, tone: "text-cyan", bg: "bg-cyan/10" },
  ok: { icon: CheckCircle2, tone: "text-green", bg: "bg-green/10" },
} as const;

export default function NotificationsPage() {
  const L = useL();
  const s = useAgentStatus(1n);
  const { receipts, live, loading } = useReceipts(1);
  const { vault, fetched: vaultFetched } = useVault();

  const online = !!s?.online;
  const items: { kind: Kind; zh: string; en: string; descZh: string; descEn: string }[] = [];

  if (!online) {
    items.push({
      kind: "warn",
      zh: "orchestrator 不可达",
      en: "Orchestrator unreachable",
      descZh: "当前无法读取链上状态；本页不显示任何占位通知。",
      descEn: "Cannot read chain state; no placeholder notifications are shown.",
    });
  } else {
    if (!s.alive) {
      items.push({
        kind: "freeze",
        zh: "交易已冻结",
        en: "Trading frozen",
        descZh: `链上 tradingFrozen 为真（最后收据在第 ${s.lastReceiptBlock} 块）。`,
        descEn: `On-chain tradingFrozen is true (last receipt at block ${s.lastReceiptBlock}).`,
      });
    }
    if (!s.fresh) {
      items.push({
        kind: "warn",
        zh: "收据不新鲜",
        en: "Receipt stale",
        descZh: `最新收据在第 ${s.lastReceiptBlock} 块，链头为 ${s.currentBlock}，间隔 ${s.currentBlock - s.lastReceiptBlock} 块。`,
        descEn: `Latest receipt at block ${s.lastReceiptBlock}, chain head ${s.currentBlock}, gap ${s.currentBlock - s.lastReceiptBlock} blocks.`,
      });
    } else {
      items.push({
        kind: "ok",
        zh: "收据新鲜",
        en: "Receipt fresh",
        descZh: `最新收据第 ${s.lastReceiptBlock} 块，链头 ${s.currentBlock}。`,
        descEn: `Latest receipt at block ${s.lastReceiptBlock}, chain head ${s.currentBlock}.`,
      });
    }
  }

  if (vaultFetched && vault) {
    items.push({
      kind: vault.frozen ? "freeze" : "ok",
      zh: vault.frozen ? "金库交易冻结" : "金库交易开放",
      en: vault.frozen ? "Vault trading frozen" : "Vault trading open",
      descZh: `vault ${vault.address.slice(0, 10)}… · agentId ${vault.agentId} · 验证者白名单 ${vault.trustedValidatorCount} 个。`,
      descEn: `vault ${vault.address.slice(0, 10)}… · agentId ${vault.agentId} · ${vault.trustedValidatorCount} trusted validator(s).`,
    });
    const spent = Number(vault.dailySpentToday);
    const limit = Number(vault.dailyLimit);
    if (limit > 0 && spent / limit >= 0.8) {
      items.push({
        kind: "warn",
        zh: "接近 PACE 日限",
        en: "Approaching PACE daily limit",
        descZh: `今日已用 ${spent / 1e18} / ${limit / 1e18} MON（窗口日 ${vault.dailyWindowDay}）。`,
        descEn: `${spent / 1e18} of ${limit / 1e18} MON used today (window day ${vault.dailyWindowDay}).`,
      });
    }
  }

  if (live && receipts.length) {
    const trades = receipts.filter((r) => !r.isHeartbeat);
    const last = receipts[0];
    items.push({
      kind: "info",
      zh: `收据流：${receipts.length} 条`,
      en: `Receipt stream: ${receipts.length}`,
      descZh: `其中交易 ${trades.length} · 心跳 ${receipts.length - trades.length}；最新一条在第 ${last?.blockHeight} 块${last?.isHeartbeat ? "（心跳）" : "（交易）"}。`,
      descEn: `${trades.length} trades · ${receipts.length - trades.length} heartbeats; latest at block ${last?.blockHeight}${last?.isHeartbeat ? " (heartbeat)" : " (trade)"}.`,
    });
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-5 flex items-center gap-2">
        <h1 className="text-lg font-semibold">{L("通知中心", "Notifications")}</h1>
        <span className={`ml-auto text-[11px] ${online ? "text-green" : "text-amber"}`}>
          {online ? L("链上", "on-chain") : loading ? L("读取中", "loading") : L("离线", "offline")}
        </span>
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-lg border border-border-base bg-input px-3 py-2 text-[11px] text-tertiary">
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
        {L(
          "以下条目由当前链上读数实时推导（不保留历史），每条都标注了据以判断的数值。",
          "These entries are derived live from current on-chain readings (no history is stored); each states the values it is based on."
        )}
      </div>

      <div className="space-y-2">
        {items.map((n, i) => {
          const m = META[n.kind];
          const Icon = m.icon;
          return (
            <div key={i} className="card card-hover flex items-start gap-3 p-4">
              <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${m.bg}`}>
                <Icon className={`h-4 w-4 ${m.tone}`} />
              </div>
              <div className="min-w-0">
                <div className="text-sm">{L(n.zh, n.en)}</div>
                <div className="text-xs text-secondary">{L(n.descZh, n.descEn)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-center gap-2 rounded-lg bg-green/5 px-3 py-2 text-xs text-green">
        <Lock className="h-3.5 w-3.5" />
        {L("owner 提现通道（withdraw）永不冻结。", "The owner withdraw channel is never frozen.")}
      </div>
    </div>
  );
}
