import { CONCEPTS } from './concepts.js';
import { measureContext } from '../harness/context.js';
import { $, esc, h, fmtTokens, fmtCost, fmtMs, shorten } from './util.js';

/**
 * The "Simple" behind-the-scenes view: a live map of the agent for
 * non-technical viewers, plus a plain-English story of each step.
 * Like everything else in the UI, it only listens to harness events.
 */
export const TOOL_INFO = {
  describe_data: { icon: '🗂️', title: 'Look at the tables', what: 'Checks which tables and columns exist' },
  run_sql: { icon: '🧮', title: 'Run a query', what: 'Asks the database a question in SQL' },
  make_chart: { icon: '📈', title: 'Draw a chart', what: 'Turns numbers into a picture' },
  save_insight: { icon: '📝', title: 'Save to memory', what: 'Writes down a fact for next time' },
};
const toolTitle = (name) => TOOL_INFO[name]?.title ?? name;
const PROVIDER_NAME = { demo: 'Scripted demo model (no key)', anthropic: 'Claude by Anthropic', openai: 'GPT by OpenAI', gemini: 'Gemini by Google' };
const why = (id) => CONCEPTS.find((c) => c.id === id);
const quote = (names) => names.map((n) => `“${toolTitle(n)}”`).join(' and ');

function toolSummary(d) {
  if (d.isError) {
    if (d.output.startsWith('Blocked by policy')) return 'Blocked by the safety rules';
    if (d.output.startsWith('The user denied')) return 'Not run: you said no';
    if (d.output.startsWith('Invalid tool call')) return 'Request was malformed, so it was sent back to fix';
    if (d.output.startsWith('Cancelled')) return 'Cancelled';
    return `Failed: ${shorten(d.output.replace(/^Error:\s*/, ''), 80)}`;
  }
  let data = null;
  try { data = JSON.parse(d.output); } catch { /* truncated output */ }
  switch (d.name) {
    case 'run_sql': {
      const n = d.display?.rowCount ?? data?.rowCount;
      return n != null ? `Got ${n.toLocaleString()} row${n === 1 ? '' : 's'} back` : 'Query finished';
    }
    case 'describe_data':
      if (data?.tables) return `Found ${data.tables.length} table${data.tables.length === 1 ? '' : 's'}`;
      if (data?.columns) return `Found ${data.columns.length} columns in “${data.table}”`;
      return 'Looked at the data';
    case 'make_chart':
      return `Drew a ${data?.type ?? ''} chart`.replace('  ', ' ');
    case 'save_insight':
      return 'Saved a note to long-term memory';
    default:
      return 'Done';
  }
}

export function createLiveView({ root, bus, memory, toolNames, getSession, getLimits, liveIndicator, mobileTab }) {
  root.innerHTML = `
    <div class="stage" id="stage">
      <svg class="wires" aria-hidden="true"></svg>
      <div class="lv-card lv-agent" data-node="agent">
        <div class="lv-head"><span class="lv-avatar">🤖</span><div class="lv-head-text"><div class="lv-title">Agent <span class="lv-tag">the coordinator</span></div><div class="lv-status" data-el="status">Idle. Waiting for your question.</div></div></div>
        <div class="lv-task" data-el="task" hidden></div>
        <div class="lv-thought" data-el="thought" hidden></div>
      </div>
      <div class="lv-card lv-model" data-node="model">
        <div class="lv-head"><span class="lv-avatar">✨</span><div class="lv-head-text"><div class="lv-title">AI model <span class="lv-tag">the brain</span></div><div class="lv-sub" data-el="model-name"></div></div><span class="lv-badge" data-el="model-calls" hidden></span></div>
        <div class="lv-note" data-el="model-note">The agent sends it the whole conversation and asks “what next?”</div>
      </div>
      <div class="lv-card lv-safety" data-node="safety">
        <div class="lv-head"><span class="lv-avatar">🛡️</span><div class="lv-head-text"><div class="lv-title">Safety checks</div><div class="lv-sub" data-el="safety">Every tool request is checked before it runs.</div></div></div>
      </div>
      <div class="lv-tools">
        <div class="lv-col-label">Tools the agent can use</div>
        ${toolNames.map((n) => `
          <div class="lv-card lv-tool" data-node="tool-${n}">
            <div class="lv-head"><span class="lv-avatar">${TOOL_INFO[n]?.icon ?? '🔧'}</span><div class="lv-head-text"><div class="lv-title">${esc(toolTitle(n))}</div><div class="lv-sub" data-el="tool-${n}">${esc(TOOL_INFO[n]?.what ?? '')}</div></div><span class="lv-badge" data-el="count-${n}" hidden></span></div>
          </div>`).join('')}
      </div>
      <div class="lv-card lv-wm" data-node="wm">
        <div class="lv-head"><span class="lv-avatar">💬</span><div class="lv-head-text"><div class="lv-title">Working memory</div><div class="lv-sub">This conversation. The model re-reads it on every step.</div></div></div>
        <div class="meter"><div class="meter-fill" data-el="wm-fill"></div></div>
        <div class="lv-sub" data-el="wm-text"></div>
      </div>
      <div class="lv-card lv-ltm" data-node="ltm">
        <div class="lv-head"><span class="lv-avatar">🗃️</span><div class="lv-head-text"><div class="lv-title">Long-term memory</div><div class="lv-sub">Notes the agent keeps for future sessions.</div></div><span class="lv-badge" data-el="ltm-count"></span></div>
        <ul class="lv-notes" data-el="notes"></ul>
      </div>
    </div>
    <div class="story-head"><h3>What just happened</h3><span class="muted small">step by step, in plain English</span></div>
    <ol class="story" data-el="story"></ol>`;

  const stage = $('#stage', root);
  const svg = $('.wires', stage);
  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const node = (name) => root.querySelector(`[data-node="${name}"]`);
  const storyEl = el('story');

  let running = false;
  let lastReasoning = '';
  let counts = {};
  let freshNote = null;
  const resetTimers = new Map();

  // ── Node & wire state ───────────────────────────────────────────────────
  const STATES = ['is-active', 'is-done', 'is-error', 'is-waiting', 'is-warn'];
  function setNode(name, state, { autoClear } = {}) {
    const n = node(name);
    if (!n) return;
    n.classList.remove(...STATES);
    if (state) n.classList.add(`is-${state}`);
    clearTimeout(resetTimers.get(name));
    if (autoClear) resetTimers.set(name, setTimeout(() => n.classList.remove(...STATES), autoClear));
  }
  function setWire(id, state) {
    const w = svg.querySelector(`[data-wire="${id}"]`);
    if (!w) return;
    w.classList.remove('on', 'ok', 'bad');
    if (state) w.classList.add(state);
  }
  function clearWires() {
    svg.querySelectorAll('.wire').forEach((w) => w.classList.remove('on', 'ok', 'bad'));
  }

  function drawWires() {
    const narrow = stage.clientWidth < 460;
    stage.classList.toggle('narrow', narrow);
    if (narrow || !stage.clientWidth) {
      svg.innerHTML = '';
      return;
    }
    const sr = stage.getBoundingClientRect();
    const pt = (n, side) => {
      const r = n.getBoundingClientRect();
      const x = side === 'right' ? r.right : side === 'left' ? r.left : r.left + r.width / 2;
      const y = side === 'top' ? r.top : side === 'bottom' ? r.bottom : r.top + r.height / 2;
      return [x - sr.left, y - sr.top];
    };
    const states = Object.fromEntries([...svg.querySelectorAll('.wire')].map((w) => [w.dataset.wire, w.getAttribute('class')]));
    const paths = [];
    const agent = node('agent');
    const [ax, ay] = pt(agent, 'bottom');
    const [mx, my] = pt(node('model'), 'top');
    paths.push(['model', `M${ax},${ay} L${mx},${my}`]);
    const [rx, ry] = pt(agent, 'right');
    for (const n of toolNames) {
      const [tx, ty] = pt(node(`tool-${n}`), 'left');
      const dx = Math.max(20, (tx - rx) / 2);
      paths.push([`tool-${n}`, `M${rx},${ry} C${rx + dx},${ry} ${tx - dx},${ty} ${tx},${ty}`]);
    }
    if (toolNames.includes('save_insight')) {
      const [sx, sy] = pt(node('tool-save_insight'), 'bottom');
      const [lx, ly] = pt(node('ltm'), 'top');
      paths.push(['ltm', `M${sx},${sy} L${lx},${ly}`]);
    }
    svg.setAttribute('viewBox', `0 0 ${sr.width} ${sr.height}`);
    svg.innerHTML = paths.map(([id, d]) => `<path class="${states[id] ?? 'wire'}" data-wire="${id}" d="${d}"/>`).join('');
  }
  new ResizeObserver(() => drawWires()).observe(stage);

  // ── Status helpers ──────────────────────────────────────────────────────
  function status(text, tone) {
    const s = el('status');
    s.textContent = text;
    s.className = `lv-status ${tone ? `tone-${tone}` : ''}`;
  }
  function setLive(on, label) {
    running = on;
    node('agent').classList.toggle('is-live', on);
    if (liveIndicator) {
      liveIndicator.classList.toggle('on', on);
      liveIndicator.textContent = label ?? (on ? 'Agent working' : 'Idle');
    }
    mobileTab?.classList.toggle('live', on);
  }

  function renderWorkingMemory() {
    const s = getSession();
    if (!s) return;
    const budget = getLimits().contextBudget;
    const tokens = measureContext({ system: s.system, tools: s.tools, messages: s.messages }).total;
    const pct = Math.min(100, (tokens / budget) * 100);
    el('wm-fill').style.width = `${pct}%`;
    el('wm-fill').dataset.level = pct > 90 ? 'high' : pct > 65 ? 'mid' : 'low';
    el('wm-text').textContent = `${s.messages.length} message${s.messages.length === 1 ? '' : 's'} · ~${fmtTokens(tokens)} of ${fmtTokens(budget)} tokens${s.carryOver ? ' · summary of earlier chat waiting' : ''}`;
  }

  function renderNotes() {
    const items = memory.list();
    el('ltm-count').textContent = `${items.length} note${items.length === 1 ? '' : 's'}`;
    el('notes').innerHTML = items.length
      ? items.slice(-3).reverse().map((t) => `<li class="${t === freshNote ? 'fresh' : ''}">${t === freshNote ? '<span class="new">NEW</span>' : ''}${esc(t)}</li>`).join('')
      : '<li class="muted">Nothing saved yet.</li>';
  }

  // ── Story ───────────────────────────────────────────────────────────────
  function story(icon, html, { tone, concept, detail } = {}) {
    $('.story-empty', storyEl)?.remove();
    const c = concept && why(concept);
    const li = h(`<li class="st ${tone ? `tone-${tone}` : ''}">
      <span class="st-icon">${icon}</span>
      <div class="st-body">
        <div class="st-text">${html}</div>
        ${detail ? `<div class="st-detail">${esc(detail)}</div>` : ''}
        ${c ? `<details class="st-why"><summary>Why?</summary><p><b>${esc(c.title)}.</b> ${esc(c.body)}</p></details>` : ''}
      </div>
    </li>`);
    storyEl.append(li);
    requestAnimationFrame(() => li.classList.add('in'));
    storyEl.scrollTop = storyEl.scrollHeight;
  }
  function storyDivider(text) {
    $('.story-empty', storyEl)?.remove();
    storyEl.append(h(`<li class="st-divider"><span>${esc(text)}</span></li>`));
  }
  function storyEmpty() {
    storyEl.innerHTML = '<li class="story-empty muted">Ask a question on the left. The agent’s steps will appear here one at a time, and the map above lights up to show which part is working.</li>';
  }

  function resetMap() {
    counts = {};
    clearWires();
    ['model', 'safety', 'wm', 'ltm', ...toolNames.map((n) => `tool-${n}`)].forEach((n) => setNode(n, null));
    toolNames.forEach((n) => {
      el(`count-${n}`).hidden = true;
      el(`tool-${n}`).textContent = TOOL_INFO[n]?.what ?? '';
    });
    el('model-calls').hidden = true;
    el('thought').hidden = true;
    el('safety').textContent = 'Every tool request is checked before it runs.';
  }

  // ── Events → visuals ────────────────────────────────────────────────────
  bus.on((evt) => {
    const d = evt.data;
    switch (evt.type) {
      case 'session:start':
        resetMap();
        storyEmpty();
        el('task').hidden = true;
        status(d.reason === 'start' ? 'Idle. Waiting for your question.' : 'New session started. Waiting for your question.');
        renderWorkingMemory();
        renderNotes();
        break;

      case 'run:start': {
        resetMap();
        lastReasoning = '';
        setLive(true);
        status('Got your question. Getting to work…', 'busy');
        el('task').hidden = false;
        el('task').innerHTML = `<span class="muted">Working on:</span> “${esc(shorten(d.userText, 140))}”`;
        el('model-name').textContent = `${PROVIDER_NAME[d.provider] ?? d.provider} · ${d.model}`;
        storyDivider(`Question ${d.run}`);
        story('🙋', `You asked: <b>“${esc(shorten(d.userText, 160))}”</b>. The agent is now active.`, { concept: 'loop' });
        break;
      }

      case 'context:check':
        status('Checking its working memory: is there room for this conversation?', 'busy');
        setNode('wm', 'active', { autoClear: 1400 });
        renderWorkingMemory();
        break;

      case 'context:compact':
        status('Working memory is full, so it’s summarizing the older conversation…', 'warn');
        setNode('wm', 'warn');
        break;

      case 'context:compacted':
        setNode('wm', 'done', { autoClear: 1800 });
        renderWorkingMemory();
        story('🗜️', 'The conversation got too long, so the agent <b>summarized the older messages</b> into a short note to free up working memory.', { tone: 'warn', concept: 'context', detail: shorten(d.summary, 240) });
        break;

      case 'model:request':
        status(d.purpose === 'compaction' ? 'Asking the AI model to write a summary…' : `Asking the AI model what to do next (step ${d.iteration})…`, 'busy');
        setNode('model', 'active');
        setWire('model', 'on');
        el('model-note').textContent = `Reading ${d.messageCount} message${d.messageCount === 1 ? '' : 's'} (~${fmtTokens(d.estimatedTokens)} tokens)…`;
        if (d.purpose === 'agent') {
          el('model-calls').hidden = false;
          el('model-calls').textContent = `call ${d.iteration}`;
        }
        break;

      case 'model:retry':
        status(`The AI service is busy. Trying again in ${fmtMs(d.delayMs)}…`, 'warn');
        setNode('model', 'warn');
        story('⏳', `The AI service was busy (${esc(d.status ?? 'network')}). The agent is <b>waiting and retrying</b> automatically.`, { tone: 'warn', concept: 'reliability' });
        break;

      case 'model:response':
        setNode('model', 'done', { autoClear: 1500 });
        setWire('model', null);
        el('model-note').textContent = `Replied in ${fmtMs(d.ms)} · read ${fmtTokens(d.usage.input)} tokens, wrote ${fmtTokens(d.usage.output)}${d.cost != null ? ` · ${fmtCost(d.cost)}` : ''}`;
        lastReasoning = d.purpose === 'agent' ? d.reasoning ?? '' : '';
        if (lastReasoning) {
          el('thought').hidden = false;
          el('thought').textContent = `💭 “${shorten(lastReasoning, 220)}”`;
        }
        break;

      case 'loop:decide': {
        const names = [...new Set(d.tools ?? [])];
        if (d.continue) {
          status(`The model wants to use ${quote(names)}.`, 'busy');
          story('🤖', `The AI model thought about it and decided to use ${quote(names)}.`, { concept: 'loop', detail: lastReasoning ? `Its reasoning: “${shorten(lastReasoning, 260)}”` : '' });
        } else if (d.stopReason === 'end') {
          status('The model has enough information. Writing the answer…', 'busy');
          story('🤖', 'The AI model has <b>enough information to answer</b>, so the loop stops here.', { concept: 'stopping' });
        } else {
          story('⚠️', `The model stopped early (${esc(d.stopReason)}).`, { tone: 'warn', concept: 'stopping' });
        }
        break;
      }

      case 'tool:call': {
        counts[d.name] = (counts[d.name] ?? 0) + 1;
        const badge = el(`count-${d.name}`);
        if (badge) {
          badge.hidden = false;
          badge.textContent = `×${counts[d.name]}`;
        }
        setNode(`tool-${d.name}`, 'active');
        setWire(`tool-${d.name}`, 'on');
        if (el(`tool-${d.name}`)) el(`tool-${d.name}`).textContent = d.input?.purpose ? shorten(d.input.purpose, 70) : 'Getting ready…';
        status(`Using the “${toolTitle(d.name)}” tool…`, 'busy');
        break;
      }

      case 'tool:validate':
        if (!d.ok) {
          setNode(`tool-${d.name}`, 'error');
          setWire(`tool-${d.name}`, 'bad');
          story('🧩', `The model’s request to “${esc(toolTitle(d.name))}” was <b>filled in wrong</b>. The agent sent the error back so the model can correct itself.`, { tone: 'warn', concept: 'validation', detail: d.errors.join('; ') });
        }
        break;

      case 'tool:policy':
        setNode('safety', d.decision === 'allow' ? 'done' : d.decision === 'ask' ? 'waiting' : 'error', d.decision === 'allow' ? { autoClear: 1400 } : {});
        if (d.decision === 'allow') {
          el('safety').textContent = `✓ “${toolTitle(d.name)}” is safe to run (${d.reason.replace(/\.$/, '').toLowerCase()}).`;
        } else if (d.decision === 'ask') {
          el('safety').textContent = '✋ This would change your data. Waiting for your OK in the chat.';
          setNode(`tool-${d.name}`, 'waiting');
          status('Waiting for your permission in the chat…', 'warn');
          story('✋', 'This step would <b>change your data</b>, so the agent paused to ask for your permission.', { tone: 'warn', concept: 'guardrails' });
        } else {
          el('safety').textContent = `⛔ Blocked: ${d.reason}`;
          setNode(`tool-${d.name}`, 'error');
          story('⛔', `A safety rule <b>blocked</b> “${esc(toolTitle(d.name))}”.`, { tone: 'bad', concept: 'guardrails', detail: d.reason });
        }
        break;

      case 'guardrail:decision':
        if (d.approved) {
          setNode('safety', 'done', { autoClear: 1600 });
          el('safety').textContent = '👍 You approved it.';
          setNode(`tool-${d.name}`, 'active');
          story('👍', 'You <b>approved</b> it, so the agent went ahead.', { tone: 'ok' });
        } else {
          setNode('safety', 'error', { autoClear: 2500 });
          el('safety').textContent = '🙅 You said no. Nothing was changed.';
          story('🙅', 'You <b>said no</b>, so nothing was changed. The model is told, and it will answer without doing it.', { concept: 'guardrails' });
        }
        break;

      case 'tool:execute':
        if (el(`tool-${d.name}`)) el(`tool-${d.name}`).innerHTML = '<span class="spinner"></span> Working…';
        break;

      case 'tool:result': {
        const summary = toolSummary(d);
        const ok = !d.isError;
        if (el(`tool-${d.name}`)) el(`tool-${d.name}`).textContent = summary;
        setNode(`tool-${d.name}`, ok ? 'done' : 'error', { autoClear: 2600 });
        setWire(`tool-${d.name}`, ok ? 'ok' : 'bad');
        setTimeout(() => setWire(`tool-${d.name}`, null), 1600);
        if (ok && d.name === 'save_insight') {
          freshNote = memory.list().at(-1) ?? null;
          renderNotes();
          setNode('ltm', 'done', { autoClear: 3000 });
          setWire('ltm', 'ok');
          setTimeout(() => setWire('ltm', null), 1800);
          story('📝', `Saved to <b>long-term memory</b>: “${esc(shorten(freshNote ?? '', 140))}”`, { tone: 'ok', concept: 'memory' });
        } else if (ok) {
          story(TOOL_INFO[d.name]?.icon ?? '🔧', `Used <b>“${esc(toolTitle(d.name))}”</b>: ${esc(summary.charAt(0).toLowerCase() + summary.slice(1))} <span class="muted">(${fmtMs(d.ms)})</span>.`, { concept: 'execution' });
        } else if (!/malformed|safety rules|you said no/i.test(summary)) {
          story('⚠️', `“${esc(toolTitle(d.name))}” ran into a problem. The model will see the error and adjust.`, { tone: 'warn', concept: 'reliability', detail: summary });
        }
        break;
      }

      case 'history:append':
        renderWorkingMemory();
        break;

      case 'guardrail:limit':
        setNode('safety', 'error');
        el('safety').textContent = `🛑 ${d.message}`;
        story('🛑', `A <b>safety limit</b> stopped the agent: ${esc(d.message)}`, { tone: 'bad', concept: 'guardrails' });
        break;

      case 'step:paused':
        status(`Paused in step mode. Next: ${d.label}. Press “Next step”.`, 'warn');
        break;

      case 'run:error':
        status('Something went wrong. See the story below.', 'bad');
        setNode('model', 'error');
        story('❌', `Something went wrong: ${esc(shorten(d.message, 200))}`, { tone: 'bad', detail: d.hint });
        break;

      case 'run:aborted':
        story('⏹', 'You <b>stopped</b> the agent. Unfinished steps were closed off cleanly.', { tone: 'warn', concept: 'stopping' });
        break;

      case 'run:end':
        setLive(false);
        clearWires();
        renderWorkingMemory();
        if (d.outcome === 'answered') {
          status('Done ✓. The answer is in the chat. Waiting for your next question.', 'ok');
          story('✅', `<b>Answer delivered.</b> It took ${d.iterations} AI call${d.iterations === 1 ? '' : 's'} and ${d.toolCalls} tool use${d.toolCalls === 1 ? '' : 's'}: ${fmtTokens(d.input + d.output)} tokens, ${fmtCost(d.cost)}, ${fmtMs(d.ms)}.`, { tone: 'ok' });
        } else if (d.outcome === 'aborted') {
          status('Stopped. Waiting for your next question.');
        } else if (d.outcome !== 'error') {
          status(`Finished early (${d.outcome}). Waiting for your next question.`, 'warn');
        }
        setTimeout(() => {
          freshNote = null;
          renderNotes();
        }, 6000);
        break;
    }
  });

  memory.subscribe(renderNotes);

  storyEmpty();
  renderNotes();
  return { redraw: drawWires };
}
