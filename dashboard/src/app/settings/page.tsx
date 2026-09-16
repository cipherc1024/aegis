"use client";

import { useState } from "react";
import { useL, useLang } from "@/lib/i18n";
import { SampleBanner } from "@/components/SampleBanner";
import { Wallet, Bell, Palette, Settings as Cog } from "lucide-react";

const GROUPS = [
  { key: "account", icon: Wallet, zh: "账户与安全", en: "Account & Security" },
  { key: "notify", icon: Bell, zh: "通知偏好", en: "Notifications" },
  { key: "display", icon: Palette, zh: "显示与偏好", en: "Display" },
  { key: "advanced", icon: Cog, zh: "高级与开发者", en: "Advanced" },
];

export default function SettingsPage() {
  const L = useL();
  const [active, setActive] = useState("account");

  return (
    <div>
      <h1 className="mb-4 text-lg font-semibold">{L("设置", "Settings")}</h1>
      <SampleBanner
        note={L(
          "本页为界面占位：开关、输入框均为本地状态，不读写链上或后端；显示的钱包地址、MAX_BLOCK_AGE / STALENESS_LIMIT / TEE 度量白名单是示意值，非实际配置。真实值见 aegis/contracts 与 aegis/.env。",
          "Placeholder UI: the toggles and inputs are local state only and read/write nothing on-chain or in the backend. The wallet address, MAX_BLOCK_AGE / STALENESS_LIMIT and TEE measurement allowlist shown are illustrative, not actual configuration. Real values live in aegis/contracts and aegis/.env."
        )}
      />
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
        {active === "account" && (
          <Section title={L("账户与安全", "Account & Security")}>
            <Item label={L("钱包", "Wallet")} hint={L("未连接", "not connected")} action={L("断开", "Disconnect")} />
            <Toggle label={L("提现白名单（时间锁）", "Withdrawal allowlist (timelock)")} defaultOn />
            <Toggle label={L("API Key 管理", "API key management")} />
            <Toggle label={L("会话管理", "Session management")} defaultOn />
          </Section>
        )}

        {active === "notify" && (
          <Section title={L("通知偏好", "Notifications")}>
            <Toggle label={L("冻结告警", "Freeze alerts")} defaultOn />
            <Toggle label={L("新鲜度警告", "Freshness warnings")} defaultOn />
            <Toggle label={L("拦截交易", "Blocked trades")} defaultOn />
            <Toggle label={L("提现完成", "Withdrawals")} />
            <div className="my-3 h-px bg-border-subtle" />
            <Toggle label={L("邮件", "Email")} />
            <Toggle label={L("Telegram", "Telegram")} defaultOn />
            <Toggle label={L("Webhook", "Webhook")} />
            <Field label="Webhook URL">
              <input className="inp mono" placeholder="https://…" />
            </Field>
          </Section>
        )}

        {active === "display" && (
          <Section title={L("显示与偏好", "Display")}>
            <Field label={L("语言", "Language")}>
              <LangSelect />
            </Field>
            <Field label={L("法币", "Fiat")}>
              <select className="inp">
                <option>USD</option>
                <option>CNY</option>
              </select>
            </Field>
            <Toggle label={L("显示哈希全文", "Show full hashes")} />
            <Toggle label={L("紧凑列表", "Compact lists")} />
          </Section>
        )}

        {active === "advanced" && (
          <Section title={L("高级与开发者", "Advanced")}>
            <Field label={L("网络", "Network")}>
              <select className="inp">
                <option>Monad Testnet · 10143</option>
                <option>Monad Mainnet · 143</option>
              </select>
            </Field>
            <Field label="RPC">
              <input className="inp mono" defaultValue="https://testnet-rpc.monad.xyz" />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="MAX_BLOCK_AGE">
                <input className="inp mono" defaultValue="—" />
              </Field>
              <Field label="STALENESS_LIMIT">
                <input className="inp mono" defaultValue="—" />
              </Field>
            </div>
            <Field label={L("TEE 度量白名单", "TEE measurement allowlist")}>
              <input className="inp mono" defaultValue="—" />
            </Field>
            <button className="rounded-lg border border-red/40 bg-red/5 px-3 py-2 text-xs font-medium text-red hover:bg-red/10">
              {L("导出私钥", "Export private key")}
            </button>
          </Section>
        )}
      </div>
      </div>

      <style jsx>{`
        .inp {
          width: 100%;
          background: var(--bg-input);
          border: 1px solid var(--border-base);
          border-radius: 8px;
          padding: 9px 12px;
          font-size: 13px;
          outline: none;
        }
        .inp:focus {
          border-color: rgba(0, 229, 204, 0.4);
        }
      `}</style>
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

function Item({ label, hint, action }: { label: string; hint: string; action: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border-subtle py-2.5 text-xs last:border-0">
      <div>
        <div className="text-secondary">{label}</div>
        <div className="mono text-[11px] text-muted">{hint}</div>
      </div>
      <button className="rounded-md border border-border-base px-2.5 py-1 text-[11px] text-tertiary hover:border-border-hover hover:text-secondary">
        {action}
      </button>
    </div>
  );
}

function Toggle({ label, defaultOn = false }: { label: string; defaultOn?: boolean }) {
  const [on, setOn] = useState(defaultOn);
  return (
    <button
      onClick={() => setOn((o) => !o)}
      className="flex w-full items-center justify-between border-b border-border-subtle py-2.5 text-xs last:border-0"
    >
      <span className="text-secondary">{label}</span>
      <span className={`relative h-5 w-9 rounded-full transition-colors ${on ? "bg-cyan" : "bg-input"}`}>
        <span
          className={`absolute top-0.5 h-4 w-4 rounded-full bg-base transition-all ${on ? "left-[18px]" : "left-0.5"}`}
        />
      </span>
    </button>
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
