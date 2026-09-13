import Link from "next/link";
import { ShieldCheck, ScanSearch, Lock, Activity, Ban, type LucideIcon } from "lucide-react";
import { AnimatedNumber } from "@/components/motion";

const STATS: {
  label: string;
  icon: LucideIcon;
  tone: string;
  value?: string;
  count?: number;
}[] = [
  { label: "累计验证收据", count: 12480, icon: ShieldCheck, tone: "text-cyan" },
  { label: "平台 TVL", value: "$4.82M", icon: Lock, tone: "text-green" },
  { label: "运行中 Agent", count: 37, icon: Activity, tone: "text-purple" },
  { label: "拦截攻击", count: 219, icon: Ban, tone: "text-red" },
];

const RECEIPTS = [
  { id: "1046", action: "买入 MON", amount: "0.5 MON", block: 61753445, tone: "green" },
  { id: "1045", action: "拦截 $SCAM", amount: "拒绝", block: 61753440, tone: "red" },
  { id: "1044", action: "卖出 USDC", amount: "120 USDC", block: 61753433, tone: "green" },
];

export default function LandingPage() {
  return (
    <div className="mx-auto max-w-5xl">
      {/* Hero */}
      <section className="py-16 text-center">
        <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-border-base bg-card px-3 py-1 text-xs text-secondary">
          <ShieldCheck className="h-3.5 w-3.5 text-cyan" />
          基于 TEE 的可验证自主交易 Agent
        </div>
        <h1 className="bg-gradient-to-r from-primary to-cyan bg-clip-text text-5xl font-semibold tracking-tight text-transparent">
          Agent 必须证明它听话了。
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-secondary">
          每一笔交易、每一次拒绝、每一次心跳，都附带一张绑定 Monad 区块高度的 TEE 收据——任何人可独立验证。
        </p>
        <div className="mt-8 flex items-center justify-center gap-3">
          <Link
            href="/market"
            className="rounded-lg bg-cyan px-5 py-2.5 text-sm font-medium text-base hover:opacity-90"
          >
            浏览 Agent 市场
          </Link>
          <Link
            href="/verify"
            className="flex items-center gap-1.5 rounded-lg border border-border-base px-5 py-2.5 text-sm text-primary hover:border-border-hover"
          >
            <ScanSearch className="h-4 w-4" />
            独立验证器
          </Link>
        </div>
      </section>

      {/* Stats */}
      <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {STATS.map((s) => {
          const Icon = s.icon;
          return (
            <div key={s.label} className="card card-hover p-4">
              <Icon className={`h-4 w-4 ${s.tone}`} />
              <div className="mono mt-3 text-2xl font-semibold">
                {s.count !== undefined ? <AnimatedNumber value={s.count} /> : s.value}
              </div>
              <div className="mt-1 text-xs text-tertiary">{s.label}</div>
            </div>
          );
        })}
      </section>

      {/* Live receipts */}
      <section className="mt-8">
        <div className="mb-3 flex items-center gap-2 text-sm text-secondary">
          <span className="h-2 w-2 rounded-full bg-green dot-pulse" />
          实时收据流
        </div>
        <div className="space-y-2">
          {RECEIPTS.map((r) => (
            <div key={r.id} className="card card-hover flex items-center gap-3 p-3">
              <span
                className={`h-6 w-[3px] rounded-full ${r.tone === "red" ? "bg-red" : "bg-green"}`}
              />
              <span className="mono text-xs text-muted">#{r.id}</span>
              <span className="text-sm">{r.action}</span>
              <span className="mono text-xs text-secondary">{r.amount}</span>
              <span className="mono ml-auto text-xs text-muted">block {r.block}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
