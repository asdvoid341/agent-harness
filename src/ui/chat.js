import { $, esc, h, markdown, fmtTokens, fmtCost, fmtMs, shorten } from './util.js';
import { icon, TOOL_INFO } from './icons.js';

const compact = (v) => {
  const a = Math.abs(v);
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  return `${+v.toFixed(2)}`;
};

/** Right-align only columns whose cells are all numbers (money, %, counts). */
function alignNumericColumns(root) {
  const isNum = (s) => /^[\s$€£¥+\-−~]*[\d.,]+\s*[%kKmMbB]?(\s*[^\w\s]{1,3})?\s*$/.test(s.trim());
  root.querySelectorAll('table').forEach((table) => {
    const rows = [...table.querySelectorAll('tbody tr')];
    const cols = table.querySelector('tr')?.children.length ?? 0;
    for (let c = 0; c < cols; c++) {
      const cells = rows.map((r) => r.children[c]).filter(Boolean);
      if (cells.length && cells.every((td) => !td.textContent.trim() || isNum(td.textContent))) {
        table.querySelectorAll(`tr > :nth-child(${c + 1})`).forEach((el) => el.classList.add('num'));
      }
    }
  });
}

/** The left panel: the product. It renders purely from harness events. */
export function createChat({ root, bus, suggestions, onSuggestion }) {
  const log = $('#chat-log', root);
  const scroller = $('#chat', root);
  const chips = new Map();
  const charts = [];
  let typing = null;
  let runSources = [];
  let lastAnswer = null;

  const scrollDown = () => requestAnimationFrame(() => (scroller.scrollTop = scroller.scrollHeight));
  const add = (node) => {
    $('.welcome', log)?.classList.add('compact');
    log.append(node);
    if (typing) log.append(typing);
    scrollDown();
    return node;
  };

  function showWelcome() {
    log.append(h(`<div class="welcome">
      <p class="eyebrow">Try it</p>
      <h2>Ask the data a question</h2>
      <p>The agent can look at tables, run SQL in your browser (DuckDB), draw charts and save notes to memory. The sample data is a fictional retailer’s 2025 orders and regional targets, or upload your own CSV.</p>
      <div class="suggestion-grid">${suggestions.map((s) => `<button class="suggestion" type="button">${esc(s)}</button>`).join('')}</div>
    </div>`));
    log.querySelectorAll('.welcome .suggestion').forEach((b) => b.addEventListener('click', () => onSuggestion(b.textContent)));
  }

  function setTyping(label) {
    if (!label) {
      typing?.remove();
      typing = null;
      return;
    }
    if (!typing) typing = h(`<div class="typing"><span class="dots"><i></i><i></i><i></i></span><span class="label"></span></div>`);
    $('.label', typing).textContent = label;
    log.append(typing);
    scrollDown();
  }

  function notice(text, tone = 'info', iconName = 'info') {
    return add(h(`<div class="notice tone-${tone}">${icon(iconName, 16)}<div>${markdown(text)}</div></div>`));
  }

  // ── Rich displays ───────────────────────────────────────────────────────
  function renderTable({ columns, rows, rowCount, caption }) {
    if (!columns?.length) return `<p class="muted">No columns returned.</p>`;
    const fmt = (v) => (typeof v === 'number' && !Number.isInteger(v) ? v.toLocaleString('en-US', { maximumFractionDigits: 2 }) : v ?? '∅');
    return `<div class="table-wrap"><table>
      ${caption ? `<caption>${esc(caption)}</caption>` : ''}
      <thead><tr>${columns.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead>
      <tbody>${rows.map((r) => `<tr>${columns.map((c) => `<td>${esc(fmt(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody>
    </table></div>${rowCount > rows.length ? `<p class="muted small">Showing ${rows.length} of ${rowCount.toLocaleString()} rows.</p>` : ''}`;
  }

  /**
   * Charts follow a few data-viz rules: the title states the takeaway, the
   * subtitle says what is plotted, axes are formatted, gridlines are light,
   * and the series under discussion is highlighted while the rest are muted.
   */
  function renderChart(spec) {
    const card = add(h(`<figure class="chart-card">
      <figcaption><span class="chart-title">${esc(spec.title)}</span>${spec.subtitle ? `<span class="chart-sub">${esc(spec.subtitle)}</span>` : ''}</figcaption>
      <div class="chart-box"><canvas></canvas></div>
    </figure>`));
    if (!window.Chart) {
      $('.chart-box', card).textContent = 'Chart library failed to load.';
      return;
    }
    const css = getComputedStyle(document.documentElement);
    const v = (name) => css.getPropertyValue(name).trim();
    const palette = [1, 2, 3, 4, 5, 6].map((i) => v(`--series-${i}`));
    const muted = v('--series-muted');
    const text = v('--muted');
    const grid = v('--grid');
    const round = spec.type === 'pie' || spec.type === 'doughnut';
    const maxVal = Math.max(...spec.datasets.flatMap((d) => d.data));
    const fmt = (n) =>
      spec.format === 'currency' ? `$${compact(n)}`
      : spec.format === 'percent' ? `${+(maxVal <= 1 ? n * 100 : n).toFixed(1)}%`
      : compact(n);

    const hl = spec.highlight;
    const seriesHit = hl && spec.datasets.some((d) => d.label === hl);
    const labelHit = hl && !seriesHit && spec.labels.includes(hl);

    const datasets = spec.datasets.map((d, i) => {
      const base = palette[i % palette.length];
      const dim = seriesHit && d.label !== hl;
      let color = dim ? muted : base;
      if (seriesHit && d.label === hl) color = palette[0];
      const perPoint = labelHit && !round ? spec.labels.map((l) => (l === hl ? base : `${base}55`)) : null;
      return {
        ...d,
        backgroundColor: round ? spec.labels.map((l, j) => (labelHit && l !== hl ? muted : palette[j % palette.length])) : perPoint ?? color,
        borderColor: round ? v('--surface') : perPoint ?? color,
        borderWidth: round ? 2 : spec.type === 'line' ? (seriesHit && d.label === hl ? 3 : seriesHit ? 1.5 : 2) : 0,
        borderRadius: spec.type === 'bar' ? 4 : 0,
        pointRadius: spec.type === 'line' ? (seriesHit && d.label !== hl ? 0 : 2.5) : undefined,
        tension: 0.3,
        order: seriesHit && d.label === hl ? 0 : 1,
      };
    });

    charts.push(
      new window.Chart($('canvas', card), {
        type: spec.type,
        data: { labels: spec.labels, datasets },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 500 },
          interaction: { mode: 'index', intersect: false },
          plugins: {
            legend: { display: round || spec.datasets.length > 1, position: 'bottom', labels: { color: text, boxWidth: 8, boxHeight: 8, usePointStyle: true, pointStyle: 'circle', padding: 14 } },
            tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(c.parsed.y ?? c.parsed)}` } },
          },
          scales: round ? {} : {
            x: { ticks: { color: text, maxRotation: 0, autoSkip: true, autoSkipPadding: 12 }, grid: { display: false }, border: { color: grid } },
            y: { ticks: { color: text, callback: (n) => fmt(n), maxTicksLimit: 5 }, grid: { color: grid, drawTicks: false }, border: { display: false }, beginAtZero: true },
          },
        },
      }),
    );
  }

  // ── Tool chips ──────────────────────────────────────────────────────────
  function toolChip(d) {
    const label = d.input?.purpose || (d.name === 'make_chart' && d.input?.title) || (d.name === 'describe_data' && (d.input?.table ? `table ${d.input.table}` : 'list tables')) || (d.name === 'save_insight' && shorten(d.input?.insight, 60)) || '';
    const chip = add(h(`<details class="tool-chip state-running">
      <summary>
        <span class="tc-icon">${icon(TOOL_INFO[d.name]?.icon ?? 'gear', 15)}</span>
        <span class="tc-name">${esc(d.name)}</span>
        <span class="tc-label">${esc(label)}</span>
        <span class="tc-status"><span class="spinner"></span>running</span>
      </summary>
      <div class="tc-body"></div>
    </details>`));
    const body = $('.tc-body', chip);
    const code = d.input?.sql ?? JSON.stringify(d.input, null, 2);
    body.append(h(`<pre class="code small"></pre>`));
    body.lastElementChild.textContent = code;
    chips.set(d.id, { chip, input: d.input, name: d.name });
  }

  function setChipStatus(id, state, text) {
    const c = chips.get(id);
    if (!c) return;
    c.chip.className = `tool-chip state-${state}`;
    $('.tc-status', c.chip).innerHTML = esc(text);
  }

  // ── Provenance: which queries each answer is based on ───────────────────
  function addProvenance() {
    if (!lastAnswer || !runSources.length) return;
    const n = runSources.length;
    const el = h(`<details class="provenance">
      <summary>${icon('query', 14)} Based on ${n} quer${n === 1 ? 'y' : 'ies'} · show the SQL</summary>
      <ol>${runSources.map((s) => `<li><div class="pv-meta"><span class="pv-tool">${esc(TOOL_INFO[s.name]?.title ?? s.name)}</span><span class="muted">${esc(s.result)}</span></div><pre class="code small"></pre></li>`).join('')}</ol>
    </details>`);
    el.querySelectorAll('pre').forEach((pre, i) => (pre.textContent = runSources[i].sql));
    lastAnswer.after(el);
    scrollDown();
  }

  // ── Approval (human in the loop) ────────────────────────────────────────
  function requestApproval({ name, input, reason, signal }) {
    return new Promise((resolve) => {
      const card = add(h(`<div class="approval">
        <div class="ap-head">${icon('hand', 18)} Approval needed <code>${esc(name)}</code></div>
        <p>${esc(reason)}</p>
        <pre class="code small"></pre>
        <div class="ap-actions"><button class="btn danger" data-a="yes">Approve &amp; run</button><button class="btn" data-a="no">Deny</button></div>
      </div>`));
      $('pre', card).textContent = input?.sql ?? JSON.stringify(input, null, 2);
      const finish = (ok, text) => {
        card.querySelectorAll('button').forEach((b) => (b.disabled = true));
        card.classList.add(ok ? 'approved' : 'denied');
        $('.ap-actions', card).innerHTML = `<span class="ap-result">${icon(ok ? 'check' : 'x', 15)} ${esc(text)}</span>`;
        signal?.removeEventListener('abort', onAbort);
        resolve(ok);
      };
      const onAbort = () => finish(false, 'Cancelled');
      signal?.addEventListener('abort', onAbort, { once: true });
      card.querySelector('[data-a="yes"]').addEventListener('click', () => finish(true, 'Approved'));
      card.querySelector('[data-a="no"]').addEventListener('click', () => finish(false, 'Denied'));
      card.querySelector('[data-a="yes"]').focus({ preventScroll: true });
    });
  }

  // ── Event subscription ──────────────────────────────────────────────────
  bus.on((evt) => {
    const d = evt.data;
    switch (evt.type) {
      case 'run:start':
        runSources = [];
        lastAnswer = null;
        add(h(`<div class="bubble user"></div>`)).textContent = d.userText;
        setTyping('Starting…');
        break;
      case 'model:request':
        setTyping(d.purpose === 'compaction' ? 'Compacting earlier conversation…' : `Thinking (model call #${d.iteration})…`);
        break;
      case 'model:retry':
        setTyping(`Provider busy, retrying in ${fmtMs(d.delayMs)}…`);
        break;
      case 'model:response': {
        setTyping(null);
        if (d.purpose !== 'agent') break;
        if (d.reasoning) {
          const r = add(h(`<details class="reasoning"><summary>${icon('model', 13)} Reasoning summary</summary><div></div></details>`));
          $('div', r).textContent = d.reasoning;
        }
        const text = d.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
        if (text) {
          lastAnswer = add(h(`<div class="bubble assistant markdown">${markdown(text)}</div>`));
          alignNumericColumns(lastAnswer);
        }
        break;
      }
      case 'tool:call':
        toolChip(d);
        break;
      case 'tool:validate':
        if (!d.ok) setChipStatus(d.id, 'error', 'invalid arguments');
        break;
      case 'tool:policy':
        if (d.decision === 'deny') setChipStatus(d.id, 'error', 'blocked by policy');
        if (d.decision === 'ask') setChipStatus(d.id, 'waiting', 'needs approval');
        break;
      case 'guardrail:decision':
        setChipStatus(d.id, d.approved ? 'running' : 'error', d.approved ? 'approved, running' : 'denied');
        break;
      case 'tool:result': {
        const c = chips.get(d.id);
        if (!c) break;
        const { chip } = c;
        if (!chip.classList.contains('state-error')) setChipStatus(d.id, d.isError ? 'error' : 'done', d.isError ? 'error' : `done · ${fmtMs(d.ms)}`);
        const body = $('.tc-body', chip);
        if (d.isError) {
          body.append(h(`<div class="tc-error"></div>`));
          body.lastElementChild.textContent = d.output;
          chip.open = true;
        } else if (d.display?.kind === 'table') {
          body.insertAdjacentHTML('beforeend', renderTable(d.display));
          $('.tc-label', chip).textContent ||= `${d.display.rowCount} rows`;
        } else if (d.display?.kind === 'tables') {
          body.insertAdjacentHTML('beforeend', d.display.tables.map((t) => `<p><b>${esc(t.name)}</b> · ${t.rows.toLocaleString()} rows<br><span class="muted small">${t.columns.map((col) => esc(`${col.name} ${col.type}`)).join(', ')}</span></p>`).join(''));
        } else if (d.display?.kind === 'memory') {
          body.insertAdjacentHTML('beforeend', `<p>Saved to long-term memory: “${esc(d.display.insight)}”</p>`);
        }
        if (d.display?.kind === 'chart') renderChart(d.display.spec);
        if (!d.isError && c.input?.sql) {
          const result = d.display?.kind === 'table' ? `${d.display.rowCount.toLocaleString()} row${d.display.rowCount === 1 ? '' : 's'}` : d.display?.kind === 'chart' ? 'chart' : 'done';
          runSources.push({ name: c.name, sql: c.input.sql, result });
        }
        break;
      }
      case 'context:compacted':
        notice('**Context compacted.** The earlier conversation was summarized into one message to stay within the context budget.', 'info', 'compress');
        break;
      case 'guardrail:limit':
        setTyping(null);
        notice(`**Guardrail:** ${d.message}`, 'warn', 'shield');
        break;
      case 'run:error':
        setTyping(null);
        add(h(`<div class="notice tone-error">${icon('xCircle', 16)}<div><b>Something went wrong.</b> <span class="msg"></span><br><span class="muted small"></span></div></div>`));
        $('.msg', log.lastElementChild).textContent = d.message;
        $('.small', log.lastElementChild).textContent = d.hint ?? '';
        break;
      case 'run:aborted':
        setTyping(null);
        notice('Stopped.', 'warn', 'stop');
        break;
      case 'step:paused':
        setTyping(`Paused in step mode: next is “${d.label}”. Press Next step on the right.`);
        break;
      case 'run:end':
        setTyping(null);
        if (d.outcome === 'answered') addProvenance();
        if (d.outcome !== 'aborted') {
          add(h(`<div class="run-footer">${d.iterations} model call${d.iterations === 1 ? '' : 's'} · ${d.toolCalls} tool call${d.toolCalls === 1 ? '' : 's'} · ${fmtTokens(d.input + d.output)} tokens · ${fmtCost(d.cost)} · ${fmtMs(d.ms)}</div>`));
        }
        break;
    }
  });

  function clear() {
    charts.splice(0).forEach((c) => c.destroy());
    chips.clear();
    log.innerHTML = '';
    typing = null;
    showWelcome();
  }

  showWelcome();
  return { requestApproval, notice, clear };
}
