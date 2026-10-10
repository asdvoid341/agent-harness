/**
 * Scripts for the demo model. Each script is a list of steps; step N runs when
 * the model is called for the Nth time within a run. Steps read the *real*
 * tool results from the request body, so every number in a demo answer comes
 * from DuckDB, exactly like it would with a real model.
 *
 * Each scenario shows a different part of the harness:
 *   1. Multi-step analysis, a chart and parallel tool calls with memory
 *   2. A destructive write → policy "ask" → human approval
 *   3. A malformed tool call → validation error → model self-corrects
 *   4. Joins across tables + a multi-series chart
 */
const money = (v) => `$${Math.round(Number(v) || 0).toLocaleString('en-US')}`;
const pct = (v) => `${(Number(v) * 100).toFixed(1)}%`;
const rowsOf = (r) => r?.data?.rows ?? [];
const TARGETS_SQL = 'SELECT s.region, ROUND(SUM(s.revenue), 2) AS revenue, t.target\nFROM sales s\nJOIN (SELECT region, SUM(revenue_target) AS target FROM targets GROUP BY region) t USING (region)\nGROUP BY s.region, t.target\nORDER BY revenue DESC';
const list = (xs) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

export const SUGGESTIONS = [
  'Which product category drives the most revenue, and how did it trend month by month?',
  'How did each region perform against its 2025 revenue targets?',
  'Who are our top 5 customers by revenue?',
  'Delete all orders with fewer than 2 units.',
];

const SCRIPTS = [
  {
    prompt: SUGGESTIONS[0],
    steps: [
      () => ({
        reasoning: 'The user wants a ranking of categories by revenue plus a monthly trend. I should check the schema first so I use the real column names.',
        text: "I'll start by checking the structure of the sales table.",
        calls: [{ name: 'describe_data', input: { table: 'sales' } }],
      }),
      () => ({
        reasoning: 'Columns include order_date, category, units and revenue. Aggregate revenue by category, highest first.',
        calls: [{ name: 'run_sql', input: { sql: 'SELECT category, ROUND(SUM(revenue), 2) AS revenue, SUM(units) AS units, COUNT(*) AS orders\nFROM sales\nGROUP BY category\nORDER BY revenue DESC', purpose: 'Rank categories by revenue' } }],
      }),
      ({ results }) => {
        const top = rowsOf(results[1])[0] ?? { category: 'Electronics', revenue: 0 };
        return {
          reasoning: `${top.category} leads. Now I'll chart monthly revenue per category to show the trend. Saving the headline insight can run at the same time, so I'll make both calls in one turn.`,
          calls: [
            {
              name: 'make_chart',
              input: {
                type: 'line',
                title: `${top.category} drives the year-end revenue spike`,
                subtitle: 'Monthly revenue by category, 2025 (USD)',
                highlight: top.category,
                sql: "SELECT strftime(order_date, '%Y-%m') AS month, category, ROUND(SUM(revenue), 2) AS revenue\nFROM sales\nGROUP BY 1, 2\nORDER BY 1, 2",
                x: 'month',
                y: ['revenue'],
                series: 'category',
              },
            },
            { name: 'save_insight', input: { insight: `${top.category} is the top revenue category in 2025 (${money(top.revenue)}).` } },
          ],
        };
      },
      ({ results }) => {
        const cats = rowsOf(results[1]);
        const total = cats.reduce((s, c) => s + Number(c.revenue), 0) || 1;
        const top = cats[0] ?? { category: '?', revenue: 0 };
        const series = results[2]?.data?.series ?? [];
        const topSeries = series.find((s) => s.series === top.category);
        const table = cats.map((c) => `| ${c.category} | ${money(c.revenue)} | ${pct(c.revenue / total)} | ${Number(c.units).toLocaleString()} |`).join('\n');
        return {
          reasoning: 'I have the ranking and the chart summary. Time to write the answer using only these numbers.',
          text: `**${top.category}** drives the most revenue: **${money(top.revenue)}**, or ${pct(top.revenue / total)} of the 2025 total.

| Category | Revenue | Share | Units |
|---|---:|---:|---:|
${table}

**Trend:** see the chart above. ${topSeries ? `${top.category} peaked in **${topSeries.peak.x}** (${money(topSeries.peak.y)}) and was lowest in ${topSeries.low.x} (${money(topSeries.low.y)}), a clear year-end spike.` : ''} Office Supplies sells the most units but at low prices, so its revenue stays small.

_I saved the headline finding to long-term memory. It will be part of the system prompt in your next session._`,
        };
      },
    ],
  },
  {
    prompt: SUGGESTIONS[1],
    steps: [
      () => ({
        reasoning: 'This needs both actual revenue and targets. Let me list the tables to see how targets are stored.',
        calls: [{ name: 'describe_data', input: {} }],
      }),
      () => ({
        reasoning: 'There is a `targets` table with region, quarter and revenue_target. I will aggregate both sides to region level and join them.',
        text: 'Targets are stored per region and quarter. Joining them against actual sales:',
        calls: [{ name: 'run_sql', input: { sql: TARGETS_SQL, purpose: 'Compare 2025 revenue with target per region' } }],
      }),
      ({ results }) => {
        const rows = rowsOf(results[1]).map((r) => ({ ...r, att: Number(r.revenue) / Number(r.target) }));
        const best = [...rows].sort((a, b) => b.att - a.att)[0];
        const worst = [...rows].sort((a, b) => a.att - b.att)[0];
        const gap = (r) => `${Math.abs(Math.round((r.att - 1) * 100))}%`;
        const title = best && worst && worst.att < 1
          ? `${worst.region} missed its target by ${gap(worst)}; ${best.region} beat it by ${gap(best)}`
          : 'Every region beat its 2025 target';
        return {
          reasoning: `${best?.region} is furthest above target and ${worst?.region} furthest below. A grouped bar chart makes the gap visible; I'll highlight ${worst?.region}.`,
          calls: [{ name: 'make_chart', input: { type: 'bar', title, subtitle: 'Revenue vs target by region, 2025 (USD)', highlight: worst?.region, sql: TARGETS_SQL, x: 'region', y: ['revenue', 'target'] } }],
        };
      },
      ({ results }) => {
        const rows = rowsOf(results[1]).map((r) => ({ ...r, att: Number(r.revenue) / Number(r.target) }));
        const beat = rows.filter((r) => r.att >= 1).map((r) => r.region);
        const missed = rows.filter((r) => r.att < 1).map((r) => r.region);
        const best = [...rows].sort((a, b) => b.att - a.att)[0];
        const worst = [...rows].sort((a, b) => a.att - b.att)[0];
        const table = rows.map((r) => `| ${r.region} | ${money(r.revenue)} | ${money(r.target)} | ${pct(r.att)} ${r.att >= 1 ? '✅' : '⚠️'} |`).join('\n');
        return {
          reasoning: 'Compute attainment = revenue / target for each region and summarize who beat and who missed.',
          text: `${beat.length ? `**${list(beat)}** beat target` : 'No region beat target'}${missed.length ? `, while **${list(missed)}** fell short` : ''}.

| Region | Revenue | Target | Attainment |
|---|---:|---:|---:|
${table}

${best ? `**${best.region}** over-delivered the most (${pct(best.att)} of target).` : ''} ${worst && worst !== best ? `**${worst.region}** is furthest behind at ${pct(worst.att)}.` : ''}`,
        };
      },
    ],
  },
  {
    prompt: SUGGESTIONS[2],
    steps: [
      () => ({
        reasoning: 'Sum revenue per customer and take the top 5.',
        calls: [{ name: 'run_sql', input: { query: 'SELECT customer, SUM(revenue) AS revenue FROM sales GROUP BY customer ORDER BY revenue DESC LIMIT 5' } }],
      }),
      ({ results }) => ({
        reasoning: `The harness rejected my call: ${results[0]?.raw?.split('\n')[1] ?? 'invalid arguments'}. The schema says the parameter is \`sql\`, not \`query\`. I'll fix that, and add each customer's segment and region while I'm at it.`,
        text: 'My first call used the wrong parameter name. Fixing it:',
        calls: [{ name: 'run_sql', input: { sql: 'SELECT customer, segment, region, ROUND(SUM(revenue), 2) AS revenue, COUNT(*) AS orders\nFROM sales\nGROUP BY customer, segment, region\nORDER BY revenue DESC\nLIMIT 5', purpose: 'Top 5 customers by revenue' } }],
      }),
      ({ results }) => {
        const rows = rowsOf(results[1]);
        const table = rows.map((r, i) => `| ${i + 1} | ${r.customer} | ${r.segment} | ${r.region} | ${money(r.revenue)} | ${r.orders} |`).join('\n');
        const enterprise = rows.filter((r) => r.segment === 'Enterprise').length;
        return {
          text: `Your top 5 customers by 2025 revenue:

| # | Customer | Segment | Region | Revenue | Orders |
|---|---|---|---|---:|---:|
${table}

${enterprise === rows.length ? `All ${rows.length}` : `${enterprise} of the top ${rows.length}`} are Enterprise accounts. **${rows[0]?.customer ?? '?'}** leads with ${money(rows[0]?.revenue)}.`,
        };
      },
    ],
  },
  {
    prompt: SUGGESTIONS[3],
    steps: [
      () => ({
        reasoning: 'This is destructive. Before deleting anything I should measure the impact so the user can make an informed approval decision.',
        text: 'Before deleting anything, let me check what would be affected.',
        calls: [{ name: 'run_sql', input: { sql: 'SELECT COUNT(*) AS orders, ROUND(SUM(revenue), 2) AS revenue\nFROM sales\nWHERE units < 2', purpose: 'Measure impact before deleting' } }],
      }),
      ({ results }) => {
        const r = rowsOf(results[0])[0] ?? {};
        return {
          reasoning: 'Now issue the DELETE. The harness policy will pause and ask the user to approve it.',
          text: `That's **${r.orders} orders** worth **${money(r.revenue)}** in revenue. Deleting them changes the data, so the harness will ask you to approve this.`,
          calls: [{ name: 'run_sql', input: { sql: 'DELETE FROM sales WHERE units < 2', purpose: 'Delete orders with fewer than 2 units' } }],
        };
      },
      ({ results }) => {
        const before = rowsOf(results[0])[0] ?? {};
        const del = results[1];
        if (!del || del.isError) {
          return { text: `No changes were made: the deletion **was not approved**. The ${before.orders ?? 'matching'} orders with fewer than 2 units are still in the table. Instead, I could exclude them from a specific analysis with \`WHERE units >= 2\`.` };
        }
        return { text: `Done. I deleted **${before.orders} orders** (${money(before.revenue)} of revenue) with fewer than 2 units. Use **Reset data** above the chat to restore the original dataset.` };
      },
    ],
  },
];

const FALLBACK = {
  steps: [
    () => ({
      reasoning: "This question isn't one of my scripted scenarios. I'm a scripted demo model, so I'll show what I can: list the tables, then explain.",
      calls: [{ name: 'describe_data', input: {} }],
    }),
    ({ results }) => {
      const tables = results[0]?.data?.tables ?? [];
      return {
        text: `I'm the **demo model**: a scripted stand-in that can only follow the suggested questions. Everything around me is real, though. The \`describe_data\` call you just saw went through validation, policy and execution against DuckDB in your browser.

Tables available: ${tables.map((t) => `\`${t.name}\` (${Number(t.rows).toLocaleString()} rows)`).join(', ') || '(none)'}.

To ask anything you like, open **Settings** and add an API key (Anthropic, OpenAI or Gemini). Your key stays in this browser tab.`,
      };
    },
  ],
};

let idCounter = 0;

/** Script engine: reads an Anthropic-shaped request body and returns an Anthropic-shaped response. */
export function scriptedResponse(body) {
  const msgs = body.messages ?? [];

  // A request with no tools is the compaction (summary) call.
  if (!body.tools?.length) {
    return reply(body, { text: '- Demo session summary: the user explored the sample sales data with the scripted analyst.\n- Figures reported earlier can be re-queried from the `sales` and `targets` tables.' });
  }

  let start = -1;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === 'user' && msgs[i].content.some((b) => b.type === 'text')) {
      start = i;
      break;
    }
  }
  const userText = (msgs[start]?.content.filter((b) => b.type === 'text').at(-1)?.text ?? '').trim();
  const after = msgs.slice(start + 1);
  const step = after.filter((m) => m.role === 'assistant').length;
  const results = after
    .filter((m) => m.role === 'user')
    .flatMap((m) => m.content.filter((b) => b.type === 'tool_result'))
    .map((b) => ({ id: b.tool_use_id, isError: !!b.is_error, raw: String(b.content), data: tryParse(b.content) }));

  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const script = SCRIPTS.find((s) => norm(s.prompt) === norm(userText)) ?? FALLBACK;
  const fn = script.steps[Math.min(step, script.steps.length - 1)];
  return reply(body, fn({ results, userText }));
}

function reply(body, { reasoning, text, calls = [] }) {
  const content = [];
  if (reasoning) content.push({ type: 'thinking', thinking: reasoning, signature: 'demo-signature' });
  if (text) content.push({ type: 'text', text });
  for (const c of calls) content.push({ type: 'tool_use', id: `toolu_demo_${(++idCounter).toString().padStart(3, '0')}`, name: c.name, input: c.input });
  const estimate = (v) => Math.ceil(JSON.stringify(v).length / 4);
  return {
    id: `msg_demo_${Date.now().toString(36)}`,
    type: 'message',
    role: 'assistant',
    model: body.model,
    content,
    stop_reason: calls.length ? 'tool_use' : 'end_turn',
    usage: { input_tokens: estimate([body.system, body.tools, body.messages]), output_tokens: estimate(content) },
  };
}

function tryParse(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
