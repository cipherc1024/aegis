"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar, type AgentStatus } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useAgentStatus } from "@/lib/useAgentStatus";
import { NAV } from "@/lib/nav";
import { LayoutDashboard, ScrollText, Wallet, Menu, X } from "lucide-react";

// 底部 tab 只放高频页，其余全部页面在「更多」抽屉里按 NAV 的三组分好。
// 抽屉直接渲染 NAV —— 不另抄一份清单，否则以后加页会再次出现"新页在手机上点不到"。
// （Sidebar 在 md 以下整体隐藏，没有这个抽屉时手机上只能到达 TABS 的 6 页。）
const TABS = [
  { href: "/dashboard", icon: LayoutDashboard, label: "主页" },
  { href: "/receipts", icon: ScrollText, label: "收据" },
  { href: "/funds", icon: Wallet, label: "资金" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const pathname = usePathname();
  const s = useAgentStatus(1n);

  // 链不可达时必须显示"不可达"，绝不能落到"正常"——否则 RPC 挂掉时
  // 侧边栏会亮绿点说一切正常，这比不显示状态更有害。
  const status: AgentStatus = !s || !s.online ? "offline" : !s.alive ? "frozen" : !s.fresh ? "stale" : "ok";

  return (
    <div className="bg-top-glow relative flex h-screen overflow-hidden">
      <Sidebar
        collapsed={collapsed}
        onToggle={() => setCollapsed((c) => !c)}
        status={status}
        currentBlock={s?.online ? s.currentBlock : null}
      />
      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto px-4 py-5 pb-20 md:px-7 md:py-6 md:pb-6">{children}</main>
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
              <span className="text-sm font-medium">全部页面</span>
              <button aria-label="关闭菜单" onClick={() => setMoreOpen(false)} className="text-tertiary">
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="px-3 py-2">
              {NAV.map((group) => (
                <div key={group.label} className="mb-3">
                  <div className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted">
                    {group.label}
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
                          <span className="truncate">{item.label}</span>
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
              aria-label={t.label}
              className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] ${
                active ? "text-cyan" : "text-tertiary"
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </Link>
          );
        })}
        <button
          onClick={() => setMoreOpen((v) => !v)}
          aria-label="更多页面"
          aria-expanded={moreOpen}
          className={`flex flex-1 flex-col items-center gap-1 py-2 text-[10px] ${
            moreOpen ? "text-cyan" : "text-tertiary"
          }`}
        >
          <Menu className="h-4 w-4" />
          更多
        </button>
      </nav>
    </div>
  );
}
