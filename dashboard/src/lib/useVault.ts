"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type VaultState } from "./aegis";

/**
 * 金库真实状态轮询（余额/限额/日限用量）。返回 null 表示 orchestrator 不可达 —— 
 * 调用方必须显示"离线"，不得回退到示例数字。
 */
export function useVault(intervalMs = 15_000, agentId = 1) {
  const [vault, setVault] = useState<VaultState | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetched, setFetched] = useState(false);
  const alive = useRef(true);

  const refresh = useCallback(async () => {
    const v = await api.vault(agentId);
    if (!alive.current) return;
    setVault(v);
    setLoading(false);
    setFetched(true);
  }, [agentId]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    const id = setInterval(() => void refresh(), intervalMs);
    return () => {
      alive.current = false;
      clearInterval(id);
    };
  }, [refresh, intervalMs]);

  return { vault, loading, fetched, refresh };
}
