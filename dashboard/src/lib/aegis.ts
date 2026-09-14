/**
 * 统一入口客户端：只看 orchestrator 的公开只读端点，不持任何密钥。
 *
 * 设计原则（答辩时照此讲）：
 *   - Dashboard 自己不做任何"裁决"，它只是把 orchestrator 的输出如实渲染出来；
 *   - 需要独立验证证据时不走本客户端，走 verify 页 —— 那里用公共 RPC 在浏览器内直读链上；
 *   - 端点不可达时一律返回 null，由页面显示"离线"，绝不回退到看起来像真数据的占位值。
 */

// 同源代理（next.config.mjs rewrites 把 /orch/* 转发到 orchestrator），
// 因此不需要 orchestrator 开 CORS，也不把内网地址暴露给浏览器。
export const ORCH = process.env.NEXT_PUBLIC_ORCH_ORIGIN || "/orch";

export interface LlmMeta {
  base: string | null;
  model: string | null;
  challengerModel: string | null;
  crossFamily: boolean;
  mode: "live" | "mock";
}

export interface DecisionTraceStep {
  stage: string;
  facts?: unknown;
  suspicious?: unknown;
  plan?: unknown;
}

export interface LiveStatus {
  online: boolean;
  currentBlock: number;
  lastReceiptBlock: number;
  fresh: boolean;
  alive: boolean;
  receiptHash: string;
  guardrailHash: string;
  executionHash: string;
  llm: LlmMeta;
  agentId: number;
}

export interface TrustDevice {
  role: string;
  name: string;
  holds: string[];
  note: string;
}

export interface AegisConfig {
  agentId: number;
  chain: { chainId: number; name: string };
  contracts: {
    receiptRegistry: string;
    validationRegistry: string | null;
    vaultQuorum: string | null;
    quoteService: string | null;
  };
  policy: {
    whitelist: string[];
    perTxLimitMon: number;
    demoMaxMon: number;
    blocklist: string[];
    trustedCommand: string;
  };
  trustBoundary: { devices: TrustDevice[]; llmPlacement: string };
}

export interface VerifyCheckResult {
  key: string;
  labelZh: string;
  labelEn: string;
  detail: string;
  state: "pass" | "fail" | "pending";
}

export interface VerifyResponse {
  input: { command: string; marketData: string; target: string; amount: string; data: string };
  /** "pipeline" = 服务端用双 LLM 解析出的意图；"explicit" = 调用方直接指定了 target/amount */
  resolvedBy: "pipeline" | "explicit";
  proposer: { verdict: "accept" | "reject"; guardrail: string[]; pace: string | null };
  challenger: {
    verdict: "accept" | "reject" | null;
    /** challenger 四层独立重推导的逐层结果，形如 { "1_policy": "pass", ... } */
    layers?: Record<string, string>;
    mismatches?: string[];
    error?: string;
  };
  agree: boolean | null;
}

export interface PipelinePreview {
  llm: LlmMeta;
  command: string;
  marketData: string;
  kind: "intent" | "refuse";
  stage?: string;
  reason?: string;
  steps: DecisionTraceStep[];
  intent?: { target: string; amount: string; data: string };
  guardrail?: string[];
  pace?: string | null;
  deltaVerdict?: "accept" | "reject";
}

export interface CommandResult {
  decision: string;
  dryRun?: boolean;
  type?: string;
  reason?: string;
  stage?: string;
  reasons?: string[];
  target?: string;
  amount?: string;
  txHash?: string;
  status?: number;
  gasUsed?: string;
  submitPath?: string;
  newLastReceiptHash?: string;
  quote?: { bytes: number };
  transcriptHash?: string;
  llm?: unknown;
  challenger?: { agree: boolean | null; response: number; layers?: unknown[]; mismatches?: unknown[]; note?: string };
  execution?: { status: string; txHash?: string; vaultBalance?: string; challengerResponse?: number; waitedMs?: number; error?: string };
}

export interface ChainReceipt {
  receiptHash: string;
  blockHeight: number;
  isHeartbeat: boolean;
  txHash: string;
}

async function get<T>(path: string, ms = 90_000): Promise<T | null> {
  try {
    const r = await fetch(`${ORCH}${path}`, { signal: AbortSignal.timeout(ms), cache: "no-store" });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

async function post<T>(path: string, body: unknown, ms: number): Promise<T | null> {
  try {
    const r = await fetch(`${ORCH}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
      cache: "no-store",
    });
    if (!r.ok) return null;
    return (await r.json()) as T;
  } catch {
    return null;
  }
}

export const api = {
  config: (agentId = 1) => get<AegisConfig>(`/api/config?agentId=${agentId}`, 5_000),
  status: (agentId = 1) => get<LiveStatus>(`/api/status?agentId=${agentId}`, 8_000),
  receipts: (agentId = 1) => get<ChainReceipt[]>(`/api/receipts?agentId=${agentId}`, 30_000),
  decision: (digest: string) =>
    get<{ found: boolean; transcript?: Record<string, unknown> }>(`/api/decision/${digest}`, 8_000),

  /** 零 gas：双 LLM 会说/提出什么 */
  pipeline: (command: string, marketData = "") =>
    get<PipelinePreview>(
      `/api/pipeline?command=${encodeURIComponent(command)}&marketData=${encodeURIComponent(marketData)}`,
      120_000
    ),

  /**
   * 两套独立实现的确定性裁决（δ）。**推荐省略 target/amount** ——
   * 由 orchestrator 用与 /api/agent/command 相同的双 LLM 管线解析意图，
   * 保证两处口径一致；显式传参只用于负例脚本。
   */
  verify: (input: { command: string; marketData?: string; target?: string; amount?: string; data?: string }) =>
    post<VerifyResponse>("/api/verify", input, 120_000),

  /** dryRun 零 gas；execute 会真实上链（仅在演示执行链路时用） */
  command: (
    input: {
      command?: string;
      marketData?: string;
      target?: string;
      amount?: string;
      data?: string;
      execute?: boolean;
      dryRun?: boolean;
      tamperTranscript?: boolean;
    },
    ms = 180_000
  ) => post<CommandResult>(`/api/agent/command?agentId=1`, input, ms),
};
