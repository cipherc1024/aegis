"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV } from "@/lib/nav";
import { Shield, PanelLeftClose, PanelLeftOpen } from "lucide-react";

export type AgentStatus = "ok" | "stale" | "frozen";

const STATUS_META: Record<AgentStatus, { label: string; color: string; dot: string }> = {
  ok: { label: "正常", color: "text-green", dot: "bg-green dot-pulse" },
  stale: { label: "收据不新鲜", color: "text-amber", dot: "bg-amber dot-pulse-fast" },
  frozen: { label: "已冻结", color: "text-red", dot: "bg-red" },
};

export function Sidebar({
  collapsed,
  onToggle,
  status,
  currentBlock,
}: {
  collapsed: boolean;
  onToggle: () => void;
  status: AgentStatus;
  currentBlock: number | null;
}) {
  const pathname = usePathname();
  const meta = STATUS_META[status];

  return (
    <aside
      className="hidden h-screen shrink-0 flex-col border-r border-border-base bg-sidebar transition-all duration-200 md:flex"
      style={{ width: collapsed ? 60 : 232 }}
    >
      {/* Logo */}
      <div className="flex h-[52px] items-center gap-2 border-b border-border-subtle px-4">
        <Shield className="h-5 w-5 shrink-0 text-cyan" />
        {!collapsed && <span className="font-semibold tracking-tight">Aegis Agent</span>}
        <button
          onClick={onToggle}
          aria-label={collapsed ? "展开侧边栏" : "折叠侧边栏"}
          className="ml-auto text-tertiary hover:text-primary"
        >
          {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto px-2 py-3">
        {NAV.map((group) => (
          <div key={group.label} className="mb-3">
            {!collapsed && (
              <div className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-muted">
                {group.label}
              </div>
            )}
            {group.items.map((item) => {
              const active = pathname === item.href;
              const Icon = item.icon;
              return (
                <Link
                  key={item.key}
                  href={item.href}
                  title={collapsed ? item.label : undefined}
                  className={`group mb-0.5 flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm transition-colors ${
                    active ? "bg-hover text-primary" : "text-secondary hover:bg-hover hover:text-primary"
                  }`}
                >
                  <Icon className={`h-4 w-4 shrink-0 ${active ? "text-cyan" : ""}`} />
                  {!collapsed && (
                    <>
                      <span className="truncate">{item.label}</span>
                      {item.badge && (
                        <span className="ml-auto rounded-md bg-input px-1.5 py-0.5 text-[10px] text-muted">
                          {item.badge}
                        </span>
                      )}
                    </>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Status badge */}
      <div className="border-t border-border-subtle p-3">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${meta.dot}`} />
          {!collapsed && (
            <div className="min-w-0">
              <div className={`text-xs font-medium ${meta.color}`}>{meta.label}</div>
              <div className="mono truncate text-[10px] text-muted">
                block #{currentBlock ? currentBlock.toLocaleString() : "—"}
              </div>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
