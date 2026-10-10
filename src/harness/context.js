/**
 * Context management.
 *
 * The model is stateless: every call resends the whole conversation, so the
 * harness must keep that conversation within a budget. Three rules here:
 *
 *  1. Measure it. We estimate tokens (~4 chars/token) before each call and
 *     show the provider's real count after.
 *  2. Keep history append-only. Editing or snipping earlier turns breaks
 *     prompt caching, and on newer Claude models it invalidates the model's
 *     preserved reasoning from later turns.
 *  3. When over budget, compact: summarize the session into one message and
 *     start fresh with that summary + the new user turn. Big tool outputs are
 *     truncated *before* they enter history, never edited afterwards.
 */
export const estimateTokens = (value) => {
  const s = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  return Math.ceil((s?.length ?? 0) / 4);
};

export function measureContext({ system, tools, messages }) {
  const sys = estimateTokens(system);
  const tl = estimateTokens(tools);
  const perMessage = messages.map((m) => estimateTokens(m.native ?? m.content));
  const history = perMessage.reduce((a, b) => a + b, 0);
  return { system: sys, tools: tl, history, total: sys + tl + history, messages: messages.length };
}

export function truncate(text, maxChars) {
  if (text.length <= maxChars) return { text, truncated: false, originalLength: text.length };
  return {
    text: `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} chars by the harness. Narrow the query (aggregate, filter, LIMIT) to see less.]`,
    truncated: true,
    originalLength: text.length,
  };
}

/** Flatten the conversation into a plain transcript for the summarizer. */
export function transcriptForSummary(messages) {
  const clip = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);
  const lines = [];
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === 'text') lines.push(`${m.role.toUpperCase()}: ${b.text}`);
      else if (b.type === 'tool_call') lines.push(`ASSISTANT called ${b.name}(${clip(JSON.stringify(b.input), 600)})`);
      else if (b.type === 'tool_result') lines.push(`TOOL RESULT ${b.name}${b.isError ? ' (error)' : ''}: ${clip(b.output, 900)}`);
    }
  }
  return lines.join('\n');
}

export const COMPACTION_SYSTEM =
  'You compress agent sessions. Write a faithful, compact summary that lets the same agent continue the work without the original transcript.';

export const COMPACTION_INSTRUCTIONS = `Summarize the session transcript below for the agent that will continue it.
Keep: the user's goals and preferences, tables and columns that were used, exact figures and findings already reported, any data modifications made, and open questions.
Drop: raw tool output and anything that can be re-queried cheaply.
Use short bullet points. Do not invent anything that is not in the transcript.`;
