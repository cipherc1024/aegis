"use client";

import { useState } from "react";
import Link from "next/link";
import { useL } from "@/lib/i18n";
import { shortAddr } from "@/lib/mock";
import { Check, Copy, FileSearch, FlaskConical, Landmark, ListChecks, ShieldAlert } from "lucide-react";

const EXPLORER = "https://testnet.monadexplorer.com";
const TENDERLY = "https://dashboard.tenderly.co/contract/monad-testnet";

/** 一键零 gas 复现（与 aegis/ARTIFACT.md §1 同表） */
const CMDS: { cmd: string; expect: string }[] = [
  { cmd: "cd aegis && npm ci", expect: "" },
  { cmd: "npx hardhat test", expect: "44 passing" },
  { cmd: "node challenger/selftest.mjs", expect: "17 pass / 0 fail" },
  { cmd: "node scripts/parity-check.mjs", expect: "21 agree / 0 diverge" },
  { cmd: "node scripts/attack-family.mjs", expect: "8 as-expected / 0 unexpected" },
  { cmd: "node scripts/atomic-input.mjs", expect: "ALL REGIMES PASS (4/4)" },
  { cmd: "node scripts/tee-adversary-sim.mjs", expect: "ALL LEGS PASS" },
  { cmd: "node scripts/soa-demo.mjs", expect: "8 pass / 0 fail" },
];

/** 9 个已在 Tenderly 源码级公开验证的自部署合约（匿名可查） */
const CONTRACTS: { name: string; addr: string }[] = [
  { name: "AegisVaultQuorum", addr: "0x3aBbb284760dce5643A8a5D1bA2bb9A58C2b89De" },
  { name: "ReceiptRegistry", addr: "0x4622D041696942dC873a8A5E54f1e1ca9669c90B" },
  { name: "DcapGate", addr: "0xAe58a4F6DD3E2810812193D4766f11d5F3Dfc66F" },
  { name: "ValidationRegistry", addr: "0x8b96a09eb50409FE4c402cB9Bb9D1Ef79bbe0cEa" },
  { name: "IdentityRegistry", addr: "0xC99D2957fdA1455E68dF2181A4bB97fd73081A74" },
  { name: "ReputationRegistry", addr: "0xb5B853BcE92940b8E5BFba131301509eaCFb5c9f" },
  { name: "CommittedOracle", addr: "0xe3D4a4F8DA20654dC2D845F130C654beb75C8967" },
  { name: "AtomicExecutor", addr: "0x0861C00133eCDf67fE61501F61D3fB8969A0e3D6" },
  { name: "AuditDraw", addr: "0x4EabbF03aa526D4B5C012Cd176D69025Cc52CE45" },
];

interface Row {
  zh: string;
  en: string;
  hash: string;
  block: number;
  from?: string;
  noteZh: string;
  noteEn: string;
}

/** 关键链上交易：逐笔可在浏览器里核对 */
const TXS: Row[] = [
  {
    zh: "v5 收据提交（链上 DCAP 验真）",
    en: "v5 receipt (on-chain DCAP verified)",
    hash: "0xda7a711711244c7d81283c231d5b79e27b6fab05ce1229ac1abd9e88385fe831",
    block: 64148941,
    from: "0x2a0eeca0…",
    noteZh: "proposer / TEE 钥提交决策收据，含真 Intel TDX quote（约 3.5M gas）",
    noteEn: "the proposer/TEE key submits the decision receipt carrying a real Intel TDX quote (~3.5M gas)",
  },
  {
    zh: "v5 裁决写入 ValidationRegistry",
    en: "v5 verdict written to ValidationRegistry",
    hash: "0x98fe4af5a0372abee8defae09e3ee9736c4c9ae548c0073f30ef9f9e9f5cdfac",
    block: 64148961,
    from: "0x16e619c3…",
    noteZh: "来自另一把钥（独立 challenger，且已在金库白名单内）——proposer 无法为自己的决策背书",
    noteEn: "comes from a different key (the independent challenger, allowlisted in the vault) — a proposer cannot endorse its own decision",
  },
  {
    zh: "v5 executeTrade（真实 WMON wrap）",
    en: "v5 executeTrade (real WMON wrap)",
    hash: "0x7e6e71d34e6ca04f465d565252eac5edd2997af1d1cebecc9f0b68896d2544ef",
    block: 64148976,
    from: "0x2a0eeca0…",
    noteZh: "只有裁决通过后才执行；金库 WMON 0 → 0.01，MON 0.5 → 0.49",
    noteEn: "execution only after the verdict passed; vault WMON 0 → 0.01, MON 0.5 → 0.49",
  },
  {
    zh: "in-TEE CVM 收据（Phala TDX 内实跑）",
    en: "in-TEE CVM receipt (ran inside Phala TDX)",
    hash: "0xadf522038b8ace6d7ada14ca491b527eb3ab8caf630153d2570b799ec96003be",
    block: 63607466,
    noteZh: "真 CVM 内还原模块 → 确定性判定 → 取 quote → 上链（5010 字节 quote）",
    noteEn: "modules restored inside a real CVM → deterministic verdict → quote → on-chain (5010-byte quote)",
  },
  {
    zh: "SOA-lite 收据 + 签署目标存证",
    en: "SOA-lite receipt + signed-objective binding",
    hash: "0xac1a5c8a2f60f2110d005fd4383c4b9b36d75819ac174c6dbd9b7214bbe904de",
    block: 62756780,
    noteZh: "用户签署的是目标而非动作；objectiveHash 经 bindTranscript 上链（aegis://objective/<hash>）",
    noteEn: "the user signs an objective, not an action; objectiveHash is bound on-chain via bindTranscript (aegis://objective/<hash>)",
  },
  {
    zh: "M2 原子输入–执行绑定",
    en: "M2 atomic input→execution binding",
    hash: "0x2dc3210087fef1fdbe08dccf928904da1cdcc5a10b476f891d513e4d76f29941",
    block: 63051997,
    noteZh: "同一 tx 内读共识提交的输入并执行 wrap；输入被换则 revert",
    noteEn: "reads the consensus-committed input and wraps in one tx; a swapped input reverts",
  },
];

export default function EvidencePage() {
  const L = useL();
  return (
    <div className="mx-auto max-w-5xl space-y-4">
      <div className="py-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <FileSearch className="h-5 w-5 text-cyan" />
          {L("证据与复现", "Evidence & reproduce")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          {L(
            "这一页把仓库里 ARTIFACT.md 的证据索引搬到浏览器：每个数字都能一键核验——要么是一条能在本机跑出同样结果的命令，要么是一笔能在区块浏览器里点开的交易。本页不显示任何推算值。",
            "This page lifts the evidence index from ARTIFACT.md into the browser: every number can be checked — either by a command that reproduces it locally, or by a transaction you can open in the explorer. Nothing here is imputed."
          )}
        </p>
      </div>

      <div className="card p-5">
        <div className="mb-1 flex items-center gap-2 text-sm font-medium">
          <FlaskConical className="h-4 w-4 text-cyan" />
          {L("一键零 gas 复现（无需 API key、无需私钥、不花钱）", "Zero-gas reproduction (no API key, no private key, no funds)")}
        </div>
        <div className="mb-3 text-[12px] leading-relaxed text-tertiary">
          {L(
            "在 aegis/ 目录下依次执行，右侧是期望输出。全部 harness 刻意做到环境无关：不读 .env；没有 LLM key 时如实标注 mode=mock，绝不静默编造裁决。",
            "Run these in aegis/; expected output on the right. Every harness is deliberately environment-free: it reads no .env, and with no LLM key it labels mode=mock instead of silently inventing a verdict."
          )}
        </div>
        <div className="space-y-1.5">
          {CMDS.map((c) => (
            <div key={c.cmd} className="flex items-center gap-2 rounded-lg border border-border-subtle bg-input px-3 py-2">
              <code className="mono min-w-0 flex-1 truncate text-[12px] text-secondary">{c.cmd}</code>
              {c.expect ? <span className="mono shrink-0 text-[12px] text-green">{c.expect}</span> : null}
              <CopyBtn text={c.cmd} />
            </div>
          ))}
        </div>
        <div className="mt-3 text-[12px] leading-relaxed text-tertiary">
          {L(
            "完整表（含 DCAP 产物离线重建、cross-machine 2-of-2 流程）见仓库 aegis/ARTIFACT.md §1；链上证据索引见 §2。",
            "The full table (incl. offline DCAP artifact rebuild and the cross-machine 2-of-2 flow) is in aegis/ARTIFACT.md §1; the on-chain evidence index is §2."
          )}
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-1 flex items-center gap-2 text-sm font-medium">
          <Landmark className="h-4 w-4 text-cyan" />
          {L("9 个自部署合约：Tenderly 源码级公开验证（匿名免登录）", "9 self-deployed contracts: source-verified publicly on Tenderly (anonymous)")}
        </div>
        <div className="mb-3 text-[12px] leading-relaxed text-tertiary">
          {L(
            "点 Tenderly 看已部署字节码对应的源码，点 explorer 看链上地址本身。两者都不需要账号、不需要钱包。",
            "Open Tenderly to read the source behind the deployed bytecode; open the explorer for the address itself. Neither needs an account or a wallet."
          )}
        </div>
        <div className="space-y-1.5">
          {CONTRACTS.map((c) => (
            <div key={c.addr} className="flex flex-wrap items-center gap-2 rounded-lg border border-border-subtle px-3 py-2">
              <span className="mono text-[12px] text-secondary">{c.name}</span>
              <span className="mono text-[12px] text-muted">{shortAddr(c.addr)}</span>
              <span className="ml-auto flex shrink-0 items-center gap-2 text-[12px]">
                <a className="text-cyan hover:underline" href={TENDERLY + "/" + c.addr} target="_blank" rel="noreferrer">
                  Tenderly ↗
                </a>
                <a className="text-secondary hover:underline" href={EXPLORER + "/address/" + c.addr} target="_blank" rel="noreferrer">
                  explorer ↗
                </a>
                <CopyBtn text={c.addr} />
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-1 flex items-center gap-2 text-sm font-medium">
          <ListChecks className="h-4 w-4 text-cyan" />
          {L("关键链上交易（逐笔可点开核对）", "Key on-chain transactions (each openable)")}
        </div>
        <div className="mb-3 text-[12px] leading-relaxed text-tertiary">
          {L(
            "Monad testnet · chainId 10143。前三行是同一笔端到端执行的三段：注意 from 地址不同，这就是「proposer 不能给自己的决策背书」的链上证据。",
            "Monad testnet · chainId 10143. The first three rows are the three legs of one end-to-end run: note the different from addresses — that is the on-chain proof that a proposer cannot endorse its own decision."
          )}
        </div>
        <div className="space-y-2">
          {TXS.map((t) => (
            <div key={t.hash} className="rounded-lg border border-border-subtle px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-[12px] text-secondary">{L(t.zh, t.en)}</span>
                <span className="mono text-[12px] text-muted">block {t.block.toLocaleString()}</span>
                {t.from ? <span className="mono text-[12px] text-amber">from {t.from}</span> : null}
                <a
                  className="ml-auto shrink-0 text-[12px] text-cyan hover:underline"
                  href={EXPLORER + "/tx/" + t.hash}
                  target="_blank"
                  rel="noreferrer"
                >
                  explorer ↗
                </a>
              </div>
              <div className="mt-1 flex items-start gap-2">
                <code className="mono min-w-0 flex-1 break-all text-[12px] text-tertiary">{t.hash}</code>
                <CopyBtn text={t.hash} />
              </div>
              <div className="mt-1 text-[12px] leading-relaxed text-tertiary">{L(t.noteZh, t.noteEn)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="card flex items-start gap-3 border-amber/40 p-5">
        <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber" />
        <div className="text-[12px] leading-relaxed text-secondary">
          <div className="mb-1 text-sm text-primary">
            {L("同时也是我们主动公开的负结果", "And the negative result we publish against ourselves")}
          </div>
          {L(
            "八类攻击者实测拦下七类：策略后门被 L1/L3 拦下、意图漂移被目标层 L5 拦下、混淆代理被 L4 算术绑定拦下。剩下那类是输入代换——当决策与被换掉的输入完全一致时，任何确定性谓词都拦不住。这是不可能性结果，不是被防住的场景，我们把它当作负对照公开。",
            "Seven of eight attacker families are blocked in measurement: policy backdoors by L1/L3, intent drift by the objective layer L5, confused deputies by L4 arithmetic binding. The one that is not is input substitution — when the decision is perfectly consistent with an input that was swapped underneath it, no deterministic predicate can catch it. That is an impossibility result, not a defended case, and we publish it as a negative control."
          )}
          <div className="mt-2 flex flex-wrap gap-3 text-[12px]">
            <Link className="text-cyan hover:underline" href="/architecture">
              {L("在架构页现场跑 11 个负例 →", "Run the 11 negative cases live →")}
            </Link>
            <Link className="text-cyan hover:underline" href="/glossary">
              {L("术语表（δ / PACE / L1–L5 / PDR…）→", "Glossary (δ / PACE / L1–L5 / PDR…) →")}
            </Link>
          </div>
        </div>
      </div>

      <div className="card p-5">
        <div className="mb-3 text-sm font-medium">
          {L("复现环境要求（容易踩的坑）", "Reproduction environment (easy to trip on)")}
        </div>
        <ul className="space-y-1.5 text-[12px] leading-relaxed text-secondary">
          <li>
            · {L(
              "Node.js ≥ 22（开发实测 v24）与 npm；合约必须用 evmVersion: paris 编译——Monad 上 MCOPY 行为不正确。",
              "Node.js ≥ 22 (developed on v24) and npm; contracts must compile with evmVersion: paris — MCOPY behaves incorrectly on Monad."
            )}
          </li>
          <li>
            · {L(
              "eth_getLogs 限 100 块，故收据索引器走 JSON-RPC 批量扫窗；更早的收据请在区块浏览器查。",
              "eth_getLogs is capped at 100 blocks, so the receipt indexer sweeps batched 100-block windows; older receipts are checked in the explorer."
            )}
          </li>
          <li>
            · {L(
              "不要用 Multicall3：Monad 上内层 msg.sender 不保留，故交易逐笔执行。",
              "Do not use Multicall3: the inner msg.sender is not preserved on Monad, so trades execute one at a time."
            )}
          </li>
          <li>
            · {L(
              "soa-demo 需要一个丢弃用的用户角色签名键（只签 canonical JSON、不碰链、不需要资金），公开测试键写在 README 里。",
              "soa-demo needs a throwaway user-role signing key (signs canonical JSON only, never touches the chain, needs no funds); the public test key is in the README."
            )}
          </li>
          <li>
            · {L(
              "唯一联网可选项是 LLM；它还刻意跑在 TEE 之外——保证来自确定性谓词 δ 被正确求值，而不是模型在不在 enclave 里。",
              "The only networked optional part is the LLM, and it deliberately runs outside the TEE — the guarantee comes from δ being evaluated correctly, not from the model being inside an enclave."
            )}
          </li>
        </ul>
      </div>
    </div>
  );
}

function CopyBtn({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      aria-label="复制"
      onClick={() => {
        void navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
      className="shrink-0 rounded-md border border-border-base p-1 text-tertiary hover:border-border-hover hover:text-primary"
    >
      {done ? <Check className="h-3 w-3 text-green" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}
