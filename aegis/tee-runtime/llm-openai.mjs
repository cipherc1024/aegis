// OpenAI 兼容 LLM 适配器（DeepSeek / Kimi / 自建等）
// baseUrl 形如 https://api.deepseek.com  或  .../v1 ；会请求 {baseUrl}/chat/completions
export function makeOpenAICompatLLM({ baseUrl, apiKey, model, timeoutMs = 30000 } = {}) {
  if (!baseUrl || !apiKey) throw new Error("missing LLM_BASE_URL / LLM_API_KEY");
  const url = baseUrl.replace(/\/$/, "") + "/chat/completions";

  return async (system, user) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature: 0,
          messages: [
            { role: "system", content: system },
            { role: "user", content: user },
          ],
        }),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = await res.json();
      return j.choices?.[0]?.message?.content ?? "";
    } finally {
      clearTimeout(timer);
    }
  };
}
