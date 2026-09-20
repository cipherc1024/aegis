/**
 * 统一入口客户端：只看 orchestrator 的公开只读端点，不持任何密钥。
 *
 * 设计原则（答辩时照此讲）：
 *   - Dashboard 自己不做任何"裁决"，它只是把 orchestrator 的输出如实渲染出来；
 *   - 需要独立验证证据时不走本客户端，走 verify 页 —— 那里用公共 RPC 在浏览器内直读链上；
 *   - 端点不可达时一律返回 null，由页面显示"离线"，绝不回退到看起来像真数据的占位值。
 */

// 同源代理（next.config.mjs rewrites 把 /orch/* 转发到 orchestrator），
// 因此演示链路不经 CORS（orchestrator 自身的 ALLOWED_ORIGINS 白名单是给
// 非浏览器直连用的，见 aegis/.env.example），也不把内网地址暴露给浏览器。
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
    identityRegistry: string | null;
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
    /** challenger 逐层独立重推导结果（L1–L5），形如 { "1_policy": "pass", ... } */
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

/**
 * 执行统计（/api/exec-stats）：收据流聚合 + 链上 validation 状态直读。
 * 注意这不是收益回测 —— 收益率/回撤需要价格管道，本系统不产生。
 */
export interface ExecStatsRow extends ChainReceipt {
  validation: {
    validator: string;
    agentId: number;
    /** uint8 裁决值：>=100 放行（见 AegisVaultQuorum.MIN_RESPONSE） */
    response: number;
    tag: string;
    /** 有人对该 requestHash 发过 validationRequest */
    requested: boolean;
    /** 已裁决 = 有请求且 response 非零 */
    responded: boolean;
  } | null;
}
export interface ExecStats {
  agentId: number;
  receiptsTotal: number;
  heartbeats: number;
  tradesSubmitted: number;
  validated: number;
  agreed: number;
  rejected: number;
  pendingValidation: number;
  firstBlock: number | null;
  lastBlock: number | null;
  note: string;
  rows: ExecStatsRow[];
}

/** 金库链上真实状态（/api/vault）。余额、限额、用量全部链上读回，无任何占位值。 */
export interface VaultTarget {
  symbol: string;
  address: string;
  whitelisted: boolean | null;
  kind: "native" | "erc20" | "unreadable" | "unknown";
  balance: string | null;
  decimals: number;
}

export interface VaultState {
  configured: boolean;
  note?: string;
  /** 全部字段在 configured=false 时缺省；configured=true 时 orchestrator 保证给出 */
  address: string;
  owner: string;
  agentId: number;
  teeDerivedAddress: string;
  frozen: boolean;
  balanceMon: string;
  balanceMonHuman: number;
  perTxLimit: string;
  dailyLimit: string;
  dailySpentToday: string;
  dailyRemaining: string;
  dailyWindowDay: number;
  trustedValidatorCount: number;
  targets: VaultTarget[];
}

/** ERC-8004 身份注册表真实读数（/api/agents） */
export interface IdentityAgent {
  agentId: number;
  owner: string | null;
  agentWallet: string | null;
  tokenURI: string | null;
  note?: string;
}
export interface IdentityState {
  lastId: number;
  agents: IdentityAgent[];
}

/** 金库清单一项（/api/vaults）：身份 + 该 agent 的金库（可能不存在） */
export interface VaultListRow extends IdentityAgent {
  /** null = 该 agent 没有可发现的金库（合约 agentId immutable，需逐个部署） */
  vault: (VaultState & { source: string; readError?: string | null }) | null;
  vaultNote: string | null;
}
export interface VaultListState {
  lastId: number;
  vaults: VaultListRow[];
  scan: {
    candidates: { source: string; address: string; declaredAgentId: number | null }[];
    /** 读了但没匹配上任何 agent 的候选地址（如已被替换的旧金库） */
    unroutedCandidates: { address: string; source: string; onchainAgentId: number }[];
    note: string;
  };
}

/** challenger 策略与链上已认证哈希的差异核对（/api/policy） */
export interface ChallengerPolicy {
  agentId: number;
  whitelist: string[];
  perTxLimit: string;
  dailyLimit: string;
  maxSlippageBps: number;
  blocklist: string[];
  allowedAssets: string[];
  /** orchestrator 附带的来源文件名，如 challenger-policy-1.json */
  __file?: string;
}
export interface PolicyState {
  agentId: number;
  /** null = 该 agent 尚无 challenger 策略文件，challenger 会跳过它 */
  policy: ChallengerPolicy | null;
  policyFile: string | null;
  attestedGuardrailHash: string | null;
  onChainGuardrailHash: string;
  inSync: boolean;
  registry: string;
  note: string;
}

/** 治理写操作的两步协议：先拿 preview（零 gas），再带 confirm 广播 */
export interface AdminPreview {
  op: string;
  label: string;
  target: string;
  signer: string;
  args: unknown[];
  value: string;
  gasLimit: string;
  gasPrice: string;
  estimatedFeeMon: number;
  signerBalanceMon: number;
  /** 该操作明确"不产生"的东西（如注册 agent 不产生金库/策略） */
  sideEffects?: string[];
  /** attest-guardrail 专有：策略文件名 / 两侧哈希 / 是否已一致 */
  policyFile?: string;
  attestedGuardrailHash?: string;
  onChainGuardrailHash?: string;
  inSync?: boolean;
}

export interface AdminResult {
  dryRun: boolean;
  preview?: AdminPreview;
  note?: string;
  error?: string;
  hint?: string;
  txHash?: string;
  status?: number;
  gasUsed?: string;
  vault?: VaultState;
  identity?: IdentityState;
  /** 注册路径专有：新分配的 agentId */
  newAgentId?: number;
  /** 注册路径专有：注册之后仍需人工完成的三件事（金库 / 策略 / 认证） */
  nextSteps?: string[];
}

function extractError(j: unknown): string | null {
  if (j && typeof j === "object" && "error" in j) return String((j as { error: unknown }).error);
  return null;
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
  const r = await postRaw<T>(path, body, ms);
  return r.ok ? r.data : null;
}

/**
 * 保留错误体的 POST。治理写接口的 400 里带着合约 revert 原因
 *（例如 "No change"），用 post() 会被吞成 null，页面上只剩"操作失败"。
 */
async function postRaw<T>(path: string, body: unknown, ms: number): Promise<{ ok: boolean; data: T | null }> {
  try {
    const r = await fetch(`${ORCH}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
      cache: "no-store",
    });
    const data = (await r.json().catch(() => null)) as T | null;
    return { ok: r.ok, data };
  } catch {
    return { ok: false, data: null };
  }
}

export const api = {
  config: (agentId = 1) => get<AegisConfig>(`/api/config?agentId=${agentId}`, 5_000),
  status: (agentId = 1) => get<LiveStatus>(`/api/status?agentId=${agentId}`, 8_000),
  receipts: (agentId = 1) => get<ChainReceipt[]>(`/api/receipts?agentId=${agentId}`, 30_000),
  /** 执行统计（收据聚合 + 链上 validation 直读）。慢：逐笔读 ValidationRegistry。 */
  execStats: (agentId = 1) => get<ExecStats>(`/api/exec-stats?agentId=${agentId}`, 60_000),
  decision: (digest: string) =>
    get<{ found: boolean; transcript?: Record<string, unknown> }>(`/api/decision/${digest}`, 8_000),

  /** 金库真实状态（余额/限额/日限用量/白名单标的余额） */
  vault: (agentId = 1) => get<VaultState>(`/api/vault?agentId=${agentId}`, 20_000),
  /** 全 agent 的金库清单：谁有金库、谁只有身份（链上读回比得出） */
  vaults: () => get<VaultListState>(`/api/vaults`, 60_000),
  /** ERC-8004 身份注册表真实读数 */
  agents: () => get<IdentityState>(`/api/agents`, 20_000),
  /** 策略文件 vs 链上已认证 guardrailHash */
  policy: (agentId = 1) => get<PolicyState>(`/api/policy?agentId=${agentId}`, 15_000),

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

  /**
   * 治理写操作（真实上链，owner 私钥在 orchestrator 侧）。
   * 调两次：先不带 confirm 拿 preview（零 gas，用于确认框展示预估费用），
   * 用户确认后再带 confirm:true 重发同一 body 才会广播。
   * 失败时返回带 error/hint 的对象而非 null，页面可显示合约的 revert 原因。
   */
  admin: async (op: string, body: Record<string, unknown>, expectRegister = false): Promise<AdminResult | null> => {
    const r = await postRaw<AdminResult>(expectRegister ? "/api/agents" : `/api/admin/${op}`, body, 180_000);
    if (r.data) return extractError(r.data) ? { ...r.data, dryRun: r.data.dryRun ?? true } : r.data;
    return null;
  },
};
