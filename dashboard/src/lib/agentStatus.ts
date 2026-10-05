/**
 * 链上状态语义（侧边栏与顶栏共用一份）。
 *
 * ⚠️ 为什么单独成模块：状态判据与文案**必须只有一份**。此前 `AgentStatus` 与
 * `STATUS_META` 定义在 `components/layout/Sidebar.tsx`，而顶栏（移动端唯一的可见位置）
 * 也要显示同一个状态；复制一份，迟早会出现"同一链上状态在两处结论不同"的老问题。
 *
 * 判据（2026-10-04 修正）：
 *   offline ← 链上读数拿不到（RPC 失败 / 不在链上）
 *   frozen  ← **只有** `AegisVault.tradingFrozen === true` 才算。此时 executeTrade 会被
 *              `Trading frozen` 拒绝，需 owner 调 `resumeTrading`（且必须已有新鲜收据）
 *   stale   ← 没有新鲜收据（`!alive || !fresh`）。这只表示**死手开关的条件已满足**
 *             （任何人可调 `freezeIfStale`），**不等于已冻结**——此前的实现把
 *             `!alive` 直接标成"已冻结"，在链上 tradingFrozen=false 时亮红字说了假话。
 *   unknown ← 读数成功，但 `tradingFrozen` 这一次没取到（`frozen === null`）
 *   ok      ← 有新鲜收据且未冻结
 */
export type AgentStatus = "ok" | "stale" | "frozen" | "offline" | "unknown";

export interface StatusMeta {
  label: string;
  labelEn: string;
  /** Tailwind 文本色类 */
  color: string;
  /** Tailwind 圆点类 */
  dot: string;
  /** hover 说明：解释这个状态**意味着什么、不意味着什么** */
  hint: string;
}

export const STATUS_META: Record<AgentStatus, StatusMeta> = {
  ok: {
    label: "正常",
    labelEn: "OK",
    color: "text-green",
    dot: "bg-green dot-pulse",
    hint: "有新鲜交易收据、金库未冻结：executeTrade 具备放行条件（仍须已授权 challenger 背书）",
  },
  stale: {
    label: "收据不新鲜",
    labelEn: "Stale receipt",
    color: "text-amber",
    dot: "bg-amber dot-pulse-fast",
    hint: "距最近一张交易收据已超过 STALENESS_LIMIT：死手开关的条件已满足（任何人可调 freezeIfStale 冻结金库），但链上 tradingFrozen 当前仍为 false。这不是故障，是 agent 空闲——补一张新鲜收据即可恢复。",
  },
  frozen: {
    label: "已冻结",
    labelEn: "Frozen",
    color: "text-red",
    dot: "bg-red",
    hint: "链上 tradingFrozen == true：executeTrade 会被 Trading frozen 拒绝。需 owner 调 resumeTrading，且调用时必须已有新鲜收据。",
  },
  offline: {
    label: "链上不可达",
    labelEn: "Chain unreachable",
    color: "text-muted",
    dot: "bg-muted",
    hint: "拿不到链上读数。注意：这只说明这一次读失败，不等于相关服务没启动。",
  },
  unknown: {
    label: "状态部分未知",
    labelEn: "Partly unknown",
    color: "text-tertiary",
    dot: "bg-tertiary",
    hint: "读数成功，但金库的 tradingFrozen 这一次没取到，故无法断言是否已冻结——不猜、不显示“正常”。",
  },
};

/** 把链上读数映射成状态。输入为 `null`（还没读到）时按 offline 处理。 */
export function computeAgentStatus(
  s: { online: boolean; alive: boolean; fresh: boolean; frozen: boolean | null } | null
): AgentStatus {
  if (!s || !s.online) return "offline";
  if (s.frozen === true) return "frozen";
  if (!s.alive || !s.fresh) return "stale";
  if (s.frozen === null) return "unknown";
  return "ok";
}
