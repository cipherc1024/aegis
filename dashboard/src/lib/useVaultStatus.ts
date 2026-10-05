"use client";

import { useAgentStatus } from "./useAgentStatus";
import { computeAgentStatus, STATUS_META, type AgentStatus, type StatusMeta } from "./agentStatus";

export interface VaultStatus {
  status: AgentStatus;
  meta: StatusMeta;
  /** 链上当前块高；拿不到时为 null（不显示旧值，避免"看起来像实时"） */
  currentBlock: number | null;
}

/**
 * 侧边栏与顶栏共用的链上状态。
 *
 * 数据源刻意走 `useAgentStatus`（**浏览器内直读链上**，见 lib/chain.ts），
 * 不经 orchestrator——这样即使 proposer 服务挂了，状态灯仍然说真话。
 */
export function useVaultStatus(agentId = 1n, intervalMs = 6000): VaultStatus {
  const s = useAgentStatus(agentId, intervalMs);
  const status = computeAgentStatus(s);
  return { status, meta: STATUS_META[status], currentBlock: s?.online ? s.currentBlock : null };
}
