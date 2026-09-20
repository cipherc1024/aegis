"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { NAV_FLAT } from "@/lib/nav";
import { useLang, useL } from "@/lib/i18n";
import { Languages, Plug } from "lucide-react";

export function Topbar() {
  const pathname = usePathname();
  const lang = useLang((s) => s.lang);
  const toggle = useLang((s) => s.toggle);
  const L = useL();
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
        {/* 只读控制台：本 Dashboard 不持任何私钥，没有"连接钱包"这个动作。
            引导到独立验证页（浏览器内直读链上，无需钱包）而非放一个死按钮。 */}
        <Link
          href="/verify"
          className="flex items-center gap-1.5 rounded-lg border border-cyan/40 bg-cyan/5 px-3 py-1.5 text-xs font-medium text-cyan hover:bg-cyan/10"
        >
          <Plug className="h-3.5 w-3.5" />
          {L("独立验证（无需钱包）", "Verify (no wallet)")}
        </Link>
      </div>
    </header>
  );
}
