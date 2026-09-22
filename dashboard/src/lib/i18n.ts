import { create } from "zustand";

export type Lang = "zh" | "en";

interface LangState {
  lang: Lang;
  setLang: (l: Lang) => void;
  toggle: () => void;
}

export const useLang = create<LangState>((set) => ({
  lang: "zh",
  setLang: (l) => set({ lang: l }),
  toggle: () => set((s) => ({ lang: s.lang === "zh" ? "en" : "zh" })),
}));

/**
 * 跨页面上报「用户此刻想试的输入」。landing hero 与参数化演示页之间用它交接，
 * 避免把中文/特殊字符塞进 URL（既丑又容易在 Windows 终端被引号吃掉）。
 */
interface LinkState {
  command: string;
  marketData: string;
  setCommand: (c: string) => void;
  setMarketData: (m: string) => void;
}

export const useLink = create<LinkState>((set) => ({
  command: "buy WMON 0.01",
  marketData: "",
  setCommand: (command) => set({ command }),
  setMarketData: (marketData) => set({ marketData }),
}));

// 键字典只保留真正被 t("...") 调用的条目 —— 页面绝大多数文案走 L("中文","English")
// 内联双语，字典是历史遗留的少数几处。
//
// ⚠️ status.* 三个键是**动态拼接**使用的（SafetyPanel.tsx: t(`status.${status}`)），
// 静态扫描 t("literal") 找不到它们；删除会导致 UI 直接显示 "status.frozen" 原文。
// 改本文件前必须把这两种调用形式都算上。
const DICT: Record<string, { zh: string; en: string }> = {
  "status.ok": { zh: "正常", en: "Healthy" },
  "status.stale": { zh: "收据不新鲜", en: "Stale receipts" },
  "status.frozen": { zh: "已冻结", en: "Frozen" },

  "dash.agentStatus": { zh: "Agent 状态", en: "Agent status" },
  "dash.receiptStream": { zh: "实时收据流", en: "Receipt stream" },
  "dash.hashChain": { zh: "收据哈希链", en: "Receipt hash chain" },
  "dash.perTx": { zh: "单笔限额", en: "Per-tx limit" },
  "dash.daily": { zh: "每日累计", en: "Daily limit" },
  "dash.depositWithdraw": { zh: "存取款", en: "Deposit / Withdraw" },
  "dash.editPolicy": { zh: "策略配置", en: "Policy" },

  "safety.freshness": { zh: "新鲜度", en: "Freshness" },
  "safety.alive": { zh: "存活", en: "Liveness" },
  "safety.chain": { zh: "链完整性", en: "Chain integrity" },
  "safety.dcap": { zh: "DCAP 验证", en: "DCAP verified" },
  "safety.withdrawOpen": { zh: "提现永不冻结", en: "Withdraw always open" },
};

export function useT() {
  const lang = useLang((s) => s.lang);
  return (key: string) => DICT[key]?.[lang] ?? key;
}

/** 便捷内联双语：L("中文","English") */
export function useL() {
  const lang = useLang((s) => s.lang);
  return (zh: string, en: string) => (lang === "zh" ? zh : en);
}
