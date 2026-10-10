import { CONCEPTS } from './concepts.js';
import { icon, TOOL_INFO } from './icons.js';
import { measureContext } from '../harness/context.js';
import { $, esc, h, fmtTokens, fmtCost, fmtMs, shorten } from './util.js';

/**
 * The "Simple" behind-the-scenes view: a live map of the agent for
 * non-technical viewers, plus a plain-English story of each step, grouped
 * into Think → Act → Observe cycles. It only listens to harness events.
 *
 * Colour = concept, everywhere: agent (ink), AI model (violet), tools (teal),
 * safety (amber), memory (blue).
 */
const toolTitle = (name) => TOOL_INFO[name]?.title ?? name;
const PROVIDER_NAME = { demo: 'Scripted demo model (no key)', anthropic: 'Claude by Anthropic', openai: 'GPT by OpenAI', gemini: 'Gemini by Google' };
const why = (id) => CONCEPTS.find((c) => c.id === id);
const quote = (names) => names.map((n) => `“${toolTitle(n)}”`).join(' and ');
const PHASE = { you: 'You', think: 'Think', act: 'Act', observe: 'Observe', answer: 'Answer', memory: 'Memory', safety: 'Safety' };

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
  const card = (node, kind, iconName, title, tag, body) => `
    <div class="lv-card k-${kind} lv-${node}" data-node="${node}">
      <div class="lv-head"><span class="lv-avatar">${icon(iconName, 18)}</span><div class="lv-head-text"><div class="lv-title">${title}${tag ? ` <span class="lv-tag">${tag}</span>` : ''}</div>${body}</div></div>
    </div>`;

  root.innerHTML = `
    <div class="map-head">
      <h3>Live map</h3>
      <div class="legend">
        <span><i class="k-agent"></i>Agent</span><span><i class="k-model"></i>AI model</span><span><i class="k-tool"></i>Tools</span><span><i class="k-guard"></i>Safety</span><span><i class="k-memory"></i>Memory</span>
      </div>
    </div>
    <div class="stage" id="stage">
      <svg class="wires" aria-hidden="true"></svg>
      <div class="col col-brain">
      <div class="lv-card k-agent lv-agent" data-node="agent">
        <div class="lv-head"><span class="lv-avatar">${icon('agent', 18)}</span><div class="lv-head-text"><div class="lv-title">Agent <span class="lv-tag">the harness</span></div><div class="lv-status" data-el="status">Idle. Waiting for your question.</div></div></div>
        <div class="lv-task" data-el="task" hidden></div>
        <div class="lv-thought" data-el="thought" hidden></div>
      </div>
      <div class="lv-card k-model lv-model" data-node="model">
        <div class="lv-head"><span class="lv-avatar">${icon('model', 18)}</span><div class="lv-head-text"><div class="lv-title">AI model <span class="lv-tag">the brain</span></div><div class="lv-sub" data-el="model-name"></div></div><span class="lv-badge" data-el="model-calls" hidden></span></div>
        <div class="lv-note" data-el="model-note">Gets the whole conversation and answers one question: “what next?”</div>
      </div>
      </div>
      <div class="col col-act">
      ${card('safety', 'guard', 'shield', 'Safety checks', '', '<div class="lv-sub" data-el="safety">Every tool request is checked before it runs.</div>')}
      <div class="lv-tools">
        <div class="lv-col-label">Tools the agent can use</div>
        ${toolNames.map((n) => `
          <div class="lv-card k-tool lv-tool" data-node="tool-${n}">
            <div class="lv-head"><span class="lv-avatar">${icon(TOOL_INFO[n]?.icon ?? 'gear', 16)}</span><div class="lv-head-text"><div class="lv-title">${esc(toolTitle(n))}</div><div class="lv-sub" data-el="tool-${n}">${esc(TOOL_INFO[n]?.what ?? '')}</div></div><span class="lv-badge" data-el="count-${n}" hidden></span></div>
          </div>`).join('')}
      </div>
      </div>
      <div class="col col-mem">
      <div class="lv-card k-memory lv-wm" data-node="wm">
        <div class="lv-head"><span class="lv-avatar">${icon('chat', 18)}</span><div class="lv-head-text"><div class="lv-title">Working memory</div><div class="lv-sub">This conversation. Re-read on every call.</div></div></div>
        <div class="meter"><div class="meter-fill" data-el="wm-fill"></div></div>
        <div class="lv-sub" data-el="wm-text"></div>
      </div>
      <div class="lv-card k-memory lv-ltm" data-node="ltm">
        <div class="lv-head"><span class="lv-avatar">${icon('memory', 18)}</span><div class="lv-head-text"><div class="lv-title">Long-term memory</div><div class="lv-sub">Notes kept for future sessions.</div></div><span class="lv-badge" data-el="ltm-count"></span></div>
        <ul class="lv-notes" data-el="notes"></ul>
      </div>
      </div>
    </div>
    <div class="below">
      <div class="subtabs" role="tablist">
        <button role="tab" data-sub="story" aria-selected="true">What just happened</button>
        <button role="tab" data-sub="anatomy" aria-selected="false">Anatomy of this answer<span class="dot-new" data-el="anatomy-dot" hidden></span></button>
      </div>
      <div class="sub-panel" data-panel="story"><ol class="story" data-el="story"></ol></div>
      <div class="sub-panel" data-panel="anatomy" hidden><div id="anatomy" class="anatomy"></div></div>
    </div>`;

  function showSub(name) {
    root.querySelectorAll('[data-sub]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.sub === name)));
    root.querySelectorAll('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== name));
    if (name === 'anatomy') root.querySelector('[data-el="anatomy-dot"]').hidden = true;
  }
  root.querySelectorAll('[data-sub]').forEach((b) => b.addEventListener('click', () => showSub(b.dataset.sub)));

  const stage = $('#stage', root);
  const svg = $('.wires', stage);
  const el = (name) => root.querySelector(`[data-el="${name}"]`);
  const node = (name) => root.querySelector(`[data-node="${name}"]`);
  const storyEl = el('story');

  let lastReasoning = '';
  let counts = {};
  let freshNote = null;
  let explainedReact = false;
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
  const clearWires = () => svg.querySelectorAll('.wire').forEach((w) => w.classList.remove('on', 'ok', 'bad'));

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
    paths.push(['model', 'k-model', `M${ax},${ay} L${mx},${my}`]);
    const [rx, ry] = pt(agent, 'right');
    for (const n of toolNames) {
      const [tx, ty] = pt(node(`tool-${n}`), 'left');
      const dx = Math.max(20, (tx - rx) / 2);
      paths.push([`tool-${n}`, 'k-tool', `M${rx},${ry} C${rx + dx},${ry} ${tx - dx},${ty} ${tx},${ty}`]);
    }
    if (toolNames.includes('save_insight')) {
      const [sx, sy] = pt(node('tool-save_insight'), 'bottom');
      const [lx, ly] = pt(node('ltm'), 'top');
      const ddy = Math.max(8, (ly - sy) / 2);
      paths.push(['ltm', 'k-memory', `M${sx},${sy} C${sx},${sy + ddy} ${lx},${ly - ddy} ${lx},${ly}`]);
    }
    svg.setAttribute('viewBox', `0 0 ${sr.width} ${sr.height}`);
    svg.innerHTML = paths.map(([id, kind, d]) => `<path class="${states[id] ?? `wire ${kind}`}" data-wire="${id}" d="${d}"/>`).join('');
  }
  new ResizeObserver(() => drawWires()).observe(stage);

  // ── Status helpers ──────────────────────────────────────────────────────
  function status(text, tone) {
    const s = el('status');
    s.textContent = text;
    s.className = `lv-status ${tone ? `tone-${tone}` : ''}`;
  }
  function setLive(on) {
    node('agent').classList.toggle('is-live', on);
    if (liveIndicator) {
      liveIndicator.classList.toggle('on', on);
      liveIndicator.textContent = on ? 'Agent working' : 'Idle';
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
      ? items.slice(-1).map((t) => `<li class="${t === freshNote ? 'fresh' : ''}" title="${esc(t)}">${t === freshNote ? '<span class="new">NEW</span>' : ''}${esc(t)}</li>`).join('')
      : '<li class="muted">Nothing saved yet.</li>';
  }

  // ── Story ───────────────────────────────────────────────────────────────
  // kind = colour (agent/model/tool/guard/memory/ok/bad), phase = Think/Act/Observe pill.
  function story(iconName, html, { kind = 'agent', phase, tone, concept, detail } = {}) {
    $('.story-empty', storyEl)?.remove();
    const c = concept && why(concept);
    const li = h(`<li class="st k-${kind} ${tone ? `tone-${tone}` : ''}">
      <span class="st-icon">${icon(iconName, 16)}</span>
      <div class="st-body">
        ${phase ? `<span class="phase ph-${phase}">${PHASE[phase]}</span>` : ''}
        <span class="st-text">${html}</span>
        ${detail ? `<div class="st-detail">${esc(detail)}</div>` : ''}
        ${c ? `<details class="st-why"><summary>Why?</summary><p><b>${esc(c.title)}.</b> ${esc(c.body)}</p></details>` : ''}
      </div>
    </li>`);
    storyEl.append(li);
    requestAnimationFrame(() => li.classList.add('in'));
    const panel = storyEl.parentElement;
    panel.scrollTop = panel.scrollHeight;
  }
  function storyDivider(text, sub) {
    $('.story-empty', storyEl)?.remove();
    storyEl.append(h(`<li class="st-divider"><span>${esc(text)}</span>${sub ? `<em>${esc(sub)}</em>` : ''}</li>`));
  }
  function storyEmpty() {
    storyEl.innerHTML = '<li class="story-empty muted">Ask a question on the left. Each step appears here as it happens, and the map above lights up to show which part is working.</li>';
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

      case 'run:start':
        resetMap();
        lastReasoning = '';
        setLive(true);
        status('Got your question. Getting to work…', 'busy');
        el('model-name').textContent = `${PROVIDER_NAME[d.provider] ?? d.provider} · ${d.model}`;
        storyDivider(`Question ${d.run}`);
        story('user', `You asked <b>“${esc(shorten(d.userText, 160))}”</b>. The agent is now active.`, { kind: 'agent', phase: 'you', concept: 'loop' });
        break;

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
        story('compress', 'The conversation got too long, so the agent <b>summarized older messages</b> to free up working memory.', { kind: 'memory', phase: 'memory', concept: 'context', detail: shorten(d.summary, 240) });
        break;

      case 'model:request':
        status(d.purpose === 'compaction' ? 'Asking the AI model to write a summary…' : `Asking the AI model what to do next (step ${d.iteration})…`, 'busy');
        setNode('model', 'active');
        setWire('model', 'on');
        el('model-note').textContent = `Reading ${d.messageCount} message${d.messageCount === 1 ? '' : 's'} (~${fmtTokens(d.estimatedTokens)} tokens)…`;
        if (d.purpose === 'agent') {
          el('model-calls').hidden = false;
          el('model-calls').textContent = `call ${d.iteration}`;
          storyDivider(`Step ${d.iteration}`, explainedReact ? '' : 'one Think → Act → Observe cycle');
          explainedReact = true;
        }
        break;

      case 'model:retry':
        status(`The AI service is busy. Trying again in ${fmtMs(d.delayMs)}…`, 'warn');
        setNode('model', 'warn');
        story('retry', `The AI service was busy (${esc(d.status ?? 'network')}). The agent is <b>waiting and retrying</b> automatically.`, { kind: 'model', phase: 'think', tone: 'warn', concept: 'reliability' });
        break;

      case 'model:response':
        setNode('model', 'done', { autoClear: 1500 });
        setWire('model', null);
        el('model-note').textContent = `Replied in ${fmtMs(d.ms)} · read ${fmtTokens(d.usage.input)} tokens, wrote ${fmtTokens(d.usage.output)}${d.cost != null ? ` · ${fmtCost(d.cost)}` : ''}`;
        lastReasoning = d.purpose === 'agent' ? d.reasoning ?? '' : '';
        if (lastReasoning) {
          el('thought').hidden = false;
          el('thought').textContent = `“${shorten(lastReasoning, 220)}”`;
        }
        break;

      case 'loop:decide': {
        const names = [...new Set(d.tools ?? [])];
        const detail = lastReasoning ? `Its reasoning: “${shorten(lastReasoning, 260)}”` : '';
        if (d.continue) {
          status(`The model wants to use ${quote(names)}.`, 'busy');
          story('model', `The AI model decided to use ${quote(names)}.`, { kind: 'model', phase: 'think', concept: 'react', detail });
        } else if (d.stopReason === 'end') {
          status('The model has enough information. Writing the answer…', 'busy');
          story('model', 'The AI model has <b>enough information to answer</b>, so the loop stops.', { kind: 'model', phase: 'think', concept: 'stopping', detail });
        } else {
          story('alert', `The model stopped early (${esc(d.stopReason)}).`, { kind: 'model', phase: 'think', tone: 'warn', concept: 'stopping' });
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
          story('alert', `The request to “${esc(toolTitle(d.name))}” was <b>filled in wrong</b>. The agent sent the error back so the model can correct itself.`, { kind: 'tool', phase: 'observe', tone: 'warn', concept: 'validation', detail: d.errors.join('; ') });
        }
        break;

      case 'tool:policy':
        setNode('safety', d.decision === 'allow' ? 'done' : d.decision === 'ask' ? 'waiting' : 'error', d.decision === 'allow' ? { autoClear: 1400 } : {});
        if (d.decision === 'allow') {
          el('safety').textContent = `Checked: “${toolTitle(d.name)}” is safe to run (${d.reason.replace(/\.$/, '').toLowerCase()}).`;
        } else if (d.decision === 'ask') {
          el('safety').textContent = 'This would change your data. Waiting for your OK in the chat.';
          setNode(`tool-${d.name}`, 'waiting');
          status('Waiting for your permission in the chat…', 'warn');
          story('hand', 'This step would <b>change your data</b>, so the agent paused to ask your permission.', { kind: 'guard', phase: 'act', concept: 'guardrails' });
        } else {
          el('safety').textContent = `Blocked: ${d.reason}`;
          setNode(`tool-${d.name}`, 'error');
          story('shield', `A safety rule <b>blocked</b> “${esc(toolTitle(d.name))}”.`, { kind: 'guard', phase: 'act', tone: 'bad', concept: 'guardrails', detail: d.reason });
        }
        break;

      case 'guardrail:decision':
        if (d.approved) {
          setNode('safety', 'done', { autoClear: 1600 });
          el('safety').textContent = 'You approved it.';
          setNode(`tool-${d.name}`, 'active');
          story('check', 'You <b>approved</b> it, so the agent went ahead.', { kind: 'guard', phase: 'act' });
        } else {
          setNode('safety', 'error', { autoClear: 2500 });
          el('safety').textContent = 'You said no. Nothing was changed.';
          story('x', 'You <b>said no</b>, so nothing was changed. The model is told, and answers without doing it.', { kind: 'guard', phase: 'act', concept: 'guardrails' });
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
          story('memory', `Saved to <b>long-term memory</b>: “${esc(shorten(freshNote ?? '', 140))}”`, { kind: 'memory', phase: 'observe', concept: 'memory' });
        } else if (ok) {
          story(TOOL_INFO[d.name]?.icon ?? 'gear', `<b>${esc(toolTitle(d.name))}</b>: ${esc(summary.charAt(0).toLowerCase() + summary.slice(1))} <span class="muted">(${fmtMs(d.ms)})</span>.`, { kind: 'tool', phase: 'observe', concept: 'execution' });
        } else if (!/malformed|safety rules|you said no/i.test(summary)) {
          story('alert', `“${esc(toolTitle(d.name))}” ran into a problem. The model will see the error and adjust.`, { kind: 'tool', phase: 'observe', tone: 'warn', concept: 'reliability', detail: summary });
        }
        break;
      }

      case 'history:append':
        renderWorkingMemory();
        break;

      case 'guardrail:limit':
        setNode('safety', 'error');
        el('safety').textContent = d.message;
        story('stop', `A <b>safety limit</b> stopped the agent: ${esc(d.message)}`, { kind: 'guard', tone: 'bad', concept: 'guardrails' });
        break;

      case 'step:paused':
        status(`Paused in step mode. Next: ${d.label}. Press “Next step”.`, 'warn');
        break;

      case 'run:error':
        status('Something went wrong. See the story below.', 'bad');
        setNode('model', 'error');
        story('xCircle', `Something went wrong: ${esc(shorten(d.message, 200))}`, { kind: 'agent', tone: 'bad', detail: d.hint });
        break;

      case 'run:aborted':
        story('stop', 'You <b>stopped</b> the agent. Unfinished steps were closed off cleanly.', { kind: 'agent', tone: 'warn', concept: 'stopping' });
        break;

      case 'run:end':
        setLive(false);
        clearWires();
        renderWorkingMemory();
        if (d.outcome === 'answered') {
          status('Done. The answer is in the chat. Waiting for your next question.', 'ok');
          storyDivider('Result');
          story('checkCircle', `<b>Answer delivered</b> after ${d.iterations} Think → Act → Observe cycle${d.iterations === 1 ? '' : 's'}: ${fmtTokens(d.input + d.output)} tokens, ${fmtCost(d.cost)}, ${fmtMs(d.ms)}.`, { kind: 'ok', phase: 'answer' });
        } else if (d.outcome === 'aborted') {
          status('Stopped. Waiting for your next question.');
        } else if (d.outcome !== 'error') {
          status(`Finished early (${d.outcome}). Waiting for your next question.`, 'warn');
        }
        if (root.querySelector('[data-panel="anatomy"]').hidden && d.iterations > 0) el('anatomy-dot').hidden = false;
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
  return { redraw: drawWires, showSub };
}
