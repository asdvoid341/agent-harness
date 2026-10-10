import { measureContext } from '../harness/context.js';
import { fmtTokens, fmtCost, fmtMs } from './util.js';

const KPIS = [
  { id: 'tokens', label: 'Tokens used', tip: 'Tokens are the small chunks of text the AI reads and writes (roughly ¾ of a word each). Providers charge per token.' },
  { id: 'cost', label: 'Cost', tip: 'What this question cost on your API account, estimated from the provider’s published prices.' },
  { id: 'calls', label: 'AI model calls', tip: 'How many times the agent asked the AI model “what should I do next?”. Each tool result means another call.' },
  { id: 'tools', label: 'Tools used', tip: 'How many times the agent used a tool (looking at tables, running queries, drawing charts, saving notes).' },
  { id: 'time', label: 'Time', tip: 'How long this question has taken so far.' },
  { id: 'memory', label: 'Working memory', tip: 'How full the conversation is compared with the budget. When it fills up, the agent summarizes older messages to make room.' },
];

/** The KPI strip above both views: per-question numbers, with session totals underneath. */
export function createKpis({ root, bus, getSession, getLimits }) {
  root.innerHTML = KPIS.map(
    (k) => `<div class="kpi kpi-${k.id}" title="${k.tip}">
      <div class="kpi-k">${k.label} <span class="kpi-i" aria-hidden="true">ⓘ</span></div>
      <div class="kpi-v" data-v="${k.id}">–</div>
      ${k.id === 'memory' ? '<div class="meter"><div class="meter-fill" data-fill></div></div>' : ''}
      <div class="kpi-s" data-s="${k.id}">&nbsp;</div>
    </div>`,
  ).join('');

  const v = (id) => root.querySelector(`[data-v="${id}"]`);
  const s = (id) => root.querySelector(`[data-s="${id}"]`);
  const fill = root.querySelector('[data-fill]');

  let run = null;
  let session = { tokens: 0, cost: 0, costKnown: true, tools: 0 };
  let timer = null;

  function set(id, value, sub) {
    const el = v(id);
    if (el.textContent !== value) {
      el.textContent = value;
      const card = el.parentElement;
      card.classList.remove('bump');
      void el.offsetWidth; // restart the animation
      card.classList.add('bump');
      clearTimeout(card._bump);
      card._bump = setTimeout(() => card.classList.remove('bump'), 500);
    }
    if (sub != null) s(id).textContent = sub;
  }

  function render() {
    const limits = getLimits();
    if (!run) {
      set('tokens', '0', 'this question');
      set('cost', '$0.00', 'this question');
      set('calls', '0', `limit ${limits.maxIterations} per question`);
      set('tools', '0', 'this question');
      set('time', '–', 'this question');
    } else {
      set('tokens', fmtTokens(run.input + run.output), `${fmtTokens(run.input)} read · ${fmtTokens(run.output)} written`);
      set('cost', run.costKnown ? fmtCost(run.cost) : 'n/a', session.costKnown ? `session ${fmtCost(session.cost)}` : 'no price set: add one in Settings');
      set('calls', String(run.calls), `limit ${limits.maxIterations} per question`);
      const extras = [run.approved && `${run.approved} approved`, run.blocked && `${run.blocked} blocked`].filter(Boolean).join(' · ');
      set('tools', String(run.tools), extras || `session ${session.tools}`);
      set('time', fmtMs(Math.round((run.end ?? performance.now()) - run.t0)), run.end ? 'total' : 'running…');
    }
    renderMemory();
  }

  function renderMemory() {
    const sess = getSession();
    const budget = getLimits().contextBudget;
    if (!sess) return;
    const tokens = measureContext({ system: sess.system, tools: sess.tools, messages: sess.messages }).total;
    const pct = Math.min(100, (tokens / budget) * 100);
    fill.style.width = `${pct}%`;
    fill.dataset.level = pct > 90 ? 'high' : pct > 65 ? 'mid' : 'low';
    v('memory').textContent = `${Math.round(pct)}%`;
    s('memory').textContent = `~${fmtTokens(tokens)} of ${fmtTokens(budget)} tokens`;
  }

  bus.on((evt) => {
    const d = evt.data;
    switch (evt.type) {
      case 'session:start':
        session = { tokens: 0, cost: 0, costKnown: true, tools: 0 };
        run = null;
        break;
      case 'run:start':
        run = { input: 0, output: 0, cost: 0, costKnown: true, calls: 0, tools: 0, approved: 0, blocked: 0, t0: performance.now() };
        clearInterval(timer);
        timer = setInterval(render, 200);
        break;
      case 'model:response':
        if (!run) break;
        run.calls++;
        run.input += d.usage.input;
        run.output += d.usage.output;
        session.tokens += d.usage.input + d.usage.output;
        if (d.cost == null) {
          run.costKnown = false;
          session.costKnown = false;
        } else {
          run.cost += d.cost;
          session.cost += d.cost;
        }
        break;
      case 'tool:result':
        if (!run) break;
        run.tools++;
        session.tools++;
        break;
      case 'tool:policy':
        if (run && d.decision === 'deny') run.blocked++;
        break;
      case 'guardrail:decision':
        if (run && d.approved) run.approved++;
        if (run && !d.approved) run.blocked++;
        break;
      case 'run:end':
        if (run) run.end = performance.now();
        clearInterval(timer);
        break;
    }
    render();
  });

  render();
}
