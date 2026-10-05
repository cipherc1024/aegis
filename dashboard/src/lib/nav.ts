import {
  Globe,
  Play,
  ScanSearch,
  FileSearch,
  Network,
  LayoutDashboard,
  Monitor,
  Landmark,
  Wallet,
  SlidersHorizontal,
  ScrollText,
  Settings,
  BookOpen,
  Wrench,
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

// 分组即"你打算做什么"，不再按"这一页的数据从哪来"分（2026-10-04 重排）：
//
//   为什么改：原分组是「核心（评审从这里看）/ 运营（真实写操作）/ 设计边界（真实读数 + 边界论证）」——
//   那套分类回答的是"数据是否真实"，而不是"用户要干什么"；对第一次打开的人（尤其手机上）
//   是陌生的心智模型，而且"运营"组一次塞了 10 项。同时把"评审从这里看"写进**产品**导航，
//   与 Track 04 对"别人可以构建在其上的基础设施"的定位自相矛盾。
//
// 现在：评审入口（结论 → 自己跑 → 自己验证 → 证据 → 架构）／运行（真实读数与写操作）／说明（术语、接口）。
// 19 项 → 14 项。移出导航的页面没有被删除，仍由对应页面内的"相关页面"入口与深链到达：
//   /create /market /notifications        → 由 /vaults、/settings 内链
//   /audit /backtest                      → 由 /receipts（收据与审计）内链，同一份数据的另外两个视图
//   /copy /subaccounts                    → 由 /vaults（金库与角色）内链，结构性边界的完整论证
export const NAV: NavGroup[] = [
  {
    // 评审动线：先看结论 → 自己跑一笔 → 自己验证 → 点开证据 → 再读架构。
    label: "评审入口（从这里看）",
    labelEn: "Start here",
    items: [
      { key: "landing", href: "/", label: "总览", labelEn: "Overview", icon: Globe },
      { key: "try", href: "/try", label: "现场跑一笔", labelEn: "Run a decision", icon: Play },
      { key: "verify", href: "/verify", label: "独立验证器", labelEn: "Independent verifier", icon: ScanSearch },
      { key: "evidence", href: "/evidence", label: "证据与复现", labelEn: "Evidence & reproduce", icon: FileSearch },
      { key: "architecture", href: "/architecture", label: "架构与信任边界", labelEn: "Architecture", icon: Network },
    ],
  },
  {
    label: "运行",
    labelEn: "Operations",
    items: [
      { key: "dashboard", href: "/dashboard", label: "运行看板", labelEn: "Dashboard", icon: LayoutDashboard },
      { key: "console", href: "/console", label: "Agent 控制台", labelEn: "Agent console", icon: Monitor },
      { key: "vaults", href: "/vaults", label: "金库与角色", labelEn: "Vault & roles", icon: Landmark },
      { key: "funds", href: "/funds", label: "存取款", labelEn: "Deposit / Withdraw", icon: Wallet },
      { key: "policy", href: "/policy", label: "策略编辑器", labelEn: "Policy editor", icon: SlidersHorizontal },
      { key: "receipts", href: "/receipts", label: "收据与审计", labelEn: "Receipts & audit", icon: ScrollText },
      { key: "settings", href: "/settings", label: "运行环境", labelEn: "Runtime & settings", icon: Settings },
    ],
  },
  {
    label: "说明",
    labelEn: "Reference",
    items: [
      { key: "glossary", href: "/glossary", label: "术语表", labelEn: "Glossary", icon: BookOpen },
      { key: "sdk", href: "/sdk", label: "接口与脚本", labelEn: "Interfaces & scripts", icon: Wrench },
    ],
  },
];

export const NAV_FLAT: NavItem[] = NAV.flatMap((g) => g.items);
