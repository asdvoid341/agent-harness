/**
 * OpenAI Chat Completions adapter.
 *
 * Differences the adapter hides from the harness:
 *  - the system prompt is a message, not a separate field
 *  - tool arguments arrive as a JSON *string* (which can be malformed)
 *  - each tool result is its own `role: "tool"` message
 */
export const openai = {
  id: 'openai',
  label: 'OpenAI',
  keyPlaceholder: 'sk-…',
  keyUrl: 'https://platform.openai.com/api-keys',
  models: ['gpt-5', 'gpt-5-mini', 'gpt-4.1', 'gpt-4.1-mini'],
  defaultModel: 'gpt-5-mini',
  supportsEffort: false,

  buildRequest({ system, tools, messages, model, apiKey }) {
    const out = [{ role: 'system', content: system }];
    for (const m of messages) {
      if (m.role === 'assistant') {
        const text = m.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
        const calls = m.content.filter((b) => b.type === 'tool_call');
        out.push({
          role: 'assistant',
          content: text || null,
          ...(calls.length && {
            tool_calls: calls.map((c) => ({ id: c.id, type: 'function', function: { name: c.name, arguments: JSON.stringify(c.input) } })),
          }),
        });
        continue;
      }
      const texts = m.content.filter((b) => b.type === 'text');
      if (texts.length) out.push({ role: 'user', content: texts.map((b) => b.text).join('\n\n') });
      for (const r of m.content.filter((b) => b.type === 'tool_result')) {
        out.push({ role: 'tool', tool_call_id: r.id, content: r.isError ? `[error] ${r.output}` : r.output });
      }
    }
    const body = { model, messages: out };
    if (tools.length) body.tools = tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.schema } }));
    return {
      url: 'https://api.openai.com/v1/chat/completions',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body,
    };
  },

  parseResponse(json, model) {
    const choice = json.choices?.[0] ?? {};
    const msg = choice.message ?? {};
    const content = [];
    if (msg.content) content.push({ type: 'text', text: msg.content });
    for (const tc of msg.tool_calls ?? []) {
      let input = {};
      let inputError;
      try {
        input = JSON.parse(tc.function?.arguments || '{}');
      } catch {
        inputError = `Arguments were not valid JSON: ${String(tc.function?.arguments).slice(0, 200)}`;
      }
      content.push({ type: 'tool_call', id: tc.id, name: tc.function?.name, input, ...(inputError && { inputError }) });
    }
    const stopMap = { tool_calls: 'tool_use', stop: 'end', length: 'max_tokens', content_filter: 'refusal' };
    const u = json.usage ?? {};
    return {
      content,
      reasoning: '',
      stopReason: stopMap[choice.finish_reason] ?? choice.finish_reason,
      usage: { input: u.prompt_tokens ?? 0, output: u.completion_tokens ?? 0, cacheRead: u.prompt_tokens_details?.cached_tokens ?? 0 },
      native: { provider: 'openai', model, message: msg },
    };
  },
};
