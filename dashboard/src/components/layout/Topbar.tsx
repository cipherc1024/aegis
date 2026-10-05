"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { NAV_FLAT } from "@/lib/nav";
import { useLang, useL } from "@/lib/i18n";
import { useVaultStatus } from "@/lib/useVaultStatus";
import { Languages, Plug } from "lucide-react";

export function Topbar() {
  const pathname = usePathname();
  const lang = useLang((s) => s.lang);
  const toggle = useLang((s) => s.toggle);
  const L = useL();
  const item = NAV_FLAT.find((i) => i.href === pathname);
  const title = item ? (lang === "zh" ? item.label : item.labelEn) : "Aegis";
  // 链上状态的**移动端唯一可见位置**：Sidebar 在 md 以下整体隐藏，此前手机上
  // 完全看不到状态（而评审很可能用手机打开 Live product）。md 以上由侧边栏承担，
  // 这里用 md:hidden 避免同一状态重复两处。
  const { meta, currentBlock } = useVaultStatus(1n, 6000);

  return (
    <header className="flex h-[52px] shrink-0 items-center gap-3 border-b border-border-subtle bg-base px-4 md:px-6">
      <div className="min-w-0">
        <div className="truncate text-sm font-medium">{title}</div>
      </div>

      <div className="ml-auto flex shrink-0 items-center gap-2">
        <span
          title={meta.hint}
          aria-label={L("链上状态", "On-chain status")}
          className="flex items-center gap-1.5 rounded-lg border border-border-base px-2 py-1 text-[12px] md:hidden"
        >
          <span className={`h-2 w-2 shrink-0 rounded-full ${meta.dot}`} />
          <span className={meta.color}>{L(meta.label, meta.labelEn)}</span>
          <span className="mono text-muted">{currentBlock ? `#${currentBlock.toLocaleString()}` : "#—"}</span>
        </span>

        <button
          onClick={toggle}
          aria-label="切换语言"
          title={lang === "zh" ? "Switch to English" : "切换到中文"}
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
          <span className="hidden sm:inline">{L("独立验证（无需钱包）", "Verify (no wallet)")}</span>
        </Link>
      </div>
    </header>
  );
}
