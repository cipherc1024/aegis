import {
  createPublicClient,
  http,
  defineChain,
  parseAbiItem,
  type Hex,
} from "viem";
import type { Receipt } from "./mock";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: ["https://testnet-rpc.monad.xyz"] } },
});

export const client = createPublicClient({
  chain: monadTestnet,
  transport: http(process.env.NEXT_PUBLIC_RPC_URL || undefined),
});

// 已部署（Monad testnet 10143）——见 aegis/dcap-verifier/STATUS.md
// registry 为 Phase 2 v2（bindTranscript + MAX_BLOCK_AGE=100），
// 旧地址 0x91482e67… 已废弃，勿改回。
export const ADDR = {
  registry: (process.env.NEXT_PUBLIC_REGISTRY ||
    "0x4622D041696942dC873a8A5E54f1e1ca9669c90B") as `0x${string}`,
  gate: (process.env.NEXT_PUBLIC_DCAP_GATE ||
    "0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F") as `0x${string}`,
  verifier: "0x0eb496471d638173cdF35bE6b0e54FE035289F1f" as `0x${string}`,
  vaultQuorum: (process.env.NEXT_PUBLIC_QUORUM_VAULT ||
    "0xe6E24BB72a4a327b7A7E7aA025A04eBc5a6533D7") as `0x${string}`,
} as const;

// 与 ReceiptRegistry.MAX_BLOCK_AGE 保持一致（合约常量，改合约需同步这里）
export const MAX_BLOCK_AGE = 100n;

const LATEST_RECEIPT_ABI = {
  name: "latestReceipt",
  type: "function",
  stateMutability: "view",
  inputs: [{ name: "agentId", type: "uint256" }],
  outputs: [
    { name: "digest", type: "bytes32" },
    { name: "pdrHash", type: "bytes32" },
    { name: "guardrailHash", type: "bytes32" },
    { name: "executionHash", type: "bytes32" },
    { name: "blockHeight", type: "uint256" },
    { name: "blockHash", type: "bytes32" },
    { name: "submitBlock", type: "uint256" },
    { name: "nonce", type: "bytes32" },
    { name: "quoteHash", type: "bytes32" },
    { name: "isHeartbeat", type: "bool" },
    { name: "timestamp", type: "uint256" },
  ],
} as const;

const RECEIPT_EVENT = parseAbiItem(
  "event ReceiptSubmitted(uint256 indexed agentId, bytes32 receiptHash, uint256 blockHeight, bool isHeartbeat)"
);

export interface ChainStatus {
  online: boolean;
  currentBlock: number;
  lastReceiptBlock: number;
  fresh: boolean;
  alive: boolean;
}

export async function getStatus(agentId: bigint): Promise<ChainStatus> {
  try {
    const [currentBlock, latest, fresh, alive] = await Promise.all([
      client.getBlockNumber(),
      client.readContract({
        address: ADDR.registry,
        abi: [LATEST_RECEIPT_ABI],
        functionName: "latestReceipt",
        args: [agentId],
      }) as Promise<readonly unknown[]>,
      client.readContract({
        address: ADDR.registry,
        abi: [{ name: "isTradeFresh", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bool" }] }],
        functionName: "isTradeFresh",
        args: [agentId],
      }) as Promise<boolean>,
      client.readContract({
        address: ADDR.registry,
        abi: [{ name: "isAlive", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "uint256" }], outputs: [{ type: "bool" }] }],
        functionName: "isAlive",
        args: [agentId, 60n],
      }) as Promise<boolean>,
    ]);
    const blockHeight = Number(latest[4] as bigint);
    return {
      online: true,
      currentBlock: Number(currentBlock),
      lastReceiptBlock: blockHeight,
      fresh,
      alive,
    };
  } catch {
    return { online: false, currentBlock: 0, lastReceiptBlock: 0, fresh: false, alive: false };
  }
}

export interface ChainReceipt {
  receiptHash: Hex;
  blockHeight: number;
  isHeartbeat: boolean;
  txHash: Hex;
}

export async function getReceipts(agentId: bigint, lookback = 200000n): Promise<ChainReceipt[]> {
  try {
    const latest = await client.getBlockNumber();
    const from = latest > lookback ? latest - lookback : 0n;
    const logs = await client.getLogs({
      address: ADDR.registry,
      event: RECEIPT_EVENT,
      args: { agentId },
      fromBlock: from,
      toBlock: "latest",
    });
    return logs
      .map((l) => ({
        receiptHash: l.args.receiptHash as Hex,
        blockHeight: Number(l.args.blockHeight),
        isHeartbeat: Boolean(l.args.isHeartbeat),
        txHash: l.transactionHash,
      }))
      .reverse();
  } catch {
    return [];
  }
}

export type CheckState = "pass" | "fail" | "pending";
export interface VerifyCheck {
  key: string;
  labelZh: string;
  labelEn: string;
  detail: string;
  state: CheckState;
}

/** 独立验证：全部在浏览器用公共 RPC 完成 */
export async function verifyLatest(agentId: bigint): Promise<VerifyCheck[]> {
  const checks: VerifyCheck[] = [];
  const push = (c: VerifyCheck) => checks.push(c);

  let rec: readonly unknown[];
  try {
    rec = (await client.readContract({
      address: ADDR.registry,
      abi: [LATEST_RECEIPT_ABI],
      functionName: "latestReceipt",
      args: [agentId],
    })) as readonly unknown[];
  } catch {
    return [
      { key: "rpc", labelZh: "RPC 连接", labelEn: "RPC connection", detail: "无法读取合约", state: "fail" },
    ];
  }

  const digest = rec[0] as Hex;
  const guardrailHash = rec[2] as Hex;
  const blockHeight = rec[4] as bigint;
  const blockHash = rec[5] as Hex;

  // 1) 新鲜度
  try {
    const current = await client.getBlockNumber();
    const delta = current - blockHeight;
    push({
      key: "freshness",
      labelZh: "新鲜度检查",
      labelEn: "Freshness",
      detail: `block.number − blockHeight = ${delta} (≤ ${MAX_BLOCK_AGE})`,
      state: delta <= MAX_BLOCK_AGE ? "pass" : "fail",
    });
  } catch {
    push({ key: "freshness", labelZh: "新鲜度检查", labelEn: "Freshness", detail: "读取区块高度失败", state: "pending" });
  }

  // 2) 区块哈希绑定
  try {
    const blk = await client.getBlock({ blockNumber: blockHeight });
    push({
      key: "blockhash",
      labelZh: "区块哈希绑定",
      labelEn: "Block hash binding",
      detail: blk.hash === blockHash ? "blockhash(blockHeight) == 收据哈希" : "不匹配",
      state: blk.hash === blockHash ? "pass" : "fail",
    });
  } catch {
    push({ key: "blockhash", labelZh: "区块哈希绑定", labelEn: "Block hash binding", detail: "读取区块失败", state: "pending" });
  }

  // 3) 哈希链连续性（链头一致）
  try {
    const head = (await client.readContract({
      address: ADDR.registry,
      abi: [{ name: "lastReceiptHash", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bytes32" }] }],
      functionName: "lastReceiptHash",
      args: [agentId],
    })) as Hex;
    push({
      key: "chain",
      labelZh: "哈希链连续性",
      labelEn: "Hash chain",
      detail: head === digest ? "链头 == 最新收据摘要" : "链头不一致",
      state: head === digest ? "pass" : "fail",
    });
  } catch {
    push({ key: "chain", labelZh: "哈希链连续性", labelEn: "Hash chain", detail: "读取链头失败", state: "pending" });
  }

  // 4) 护栏哈希匹配
  try {
    const reg = (await client.readContract({
      address: ADDR.registry,
      abi: [{ name: "agentGuardrailHash", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }], outputs: [{ type: "bytes32" }] }],
      functionName: "agentGuardrailHash",
      args: [agentId],
    })) as Hex;
    push({
      key: "guardrail",
      labelZh: "护栏哈希匹配",
      labelEn: "Guardrail hash",
      detail: reg === guardrailHash ? "匹配注册护栏" : "不匹配",
      state: reg === guardrailHash ? "pass" : "fail",
    });
  } catch {
    push({ key: "guardrail", labelZh: "护栏哈希匹配", labelEn: "Guardrail hash", detail: "读取失败", state: "pending" });
  }

  // 5) nonce 防重放：链上 usedNonces
  try {
    const nonce = rec[7] as Hex;
    const quoteHash = rec[8] as Hex;
    const used = (await client.readContract({
      address: ADDR.registry,
      abi: [{ name: "usedNonces", type: "function", stateMutability: "view", inputs: [{ type: "uint256" }, { type: "bytes32" }], outputs: [{ type: "bool" }] }],
      functionName: "usedNonces",
      args: [agentId, nonce],
    })) as boolean;
    push({
      key: "nonce",
      labelZh: "Nonce 防重放",
      labelEn: "Nonce anti-replay",
      detail: used ? "usedNonces[agentId][nonce] == true" : "nonce 未标记",
      state: used ? "pass" : "fail",
    });

    const zero = "0x" + "0".repeat(64);
    push({
      key: "dcap",
      labelZh: "DCAP 承诺",
      labelEn: "DCAP commitment",
      detail:
        quoteHash !== zero
          ? `链上 quoteHash=${quoteHash.slice(0, 10)}…（可 DcapGate.check 复验）`
          : "该收据无 quote 工件",
      state: quoteHash !== zero ? "pass" : "pending",
    });
  } catch {
    push({ key: "nonce", labelZh: "Nonce 防重放", labelEn: "Nonce anti-replay", detail: "读取失败", state: "pending" });
  }

  return checks;
}

const RICH_EVENT = parseAbiItem(
  "event ReceiptSubmitted(uint256 indexed agentId, bytes32 indexed receiptHash, uint256 blockHeight, bytes32 executionHash, bytes32 pdrHash, bytes32 guardrailHash, bytes32 nonce, bytes32 quoteHash, bool isHeartbeat)"
);

/** 从链上富化事件重建收据流（分窗口查询规避 getLogs 范围限制） */
export async function getReceiptViews(
  agentId: bigint,
  windows = 6,
  window = 5000n
): Promise<Receipt[]> {
  try {
    const latest = await client.getBlockNumber();
    let logs: { args: unknown }[] = [];
    for (let i = 0; i < windows; i++) {
      const to = latest - BigInt(i) * window;
      if (to <= 0n) break;
      const from = to > window ? to - window + 1n : 0n;
      try {
        logs = (await client.getLogs({
          address: ADDR.registry,
          event: RICH_EVENT,
          args: { agentId },
          fromBlock: from,
          toBlock: to,
        })) as unknown as typeof logs;
      } catch {
        continue;
      }
      if (logs.length) break;
    }
    return logs
      .map((l) => {
        const a = l.args as unknown as {
          receiptHash: Hex;
          blockHeight: bigint;
          executionHash: Hex;
          guardrailHash: Hex;
          nonce: Hex;
          isHeartbeat: boolean;
        };
        const id = a.receiptHash.slice(2, 6);
        return {
          id,
          type: (a.isHeartbeat ? "heartbeat" : "trade") as Receipt["type"],
          action: a.isHeartbeat ? "心跳" : "交易",
          blockHeight: Number(a.blockHeight),
          blockHash: "—",
          executionHash: a.executionHash,
          nonce: a.nonce,
          guardrailHash: a.guardrailHash,
          prevReceiptHash: "—",
          receiptHash: a.receiptHash,
          isHeartbeat: a.isHeartbeat,
          timestamp: Date.now(),
        };
      })
      .reverse();
  } catch {
    return [];
  }
}
