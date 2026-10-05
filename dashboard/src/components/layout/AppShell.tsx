"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useVaultStatus } from "@/lib/useVaultStatus";
import { useL } from "@/lib/i18n";
import { NAV } from "@/lib/nav";
import { LayoutDashboard, ScrollText, Wallet, Menu, X } from "lucide-react";

// 底部 tab 只放高频页，其余全部页面在「更多」抽屉里按 NAV 的分组分好。
// 抽屉直接渲染 NAV —— 不另抄一份清单，否则以后加页会再次出现"新页在手机上点不到"。
// （Sidebar 在 md 以下整体隐藏，没有这个抽屉时手机上只能到达 TABS 的这几页。）
const TABS = [
  { href: "/dashboard", icon: LayoutDashboard, label: "运行看板", labelEn: "Dashboard" },
  { href: "/receipts", icon: ScrollText, label: "收据与审计", labelEn: "Receipts & audit" },
  { href: "/funds", icon: Wallet, label: "存取款", labelEn: "Deposit / Withdraw" },
];

// 2026-10-04 导航瘦身：19 项 → 14 项。退出导航的页面**没有删除**，改由这里的
// 「相关页面」条按上下文到达，同时保证深链与旧链接不会变成死路。
// 放在 AppShell 一处，避免每个页面各抄一份内链清单——那正是"新页在手机上点不到"的成因。
const RELATED: Record<string, { href: string; zh: string; en: string }[]> = {
  "/receipts": [
    { href: "/audit", zh: "审计日志（完整导出 CSV/JSON）", en: "Audit log (full CSV/JSON export)" },
    { href: "/backtest", zh: "执行统计（同一份收据流的另一种视图）", en: "Execution stats (same receipt stream, another view)" },
  ],
  "/vaults": [
    { href: "/subaccounts", zh: "账户与角色：三把钥的现状与边界论证", en: "Accounts & roles: current keys and the boundary argument" },
    { href: "/copy", zh: "为什么没有「策略跟投」", en: "Why there is no copy-trading" },
    { href: "/create", zh: "接入下一个 Agent（需人工三步）", en: "Onboard another agent (three manual steps)" },
    { href: "/market", zh: "Agent 市场（当前只有 agentId=1 可验证）", en: "Agent market (only agentId=1 is verifiable today)" },
  ],
  "/settings": [{ href: "/notifications", zh: "通知（由真实链上事件派生）", en: "Notifications (derived from real chain events)" }],
  "/architecture": [{ href: "/glossary", zh: "术语表：δ / PACE / L1–L5 / PDR…", en: "Glossary: δ / PACE / L1–L5 / PDR…" }],
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();
  const L = useL();

  // 链上状态：判据与文案都在 lib/agentStatus.ts（与 Topbar 共用一份，
  // 避免"同一个链上状态在两处显示不同结论"）。数据是浏览器内直读链上，
  // 不经 orchestrator —— proposer 服务挂了，状态灯也仍然说真话。
  const { status, currentBlock } = useVaultStatus(1n, 6000);

  return (
    <div className="bg-top-glow relative flex h-screen overflow-hidden">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} status={status} currentBlock={currentBlock} />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto px-4 py-5 pb-20 md:px-7 md:py-6 md:pb-6">
          {children}
          {RELATED[pathname] ? (
            <div className="mx-auto mt-6 max-w-5xl rounded-xl border border-border-subtle bg-card px-4 py-3">
              <div className="mb-2 text-[12px] font-medium text-tertiary">{L("相关页面", "Related pages")}</div>
              <div className="flex flex-wrap gap-2">
                {RELATED[pathname].map((x) => (
                  <Link
                    key={x.href}
                    href={x.href}
                    className="rounded-lg border border-border-base px-2.5 py-1.5 text-[12px] text-secondary hover:border-border-hover hover:text-primary"
                  >
                    {L(x.zh, x.en)} →
                  </Link>
                ))}
              </div>
            </div>
          ) : null}
        </main>
      </div>

      {/* 手机端「更多」抽屉：Sidebar 在 md 以下隐藏，全量页面靠这里到达。 */}
      {moreOpen && (
        <div className="fixed inset-0 z-30 md:hidden">
          <button
            aria-label="关闭菜单"
            onClick={() => setMoreOpen(false)}
            className="absolute inset-0 h-full w-full bg-black/60"
          />
          <div className="absolute bottom-0 left-0 right-0 max-h-[80vh] overflow-y-auto rounded-t-2xl border-t border-border-base bg-sidebar pb-20">
            <div className="sticky top-0 flex items-center justify-between border-b border-border-subtle bg-sidebar px-4 py-3">
              <span className="text-sm font-medium">{L("全部页面", "All pages")}</span>
              <button aria-label="关闭菜单" onClick={() => setMoreOpen(false)} className="text-tertiary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-3 py-2">
              {NAV.map((group) => (
                <div key={group.label} className="mb-3">
                  <div className="px-1 pb-1 text-[12px] font-medium uppercase tracking-wider text-muted">
                    {L(group.label, group.labelEn)}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = pathname === item.href;
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          onClick={() => setMoreOpen(false)}
                          className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-xs ${
                            active ? "bg-hover text-primary" : "text-secondary hover:bg-hover"
                          }`}
                        >
                          <Icon className={`h-4 w-4 shrink-0 ${active ? "text-cyan" : ""}`} />
                          <span className="truncate">{L(item.label, item.labelEn)}</span>
                        </Link>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <nav className="fixed bottom-0 left-0 right-0 z-20 flex border-t border-border-base bg-sidebar md:hidden">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = pathname === t.href;
          return (
            <Link
              key={t.href}
              href={t.href}
              aria-label={L(t.label, t.labelEn)}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-[12px] ${
                active ? "text-cyan" : "text-tertiary"
              }`}
            >
              <Icon className="h-4 w-4" />
              {L(t.label, t.labelEn)}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          aria-label="更多页面"
          aria-expanded={moreOpen}
          className={`flex flex-1 flex-col items-center gap-1 py-2 text-[12px] ${
            moreOpen ? "text-cyan" : "text-tertiary"
          }`}
        >
          <Menu className="h-4 w-4" />
          {L("更多", "More")}
        </button>
      </nav>
    </div>
  );
}
