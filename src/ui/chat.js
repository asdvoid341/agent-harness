import { $, esc, h, markdown, fmtTokens, fmtCost, fmtMs, shorten } from './util.js';

const TOOL_ICONS = { describe_data: '🗂️', run_sql: '🧮', make_chart: '📈', save_insight: '🧠' };

/** The left panel: the product. It renders purely from harness events. */
export function createChat({ root, bus, suggestions, onSuggestion }) {
  const log = $('#chat-log', root);
  const scroller = $('#chat', root);
  const chips = new Map();
  const charts = [];
  let typing = null;

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
      <h2>Ask your data a question</h2>
      <p>This agent has 4 tools: it can inspect tables, run SQL in your browser (DuckDB), draw charts, and save insights to memory. The sample dataset is a fictional retailer's 2025 orders plus regional targets. You can also upload your own CSV.</p>
      <p class="muted">Watch the right-hand panel while it works: every prompt, model call, tool call, guardrail and retry shows up there live.</p>
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

  function notice(text, tone = 'info') {
    return add(h(`<div class="notice tone-${tone}">${markdown(text)}</div>`));
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

  function renderChart(spec) {
    const card = add(h(`<figure class="chart-card"><figcaption>${esc(spec.title)}</figcaption><div class="chart-box"><canvas></canvas></div></figure>`));
    if (!window.Chart) {
      $('.chart-box', card).textContent = 'Chart library failed to load.';
      return;
    }
    const css = getComputedStyle(document.documentElement);
    const palette = [1, 2, 3, 4, 5, 6].map((i) => css.getPropertyValue(`--series-${i}`).trim());
    const text = css.getPropertyValue('--muted').trim();
    const grid = css.getPropertyValue('--border').trim();
    const round = spec.type === 'pie' || spec.type === 'doughnut';
    charts.push(
      new window.Chart($('canvas', card), {
        type: spec.type,
        data: {
          labels: spec.labels,
          datasets: spec.datasets.map((d, i) => ({
            ...d,
            backgroundColor: round ? spec.labels.map((_, j) => palette[j % palette.length]) : palette[i % palette.length],
            borderColor: round ? css.getPropertyValue('--surface').trim() : palette[i % palette.length],
            borderWidth: round ? 2 : 2,
            borderRadius: spec.type === 'bar' ? 4 : 0,
            pointRadius: spec.type === 'line' ? 2 : undefined,
            tension: 0.25,
          })),
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          animation: { duration: 500 },
          plugins: { legend: { display: round || spec.datasets.length > 1, labels: { color: text, boxWidth: 12 } } },
          scales: round ? {} : {
            x: { ticks: { color: text, maxRotation: 0, autoSkip: true }, grid: { color: grid, display: false } },
            y: { ticks: { color: text }, grid: { color: grid }, beginAtZero: true },
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
        <span class="tc-icon">${TOOL_ICONS[d.name] ?? '🔧'}</span>
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
    chips.set(d.id, chip);
  }

  function setChipStatus(id, state, text) {
    const chip = chips.get(id);
    if (!chip) return;
    chip.className = `tool-chip state-${state}`;
    $('.tc-status', chip).innerHTML = esc(text);
  }

  // ── Approval (human in the loop) ────────────────────────────────────────
  function requestApproval({ name, input, reason, signal }) {
    return new Promise((resolve) => {
      const card = add(h(`<div class="approval">
        <div class="ap-head">✋ Approval needed: <code>${esc(name)}</code></div>
        <p>${esc(reason)}</p>
        <pre class="code small"></pre>
        <div class="ap-actions"><button class="btn danger" data-a="yes">Approve &amp; run</button><button class="btn" data-a="no">Deny</button></div>
      </div>`));
      $('pre', card).textContent = input?.sql ?? JSON.stringify(input, null, 2);
      const finish = (ok, text) => {
        card.querySelectorAll('button').forEach((b) => (b.disabled = true));
        card.classList.add(ok ? 'approved' : 'denied');
        $('.ap-actions', card).innerHTML = `<span class="ap-result">${esc(text)}</span>`;
        signal?.removeEventListener('abort', onAbort);
        resolve(ok);
      };
      const onAbort = () => finish(false, 'Cancelled');
      signal?.addEventListener('abort', onAbort, { once: true });
      card.querySelector('[data-a="yes"]').addEventListener('click', () => finish(true, '✓ Approved'));
      card.querySelector('[data-a="no"]').addEventListener('click', () => finish(false, '✕ Denied'));
      card.querySelector('[data-a="yes"]').focus({ preventScroll: true });
    });
  }

  // ── Event subscription ──────────────────────────────────────────────────
  bus.on((evt) => {
    const d = evt.data;
    switch (evt.type) {
      case 'run:start':
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
          const r = add(h(`<details class="reasoning"><summary>💭 Reasoning summary</summary><div></div></details>`));
          $('div', r).textContent = d.reasoning;
        }
        const text = d.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');
        if (text) add(h(`<div class="bubble assistant markdown">${markdown(text)}</div>`));
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
        const chip = chips.get(d.id);
        if (!chip) break;
        if (!chip.classList.contains('state-error')) setChipStatus(d.id, d.isError ? 'error' : 'done', d.isError ? 'error' : `✓ ${fmtMs(d.ms)}`);
        const body = $('.tc-body', chip);
        if (d.isError) {
          body.append(h(`<div class="tc-error"></div>`));
          body.lastElementChild.textContent = d.output;
          chip.open = true;
        } else if (d.display?.kind === 'table') {
          body.insertAdjacentHTML('beforeend', renderTable(d.display));
          $('.tc-label', chip).textContent ||= `${d.display.rowCount} rows`;
        } else if (d.display?.kind === 'tables') {
          body.insertAdjacentHTML('beforeend', d.display.tables.map((t) => `<p><b>${esc(t.name)}</b> · ${t.rows.toLocaleString()} rows<br><span class="muted small">${t.columns.map((c) => esc(`${c.name} ${c.type}`)).join(', ')}</span></p>`).join(''));
        } else if (d.display?.kind === 'memory') {
          body.insertAdjacentHTML('beforeend', `<p>Saved to long-term memory: “${esc(d.display.insight)}”</p>`);
        }
        if (d.display?.kind === 'chart') renderChart(d.display.spec);
        break;
      }
      case 'context:compacted':
        notice('🗜️ **Context compacted.** The earlier conversation was summarized into one message to stay within the context budget. See the timeline for the summary.', 'info');
        break;
      case 'guardrail:limit':
        setTyping(null);
        notice(`🛑 **Guardrail:** ${d.message}`, 'warn');
        break;
      case 'run:error':
        setTyping(null);
        add(h(`<div class="notice tone-error"><b>Something went wrong.</b> <span class="msg"></span><br><span class="muted small"></span></div>`));
        $('.msg', log.lastElementChild).textContent = d.message;
        $('.small', log.lastElementChild).textContent = d.hint ?? '';
        break;
      case 'run:aborted':
        setTyping(null);
        notice('⏹ Stopped.', 'warn');
        break;
      case 'step:paused':
        setTyping(`Paused in step mode: next is “${d.label}”. Press Next step on the right.`);
        break;
      case 'run:end':
        setTyping(null);
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
