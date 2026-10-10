/**
 * The data-analyst agent's tools.
 *
 * Each tool returns two channels:
 *   content: compact JSON the *model* reads (kept small to save context)
 *   display: rich payload the *user* sees (full tables, charts)
 * and some carry a `policy` that the harness enforces before running them.
 */

const READ = new Set(['select', 'with', 'describe', 'show', 'summarize', 'explain', 'from', 'values', 'pivot', 'unpivot', 'table']);
const WRITE = new Set(['insert', 'update', 'delete', 'create', 'drop', 'alter', 'truncate']);

/** SQL policy: read-only → allow, writes → ask a human, everything else → deny. */
export function classifySql(sql) {
  const statements = sql
    .split(';')
    .map((st) => st.replace(/^(\s*--[^\n]*\n?)+/g, '').replace(/^\s*\/\*[\s\S]*?\*\//, '').trim())
    .filter(Boolean);
  if (!statements.length) return { decision: 'deny', reason: 'The SQL is empty.' };
  if (/\b(read_csv\w*|read_parquet|read_json\w*|read_text|read_blob|glob)\s*\(/i.test(sql) || /'(https?|s3|gs|file):\/\//i.test(sql)) {
    return { decision: 'deny', reason: 'Reading files or URLs from SQL is not allowed. The agent may only use tables that are already loaded.' };
  }
  const writes = [];
  for (const st of statements) {
    const kw = (st.match(/^\(*\s*([a-z]+)/i)?.[1] ?? '').toLowerCase();
    if (READ.has(kw)) continue;
    if (WRITE.has(kw)) {
      writes.push(kw.toUpperCase());
      continue;
    }
    return { decision: 'deny', reason: `"${kw.toUpperCase() || '?'}" statements are blocked by policy. Only read queries run freely; data changes need approval.` };
  }
  if (writes.length) return { decision: 'ask', reason: `This statement changes data (${[...new Set(writes)].join(', ')}). Read-only queries run automatically, but writes need a human to approve them.` };
  return { decision: 'allow', reason: 'Read-only query: runs without approval.' };
}

/** Guess how to format chart values from the column names. */
function valueFormat(columns) {
  if (columns.some((c) => /revenue|sales|price|cost|amount|target|spend|profit|income|usd|\$/i.test(c))) return 'currency';
  if (columns.some((c) => /pct|percent|share|rate|ratio/i.test(c))) return 'percent';
  return 'number';
}

export function createAnalystTools({ db, memory, onDataChanged }) {
  const describe_data = {
    name: 'describe_data',
    description:
      'List the available tables, or describe one table: its columns with types, row count and 3 sample rows. Call this before writing SQL if you are not sure about table or column names.',
    schema: {
      type: 'object',
      properties: { table: { type: 'string', description: 'Table to describe. Omit to list all tables.' } },
      additionalProperties: false,
    },
    async run({ table } = {}) {
      const tables = await db.tables();
      if (!table) {
        return {
          content: { tables: tables.map((t) => ({ name: t.name, rows: t.rows, columns: t.columns.map((c) => `${c.name} ${c.type}`) })) },
          display: { kind: 'tables', tables },
        };
      }
      const t = tables.find((x) => x.name === table);
      if (!t) throw new Error(`No table named "${table}". Available tables: ${tables.map((x) => x.name).join(', ') || '(none)'}`);
      const sample = await db.query(`SELECT * FROM "${t.name}" LIMIT 3`);
      return {
        content: { table: t.name, rows: t.rows, columns: t.columns, sample: sample.rows },
        display: { kind: 'table', columns: sample.columns.map((c) => c.name), rows: sample.rows, rowCount: t.rows, caption: `${t.name}: ${t.rows.toLocaleString()} rows (sample)` },
      };
    },
  };

  const run_sql = {
    name: 'run_sql',
    description:
      'Run one DuckDB SQL statement against the loaded tables and return the result rows (the model sees at most 50 rows). Prefer aggregates. Read-only queries run immediately; INSERT/UPDATE/DELETE/CREATE/DROP/ALTER require the user to approve.',
    schema: {
      type: 'object',
      properties: {
        sql: { type: 'string', minLength: 1, description: 'A single DuckDB SQL statement.' },
        purpose: { type: 'string', maxLength: 120, description: 'Short note on why you are running this query (shown to the user).' },
      },
      required: ['sql'],
      additionalProperties: false,
    },
    policy: ({ sql }) => classifySql(sql),
    async run({ sql }) {
      const res = await db.query(sql);
      const columns = res.columns.map((c) => c.name);
      if (classifySql(sql).decision === 'ask') onDataChanged?.();
      return {
        content: {
          columns,
          rowCount: res.rows.length,
          rows: res.rows.slice(0, 50),
          ...(res.rows.length > 50 && { note: `Showing 50 of ${res.rows.length} rows. Aggregate or add LIMIT to see less.` }),
        },
        display: { kind: 'table', columns, rows: res.rows.slice(0, 200), rowCount: res.rows.length },
      };
    },
  };

  const make_chart = {
    name: 'make_chart',
    description:
      'Render a chart for the user from a read-only SQL query. `x` is the label column, `y` lists 1-4 numeric columns. For one line/bar per group (e.g. per category), give a single y column and set `series` to the grouping column. Write `title` as the takeaway (e.g. "Electronics drives the year-end spike"), put what is plotted in `subtitle`, and use `highlight` to emphasize the series or label you are talking about. Returns per-series totals and peaks so you can describe the chart.',
    schema: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: ['bar', 'line', 'pie', 'doughnut'] },
        title: { type: 'string', minLength: 1, maxLength: 100, description: 'The takeaway, as a short sentence.' },
        subtitle: { type: 'string', maxLength: 120, description: 'What is plotted, with units, e.g. "Monthly revenue by category, 2025 (USD)".' },
        highlight: { type: 'string', maxLength: 80, description: 'Optional series name (or x label) to emphasize; others are muted.' },
        sql: { type: 'string', minLength: 1, description: 'Read-only query producing the chart data, ordered as it should be plotted.' },
        x: { type: 'string', description: 'Column used for labels / x-axis.' },
        y: { type: 'array', items: { type: 'string' }, minItems: 1, maxItems: 4, description: 'Numeric column(s) to plot.' },
        series: { type: 'string', description: 'Optional grouping column: one dataset per distinct value (uses y[0]).' },
      },
      required: ['type', 'title', 'sql', 'x', 'y'],
      additionalProperties: false,
    },
    policy: ({ sql }) => {
      const p = classifySql(sql);
      return p.decision === 'allow' ? p : { decision: 'deny', reason: 'make_chart only accepts read-only queries.' };
    },
    async run({ type, title, subtitle, highlight, sql, x, y, series }) {
      const res = await db.query(sql);
      const cols = res.columns.map((c) => c.name);
      const missing = [x, ...y, ...(series ? [series] : [])].filter((c) => !cols.includes(c));
      if (missing.length) throw new Error(`Column(s) not in query result: ${missing.join(', ')}. The query returned: ${cols.join(', ')}`);
      if (!res.rows.length) throw new Error('The query returned no rows, so there is nothing to chart.');

      let labels;
      let datasets;
      if (series) {
        labels = [...new Set(res.rows.map((r) => String(r[x])))];
        const groups = [...new Set(res.rows.map((r) => String(r[series])))].slice(0, 12);
        datasets = groups.map((g) => {
          const byX = new Map(res.rows.filter((r) => String(r[series]) === g).map((r) => [String(r[x]), Number(r[y[0]])]));
          return { label: g, data: labels.map((l) => byX.get(l) ?? 0) };
        });
      } else {
        labels = res.rows.map((r) => String(r[x]));
        datasets = y.map((col) => ({ label: col, data: res.rows.map((r) => Number(r[col])) }));
      }
      labels = labels.slice(0, 120);
      datasets.forEach((d) => (d.data = d.data.slice(0, 120)));

      const round = (n) => Math.round(n * 100) / 100;
      const summary = datasets.map((d) => {
        let hi = 0;
        let lo = 0;
        d.data.forEach((v, i) => {
          if (v > d.data[hi]) hi = i;
          if (v < d.data[lo]) lo = i;
        });
        return { series: d.label, total: round(d.data.reduce((a, b) => a + b, 0)), peak: { x: labels[hi], y: round(d.data[hi]) }, low: { x: labels[lo], y: round(d.data[lo]) } };
      });
      return {
        content: { rendered: true, type, title, points: labels.length, series: summary, ...(res.rows.length <= 12 && { rows: res.rows }) },
        display: { kind: 'chart', spec: { type, title, subtitle, highlight, labels, datasets, format: valueFormat(y) } },
      };
    },
  };

  const save_insight = {
    name: 'save_insight',
    description:
      'Save one short, durable insight to long-term memory (e.g. "West is the fastest-growing region in 2025"). Saved insights are added to the system prompt of future sessions. Only save facts you verified with a tool.',
    schema: {
      type: 'object',
      properties: { insight: { type: 'string', minLength: 5, maxLength: 240 } },
      required: ['insight'],
      additionalProperties: false,
    },
    async run({ insight }) {
      const total = memory.add(insight);
      return { content: { saved: true, totalInsights: total, note: 'Takes effect in the next session (the current system prompt is frozen).' }, display: { kind: 'memory', insight } };
    },
  };

  return [describe_data, run_sql, make_chart, save_insight];
}
