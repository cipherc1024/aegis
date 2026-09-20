"use client";

import { useEffect, useState } from "react";
import { useL, useLang } from "@/lib/i18n";
import { api, type AegisConfig, type LiveStatus } from "@/lib/aegis";
import { shortAddr } from "@/lib/mock";
import { Wallet, Bell, Palette, Settings as Cog, RefreshCw, ExternalLink } from "lucide-react";

type GroupKey = "runtime" | "display" | "notify" | "immutable";

// 导航分组用图标，与内容一一对应。
const GROUPS: { key: GroupKey; icon: typeof Wallet; zh: string; en: string }[] = [
  { key: "runtime", icon: Wallet, zh: "连接与链", en: "Connection & Chain" },
  { key: "display", icon: Palette, zh: "显示与偏好", en: "Display" },
  { key: "notify", icon: Bell, zh: "通知能力", en: "Notifications" },
  { key: "immutable", icon: Cog, zh: "固定参数（链上/进程）", en: "Fixed parameters" },
];

const EXPLORER = "https://testnet.monadexplorer.com";

export default function SettingsPage() {
  const L = useL();
  const [active, setActive] = useState<GroupKey>("runtime");
  const [cfg, setCfg] = useState<AegisConfig | null>(null);
  const [st, setSt] = useState<LiveStatus | null>(null);
  const [fetched, setFetched] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const [c, s] = await Promise.all([api.config(), api.status()]);
    setCfg(c);
    setSt(s);
    setLoading(false);
    setFetched(true);
  }
  useEffect(() => {
    void load();
  }, []);

  const offline = fetched && !cfg;
  const llm = st?.llm ?? null;

  return (
    <div>
      <div className="mb-4 flex items-center gap-3">
        <h1 className="text-lg font-semibold">{L("设置与运行环境", "Settings & Runtime")}</h1>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border-base px-2.5 py-1 text-[11px] text-tertiary hover:border-border-hover hover:text-secondary"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {L("刷新", "refresh")}
        </button>
      </div>

      {offline && (
        <div className="card mb-4 border-red/40 p-4 text-xs text-red">
          {L(
            "orchestrator 不可达 —— 本页不显示任何占位数字。请先启动 node aegis/orchestrator/server.mjs。",
            "orchestrator unreachable — no placeholder numbers are shown. Start aegis/orchestrator/server.mjs first."
          )}
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[200px_1fr]">
        {/* sub nav */}
        <div className="card h-fit p-2">
          {GROUPS.map((g) => {
            const Icon = g.icon;
            return (
              <button
                key={g.key}
                onClick={() => setActive(g.key)}
                className={`mb-0.5 flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                  active === g.key ? "bg-hover text-primary" : "text-secondary hover:bg-hover"
                }`}
              >
                <Icon className={`h-3.5 w-3.5 ${active === g.key ? "text-cyan" : ""}`} />
                {L(g.zh, g.en)}
              </button>
            );
          })}
        </div>

        {/* content */}
        <div className="card p-5">
          {active === "runtime" && (
            <Section title={L("连接与链（真实读数）", "Connection & chain (live reads)")}>
              <Row
                label={L("网络", "Network")}
                value={cfg ? `${cfg.chain.name} · chainId ${cfg.chain.chainId}` : "—"}
              />
              <Row label="RPC" value={L("由 orchestrator 侧 FallbackProvider 持有（不在浏览器暴露）", "held by the orchestrator-side FallbackProvider (not exposed to the browser)")} mono={false} />
              <Row label={L("当前区块", "Current block")} value={st ? String(st.currentBlock) : "—"} />
              <Row label={L("agentId", "agentId")} value={cfg ? String(cfg.agentId) : "—"} />
              <Row
                label={L("orchestrator", "orchestrator")}
                value={st?.online ? L("在线", "online") : L("离线", "offline")}
                tone={st?.online ? "text-green" : "text-red"}
              />
              <Row label={L("最近收据区块", "Last receipt block")} value={st ? String(st.lastReceiptBlock) : "—"} />
              <Row
                label={L("新鲜度", "Freshness")}
                value={st ? (st.fresh ? L("新鲜", "fresh") : L("陈旧", "stale")) : "—"}
                tone={st ? (st.fresh ? "text-green" : "text-amber") : ""}
              />
              <p className="mt-3 text-[11px] text-tertiary">
                {L(
                  "本页不放「连接/断开钱包」按钮：dashboard 是只读渲染器，不持有任何密钥，也从不代表你签名。需要动钱的操作走运营页的二次确认（owner 私钥在 orchestrator 侧）。",
                  "There is no connect/disconnect wallet button here: the dashboard is a read-only renderer, holds no keys, and never signs on your behalf. Money-moving actions go through the two-phase confirm on the operations pages (owner key lives on the orchestrator side)."
                )}
              </p>
            </Section>
          )}

          {active === "display" && (
            <Section title={L("显示与偏好", "Display")}>
              <Field label={L("语言", "Language")}>
                <LangSelect />
              </Field>
              <p className="mt-3 text-[11px] text-tertiary">
                {L(
                  "语言是真实生效的设置（i18n store，仅存于本地浏览器）。其余偏好项（显示哈希全文、紧凑列表）尚无实现，故不提供开关。",
                  "Language is a real setting (i18n store, browser-local). Other preferences (full hashes, compact lists) are not implemented, so no toggles are offered."
                )}
              </p>
            </Section>
          )}

          {active === "notify" && (
            <Section title={L("通知能力（当前形态）", "Notification capability (current)")}>
              <Row label={L("通知页数据源", "Notifications page source")} value={L("/api/events（SSE 实时事件流）", "/api/events (SSE live stream)")} />
              <Row label={L("邮件", "Email")} value={L("未实现", "not implemented")} tone="text-tertiary" />
              <Row label={L("Telegram", "Telegram")} value={L("未实现", "not implemented")} tone="text-tertiary" />
              <Row label={L("Webhook", "Webhook")} value={L("未实现", "not implemented")} tone="text-tertiary" />
              <p className="mt-3 text-[11px] text-tertiary">
                {L(
                  "Aegis 目前不发送任何外部通知：没有邮件/Telegram/Webhook 的发信后端。真实可用的实时信号是 orchestrator 的 SSE 事件流（/api/events），通知页即消费它。",
                  "Aegis sends no external notifications today: there is no email/Telegram/Webhook delivery backend. The real-time signal available is the orchestrator SSE stream (/api/events), which the notifications page consumes."
                )}
              </p>
            </Section>
          )}

          {active === "immutable" && (
            <Section title={L("固定参数（链上/进程，本页只读）", "Fixed parameters (on-chain/process, read-only)")}>
              <Row label={L("收据合约", "ReceiptRegistry")} value={cfg?.contracts.receiptRegistry ?? "—"} mono addr />
              <Row label={L("身份注册表", "IdentityRegistry")} value={cfg?.contracts.identityRegistry ?? "—"} mono addr />
              <Row label={L("验证注册表", "ValidationRegistry")} value={cfg?.contracts.validationRegistry ?? "—"} mono addr />
              <Row label={L("金库（quorum）", "Vault (quorum)")} value={cfg?.contracts.vaultQuorum ?? "—"} mono addr />
              <Row label={L("Quote 服务", "Quote service")} value={cfg?.contracts.quoteService ?? "—"} mono addr />
              <div className="my-3 h-px bg-border-subtle" />
              <Row label={L("每笔限额", "Per-tx limit")} value={cfg ? `${cfg.policy.perTxLimitMon} MON` : "—"} />
              <Row label={L("演示上限", "Demo cap")} value={cfg ? `${cfg.policy.demoMaxMon} MON` : "—"} />
              <Row label="LLM" value={llm ? `${llm.mode} · ${llm.model ?? "—"}` : "—"} />
              <Row
                label={L("跨家族挑战模型", "Cross-family challenger model")}
                value={llm ? (llm.crossFamily ? llm.challengerModel ?? "—" : L("未启用", "disabled")) : "—"}
                tone={llm?.crossFamily ? "text-cyan" : "text-tertiary"}
              />
              <p className="mt-3 text-[11px] text-tertiary">
                {L(
                  "这些值全部由链上合约与 orchestrator 进程决定，dashboard 无法修改（也无「导出私钥」这类入口——私钥不在浏览器侧）。改策略走策略编辑器页；改限额走 owner 治理流程。",
                  "All of these are decided by the on-chain contracts and the orchestrator process; the dashboard cannot change them (and there is no 'export private key' entry — keys are never in the browser). Change policy on the Policy Editor page; change limits via the owner governance flow."
                )}
              </p>
              {cfg?.contracts.vaultQuorum && (
                <a
                  href={`${EXPLORER}/address/${cfg.contracts.vaultQuorum}`}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-cyan hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  {L("在区块浏览器核验金库地址", "Verify vault address on explorer")}
                </a>
              )}
            </Section>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-4 text-sm font-medium">{title}</div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  tone = "text-secondary",
  mono = true,
  addr = false,
}: {
  label: string;
  value: string;
  tone?: string;
  mono?: boolean;
  addr?: boolean;
}) {
  const shown = addr && /^0x[0-9a-fA-F]{40}$/.test(value) ? shortAddr(value) : value;
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border-subtle py-2.5 text-xs last:border-0">
      <span className="shrink-0 text-tertiary">{label}</span>
      <span className={`${mono ? "mono" : ""} truncate text-right ${tone}`} title={value}>
        {shown}
      </span>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="mt-3 block">
      <span className="mb-1.5 block text-xs text-tertiary">{label}</span>
      {children}
    </label>
  );
}

function LangSelect() {
  const lang = useLang((s) => s.lang);
  const setLang = useLang((s) => s.setLang);
  return (
    <select className="inp" value={lang} onChange={(e) => setLang(e.target.value as "zh" | "en")}>
      <option value="zh">中文</option>
      <option value="en">English</option>
    </select>
  );
}
