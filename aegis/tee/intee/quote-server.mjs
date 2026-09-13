// Aegis TEE quote 服务（跑在 Phala CVM 内）：POST /quote → getQuote(reportData) → 真 TDX quote
// orchestrator 经 QUOTE_URL 调用；key/env 封在 CVM 内不出 TEE。
// 依赖：@phala/dstack-sdk（CVM 内 /var/run/dstack.sock）
import http from "node:http";
import { DstackClient } from "@phala/dstack-sdk";

const PORT = Number(process.env.QUOTE_PORT || 8080);
const dc = new DstackClient("/var/run/dstack.sock");

function hexToU8(hex) {
  const s = String(hex).replace(/^0x/, "");
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(s.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const server = http.createServer(async (req, res) => {
  const cors = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (req.method === "OPTIONS") return res.writeHead(204, cors).end();

  try {
    if (req.method === "GET" && req.url === "/health") {
      return res.writeHead(200, { "Content-Type": "application/json", ...cors }).end(JSON.stringify({ online: true, tdx: true }));
    }
    if (req.method === "POST" && req.url === "/quote") {
      let body = "";
      for await (const chunk of req) body += chunk;
      const { reportData } = JSON.parse(body || "{}");
      if (!reportData || typeof reportData !== "string" || reportData.replace(/^0x/, "").length === 0) {
        return res.writeHead(400, { "Content-Type": "application/json", ...cors }).end(JSON.stringify({ error: "reportData required (hex, <=64 bytes)" }));
      }
      const rd = reportData.replace(/^0x/, "");
      if (rd.length > 128) {
        return res.writeHead(400, { "Content-Type": "application/json", ...cors }).end(JSON.stringify({ error: "reportData > 64 bytes" }));
      }
      const q = await dc.getQuote(hexToU8(rd));
      const quote = q.quote?.startsWith?.("0x") ? q.quote : "0x" + (q.quote ?? "");
      console.log(`[quote] bytes=${(quote.length - 2) / 2}`);
      return res.writeHead(200, { "Content-Type": "application/json", ...cors }).end(JSON.stringify({ quote, reportData: "0x" + rd }));
    }
    res.writeHead(404, { "Content-Type": "application/json", ...cors }).end(JSON.stringify({ error: "not found" }));
  } catch (e) {
    res.writeHead(500, { "Content-Type": "application/json", ...cors }).end(JSON.stringify({ error: String(e?.message || e) }));
  }
});

server.listen(PORT, () => console.log(`[quote-server] :${PORT}  POST /quote {reportData} → TDX quote`));
