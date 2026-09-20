"use client";

import { useEffect, useState } from "react";
import { useL } from "@/lib/i18n";
import { api, type VaultState, type AegisConfig } from "@/lib/aegis";
import { Users, RefreshCw, ExternalLink, ShieldCheck } from "lucide-react";
import { fmtMon } from "@/components/ConfirmTx";

const EXPLORER = "https://testnet.monadexplorer.com";

/**
 * 子账户在本系统里的真实对应物 = 链上「角色地址」，不是独立的资金账户：
 *   owner（治理）/ teeDerived（执行）/ challenger（裁决）三者权限正交，
 *   但它们共享同一个金库余额——没有 per-role 的子余额。
 * 本页如实列出这三个地址及其链上权限，并给出真实余额；不编造「$11,418 总资产」。
 */
export default function SubaccountsPage() {
  const L = useL();
  const [vault, setVault] = useState<VaultState | null>(null);
  const [ident, setIdent] = useState<AegisConfig | null>(null);
  const [fetched, setFetched] = useState(false);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    const [v, c] = await Promise.all([api.vault(1), api.config()]);
    setVault(v);
    setIdent(c);
    setLoading(false);
    setFetched(true);
  }
  useEffect(() => {
    void load();
  }, []);

  const offline = fetched && !vault;

  return (
    <div className="mx-auto max-w-4xl">
      <div className="mb-5 flex items-center gap-3">
        <Users className="h-5 w-5 text-cyan" />
        <h1 className="text-lg font-semibold">{L("账户与角色", "Accounts & Roles")}</h1>
        <button
          type="button"
          onClick={() => void load()}
          className="ml-auto flex items-center gap-1.5 rounded-md border border-border-base px-2.5 py-1 text-[11px] text-tertiary hover:border-border-hover hover:text-secondary"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          {L("刷新", "refresh")}
        </button>
      </div>

      {offline ? (
        <div className="card border-red/40 p-4 text-xs text-red">
          {L("orchestrator 不可达 —— 本页不显示任何占位数字。", "orchestrator unreachable — no placeholder numbers shown.")}
        </div>
      ) : !vault ? (
        <div className="card p-4 text-xs text-tertiary">{L("读取链上角色地址…", "reading on-chain role addresses…")}</div>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-4">
            <div className="card p-4">
              <div className="text-xs text-tertiary">{L("金库余额（唯一资金池）", "Vault balance (the only pool)")}</div>
              <div className="mono mt-2 text-xl font-semibold text-cyan">{fmtMon(vault.balanceMon)} MON</div>
            </div>
            <div className="card p-4">
              <div className="text-xs text-tertiary">{L("链上角色数", "On-chain roles")}</div>
              <div className="mono mt-2 text-xl font-semibold">3</div>
              <div className="mt-1 text-[10px] text-tertiary">{L("owner / TEE 派生 / challenger", "owner / TEE-derived / challenger")}</div>
            </div>
          </div>

          <div className="card p-2">
            <RoleRow
              name={L("owner（治理）", "owner (governance)")}
              addr={vault.owner}
              perm={L("owner-only：deposit / withdraw / setLimits / 白名单 / 授权验证者 / 冻结开关", "owner-only: deposit / withdraw / setLimits / allowlist / authorize validators / freeze")}
              note={L("部署者钱包，与 challenger 角色分离", "deployer wallet, separated from the challenger role")}
            />
            <RoleRow
              name={L("TEE 派生地址（执行）", "TEE-derived (execution)")}
              addr={vault.teeDerivedAddress}
              perm={L("仅可执行通过全部关卡的字节；非 payable，不能夹带资金，也不能转出余额", "can only execute bytes that passed every gate; non-payable, cannot attach or move funds out")}
              note={L("热钱包：逐笔另备资金会抬高密钥泄露的损失上限，故设计为只花金库余额", "hot wallet: pre-funding it per trade would raise the blast radius of a key leak, so it only spends vault balance")}
            />
            <RoleRow
              name={L("challenger（裁决）", "challenger (adjudication)")}
              addr={ident?.contracts.validationRegistry ?? "—"}
              addrLabel={L("按地址查链上裁决记录", "look up verdicts by address")}
              perm={L("独立重推导 L1–L5 并上链 validation 裁决；必须在 owner 白名单内，否则 executeTrade 一律 revert", "independently re-derives L1–L5 and writes on-chain validation; must be on the owner allowlist, otherwise executeTrade reverts")}
              note={L(
                `白名单内验证者数：${vault.trustedValidatorCount}。challenger 自己的地址不在 orchestrator 的只读面暴露——本服务只当 proposer，不持有 challenger 私钥（角色分离）。要核验是哪个地址在裁决，去验证注册表按地址查，或见 aegis/.env 的 CHALLENGER_PK 派生地址。`,
                `trusted validators: ${vault.trustedValidatorCount}. The challenger's own address is not exposed on the orchestrator read surface — this service only acts as proposer and holds no challenger key (role separation). To verify which address adjudicates, look it up on the validation registry, or derive it from CHALLENGER_PK in aegis/.env.`
              )}
              tone={vault.trustedValidatorCount > 0 ? "text-green" : "text-red"}
            />
          </div>

          <div className="card mt-4 flex items-start gap-3 p-5">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan" />
            <div className="text-xs text-secondary">
              <div className="mb-1.5 text-sm text-primary">{L("为什么没有「创建子账户」按钮", "Why there is no 'create sub-account' button")}</div>
              {L(
                "本系统里的账户划分是「权限角色」而非「独立资金子账户」：三个角色共享同一个金库余额，没有 per-role 子余额，也没有 trade/hold/read 的权限隔离开关（链上不存在这样的数据结构）。要做真正的子账户（独立限额、独立 TEE 度量、独立资金），需要先在合约里引入 per-account accounting 与权限位——那是 future work，前端无法凭空补上。",
                "Accounts here are permission roles, not separate funded sub-accounts: all three roles share one vault balance, with no per-role sub-balance and no trade/hold/read isolation switches (no such data structure exists on-chain). Real sub-accounts (independent limits, independent TEE measurements, independent funds) would require per-account accounting and permission bits in the contracts first — future work the frontend cannot invent."
              )}
            </div>
          </div>

          <a
            href={`${EXPLORER}/address/${vault.address}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-[11px] text-cyan hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            {L("在区块浏览器核验金库与角色", "Verify vault and roles on explorer")}
          </a>
        </>
      )}
    </div>
  );
}

function RoleRow({
  name,
  addr,
  perm,
  note,
  tone = "text-secondary",
  addrLabel,
}: {
  name: string;
  addr: string;
  perm: string;
  note: string;
  tone?: string;
  addrLabel?: string;
}) {
  return (
    <div className="flex items-start gap-3 border-b border-border-subtle p-3 text-xs last:border-0">
      <div className="mt-1 h-7 w-7 shrink-0 rounded-lg bg-input" />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm">{name}</span>
          <a
            href={`${EXPLORER}/address/${addr}`}
            target="_blank"
            rel="noreferrer"
            className={`mono text-[11px] hover:underline ${tone}`}
          >
            {addr}
          </a>
          {addrLabel && <span className="text-[10px] text-muted">{addrLabel}</span>}
        </div>
        <div className="mt-1 text-[11px] text-secondary">{perm}</div>
        <div className="mt-0.5 text-[11px] text-tertiary">{note}</div>
      </div>
    </div>
  );
}
