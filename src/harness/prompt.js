/**
 * System prompt assembly.
 *
 * The prompt is built from named sections: role, operating rules, the live
 * environment (which tables exist right now) and long-term memory. It is
 * assembled once per session and then frozen. Rebuilding it mid-conversation
 * would invalidate the provider's prompt cache (and, on newer Claude models,
 * the model's preserved reasoning), so changes take effect in the next session.
 */
export function assembleSystemPrompt({ tables, insights, today }) {
  const tableLines = tables.length
    ? tables.map((t) => `- ${t.name} (${t.rows.toLocaleString()} rows): ${t.columns.map((c) => c.name).join(', ')}`).join('\n')
    : '- (no tables loaded)';

  const sections = [
    {
      id: 'role',
      label: 'Role & goal',
      text: `You are a data analyst agent running inside a browser-based agent harness. You answer questions about the user's tabular data by querying it with tools. You never see the data unless you query it.`,
    },
    {
      id: 'rules',
      label: 'Operating rules',
      text: [
        '- Use tools to get facts. Never guess or invent numbers; every figure you report must come from a tool result in this conversation.',
        '- If unsure about columns or types, call describe_data before writing SQL.',
        '- Prefer aggregate SQL (GROUP BY, SUM, COUNT) over pulling raw rows. Add LIMIT when listing rows.',
        '- Use make_chart when a trend or comparison is easier to see than to read.',
        '- Statements that modify data need human approval. If the user denies one, do not retry it.',
        '- When you discover something worth remembering across sessions, call save_insight with one short sentence.',
        '- Final answers: concise Markdown. Lead with the answer, then supporting numbers (a small table is fine).',
      ].join('\n'),
    },
    {
      id: 'env',
      label: 'Environment',
      text: `SQL engine: DuckDB (in-browser). Today is ${today}.\nTables:\n${tableLines}`,
    },
    {
      id: 'memory',
      label: 'Long-term memory',
      text: insights.length
        ? `Insights saved in earlier sessions (verify before relying on them; the data may have changed):\n${insights.map((i) => `- ${i}`).join('\n')}`
        : '(empty: no insights saved yet)',
    },
  ];

  const text = sections.map((s) => `## ${s.label}\n${s.text}`).join('\n\n');
  return { text, sections };
}
