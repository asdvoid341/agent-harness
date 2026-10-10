import { CONCEPTS, NODE_CONCEPT } from './concepts.js';
import { renderDiagram } from './diagram.js';
import { $, esc, h, fmtTokens, fmtCost, fmtMs, shorten, pretty, download } from './util.js';
import { sourceUrl } from '../config.js';

/** Turn a raw harness event into something a human can read. */
function describe(evt) {
  const d = evt.data;
  switch (evt.type) {
    case 'session:start':
      return { node: 'prompt', cat: 'prompt', title: 'Session started: prompt assembled', summary: `System prompt (~${fmtTokens(d.systemTokens)} tokens, ${d.sections.length} sections) + ${d.tools.length} tool definitions (~${fmtTokens(d.toolTokens)} tokens). Frozen for this session.`, details: { system: d.system, tools: d.tools } };
    case 'run:start':
      return { node: 'input', cat: 'run', title: `Run #${d.run} started`, summary: `“${shorten(d.userText, 110)}” → ${d.provider} · ${d.model}` };
    case 'context:check':
      return { node: 'context', cat: 'context', title: 'Context check', summary: `~${fmtTokens(d.total)} of ${fmtTokens(d.budget)} token budget: system ${fmtTokens(d.system)}, tools ${fmtTokens(d.tools)}, history ${fmtTokens(d.history)} (${d.messages} messages).${d.overBudget ? ' Over budget, so compacting first.' : ' Fits.'}` };
    case 'context:compact':
      return { node: 'context', cat: 'context', tone: 'warn', title: 'Compacting context', summary: `${d.messages} messages (~${fmtTokens(d.tokens)} tokens) will be summarized into one message.` };
    case 'context:compacted':
      return { node: 'context', cat: 'context', title: 'Context compacted', summary: `~${fmtTokens(d.before)} → ~${fmtTokens(d.after)} tokens. The summary will lead the next user message.`, details: { summary: d.summary } };
    case 'model:request':
      return { node: 'model', cat: 'model', title: d.purpose === 'compaction' ? 'Summarization call' : `Model call #${d.iteration}`, summary: `${d.url.startsWith('demo:') ? 'Scripted model (local, no network)' : `POST ${d.url.replace(/^https?:\/\//, '').split('/')[0]}`} · ${d.model} · ${d.messageCount} message(s) · ~${fmtTokens(d.estimatedTokens)} tokens`, details: { url: d.url, headers: d.headers, body: d.body } };
    case 'model:retry':
      return { node: 'model', cat: 'error', tone: 'warn', title: `Retrying (attempt ${d.attempt + 1}/${d.maxAttempts})`, summary: `${shorten(d.message, 120)}: backing off ${fmtMs(d.delayMs)}.` };
    case 'model:response': {
      const u = d.usage;
      const cache = u.cacheRead ? ` (${fmtTokens(u.cacheRead)} from cache)` : '';
      return { node: 'model', cat: 'model', title: 'Model replied', summary: `${fmtMs(d.ms)} · ${fmtTokens(u.input)} in${cache} / ${fmtTokens(u.output)} out · ${fmtCost(d.cost)} · stop_reason: ${d.stopReason}`, details: { ...(d.reasoning && { reasoning_summary: d.reasoning }), response: d.raw } };
    }
    case 'loop:decide':
      return { node: d.continue ? 'decide' : 'answer', cat: 'loop', title: d.continue ? 'Decide → run tools' : 'Decide → stop', summary: d.reason };
    case 'tool:call':
      return { node: 'validate', cat: 'tool', title: `Tool call requested: ${d.name}`, summary: shorten(JSON.stringify(d.input), 140), details: d.input };
    case 'tool:validate':
      return d.ok
        ? { node: 'validate', cat: 'tool', title: 'Arguments valid', summary: `${d.name}: arguments match the tool's JSON schema.` }
        : { node: 'validate', cat: 'error', tone: 'error', title: 'Validation failed', summary: `${d.errors.join('; ')}. The error is sent back to the model as the tool result.` };
    case 'tool:policy':
      return { node: 'policy', cat: 'guard', tone: d.decision === 'deny' ? 'error' : d.decision === 'ask' ? 'warn' : undefined, title: `Policy → ${d.decision.toUpperCase()}`, summary: d.reason };
    case 'guardrail:approval':
      return { node: 'policy', cat: 'guard', tone: 'waiting', title: 'Waiting for human approval', summary: `The loop is paused until you approve or deny ${d.name} in the chat.` };
    case 'guardrail:decision':
      return { node: 'policy', cat: 'guard', tone: d.approved ? undefined : 'warn', title: d.approved ? 'Approved by user' : 'Denied by user', summary: d.approved ? 'Proceeding to execution.' : 'The tool will not run. The model is told the user denied it.' };
    case 'tool:execute':
      return { node: 'execute', cat: 'tool', title: `Executing ${d.name}`, summary: 'Running locally in your browser…' };
    case 'tool:result':
      return { node: 'execute', cat: d.isError ? 'error' : 'tool', tone: d.isError ? 'error' : undefined, title: `${d.name} ${d.isError ? 'returned an error' : 'returned'}`, summary: `${fmtMs(d.ms)} · ${d.chars.toLocaleString()} chars${d.truncated ? ', truncated before entering history' : ''}${d.isError ? ` · ${shorten(d.output, 120)}` : ''}`, details: { sent_to_model: d.output } };
    case 'guardrail:limit':
      return { node: 'decide', cat: 'guard', tone: 'error', title: 'Guardrail limit reached', summary: d.message };
    case 'run:end':
      return { node: 'answer', cat: 'run', title: `Run #${d.run} finished: ${d.outcome}`, summary: `${d.iterations} model call(s) · ${d.toolCalls} tool call(s) · ${fmtTokens(d.input + d.output)} tokens · ${fmtCost(d.cost)} · ${fmtMs(d.ms)}` };
    case 'run:error':
      return { node: 'model', cat: 'error', tone: 'error', title: `Error${d.status ? ` ${d.status}` : ''}`, summary: `${d.message}. ${d.hint ?? ''}` };
    case 'run:aborted':
      return { node: null, cat: 'error', tone: 'warn', title: 'Cancelled by user', summary: 'Open tool calls were closed as "cancelled" so the history stays valid.' };
    case 'step:paused':
      return { node: undefined, cat: 'step', tone: 'waiting', title: `Paused before: ${d.label}`, summary: 'Step mode is on. Press “Next step” to continue.' };
    default:
      return null;
  }
}

export function createInspector({ root, bus, getSession }) {
  const diagram = renderDiagram($('#diagram', root));
  const timeline = $('#timeline', root);
  const nowCard = $('#now-card', root);
  const nextBtn = $('#next-step', root);
  const stepToggle = $('#step-mode', root);
  let currentNode = null;
  let promptData = null;

  // ── Tabs ────────────────────────────────────────────────────────────────
  const tabs = root.querySelectorAll('[data-tab]');
  function showTab(name) {
    tabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.tab === name)));
    root.querySelectorAll('.tab-panel').forEach((p) => (p.hidden = p.id !== `tab-${name}`));
    if (name === 'messages') renderMessages();
  }
  tabs.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));

  // ── Concepts ────────────────────────────────────────────────────────────
  const conceptsEl = $('#tab-concepts', root);
  conceptsEl.innerHTML = CONCEPTS.map(
    (c, i) => `<article class="concept" id="concept-${c.id}">
      <h4><span class="num">${i + 1}</span>${esc(c.title)}</h4>
      <p>${esc(c.body)}</p>
      <a href="${sourceUrl(c.file)}" target="_blank" rel="noopener">${esc(c.file)} ↗</a>
    </article>`,
  ).join('');

  diagram.onNodeClick((node) => {
    const id = NODE_CONCEPT[node];
    showTab('concepts');
    const el = $(`#concept-${id}`, conceptsEl);
    el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    el?.classList.add('flash');
    setTimeout(() => el?.classList.remove('flash'), 1200);
  });

  function highlightConcept(node) {
    const id = NODE_CONCEPT[node];
    conceptsEl.querySelectorAll('.concept').forEach((c) => c.classList.toggle('current', c.id === `concept-${id}`));
  }

  // ── Step mode ───────────────────────────────────────────────────────────
  stepToggle.addEventListener('change', () => {
    bus.setStepMode(stepToggle.checked);
    nextBtn.hidden = !stepToggle.checked;
    if (!stepToggle.checked) nextBtn.disabled = true;
  });
  nextBtn.addEventListener('click', () => bus.resume());

  $('#export-trace', root).addEventListener('click', () => {
    download(`agent-trace-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify({ exportedAt: new Date().toISOString(), events: bus.log }, null, 2));
  });

  // ── Now card ────────────────────────────────────────────────────────────
  function renderNow(desc, node) {
    const concept = CONCEPTS.find((c) => c.id === NODE_CONCEPT[node]);
    nowCard.className = `now-card ${desc.tone ?? ''}`;
    nowCard.innerHTML = `
      <div class="now-top"><span class="now-dot"></span><span class="now-title">${esc(desc.title)}</span></div>
      <p class="now-what">${esc(desc.summary ?? '')}</p>
      ${concept ? `<p class="now-why"><strong>${esc(concept.title)}:</strong> ${esc(concept.body)} <a href="${sourceUrl(concept.file)}" target="_blank" rel="noopener">${esc(concept.file)} ↗</a></p>` : ''}`;
  }

  // ── Timeline ────────────────────────────────────────────────────────────
  function addTimeline(evt, desc) {
    const empty = $('.timeline-empty', timeline);
    empty?.remove();
    const item = h(`<details class="tl-item cat-${desc.cat} ${desc.tone ? `tone-${desc.tone}` : ''}">
      <summary>
        <span class="tl-dot"></span>
        <span class="tl-main"><span class="tl-title">${esc(desc.title)}</span><span class="tl-sum">${esc(desc.summary ?? '')}</span></span>
        <span class="tl-time">+${(evt.t / 1000).toFixed(2)}s</span>
      </summary>
    </details>`);
    if (desc.details !== undefined) {
      item.addEventListener('toggle', function once() {
        if (!item.open) return;
        item.append(h(`<pre class="code"></pre>`));
        item.lastElementChild.textContent = pretty(desc.details);
        item.removeEventListener('toggle', once);
      });
    } else {
      item.classList.add('no-details');
      item.addEventListener('click', (e) => e.preventDefault());
    }
    const nearBottom = timeline.scrollHeight - timeline.scrollTop - timeline.clientHeight < 80;
    timeline.append(item);
    while (timeline.children.length > 500) timeline.firstElementChild.remove();
    if (nearBottom) timeline.scrollTop = timeline.scrollHeight;
  }

  // ── Prompt tab ──────────────────────────────────────────────────────────
  function renderPrompt() {
    const el = $('#tab-prompt', root);
    if (!promptData) return;
    el.innerHTML = `
      <p class="tab-note">Assembled once when the session started and frozen until the next one. Sections are joined in this order and sent as the <code>system</code> prompt on every call.</p>
      ${promptData.sections.map((s) => `<section class="prompt-sec sec-${s.id}"><h5>${esc(s.label)}</h5><pre class="code">${esc(s.text)}</pre></section>`).join('')}
      <section class="prompt-sec sec-tools"><h5>Tool definitions (${promptData.tools.length})</h5><pre class="code">${esc(JSON.stringify(promptData.tools, null, 2))}</pre></section>`;
  }

  // ── Messages tab ────────────────────────────────────────────────────────
  function renderMessages() {
    const el = $('#tab-messages', root);
    if (el.hidden) return;
    const s = getSession();
    if (!s) return;
    const blocks = (m) =>
      m.content.map((b) => {
        if (b.type === 'text') return `<div class="mb mb-text">${esc(shorten(b.text, 600))}</div>`;
        if (b.type === 'tool_call') return `<div class="mb mb-call"><b>tool_call</b> ${esc(b.name)} <code>${esc(shorten(JSON.stringify(b.input), 300))}</code></div>`;
        return `<div class="mb mb-result ${b.isError ? 'err' : ''}"><b>tool_result</b> ${esc(b.name)}${b.isError ? ' (error)' : ''} <code>${esc(shorten(b.output, 300))}</code></div>`;
      }).join('');
    el.innerHTML = `
      <p class="tab-note">The conversation exactly as the harness stores it: append-only and provider-neutral. Each call sends all of it again. ${s.carryOver ? '<b>A compacted summary is waiting to lead the next user message.</b>' : ''}</p>
      ${s.messages.length ? s.messages.map((m, i) => `
        <div class="msg-row role-${m.role}">
          <div class="msg-meta"><span class="role">${i}. ${m.role}</span>${m.native ? `<span class="native" title="The provider's exact payload (including any reasoning blocks) is kept and replayed unchanged">+ native ${esc(m.native.provider)} payload</span>` : ''}</div>
          ${blocks(m)}
        </div>`).join('') : '<p class="muted">No messages yet in this session.</p>'}`;
  }

  // ── Event subscription ──────────────────────────────────────────────────
  bus.on((evt) => {
    const d = evt.data;
    switch (evt.type) {
      case 'session:start':
        promptData = d;
        renderPrompt();
        renderMessages();
        diagram.resetVisited();
        break;
      case 'run:start':
        diagram.resetVisited();
        diagram.setLoopLabel('agent loop');
        break;
      case 'model:request':
        if (d.purpose === 'agent') diagram.setLoopLabel(`iteration ${d.iteration}`);
        break;
      case 'history:append':
        renderMessages();
        break;
      case 'step:paused':
        nextBtn.disabled = false;
        nextBtn.classList.add('pulse');
        break;
      case 'run:end':
        renderMessages();
        nextBtn.disabled = true;
        break;
    }

    if (evt.type !== 'step:paused') {
      nextBtn.classList.remove('pulse');
      if (bus.stepMode && !bus.paused) nextBtn.disabled = true;
    }

    const desc = describe(evt);
    if (!desc) return;
    if (desc.node !== undefined) {
      currentNode = desc.node;
      diagram.setActive(desc.node, desc.tone === 'error' ? 'error' : desc.tone === 'waiting' ? 'waiting' : 'active');
      highlightConcept(desc.node);
    }
    renderNow(desc, currentNode);
    addTimeline(evt, desc);
  });

  return { showTab };
}
