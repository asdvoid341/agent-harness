/**
 * Google Gemini (generateContent) adapter.
 *
 * Differences the adapter hides from the harness:
 *  - roles are "user" / "model"; content is a list of `parts`
 *  - tool calls are `functionCall` parts and may carry no id
 *  - tool results are `functionResponse` parts whose payload must be an object
 *  - the schema dialect is an OpenAPI subset (no `additionalProperties`)
 *  - model turns can carry `thoughtSignature`s that must be sent back as-is,
 *    so we replay the native `content` when the model is unchanged
 */
function toGeminiSchema(schema) {
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const out = {};
  for (const [k, v] of Object.entries(schema)) {
    if (k === 'additionalProperties') continue;
    out[k] = typeof v === 'object' ? toGeminiSchema(v) : v;
  }
  return out;
}

export const gemini = {
  id: 'gemini',
  label: 'Google Gemini',
  keyPlaceholder: 'AIza…',
  keyUrl: 'https://aistudio.google.com/apikey',
  models: ['gemini-3.8-flash'],
  defaultModel: 'gemini-3.8-flash',
  // Saved settings that still point at these are moved to the default.
  retiredModels: ['gemini-2.5-flash', 'gemini-2.5-pro'],
  supportsEffort: false,

  buildRequest({ system, tools, messages, model, apiKey }) {
    const contents = messages.map((m) => {
      if (m.role === 'assistant') {
        if (m.native?.provider === 'gemini' && m.native.model === model && m.native.content) return m.native.content;
        return {
          role: 'model',
          parts: m.content.map((b) => (b.type === 'text' ? { text: b.text } : { functionCall: { name: b.name, args: b.input } })),
        };
      }
      return {
        role: 'user',
        parts: m.content.map((b) =>
          b.type === 'text'
            ? { text: b.text }
            : { functionResponse: { name: b.name, response: b.isError ? { error: b.output } : { result: b.output } } },
        ),
      };
    });
    const body = { systemInstruction: { parts: [{ text: system }] }, contents };
    if (tools.length) {
      body.tools = [{ functionDeclarations: tools.map((t) => ({ name: t.name, description: t.description, parameters: toGeminiSchema(t.schema) })) }];
    }
    return {
      url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body,
    };
  },

  parseResponse(json, model) {
    const cand = json.candidates?.[0];
    const parts = cand?.content?.parts ?? [];
    const content = [];
    const reasoning = [];
    parts.forEach((p, i) => {
      if (p.thought && p.text) reasoning.push(p.text);
      else if (p.text) content.push({ type: 'text', text: p.text });
      else if (p.functionCall) {
        content.push({ type: 'tool_call', id: p.functionCall.id ?? `gemini_call_${Date.now().toString(36)}_${i}`, name: p.functionCall.name, input: p.functionCall.args ?? {} });
      }
    });
    const hasCalls = content.some((b) => b.type === 'tool_call');
    const fr = cand?.finishReason;
    const stopReason = hasCalls ? 'tool_use'
      : !cand ? 'refusal'
      : fr === 'MAX_TOKENS' ? 'max_tokens'
      : ['SAFETY', 'PROHIBITED_CONTENT', 'RECITATION', 'BLOCKLIST', 'SPII'].includes(fr) ? 'refusal'
      : 'end';
    const u = json.usageMetadata ?? {};
    return {
      content,
      reasoning: reasoning.join('\n\n'),
      stopReason,
      usage: { input: u.promptTokenCount ?? 0, output: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0), cacheRead: u.cachedContentTokenCount ?? 0 },
      native: { provider: 'gemini', model, content: cand?.content ?? { role: 'model', parts: [] } },
    };
  },
};
