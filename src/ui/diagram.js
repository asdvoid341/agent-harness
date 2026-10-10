/** The live loop diagram: an SVG whose active node follows the event stream. */
const W = 78;
const H = 36;
const NODES = [
  { id: 'input', label: 'User input', x: 4, y: 26 },
  { id: 'prompt', label: 'Prompt', x: 98, y: 26 },
  { id: 'context', label: 'Context', x: 192, y: 26 },
  { id: 'model', label: 'LLM call', x: 286, y: 26 },
  { id: 'decide', label: 'Decide', x: 380, y: 26 },
  { id: 'answer', label: 'Answer', x: 474, y: 26 },
  { id: 'validate', label: 'Validate', x: 380, y: 118 },
  { id: 'policy', label: 'Guardrails', x: 286, y: 118 },
  { id: 'execute', label: 'Run tool', x: 192, y: 118 },
];
const N = Object.fromEntries(NODES.map((n) => [n.id, n]));

const right = (n) => [n.x + W, n.y + H / 2];
const left = (n) => [n.x, n.y + H / 2];
const top = (n) => [n.x + W / 2, n.y];
const bottom = (n) => [n.x + W / 2, n.y + H];

const EDGES = [
  { from: right(N.input), to: left(N.prompt) },
  { from: right(N.prompt), to: left(N.context) },
  { from: right(N.context), to: left(N.model) },
  { from: right(N.model), to: left(N.decide) },
  { from: right(N.decide), to: left(N.answer), label: 'answer', lx: 0, ly: -12 },
  { from: bottom(N.decide), to: top(N.validate), label: 'tool calls', lx: 34, ly: 4 },
  { from: left(N.validate), to: right(N.policy) },
  { from: left(N.policy), to: right(N.execute) },
  { from: top(N.execute), to: bottom(N.context), label: 'results', lx: -28, ly: 4 },
];

export function renderDiagram(container) {
  const edges = EDGES.map((e) => {
    const [x1, y1] = e.from;
    const [x2, y2] = e.to;
    const label = e.label
      ? `<text class="edge-label" x="${(x1 + x2) / 2 + e.lx}" y="${(y1 + y2) / 2 + e.ly}" text-anchor="middle">${e.label}</text>`
      : '';
    return `<line class="edge" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" marker-end="url(#arrow)"/>${label}`;
  }).join('');

  const nodes = NODES.map(
    (n) => `<g class="node" data-node="${n.id}" tabindex="0" role="button" aria-label="${n.label}">
      <rect x="${n.x}" y="${n.y}" width="${W}" height="${H}" rx="9"/>
      <text x="${n.x + W / 2}" y="${n.y + H / 2 + 4}" text-anchor="middle">${n.label}</text>
    </g>`,
  ).join('');

  container.innerHTML = `<svg viewBox="0 0 556 162" role="img" aria-label="Agent loop diagram">
    <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" class="arrowhead"/></marker></defs>
    <text class="loop-label" x="333" y="98" text-anchor="middle" id="loop-label">agent loop</text>
    ${edges}${nodes}
  </svg>`;

  const svg = container.querySelector('svg');
  return {
    setActive(id, tone = 'active') {
      svg.querySelectorAll('.node').forEach((g) => g.classList.remove('active', 'error', 'waiting'));
      if (!id) return;
      const g = svg.querySelector(`[data-node="${id}"]`);
      g?.classList.add(tone);
      g?.classList.add('visited');
    },
    resetVisited() {
      svg.querySelectorAll('.node').forEach((g) => g.classList.remove('visited', 'active', 'error', 'waiting'));
    },
    setLoopLabel(text) {
      svg.querySelector('#loop-label').textContent = text;
    },
    onNodeClick(fn) {
      svg.querySelectorAll('.node').forEach((g) => {
        g.addEventListener('click', () => fn(g.dataset.node));
        g.addEventListener('keydown', (e) => (e.key === 'Enter' || e.key === ' ') && fn(g.dataset.node));
      });
    },
  };
}
