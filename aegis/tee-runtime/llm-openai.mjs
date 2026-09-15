// OpenAI 兼容 LLM 适配器（DeepSeek / Kimi / 自建 vLLM / 校园网关等）
// baseUrl 形如 https://api.deepseek.com  或  .../v1 ；会请求 {baseUrl}/chat/completions
//
// 返回值是 llm(system, user, opts) —— opts 支持按调用覆盖 { model, json, maxTokens, temperature }：
//   json: true  → 请求方要求返回严格 JSON（响应格式 json_object；服务端不支持时自动降级重试）
//   model       → 允许"同一网关换模型"：基于本地 7B 的 challenger 与 proposer 的模型
//                 来自不同家族，且 challenger 侧强制 temperature=0——这是本项目的核心安全主张。
export function makeOpenAICompatLLM({ baseUrl, apiKey, model, timeoutMs = 30000 } = {}) {
  if (!baseUrl || !apiKey) throw new Error("missing LLM_BASE_URL / LLM_API_KEY");
  const url = baseUrl.replace(/\/$/, "") + "/chat/completions";

  return async (system, user, opts = {}) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const body = {
        model: opts.model || model,
        temperature: opts.temperature ?? 0,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      };
      // 有上限才传：自建网关（vLLM 等）对未知字段可能直接 400
      if (opts.maxTokens) body.max_tokens = opts.maxTokens;
      if (opts.json) body.response_format = { type: "json_object" };

      const call = async (b) =>
        fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify(b),
          signal: ctrl.signal,
        });

      let res = await call(body);
      // 服务端不支持 response_format → 降级为纯提示词约束重试一次（demo 永不因网关差异崩）
      if (!res.ok && opts.json) {
        delete body.response_format;
        res = await call(body);
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const j = await res.json();
      const choice = j.choices?.[0];
      const content = choice?.message?.content ?? "";
      // 推理模型（reasoning 与答案共享 max_tokens）被截断时返回空 content；
      // 明确报因，避免与"输出非 JSON"混淆（两者都 fail-closed，但排查方向不同）
      if (content === "" && choice?.finish_reason === "length") {
        throw new Error("empty content (finish_reason=length): reasoning exhausted max_tokens");
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  };
}
