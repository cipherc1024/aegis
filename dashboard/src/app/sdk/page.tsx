"use client";

import { useL } from "@/lib/i18n";
import { SampleBanner } from "@/components/SampleBanner";
import { Wrench } from "lucide-react";

function Code({ children }: { children: string }) {
  return (
    <pre className="mono overflow-x-auto rounded-lg border border-border-base bg-base p-4 text-[12px] leading-relaxed text-secondary">
      <code>{children}</code>
    </pre>
  );
}

export default function SdkPage() {
  const L = useL();
  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center gap-2">
        <Wrench className="h-5 w-5 text-cyan" />
        <h1 className="text-lg font-semibold">{L("Aegis SDK（规划中）", "Aegis SDK (planned)")}</h1>
      </div>

      <SampleBanner
        note={L(
          "SDK 尚未发布：下方代码块是规划的 API 形态示意，npm 上不存在 @aegis/sdk，也无法安装。当前可用的真实接口是 orchestrator HTTP API（POST /api/agent/command、GET /api/receipts）与 scripts/ 下的脚本。",
          "The SDK is not published: the snippets below are illustrative of a planned API; @aegis/sdk does not exist on npm and cannot be installed. The real interfaces available today are the orchestrator HTTP API (POST /api/agent/command, GET /api/receipts) and the scripts under scripts/."
        )}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div>
          <div className="mb-2 text-sm">{L("安装 + 初始化 Agent（示意，未发布）", "Install + initialize agent (illustrative, unpublished)")}</div>
          <Code>{`// 规划形态，尚未发布到 npm
import { AegisAgent } from '@aegis/sdk'

const agent = await AegisAgent.create({
  policy: { perTxLimit: 1e18n, dailyLimit: 5e18n },
  tee: true,            // 在 Phala TDX 内运行
})`}</Code>
        </div>

        <div>
          <div className="mb-2 text-sm">{L("执行交易 + 独立验证（示意，未发布）", "Execute + independently verify (illustrative, unpublished)")}</div>
          <Code>{`const receipt = await agent.execute({
  action: 'buy', asset: 'MON', amount: 0.1,
})

// 任何人可在浏览器验证，无需信任 Aegis
import { verifyReceipt } from '@aegis/sdk'
const { fresh, bound, dcap } = await verifyReceipt(receipt.id)`}</Code>
        </div>
      </div>

      <div className="card mt-4 p-5">
        <div className="mb-3 text-sm">{L("规划能力（尚未提供）", "Planned capabilities (not yet available)")}</div>
        <ul className="grid grid-cols-1 gap-2 text-xs text-secondary sm:grid-cols-2">
          {[
            L("创建/管理 Agent（ERC-8004 身份）", "Create/manage agents (ERC-8004)"),
            L("typed intent + PACE 策略验证", "typed intent + PACE policy verify"),
            L("生成 TDX quote 并上链收据", "generate TDX quote + on-chain receipts"),
            L("客户端独立验证（新鲜度/链/DCAP）", "client-side verify (freshness/chain/DCAP)"),
            L("订阅收据流（WS）", "subscribe to receipt stream (WS)"),
            L("审计导出（CSV/JSON）", "audit export (CSV/JSON)"),
          ].map((c) => (
            <li key={c} className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-muted" />
              {c}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
