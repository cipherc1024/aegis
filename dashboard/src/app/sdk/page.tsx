"use client";

import { useEffect, useState } from "react";
import { useL } from "@/lib/i18n";
import { api, type AegisConfig } from "@/lib/aegis";
import { Wrench, Copy, Check, ExternalLink } from "lucide-react";

const EXPLORER = "https://testnet.monadexplorer.com";

/**
 * 本页只列「现在就能调」的接口，不宣传 npm 上不存在的包。
 * 所有代码块都是可复制的真实调用（curl / node / 浏览器 fetch），
 * 端点取自 orchestrator 的公开只读面 + 治理写面（写面需二次确认）。
 */
export default function SdkPage() {
  const L = useL();
  const [cfg, setCfg] = useState<AegisConfig | null>(null);
  const [fetched, setFetched] = useState(false);

  useEffect(() => {
    void (async () => {
      setCfg(await api.config());
      setFetched(true);
    })();
  }, []);

  const vault = cfg?.contracts.vaultQuorum ?? "<VAULT_ADDRESS>";
  const registry = cfg?.contracts.receiptRegistry ?? "<REGISTRY_ADDRESS>";
  const offline = fetched && !cfg;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center gap-2">
        <Wrench className="h-5 w-5 text-cyan" />
        <h1 className="text-lg font-semibold">{L("接口与脚本", "Interfaces & Scripts")}</h1>
      </div>

      {offline && (
        <div className="card mb-4 border-amber/40 p-4 text-xs text-amber">
          {L(
            "orchestrator 不可达 —— 下面的地址占位符未被真实值替换。启动 node aegis/orchestrator/server.mjs 后可看到真实地址。",
            "orchestrator unreachable — the address placeholders below were not substituted. Start node aegis/orchestrator/server.mjs to see real addresses."
          )}
        </div>
      )}

      <div className="card mb-4 flex items-start gap-3 p-5">
        <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
        <div className="text-xs text-secondary">
          <div className="mb-1 text-sm text-primary">{L("没有 @aegis/sdk 这个包", "There is no @aegis/sdk package")}</div>
          {L(
            "Aegis 目前不发布 npm SDK。对外可用的真实接口是：① orchestrator 的 HTTP API（只读端点 + 需二次确认的治理写端点）；② aegis/scripts/ 下的脚本（负例、口径守卫、指数器、演示）。下面每一段都可以直接复制运行。",
            "Aegis does not publish an npm SDK. The real interfaces are: (1) the orchestrator HTTP API (read-only endpoints plus governance writes gated by two-phase confirm); (2) the scripts under aegis/scripts/ (negative cases, parity guard, indexer, demos). Every snippet below is directly runnable."
          )}
        </div>
      </div>

      <Section title={L("① 只读：查当前状态（零 gas）", "① Read: current status (zero gas)")}>
        <Code
          lang="bash"
          code={`# orchestrator 默认监听 :8787
curl -s localhost:8787/api/status?agentId=1 | jq .
# → { online, currentBlock, lastReceiptBlock, fresh, receiptHash, guardrailHash, executionHash, llm, agentId }

curl -s localhost:8787/api/config?agentId=1 | jq .contracts
# → 合约地址（ReceiptRegistry / IdentityRegistry / ValidationRegistry / vaultQuorum / quoteService）

curl -s localhost:8787/api/vault?agentId=1 | jq '{address, owner, balanceMonHuman, perTxLimit, dailyLimit, trustedValidatorCount}'
curl -s "localhost:8787/api/exec-stats?agentId=1" | jq '{tradesSubmitted, validated, pendingValidation}'`}
        />
      </Section>

      <Section title={L("② 零 gas 预演：LLM 会提出什么 + 双侧裁决", "② Dry preview: what the LLM proposes + two-sided verdict")}>
        <Code
          lang="bash"
          code={`# 双 LLM 管线的预览（不签名、不上链）
curl -s "localhost:8787/api/pipeline?command=buy%20WMON%200.01" | jq '{kind, intent, guardrail, pace, deltaVerdict}'

# proposer 预览 vs challenger 独立重推导（两套实现，这里比对结论）
curl -s -X POST localhost:8787/api/verify \\
  -H 'content-type: application/json' \\
  -d '{"command":"buy WMON 0.01"}' | jq '{resolvedBy, proposer, challenger, agree}'

# 真实全链（会花钱；dryRun 省略时默认 true 是安全的）
curl -s -X POST "localhost:8787/api/agent/command?agentId=1" \\
  -H 'content-type: application/json' \\
  -d '{"command":"buy WMON 0.01"}' | jq '{decision, dryRun, target, amount}'`}
        />
      </Section>

      <Section title={L("③ 独立验证：不信任 Aegis 也能验收据", "③ Independent verification: verify a receipt without trusting Aegis")}>
        <Code
          lang="bash"
          code={`# 任何人拿公共 RPC 就能重算整条绑定链：digest = keccak(agentId, pdrHash,
# guardrailHash, executionHash, blockHeight, blockHash, prev, nonce)
# 见 aegis/scripts/parity-check.mjs 与 challenger/verify.mjs（自包含，不 import proposer）

# 读某条收据绑定的决策原文（challenger 拉它做重推导；拉不到即拒绝）
curl -s localhost:8787/api/decision/<receiptHash> | jq .

# 收据索引（链上历史，deep history）
curl -s localhost:8787/api/receipts?agentId=1 | jq '.[0]'`}
        />
      </Section>

      <Section title={L("④ 治理写操作：两步协议（先报价，再广播）", "④ Governance writes: two-phase protocol (quote, then broadcast)")}>
        <Code
          lang="bash"
          code={`# 第一步：不带 confirm → 只做 estimateGas，返回预估费用（零 gas、零广播）
curl -s -X POST localhost:8787/api/admin/set-limits \\
  -H 'content-type: application/json' \\
  -d '{"perTxLimitMon":"0.05","dailyLimitMon":"1"}' | jq '{gasLimit, estimatedFeeMon, signerBalanceMon}'

# 第二步：确认上面的预估后，带 confirm:true 重发同一 body 才会真实上链
# curl -s -X POST localhost:8787/api/admin/set-limits \\
#   -H 'content-type: application/json' \\
#   -d '{"perTxLimitMon":"0.05","dailyLimitMon":"1","confirm":true}'

# 注册新 agent（permissionless，任何人可调；agentId 会真实增长）
curl -s -X POST localhost:8787/api/agents \\
  -H 'content-type: application/json' \\
  -d '{"name":"My Agent","description":"..."}' | jq .`}
        />
      </Section>

      <Section title={L("⑤ 浏览器内直读链上（不经过 orchestrator）", "⑤ Direct on-chain reads from the browser (bypassing the orchestrator)")}>
        <Code
          lang="javascript"
          code={`// /verify 页就是这么做的：用公共 RPC + ethers 在浏览器里直读，不信任本服务
import { JsonRpcProvider, Contract } from 'ethers'

const provider = new JsonRpcProvider('https://testnet-rpc.monad.xyz')
const vault = new Contract('${vault}', [
  'function owner() view returns (address)',
  'function tradingFrozen() view returns (bool)',
  'function perTxLimit() view returns (uint256)',
  'function isTrustedValidator(address) view returns (bool)',
], provider)

console.log(await vault.owner(), await vault.tradingFrozen())

// ReceiptRegistry: 收据哈希链头与交易槽（钩子读的是 lastTradeReceipt）
const reg = new Contract('${registry}', [
  'function lastReceiptHash(uint256 agentId) view returns (bytes32)',
  'function lastTradeReceipt(uint256 agentId) view returns (bytes32)',
], provider)
console.log(await reg.lastReceiptHash(1n))`}
        />
      </Section>

      {cfg?.contracts.vaultQuorum && (
        <a
          href={`${EXPLORER}/address/${cfg.contracts.vaultQuorum}`}
          target="_blank"
          rel="noreferrer"
          className="mt-2 inline-flex items-center gap-1.5 text-[11px] text-cyan hover:underline"
        >
          <ExternalLink className="h-3 w-3" />
          {L("金库合约已在 Tenderly 源码级公开验证（匿名可查）", "Vault contract is source-verified on Tenderly (publicly viewable)")}
        </a>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <div className="mb-2 text-sm">{title}</div>
      {children}
    </div>
  );
}

function Code({ code, lang }: { code: string; lang: string }) {
  const L = useL();
  const [copied, setCopied] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(code).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          });
        }}
        className="absolute right-2 top-2 flex items-center gap-1 rounded-md border border-border-base bg-base px-2 py-1 text-[10px] text-tertiary hover:border-border-hover hover:text-secondary"
      >
        {copied ? <Check className="h-3 w-3 text-green" /> : <Copy className="h-3 w-3" />}
        {copied ? L("已复制", "copied") : L("复制", "copy")}
      </button>
      <pre className="mono overflow-x-auto rounded-lg border border-border-base bg-base p-4 text-[12px] leading-relaxed text-secondary">
        <code>{code}</code>
      </pre>
      <span className="mono absolute bottom-2 right-3 text-[10px] text-muted">{lang}</span>
    </div>
  );
}
