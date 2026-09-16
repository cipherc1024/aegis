// 诊断：QUOTE_URL 引用的 Phala CVM quote 服务是否还活着。
import { loadEnv } from "./lib.mjs";
loadEnv();

const raw = (process.env.QUOTE_URL || "").trim().replace(/\/$/, "");
if (!raw) {
  console.log("QUOTE_URL 未配置 → orchestrator 会走 onlyTEE 回退路径");
  process.exit(0);
}
console.log("QUOTE_URL:", raw);

const reportData = "0x" + "11".repeat(32);
try {
  const res = await fetch(`${raw}/quote`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reportData }),
    signal: AbortSignal.timeout(25000),
  });
  console.log("HTTP", res.status, res.statusText);
  const text = await res.text();
  console.log("body head:", text.slice(0, 300));
  if (res.ok) {
    try {
      const j = JSON.parse(text);
      console.log("has quote:", Boolean(j.quote), "len:", j.quote ? (j.quote.length - 2) / 2 : 0);
    } catch { /* not json */ }
  }
} catch (e) {
  console.log("FETCH FAIL:", String(e?.message || e).slice(0, 200));
}
process.exit(0);
