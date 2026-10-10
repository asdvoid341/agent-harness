import { TOOL_INFO } from './icons.js';
import { esc, fmtTokens, fmtMs } from './util.js';

/**
 * "Anatomy of this answer": two small analytical charts that turn raw KPIs
 * into insight.
 *   1. Context per call: a stacked bar per AI call showing what the model
 *      re-read (system prompt, tool definitions, conversation, tool results).
 *   2. Time waterfall: every step of the latest question on one timeline.
 * Built from harness events only.
 */
const SEGMENTS = [
  { key: 'system', label: 'Instructions', cls: 'seg-system', tip: 'The system prompt: role, rules, tables, memory' },
  { key: 'tools', label: 'Tool manuals', cls: 'seg-tools', tip: 'Descriptions and schemas of the 4 tools' },
  { key: 'conversation', label: 'Conversation', cls: 'seg-conv', tip: 'Your questions, the model’s replies and tool requests' },
  { key: 'toolResults', label: 'Tool results', cls: 'seg-results', tip: 'Data returned by tools (query rows, chart summaries…)' },
];
const KIND = {
  model: { label: 'AI model', cls: 'k-model' },
  tool: { label: 'Tools', cls: 'k-tool' },
  wait: { label: 'Waiting for you', cls: 'k-wait' },
  compact: { label: 'Summarizing', cls: 'k-memory' },
};

export function createAnalytics({ root, bus }) {
  root.innerHTML = `
    <div class="anatomy-grid">
      <section class="viz">
        <h4>What the model reads on every call</h4>
        <p class="viz-sub">The model keeps nothing between calls, so each call re-sends the whole conversation.</p>
        <div class="viz-body" data-el="ctx"></div>
        <div class="legend">${SEGMENTS.map((s) => `<span title="${esc(s.tip)}"><i class="${s.cls}"></i>${s.label}</span>`).join('')}</div>
        <p class="insight" data-el="ctx-insight"></p>
      </section>
      <section class="viz">
        <h4>Where the time went</h4>
        <p class="viz-sub">Each step of the latest question, on one timeline.</p>
        <div class="viz-body" data-el="time"></div>
        <div class="legend">${Object.values(KIND).map((k) => `<span><i class="${k.cls}"></i>${k.label}</span>`).join('')}</div>
        <p class="insight" data-el="time-insight"></p>
      </section>
    </div>`;

  const el = (n) => root.querySelector(`[data-el="${n}"]`);
  let calls = [];
  let spans = [];
  let t0 = 0;
  let tEnd = null;
  let ticker = null;
  const now = () => Math.round(performance.now() - bus.t0);

  // ── Chart 1: context per call ───────────────────────────────────────────
  function renderContext() {
    const body = el('ctx');
    if (!calls.length) {
      body.innerHTML = '<p class="viz-empty">Appears after the first AI call.</p>';
      el('ctx-insight').textContent = '';
      return;
    }
    const scaled = calls.map((c) => {
      const est = SEGMENTS.reduce((s, seg) => s + c.b[seg.key], 0) || 1;
      const k = c.actual ? c.actual / est : 1;
      const parts = Object.fromEntries(SEGMENTS.map((seg) => [seg.key, c.b[seg.key] * k]));
      return { ...c, parts, total: c.actual ?? est, measured: !!c.actual };
    });
    const max = Math.max(...scaled.map((c) => c.total));
    body.innerHTML = scaled
      .map(
        (c) => `<div class="bar-row">
          <span class="bar-label">Call ${c.n}</span>
          <div class="bar-track">${SEGMENTS.map((s) => {
            const w = (c.parts[s.key] / max) * 100;
            return w > 0 ? `<i class="${s.cls}" style="width:${w.toFixed(2)}%" title="${s.label}: ~${fmtTokens(Math.round(c.parts[s.key]))} tokens"></i>` : '';
          }).join('')}</div>
          <span class="bar-value">${c.measured ? '' : '~'}${fmtTokens(Math.round(c.total))}${c.out != null ? `<small> → ${fmtTokens(c.out)}</small>` : ''}</span>
        </div>`,
      )
      .join('');

    const done = scaled.filter((c) => c.measured);
    if (done.length >= 2) {
      const read = done.reduce((s, c) => s + c.total, 0);
      const distinct = done.at(-1).total;
      const reread = Math.max(0, 1 - distinct / read);
      el('ctx-insight').innerHTML = `Across ${done.length} calls the model read <b>${fmtTokens(read)}</b> tokens, but only <b>${fmtTokens(distinct)}</b> were distinct: <b>${Math.round(reread * 100)}%</b> was re-reading. That is why long agent runs get expensive, and why prompt caching matters.`;
    } else if (done.length === 1) {
      const c = done[0];
      const fixed = (c.parts.system + c.parts.tools) / c.total;
      el('ctx-insight').innerHTML = `<b>${Math.round(fixed * 100)}%</b> of this call was fixed overhead (instructions and tool manuals), sent again with every call.`;
    } else {
      el('ctx-insight').textContent = '';
    }
  }

  // ── Chart 2: time waterfall ─────────────────────────────────────────────
  function renderTime() {
    const body = el('time');
    if (!spans.length) {
      body.innerHTML = '<p class="viz-empty">Appears when the agent starts working.</p>';
      el('time-insight').textContent = '';
      return;
    }
    const end = tEnd ?? now();
    const total = Math.max(1, end - t0);
    const rows = spans
      .map((s) => {
        const a = s.start - t0;
        const b = (s.end ?? end) - t0;
        const left = (a / total) * 100;
        const width = Math.max(0.8, ((b - a) / total) * 100);
        return `<div class="wf-row ${s.end == null ? 'open' : ''}">
          <span class="bar-label" title="${esc(s.label)}">${esc(s.label)}</span>
          <div class="wf-track"><i class="${KIND[s.kind].cls} ${s.bad ? 'bad' : ''}" style="left:${left.toFixed(2)}%;width:${width.toFixed(2)}%" title="${esc(s.label)}: ${fmtMs(b - a)}"></i></div>
          <span class="bar-value">${fmtMs(Math.round(b - a))}</span>
        </div>`;
      })
      .join('');
    body.innerHTML = `${rows}<div class="wf-axis"><span>0s</span><span>${fmtMs(Math.round(total / 2))}</span><span>${fmtMs(total)}</span></div>`;

    if (tEnd != null) {
      const sum = (kind) => spans.filter((s) => s.kind === kind).reduce((x, s) => x + ((s.end ?? end) - s.start), 0);
      const parts = ['model', 'tool', 'wait', 'compact']
        .map((k) => [k, sum(k)])
        .filter(([, v]) => v > 0)
        .map(([k, v]) => `${KIND[k].label}: <b>${Math.round((v / total) * 100)}%</b>`);
      const overhead = total - ['model', 'tool', 'wait', 'compact'].reduce((x, k) => x + sum(k), 0);
      const share = Math.round((sum('model') / total) * 100);
      el('time-insight').innerHTML = `${parts.join(' · ')}${overhead > 50 ? ` · harness: <b>${Math.round((overhead / total) * 100)}%</b>` : ''}. ${
        share >= 50 ? 'Waiting on the AI model dominates, which is typical: tools and the harness itself are fast.' : 'Most of the time was spent outside the AI model this time.'
      }`;
    } else {
      el('time-insight').textContent = '';
    }
  }

  function render() {
    renderContext();
    renderTime();
  }

  const closeSpan = (pred, t, extra = {}) => {
    const s = [...spans].reverse().find((x) => x.end == null && pred(x));
    if (s) Object.assign(s, { end: t }, extra);
  };

  bus.on((evt) => {
    const d = evt.data;
    const t = evt.t;
    switch (evt.type) {
      case 'run:start':
        calls = [];
        spans = [];
        t0 = t;
        tEnd = null;
        clearInterval(ticker);
        ticker = setInterval(renderTime, 250);
        break;
      case 'model:request':
        if (d.purpose === 'agent') calls.push({ n: d.iteration, b: d.breakdown });
        spans.push({ kind: d.purpose === 'compaction' ? 'compact' : 'model', label: d.purpose === 'compaction' ? 'Summarize' : `Think ${d.iteration}`, start: t });
        break;
      case 'model:response':
        if (d.purpose === 'agent' && calls.length) Object.assign(calls.at(-1), { actual: d.usage.input, out: d.usage.output });
        closeSpan((s) => s.kind === 'model' || s.kind === 'compact', t);
        break;
      case 'run:error':
        closeSpan(() => true, t, { bad: true });
        break;
      case 'tool:execute':
        spans.push({ kind: 'tool', id: d.id, label: `Act: ${TOOL_INFO[d.name]?.title ?? d.name}`, start: t });
        break;
      case 'tool:result':
        closeSpan((s) => s.id === d.id, t, { bad: d.isError });
        break;
      case 'guardrail:approval':
        spans.push({ kind: 'wait', id: `wait-${d.id}`, label: 'Your approval', start: t });
        break;
      case 'guardrail:decision':
        closeSpan((s) => s.id === `wait-${d.id}`, t);
        break;
      case 'run:end':
        tEnd = t;
        spans.forEach((s) => (s.end ??= t));
        clearInterval(ticker);
        break;
      default:
        return;
    }
    render();
  });

  render();
}
