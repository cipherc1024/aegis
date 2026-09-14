import {
  Globe,
  Search,
  LayoutDashboard,
  TrendingUp,
  Landmark,
  ScrollText,
  Wallet,
  Sparkles,
  SlidersHorizontal,
  LineChart,
  Monitor,
  Users,
  ScanSearch,
  Bell,
  ClipboardList,
  Wrench,
  Settings,
  Network,
  Play,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  key: string;
  href: string;
  label: string;
  labelEn: string;
  icon: LucideIcon;
  badge?: string;
}

export interface NavGroup {
  label: string;
  labelEn: string;
  items: NavItem[];
}

export const NAV: NavGroup[] = [
  {
    // 评审动线：先看结论 → 自己跑一笔 → 自己验证 → 再读架构。
    // 其余分组是产品愿景，页面标了 P1/P2 —— 不要把演示注意力引过去。
    label: "核心（评审从这里看）",
    labelEn: "Core (start here)",
    items: [
      { key: "landing", href: "/", label: "总览", labelEn: "Overview", icon: Globe },
      { key: "try", href: "/try", label: "现场跑一笔", labelEn: "Run a decision", icon: Play },
      { key: "verify", href: "/verify", label: "独立验证器", labelEn: "Independent Verifier", icon: ScanSearch },
      { key: "architecture", href: "/architecture", label: "架构与信任边界", labelEn: "Architecture", icon: Network },
      { key: "receipts", href: "/receipts", label: "收据流", labelEn: "Receipts", icon: ScrollText },
      { key: "console", href: "/console", label: "Agent Console", labelEn: "Agent Console", icon: Monitor },
    ],
  },
  {
    label: "用户",
    labelEn: "User",
    items: [
      { key: "dashboard", href: "/dashboard", label: "Dashboard", labelEn: "Dashboard", icon: LayoutDashboard },
      { key: "copy", href: "/copy", label: "策略跟投", labelEn: "Copy Strategies", icon: TrendingUp, badge: "P1" },
      { key: "vaults", href: "/vaults", label: "收益金库", labelEn: "Vaults", icon: Landmark, badge: "P1" },
      { key: "funds", href: "/funds", label: "存取款", labelEn: "Deposit / Withdraw", icon: Wallet },
    ],
  },
  {
    label: "运营者",
    labelEn: "Operator",
    items: [
      { key: "create", href: "/create", label: "创建 Agent", labelEn: "Create Agent", icon: Sparkles },
      { key: "policy", href: "/policy", label: "策略编辑器", labelEn: "Policy Editor", icon: SlidersHorizontal },
      { key: "backtest", href: "/backtest", label: "策略回测", labelEn: "Backtest", icon: LineChart, badge: "P1" },
      { key: "subaccounts", href: "/subaccounts", label: "子账户", labelEn: "Sub-accounts", icon: Users, badge: "P2" },
    ],
  },
  {
    label: "Other",
    labelEn: "Other",
    items: [
      { key: "market", href: "/market", label: "Agent 市场", labelEn: "Agent Market", icon: Search, badge: "P1" },
      { key: "notifications", href: "/notifications", label: "通知", labelEn: "Notifications", icon: Bell, badge: "P1" },
      { key: "audit", href: "/audit", label: "审计日志", labelEn: "Audit Log", icon: ClipboardList, badge: "P1" },
      { key: "sdk", href: "/sdk", label: "Aegis SDK", labelEn: "Aegis SDK", icon: Wrench, badge: "P1" },
      { key: "settings", href: "/settings", label: "设置", labelEn: "Settings", icon: Settings },
    ],
  },
];

export const NAV_FLAT: NavItem[] = NAV.flatMap((g) => g.items);
