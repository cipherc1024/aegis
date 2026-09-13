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
    label: "公开",
    labelEn: "Public",
    items: [
      { key: "landing", href: "/", label: "Landing", labelEn: "Landing", icon: Globe },
      { key: "market", href: "/market", label: "Agent 市场", labelEn: "Agent Market", icon: Search },
    ],
  },
  {
    label: "用户",
    labelEn: "User",
    items: [
      { key: "dashboard", href: "/dashboard", label: "Dashboard", labelEn: "Dashboard", icon: LayoutDashboard },
      { key: "copy", href: "/copy", label: "策略跟投", labelEn: "Copy Strategies", icon: TrendingUp, badge: "P1" },
      { key: "vaults", href: "/vaults", label: "收益金库", labelEn: "Vaults", icon: Landmark, badge: "P1" },
      { key: "receipts", href: "/receipts", label: "收据 / 验证", labelEn: "Receipts / Verify", icon: ScrollText },
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
      { key: "console", href: "/console", label: "Agent Console", labelEn: "Agent Console", icon: Monitor },
      { key: "subaccounts", href: "/subaccounts", label: "子账户", labelEn: "Sub-accounts", icon: Users, badge: "P2" },
    ],
  },
  {
    label: "审计",
    labelEn: "Audit",
    items: [
      { key: "verify", href: "/verify", label: "独立验证器", labelEn: "Independent Verifier", icon: ScanSearch },
      { key: "notifications", href: "/notifications", label: "通知", labelEn: "Notifications", icon: Bell, badge: "P1" },
      { key: "audit", href: "/audit", label: "审计日志", labelEn: "Audit Log", icon: ClipboardList, badge: "P1" },
    ],
  },
  {
    label: "开发者",
    labelEn: "Developer",
    items: [{ key: "sdk", href: "/sdk", label: "Aegis SDK", labelEn: "Aegis SDK", icon: Wrench, badge: "P1" }],
  },
  {
    label: "系统",
    labelEn: "System",
    items: [{ key: "settings", href: "/settings", label: "设置", labelEn: "Settings", icon: Settings }],
  },
];

export const NAV_FLAT: NavItem[] = NAV.flatMap((g) => g.items);
