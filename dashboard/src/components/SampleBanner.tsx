"use client";

import { useL } from "@/lib/i18n";
import { FlaskConical } from "lucide-react";

/**
 * 愿景页顶部横幅：这些页面的数字不是链上真实读数。
 * 与 StatCard/SafetyPanel 的 `sample` 芯片同一口径（评审可分辨），
 * 但用于整页都是占位数据的页面，需要比单个芯片更显眼。
 */
export function SampleBanner({ note }: { note?: string }) {
  const L = useL();
  return (
    <div className="mb-4 flex items-center gap-2 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-xs text-amber">
      <FlaskConical className="h-3.5 w-3.5 shrink-0" />
      <span>
        {note ??
          L(
            "本页为产品愿景占位数据，非链上真实读数。真实读数见「总览 / 收据流 / 验证器」。",
            "Placeholder product-vision data, not on-chain readings. For real data see Overview / Receipts / Verifier."
          )}
      </span>
    </div>
  );
}
