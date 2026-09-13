"use client";

import { usePathname } from "next/navigation";
import { NAV_FLAT } from "@/lib/nav";
import { useLang } from "@/lib/i18n";
import { Bell, Wallet, Languages } from "lucide-react";

export function Topbar() {
  const pathname = usePathname();
  const lang = useLang((s) => s.lang);
  const toggle = useLang((s) => s.toggle);
  const item = NAV_FLAT.find((i) => i.href === pathname);
  const title = item ? (lang === "zh" ? item.label : item.labelEn) : "Aegis";

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border-subtle bg-base px-6">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={toggle}
          aria-label="切换语言"
          className="flex items-center gap-1.5 rounded-lg border border-border-base px-2.5 py-1.5 text-xs text-secondary hover:border-border-hover hover:text-primary"
        >
          <Languages className="h-3.5 w-3.5" />
          {lang === "zh" ? "中文" : "EN"}
        </button>
        <button
          aria-label="通知"
          className="relative rounded-lg border border-border-base p-2 text-secondary hover:border-border-hover hover:text-primary"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-red" />
        </button>
        <button className="flex items-center gap-1.5 rounded-lg border border-cyan/40 bg-cyan/5 px-3 py-1.5 text-xs font-medium text-cyan hover:bg-cyan/10">
          <Wallet className="h-3.5 w-3.5" />
          连接钱包
        </button>
      </div>
    </header>
  );
}
