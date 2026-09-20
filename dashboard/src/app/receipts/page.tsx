"use client";

import { useState } from "react";
import Link from "next/link";
import { useL } from "@/lib/i18n";
import { shortHash } from "@/lib/mock";
import { useReceipts } from "@/lib/useReceipts";
import { CheckCircle2, Lock, Radio } from "lucide-react";

export default function ReceiptsPage() {
  const L = useL();
  const { receipts, live, loading } = useReceipts(1);
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const r = receipts.find((x) => x.receiptHash === selectedHash) ?? receipts[0];

  if (!r) {
    // 还在取数 ≠ 离线。富事件路径要串行扫 40 个 100 块的窗口（实测 ~30s），
    // 此前这里在等待期间就直接显示"离线"，把"正在查"误报成"系统没在工作"。
    if (loading) {
      return (
        <div className="card flex flex-col items-center gap-2 p-10 text-center">
          <Radio className="h-5 w-5 animate-pulse text-cyan" />
          <div className="text-sm text-secondary">{L("正在读取链上收据…", "Loading on-chain receipts…")}</div>
          <div className="max-w-md text-xs text-tertiary">
            {L(
              "浏览器直读最近若干块窗口，同时向 orchestrator 索引器取历史。窗口内没有收据时这里会继续等待索引器结果。",
              "Reading recent block windows in-browser while the orchestrator indexer serves history. If the window holds no receipts, this waits on the indexer."
            )}
          </div>
        </div>
      );
    }
    return (
      <div className="card flex flex-col items-center gap-2 p-10 text-center">
        <Radio className="h-5 w-5 text-muted" />
        <div className="text-sm text-secondary">{L("收据流离线", "Receipt stream offline")}</div>
        <div className="max-w-md text-xs text-tertiary">
          {L(
            "本页只显示真实链上收据（orchestrator 索引器产物）。索引器未运行或不可达时，这里不会显示任何占位数据。",
            "This page only shows real on-chain receipts (produced by the orchestrator's indexer). When the indexer isn't running or is unreachable, no placeholder data is shown here."
          )}
        </div>
      </div>
    );
  }

  const rows: [string, string][] = [
    [L("区块高度", "Block height"), String(r.blockHeight)],
    [L("执行动作", "Action"), r.action],
    [L("金额", "Amount"), r.amount ?? "—"],
    [L("执行哈希", "Execution hash"), r.executionHash],
    [L("nonce", "nonce"), r.nonce],
    [L("护栏哈希", "Guardrail hash"), r.guardrailHash],
    [L("前序收据", "Prev receipt"), r.prevReceiptHash],
    [L("收据哈希", "Receipt hash"), r.receiptHash],
    [L("交易哈希", "Tx hash"), r.txHash ?? "—"],
  ];

  // DCAP 面板只展示"本页真的读到了什么"。FMSPC / TCB Level / Quote 版本属于
  // quote 工件内部字段，前端没有解析能力（也不该假装有），一律显示"未解析"，
  // 真值请用 scripts/verify-quote.mjs 复验原始 quote。
  const dcap: [string, string][] = [
    [L("Quote 类型", "Quote type"), L("未解析（见 verifier）", "not parsed (see verifier)")],
    ["FMSPC", L("未解析（见 verifier）", "not parsed (see verifier)")],
    ["TCB Status", L("未解析（见 verifier）", "not parsed (see verifier)")],
    [L("收据摘要", "Receipt digest"), shortHash(r.receiptHash)],
  ];

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-[320px_1fr]">
      {/* list */}
      <div className="card p-3">
        <div className="mb-2 flex items-center gap-2 px-1 text-sm">
          {L("收据列表", "Receipts")}
          <span
            className={`ml-auto flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] ${
              live ? "bg-green/10 text-green" : "bg-input text-muted"
            }`}
          >
            <Radio className="h-2.5 w-2.5" />
            {live ? L("链上索引", "indexed") : L("离线", "offline")}
          </span>
        </div>
        <div className="space-y-1">
          {receipts.map((x) => (
            <button
              key={x.receiptHash}
              onClick={() => setSelectedHash(x.receiptHash)}
              className={`flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors ${
                r.receiptHash === x.receiptHash ? "bg-hover text-primary" : "text-secondary hover:bg-hover"
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  x.type === "rejected" ? "bg-red" : x.type === "heartbeat" ? "border border-muted" : "bg-cyan"
                }`}
              />
              <span className="mono text-muted">#{x.id}</span>
              <span className="truncate">{x.action}</span>
            </button>
          ))}
        </div>
      </div>

      {/* detail */}
      <div className="space-y-4">
        <div className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <div className="text-sm font-medium">
              {L("收据摘要", "Receipt summary")} · <span className="mono text-muted">#{r.id}</span>
            </div>
            <Link
              href="/verify"
              className="rounded-lg border border-cyan/40 bg-cyan/5 px-3 py-1.5 text-xs font-medium text-cyan hover:bg-cyan/10"
            >
              {L("独立验证最新收据", "Independently verify")}
            </Link>
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {rows.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-border-subtle py-1.5">
                <dt className="text-muted">{k}</dt>
                <dd className="mono truncate text-secondary">{v}</dd>
              </div>
            ))}
          </dl>
          {r.txHash ? (
            <a
              href={`https://testnet.monadexplorer.com/tx/${r.txHash}`}
              target="_blank"
              rel="noreferrer"
              className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border-base px-2.5 py-1.5 text-[11px] text-secondary hover:border-border-hover hover:text-primary"
            >
              {L("在区块浏览器核对这笔交易", "Verify this tx on the block explorer")} ↗
            </a>
          ) : null}
          <div className="mt-3 text-[11px] text-tertiary">
            {L(
              "哈希字段由浏览器直接读链上 ReceiptSubmitted 事件（最近若干块窗口）；「—」表示该字段不在当前数据来源里，请以区块浏览器为准。本页不显示任何推算值。",
              "Hash fields are read in-browser directly from the on-chain ReceiptSubmitted event (recent block window). \"—\" means the field is absent from the current source; treat the block explorer as authoritative. This page never shows imputed values."
            )}
          </div>
        </div>

        <div className="card p-4">
          <div className="mb-3 flex items-center gap-2 text-sm font-medium">
            <Lock className="h-4 w-4 text-cyan" />
            {L("DCAP 验证", "DCAP verification")}
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-xs sm:grid-cols-2">
            {dcap.map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-3 border-b border-border-subtle py-1.5">
                <dt className="text-muted">{k}</dt>
                <dd className="mono text-secondary">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="mt-3 flex items-center gap-2 rounded-lg bg-green/5 px-3 py-2 text-xs text-green">
            <CheckCircle2 className="h-3.5 w-3.5" />
            {L(
              "收据存在即代表链上 DCAP 验真通过：submitReceiptWithQuote 在合约内强制验 Intel TDX quote",
              "A stored receipt implies on-chain DCAP passed: submitReceiptWithQuote enforces the Intel TDX quote inside the contract"
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
