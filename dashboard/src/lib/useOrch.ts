"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface OrchState<T> {
  data: T | null;
  loading: boolean;
  /** 最近一次拉取的返回值（成功或失败），用于区分"还没拉过"和"拉了但是 null" */
  fetched: boolean;
  refresh: () => void;
}

/**
 * 轮询 orchestrator 的只读端点。
 * 刻意不用 react-query：这里的失败语义是"显示离线"而不是"重试到成功"，
 * 而且 fetcher 已在 lib/aegis.ts 里统一做了超时与 null 回退。
 */
export function useOrch<T>(fetcher: () => Promise<T | null>, deps: unknown[] = [], intervalMs = 0): OrchState<T> {
  const [data, setData] = useState<T | null>(null);
  const [fetched, setFetched] = useState(false);
  const [loading, setLoading] = useState(true);
  const fRef = useRef(fetcher);
  fRef.current = fetcher;

  const run = useCallback(async () => {
    const r = await fRef.current();
    setData(r);
    setFetched(true);
    setLoading(false);
  }, []);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void (async () => {
      const r = await fRef.current();
      if (!alive) return;
      setData(r);
      setFetched(true);
      setLoading(false);
    })();
    if (!intervalMs) return () => { alive = false; };
    const id = setInterval(() => { if (alive) void run(); }, intervalMs);
    return () => {
      alive = false;
      clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intervalMs, ...deps]);

  return { data, loading, fetched, refresh: () => void run() };
}
