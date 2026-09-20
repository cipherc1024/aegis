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

// 分组即"这一页的数据从哪来"，不是按产品模块分类：
//   核心   — 数据全部来自链上/orchestrator 真实读数，可直接核实
//   运营   — 数据仍是真实读数，但页面本身会发起真实上链写操作（花钱）
//   规划中 — 其后端不存在，页面内已有横幅明示；与上面两组分开摆放
// 判断一页该放哪组的方法：问"删掉 orchestrator，这页还剩什么"。剩真实读数 → 核心/运营；
// 只剩空壳 → 规划中。
export const NAV: NavGroup[] = [
  {
    // 评审动线：先看结论 → 自己跑一笔 → 自己验证 → 再读架构。
    // 本组每一页都必须能给出链上可核实的读数；占位页一律不放进这里。
    label: "核心（评审从这里看）",
    labelEn: "Core (start here)",
    items: [
      { key: "landing", href: "/", label: "总览", labelEn: "Overview", icon: Globe },
      { key: "try", href: "/try", label: "现场跑一笔", labelEn: "Run a decision", icon: Play },
      { key: "verify", href: "/verify", label: "独立验证器", labelEn: "Independent Verifier", icon: ScanSearch },
      { key: "architecture", href: "/architecture", label: "架构与信任边界", labelEn: "Architecture", icon: Network },
      { key: "receipts", href: "/receipts", label: "收据流", labelEn: "Receipts", icon: ScrollText },
    ],
  },
  {
    // 运营页：读数真实，但带链上写操作（需二次确认 + 真实 gas）。
    // 与核心组分开，是因为"看看"和"动钱"的风险面不同。
    label: "运营（真实写操作）",
    labelEn: "Operations (live writes)",
    items: [
      { key: "dashboard", href: "/dashboard", label: "Dashboard", labelEn: "Dashboard", icon: LayoutDashboard },
      { key: "console", href: "/console", label: "Agent Console", labelEn: "Agent Console", icon: Monitor },
      { key: "vaults", href: "/vaults", label: "金库", labelEn: "Vault", icon: Landmark },
      { key: "funds", href: "/funds", label: "存取款", labelEn: "Deposit / Withdraw", icon: Wallet },
      { key: "create", href: "/create", label: "创建 Agent", labelEn: "Create Agent", icon: Sparkles },
      { key: "policy", href: "/policy", label: "策略编辑器", labelEn: "Policy Editor", icon: SlidersHorizontal },
      { key: "market", href: "/market", label: "Agent 市场", labelEn: "Agent Market", icon: Search },
      { key: "notifications", href: "/notifications", label: "通知", labelEn: "Notifications", icon: Bell },
      { key: "audit", href: "/audit", label: "审计日志", labelEn: "Audit Log", icon: ClipboardList },
      { key: "settings", href: "/settings", label: "设置与运行环境", labelEn: "Settings & Runtime", icon: Settings },
    ],
  },
  {
    // 设计边界组：这些页面的数据是真实的（链上/进程读数），但它们对应的产品
    // 功能在本架构下「结构上不能做」或「尚未做」。页内逐条给出真实读数 + 边界论证，
    // 与上面两组分开摆放，避免评审把「结构边界」误当成「待办」，或反过来误当成已实现。
    label: "设计边界（真实读数 + 边界论证）",
    labelEn: "Design boundaries (live reads + rationale)",
    items: [
      { key: "backtest", href: "/backtest", label: "执行统计", labelEn: "Execution Stats", icon: LineChart },
      { key: "copy", href: "/copy", label: "策略跟投", labelEn: "Copy Strategies", icon: TrendingUp },
      { key: "subaccounts", href: "/subaccounts", label: "账户与角色", labelEn: "Accounts & Roles", icon: Users },
      { key: "sdk", href: "/sdk", label: "接口与脚本", labelEn: "Interfaces & Scripts", icon: Wrench },
    ],
  },
];

export const NAV_FLAT: NavItem[] = NAV.flatMap((g) => g.items);
