"use client";

import { useEffect, useState } from "react";
import { getStatus, type ChainStatus } from "./chain";

export function useAgentStatus(agentId = 1n, intervalMs = 6000): ChainStatus | null {
  const [status, setStatus] = useState<ChainStatus | null>(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      const r = await getStatus(agentId);
      if (alive) setStatus(r);
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [agentId, intervalMs]);

  return status;
}
