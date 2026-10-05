"use client";

import { useL } from "@/lib/i18n";
import { BookOpen } from "lucide-react";

interface Term {
  t: string;
  d: string;
  dEn: string;
  why?: string;
  whyEn?: string;
}

const GROUPS: { g: string; gEn: string; items: Term[] }[] = [
  {
    g: "安全判据（真正的边界）",
    gEn: "The predicates (the actual boundary)",
    items: [
      {
        t: "δ（确定性谓词）",
        d: "整套安全判据的统称：护栏 + PACE + 目标层。它就是安全边界；LLM 的输出只是被它分类的不可信输入。",
        dEn: "The whole safety predicate: guardrail + PACE + objective layer. This is the security boundary; LLM output is untrusted input classified by it.",
        why: "常见误读：以为「TEE 里的模型」提供保证。保证来自 δ 被正确求值，与模型是否可被操纵无关。",
        whyEn: "Common misreading: that a model inside a TEE provides the guarantee. The guarantee comes from δ being evaluated correctly, regardless of whether the model can be manipulated.",
      },
      {
        t: "护栏（Guardrail）",
        d: "对可信指令与外部内容做归一化（去零宽字符、leet 折叠、大小写）后匹配注入模式与黑名单。",
        dEn: "Normalises trusted commands and external content (zero-width stripping, leetspeak folding, case) before matching injection patterns and the blocklist.",
        why: "proposer 预览与 challenger 必须同口径，否则会造出假性分歧；parity-check 就是守这个的。",
        whyEn: "The proposer preview and the challenger must normalise identically, otherwise you get phantom disagreement; parity-check guards exactly that.",
      },
      {
        t: "PACE",
        d: "策略约束层：目标白名单 + 单笔上限 + 日限（含当日已用额度）。链上与链下同口径。",
        dEn: "The policy layer: target allowlist + per-trade cap + daily limit (with today's spend). Same predicate on-chain and off-chain.",
      },
      {
        t: "目标层 / L5（SOA-lite）",
        d: "用户用 EIP-191 签署一个客观目标（金额区间、标的、期限、nonce），而不是一个动作；challenger 独立验签并做 ε-区间检查。",
        dEn: "The user signs an objective with EIP-191 — amount range, asset, deadline, nonce — not an action; the challenger independently verifies the signature and runs an ε-interval check.",
        why: "于是「策略合规」不等于「你授权的」：意图漂移即使通过 PACE 也会被 L5 拒。注意 L5 指目标层，与可选的交叉模型层不是一回事。",
        whyEn: "So policy compliance is not the same as what you authorised: intent drift passes PACE but is rejected by L5. Note L5 is the objective layer, not the optional cross-family model layer.",
      },
      {
        t: "L1–L5（challenger 五层）",
        d: "策略认证 / 独立护栏 / 独立 PACE（含日限）/ 算术与原文 preimage 绑定 / 目标层验签 + ε。全部确定性，不 import proposer 任何模块。",
        dEn: "Policy attestation / independent guardrail / independent PACE (incl. daily cap) / arithmetic and transcript preimage binding / objective signature + ε. All deterministic, importing nothing from the proposer.",
      },
    ],
  },
  {
    g: "哈希与绑定链",
    gEn: "Hashes and the binding chain",
    items: [
      {
        t: "executionHash",
        d: "keccak(target, value, calldata)。金库放行的判据就是它必须与最近一张交易收据里的值逐字节相同。",
        dEn: "keccak(target, value, calldata). The vault releases funds only if it equals the value in the latest trade receipt, byte for byte.",
      },
      {
        t: "PDR / pdrHash",
        d: "keccak(executionHash, guardrailHash, true)：把「执行什么」与「当时哪套策略」绑在一起。",
        dEn: "keccak(executionHash, guardrailHash, true) — binds what is executed to which policy was in force.",
      },
      {
        t: "semantic digest（收据摘要）",
        d: "把 agentId、nonce、prev 与上面的哈希编码成 64 字节，作为 TDX quote 的 report_data。",
        dEn: "Encodes agentId, nonce, prev and the hashes above into 64 bytes, used as the TDX quote's report_data.",
      },
      {
        t: "哈希链 / prev",
        d: "每张收据引用上一张的 digest。删一条、换顺序、回滚都会在重算 digest 时暴露。",
        dEn: "Each receipt references the previous digest. Deleting, reordering or rolling back is exposed when the digest is recomputed.",
      },
      {
        t: "blockhash 绑定 / MAX_BLOCK_AGE",
        d: "收据须声明它基于哪个区块，链上校验 blockhash(blockHeight) 且不超过 100 块——防分叉重放。",
        dEn: "A receipt declares the block it was built on; the contract checks blockhash(blockHeight) and that it is within 100 blocks — anti fork-replay.",
      },
      {
        t: "nonce / 防重放",
        d: "per-agent 的 usedNonces；同一张收据不能提交两次。",
        dEn: "Per-agent usedNonces; the same receipt cannot be submitted twice.",
      },
    ],
  },
  {
    g: "身份与硬件证明",
    gEn: "Identity and hardware attestation",
    items: [
      {
        t: "TDX quote / DCAP",
        d: "Intel TDX 硬件签名的证明，含运行环境度量值；DCAP 是验证它的协议栈。本项目在链上验，不是离链验。",
        dEn: "A hardware-signed Intel TDX attestation carrying measurements of the runtime; DCAP is the verification stack. This project verifies it on-chain, not off-chain.",
      },
      {
        t: "CVM / dstack",
        d: "Phala 的机密虚拟机（TDX），以及它在容器内提供 quote 的运行时套接字。",
        dEn: "Phala's confidential VM (TDX) and the runtime socket that serves quotes inside the container.",
      },
      {
        t: "report_data",
        d: "quote 里留给调用方的 64 字节。这里放 semantic digest，把「这份决策」与「这个运行环境」钉在一起。",
        dEn: "The 64 bytes reserved for the caller inside the quote. Here it carries the semantic digest, pinning this decision to that runtime.",
      },
      {
        t: "TEE 信任边界",
        d: "TEE 只回答谁在什么环境跑，不回答决策对不对；后者由 challenger 回答——两个正交维度。",
        dEn: "The TEE answers who ran and where, not whether the decision was right; the challenger answers the latter — two orthogonal dimensions.",
        why: "LLM 刻意跑在 TEE 之外：把可被操纵的东西放进 enclave 只保护它的机密性，不产生「决策正确」的保证。",
        whyEn: "The LLM deliberately runs outside the TEE: putting a manipulable component in an enclave protects its confidentiality, not the correctness of its output.",
      },
    ],
  },
  {
    g: "执行闸门与状态",
    gEn: "The execution gate and its states",
    items: [
      {
        t: "quorum 闸门 / _preExecutionHook",
        d: "executeTrade 前的链上检查：验证者地址必须在金库 owner 白名单内，且它对最新交易收据 digest 给出的 response ≥ 100。",
        dEn: "The on-chain check before executeTrade: the validator address must be on the vault owner's allowlist, and its verdict for the latest trade-receipt digest must be response ≥ 100.",
        why: "ValidationRegistry 本身无需许可，所以只读分值是错的：任何人都能自证自答伪造 quorum。",
        whyEn: "The ValidationRegistry is permissionless, so reading the score alone is wrong: anyone can self-request and self-answer to forge a quorum.",
      },
      {
        t: "isTradeFresh / isAlive",
        d: "前者看最新交易收据是否在 MAX_BLOCK_AGE 内；后者看最近任意收据是否在 STALENESS_LIMIT 内（存活）。",
        dEn: "The former asks whether the latest trade receipt is within MAX_BLOCK_AGE; the latter whether any receipt is within STALENESS_LIMIT (liveness).",
      },
      {
        t: "死手开关 / tradingFrozen",
        d: "agent 长时间没有新鲜收据时，任何人可调 freezeIfStale 冻结交易；owner 可 resumeTrading（需先有新鲜收据）。",
        dEn: "When the agent has had no fresh receipt for a while, anyone may call freezeIfStale to freeze trading; the owner can resumeTrading (a fresh receipt is required first).",
        why: "侧边栏的「收据不新鲜」不等于「已冻结」：前者只说明条件已满足，链上 tradingFrozen 可能仍是 false。",
        whyEn: "The sidebar's stale receipt is not the same as frozen: the former only means the condition is met; on-chain tradingFrozen may still be false.",
      },
    ],
  },
  {
    g: "角色与标准",
    gEn: "Roles and standards",
    items: [
      {
        t: "proposer / challenger",
        d: "proposer 是出主意的 agent 进程（双 LLM 管线 + δ 预览，持收据提交钥）；challenger 是独立裁判进程，持另一把钥，独立重推导后上链裁决。",
        dEn: "proposer is the proposing agent process (dual-LLM pipeline + δ preview, holds the receipt key); challenger is the independent adjudicator holding a different key, re-deriving and writing the verdict.",
      },
      {
        t: "owner / TEE 派生地址",
        d: "owner 是金库治理钥（withdraw / 限额 / 白名单 / 换 registry / 授权验证者）；TEE 派生地址只被允许执行通过全部关卡的字节。",
        dEn: "owner is the vault governance key (withdraw / limits / allowlist / swap registry / authorise validators); the TEE-derived address may only execute bytes that passed every gate.",
        why: "当前部署里 owner == TEE 派生地址 == proposer 签名地址（同一把钥），已在总览页如实披露：不要在答辩中声称三方分权。",
        whyEn: "In the current deployment owner == TEE-derived == proposer signing address (one key); it is disclosed on the overview page — do not claim a three-way split.",
      },
      {
        t: "ERC-8004",
        d: "身份 / 声誉 / 验证三个注册表。本项目自部署（官方 testnet 无部署），并把 Validation 从元数据改造成执行硬闸门。",
        dEn: "The Identity / Reputation / Validation registries. Self-deployed here (the official registries are not deployed on the testnet), and Validation is turned from metadata into a hard execution gate.",
      },
      {
        t: "输入真实性不可能性（R1）",
        d: "谓词只能验证「给定输入 x 的决策」，无法验证 x 本身未被代换。这是不可能性边界，实验里作为负对照公开。",
        dEn: "A predicate can only validate the decision given input x; it cannot validate that x was not substituted. This is an impossibility boundary, published as a negative control.",
      },
    ],
  },
];

export default function GlossaryPage() {
  const L = useL();
  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="py-6">
        <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight">
          <BookOpen className="h-5 w-5 text-cyan" />
          {L("术语表", "Glossary")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-secondary">
          {L(
            "本项目大量使用自造缩写。这一页给每个术语一句话定义，并标出常见的误读——读其他页面前先扫一眼，能省很多时间。",
            "This project uses a lot of its own abbreviations. Each term gets a one-line definition plus the common misreading — worth a skim before the other pages."
          )}
        </p>
      </div>

      {GROUPS.map((g) => (
        <div key={g.g} className="card p-5">
          <div className="mb-3 text-sm font-medium">{L(g.g, g.gEn)}</div>
          <dl className="space-y-3">
            {g.items.map((it) => (
              <div key={it.t} className="border-b border-border-subtle pb-3 last:border-0 last:pb-0">
                <dt className="mono text-[13px] text-cyan">{it.t}</dt>
                <dd className="mt-1 text-[13px] leading-relaxed text-secondary">{L(it.d, it.dEn)}</dd>
                {it.why ? (
                  <dd className="mt-1.5 rounded-md bg-amber/5 px-2.5 py-1.5 text-[12px] leading-relaxed text-amber">
                    {L("常见误读：", "Common misreading: ")}
                    {L(it.why, it.whyEn ?? it.why)}
                  </dd>
                ) : null}
              </div>
            ))}
          </dl>
        </div>
      ))}

      <div className="card p-5 text-[12px] leading-relaxed text-tertiary">
        {L(
          "更细的口径与实测数字（例如 MIN_RESPONSE 的取值、MAX_BLOCK_AGE 如何标定、跨家族模型层何时触发）写在仓库的 aegis/README.md 与 ARTIFACT.md 里。",
          "Finer details and measurements (e.g. how MIN_RESPONSE was chosen, how MAX_BLOCK_AGE was calibrated, when the cross-family layer fires) live in aegis/README.md and ARTIFACT.md."
        )}
      </div>
    </div>
  );
}
