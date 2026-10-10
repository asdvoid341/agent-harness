/**
 * Anthropic Messages API adapter (raw HTTP so the exact request is visible).
 *
 * Notes on current Claude models:
 *  - Calling from a browser requires `anthropic-dangerous-direct-browser-access`.
 *    It's "dangerous" for apps that embed their own key; here each visitor
 *    brings their own key, which is the intended use.
 *  - Thinking is adaptive; we ask for a readable summary so the inspector can
 *    show the model's reasoning. Thinking blocks are replayed verbatim
 *    (via `native`), which is why the harness keeps history append-only.
 *  - `fallbacks: "default"` lets the API retry a refused request on a fallback model.
 *  - Top-level `cache_control` turns on automatic prompt caching.
 */
const MODERN = ['claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5'];
const FALLBACK_CAPABLE = new Set(['claude-opus-5-5', 'claude-sonnet-5-5']);

export function toAnthropicMessages(messages, model, nativeProvider = 'anthropic') {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      if (m.native?.provider === nativeProvider && m.native.model === model) return { role: 'assistant', content: m.native.content };
      return {
        role: 'assistant',
        content: m.content
          .filter((b) => b.type !== 'text' || b.text)
          .map((b) => (b.type === 'text' ? { type: 'text', text: b.text } : { type: 'tool_use', id: b.id, name: b.name, input: b.input })),
      };
    }
    return {
      role: 'user',
      content: m.content.map((b) =>
        b.type === 'text'
          ? { type: 'text', text: b.text }
          : { type: 'tool_result', tool_use_id: b.id, content: b.output, ...(b.isError && { is_error: true }) },
      ),
    };
  });
}

export function parseAnthropicResponse(json, model, nativeProvider = 'anthropic') {
  const content = [];
  const reasoning = [];
  for (const b of json.content ?? []) {
    if (b.type === 'text' && b.text) content.push({ type: 'text', text: b.text });
    else if (b.type === 'tool_use') content.push({ type: 'tool_call', id: b.id, name: b.name, input: b.input ?? {} });
    else if (b.type === 'thinking' && b.thinking) reasoning.push(b.thinking);
  }
  const stopMap = { tool_use: 'tool_use', end_turn: 'end', stop_sequence: 'end', pause_turn: 'end', max_tokens: 'max_tokens', refusal: 'refusal' };
  const u = json.usage ?? {};
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return {
    content,
    reasoning: reasoning.join('\n\n'),
    stopReason: stopMap[json.stop_reason] ?? json.stop_reason,
    usage: { input: (u.input_tokens ?? 0) + cacheRead + cacheWrite, output: u.output_tokens ?? 0, cacheRead, cacheWrite },
    native: { provider: nativeProvider, model, content: json.content },
  };
}

export const anthropic = {
  id: 'anthropic',
  label: 'Anthropic (Claude)',
  keyPlaceholder: 'sk-ant-…',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  models: MODERN,
  defaultModel: 'claude-opus-5-5',
  supportsEffort: true,

  buildRequest({ system, tools, messages, model, apiKey, effort = 'medium' }) {
    const headers = {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    };
    const body = {
      model,
      max_tokens: 16000,
      system,
      messages: toAnthropicMessages(messages, model),
    };
    if (tools.length) body.tools = tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema }));
    if (MODERN.includes(model)) {
      body.thinking = { type: 'adaptive', display: 'summarized' };
      body.output_config = { effort };
      body.cache_control = { type: 'ephemeral' };
    }
    if (FALLBACK_CAPABLE.has(model)) {
      headers['anthropic-beta'] = 'server-side-fallback-2026-07-01';
      body.fallbacks = 'default';
    }
    return { url: 'https://api.anthropic.com/v1/messages', headers, body };
  },

  parseResponse: (json, model) => parseAnthropicResponse(json, model),
};
