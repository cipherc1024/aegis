"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Sidebar, type AgentStatus } from "./Sidebar";
import { Topbar } from "./Topbar";
import { useAgentStatus } from "@/lib/useAgentStatus";
import { LayoutDashboard, ScrollText, ScanSearch, Wallet, Monitor } from "lucide-react";

const TABS = [
  { href: "/dashboard", icon: LayoutDashboard, label: "主页" },
  { href: "/receipts", icon: ScrollText, label: "收据" },
  { href: "/verify", icon: ScanSearch, label: "验证" },
  { href: "/console", icon: Monitor, label: "Console" },
  { href: "/funds", icon: Wallet, label: "资金" },
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const pathname = usePathname();
  const s = useAgentStatus(1n);

  const status: AgentStatus = !s || !s.online ? "ok" : !s.alive ? "frozen" : !s.fresh ? "stale" : "ok";

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
      </nav>
    </div>
  );
}
