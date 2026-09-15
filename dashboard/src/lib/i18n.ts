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

const DICT: Record<string, { zh: string; en: string }> = {
  "nav.public": { zh: "公开", en: "Public" },
  "nav.user": { zh: "用户", en: "User" },
  "nav.operator": { zh: "运营者", en: "Operator" },
  "nav.audit": { zh: "审计", en: "Audit" },
  "nav.developer": { zh: "开发者", en: "Developer" },
  "nav.system": { zh: "系统", en: "System" },

  "landing.tagline": { zh: "基于 TEE 的可验证自主交易 Agent", en: "Verifiable autonomous trading agent, powered by TEE" },
  "landing.title": { zh: "Agent 必须证明它听话了。", en: "The agent must prove it obeyed." },
  "landing.subtitle": {
    zh: "每一笔交易、每一次拒绝、每一次心跳，都附带一张绑定 Monad 区块高度的 TEE 收据——任何人可独立验证。",
    en: "Every trade, rejection and heartbeat carries a TEE receipt anchored to a Monad block height — verifiable by anyone.",
  },
  "landing.browse": { zh: "浏览 Agent 市场", en: "Browse Agents" },
  "landing.verifier": { zh: "独立验证器", en: "Independent Verifier" },
  "landing.liveReceipts": { zh: "实时收据流", en: "Live receipts" },

  "stat.totalReceipts": { zh: "累计验证收据", en: "Verified receipts" },
  "stat.tvl": { zh: "平台 TVL", en: "Platform TVL" },
  "stat.agents": { zh: "运行中 Agent", en: "Active agents" },
  "stat.blocked": { zh: "拦截攻击", en: "Attacks blocked" },

  "status.ok": { zh: "正常", en: "Healthy" },
  "status.stale": { zh: "收据不新鲜", en: "Stale receipts" },
  "status.frozen": { zh: "已冻结", en: "Frozen" },

  "market.title": { zh: "Agent 市场", en: "Agent Market" },
  "market.subtitle": { zh: "发现可验证、可投资的自主交易 Agent", en: "Discover verifiable autonomous trading agents" },
  "market.sampleNotice": {
    zh: "示例数据：以下 Agent 为产品愿景占位，非链上真实注册的 agent。真实可验证的 agent 只有一个（agentId=1），见「总览 / 收据流」。",
    en: "Sample data: the agents below are product-vision placeholders, not on-chain registrations. Only one agent (agentId=1) is real and verifiable — see Overview / Receipts.",
  },
  "market.filter.all": { zh: "全部", en: "All" },
  "market.filter.highYield": { zh: "高收益", en: "High yield" },
  "market.filter.lowRisk": { zh: "低风险", en: "Low risk" },
  "market.filter.new": { zh: "新上线", en: "New" },
  "market.invest": { zh: "查看 / 投资", en: "View / Invest" },
  "market.reputation": { zh: "声誉", en: "Reputation" },
  "market.return30d": { zh: "30d 收益", en: "30d return" },
  "market.drawdown": { zh: "最大回撤", en: "Max drawdown" },
  "market.winRate": { zh: "胜率", en: "Win rate" },

  "dash.myEquity": { zh: "我的权益", en: "My equity" },
  "dash.totalProfit": { zh: "累计收益", en: "Total profit" },
  "dash.todayQuota": { zh: "今日额度", en: "Today's quota" },
  "dash.agentStatus": { zh: "Agent 状态", en: "Agent status" },
  "dash.receiptStream": { zh: "实时收据流", en: "Receipt stream" },
  "dash.hashChain": { zh: "收据哈希链", en: "Receipt hash chain" },
  "dash.safety": { zh: "安全状态", en: "Safety status" },
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
