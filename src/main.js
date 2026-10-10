import { EventBus } from './harness/events.js';
import { Agent } from './harness/agent.js';
import { ToolRegistry } from './harness/tools.js';
import { MemoryStore } from './harness/memory.js';
import { assembleSystemPrompt } from './harness/prompt.js';
import { PROVIDERS } from './providers/index.js';
import { createDb, tableNameFromFile } from './usecase/db.js';
import { createAnalystTools } from './usecase/tools.js';
import { generateSampleData } from './usecase/sample-data.js';
import { SUGGESTIONS } from './usecase/demo-scripts.js';
import { createChat } from './ui/chat.js';
import { createInspector } from './ui/inspector.js';
import { createLiveView } from './ui/liveview.js';
import { createKpis } from './ui/kpis.js';
import { createSettings } from './ui/settings.js';
import { $, esc, storage } from './ui/util.js';
import { APP_CONFIG } from './config.js';

// ── Wiring: one bus, one agent, two views ────────────────────────────────────
const bus = new EventBus();
const memory = new MemoryStore();
const db = createDb();

const appPane = $('#app-pane');
const form = $('#composer');
const input = $('#prompt');
const sendBtn = $('#send');
const stopBtn = $('#stop');
let controller = null;

const settings = createSettings({
  dialog: $('#settings'),
  providers: PROVIDERS,
  onChange: () => updateModePill(),
});

const chat = createChat({ root: appPane, bus, suggestions: SUGGESTIONS, onSuggestion: (text) => submit(text) });

const tools = new ToolRegistry(createAnalystTools({ db, memory, onDataChanged: () => refreshTables() }));

const agent = new Agent({
  bus,
  tools,
  getConfig: settings.getConfig,
  approve: chat.requestApproval,
  buildSystemPrompt: async () =>
    assembleSystemPrompt({
      tables: await db.tables().catch(() => []),
      insights: memory.list(),
      today: new Date().toISOString().slice(0, 10),
    }),
});

// ── Right half: KPI strip + Simple (live map) and Technical views ───────────
const getSession = () => agent.session;
const getLimits = () => settings.getConfig().limits;
createKpis({ root: $('#kpis'), bus, getSession, getLimits });
const liveView = createLiveView({
  root: $('#simple-view'),
  bus,
  memory,
  toolNames: tools.names(),
  getSession,
  getLimits,
  liveIndicator: $('#live-indicator'),
  mobileTab: $('#mobile-tab-behind'),
});
createInspector({ root: $('#inspector-pane'), bus, getSession });

const prefs = storage('local');
function showView(view) {
  document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.view === view)));
  $('#simple-view').hidden = view !== 'simple';
  $('#tech-view').hidden = view !== 'technical';
  prefs.write('agent-harness:view', view);
  if (view === 'simple') requestAnimationFrame(liveView.redraw);
}
document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => showView(b.dataset.view)));
showView(prefs.read('agent-harness:view', 'simple') === 'technical' ? 'technical' : 'simple');

// ── Header ───────────────────────────────────────────────────────────────────
function updateModePill() {
  const c = settings.getConfig();
  const pill = $('#mode-pill');
  const live = c.provider.needsKey !== false;
  pill.dataset.mode = live ? (c.apiKey ? 'live' : 'nokey') : 'demo';
  pill.innerHTML = live
    ? `<span class="dot"></span>${c.apiKey ? 'Live' : 'Key needed'} · ${esc(c.model)}`
    : '<span class="dot"></span>Demo · scripted model';
  $('#demo-banner').hidden = live;
}
$('#mode-pill').addEventListener('click', () => settings.open());
$('#open-settings').addEventListener('click', () => settings.open());
$('#demo-add-key').addEventListener('click', () => settings.open());
$('#repo-link').href = APP_CONFIG.repoUrl;
updateModePill();

// ── Data bar ─────────────────────────────────────────────────────────────────
async function refreshTables() {
  const el = $('#table-chips');
  try {
    const tables = await db.tables();
    el.innerHTML = tables.map((t) => `<span class="table-chip" title="${esc(t.columns.map((c) => `${c.name} ${c.type}`).join(', '))}">${esc(t.name)} <b>${t.rows.toLocaleString()}</b></span>`).join('');
  } catch (err) {
    el.innerHTML = `<span class="table-chip error">database unavailable</span>`;
  }
}

async function loadSample() {
  const { sales, targets } = generateSampleData();
  await db.loadCsv('sales', sales);
  await db.loadCsv('targets', targets);
}

$('#reset-data').addEventListener('click', async () => {
  if (agent.running) return;
  await loadSample();
  await refreshTables();
  chat.notice('↺ Sample tables restored to their original state.');
});

$('#csv-input').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file || agent.running) return;
  if (file.size > 15 * 1024 * 1024) return chat.notice('That file is larger than 15 MB. Please use a smaller CSV.', 'warn');
  const name = tableNameFromFile(file.name);
  try {
    await db.loadCsv(name, await file.text());
    await refreshTables();
    await agent.newSession('data-changed');
    chat.clear();
    chat.notice(`📄 Loaded **${name}** from your file (it stays in this browser). A new session started so the system prompt includes the new table.`);
  } catch (err) {
    chat.notice(`Couldn't load that CSV: ${err.message}`, 'error');
  }
});

// ── Memory dialog ────────────────────────────────────────────────────────────
const memDialog = $('#memory-dialog');
function renderMemory() {
  const items = memory.list();
  $('#memory-count').textContent = items.length;
  $('#memory-list').innerHTML = items.length
    ? items.map((i) => `<li>${esc(i)}</li>`).join('')
    : '<li class="muted">Nothing saved yet. The agent saves insights with the save_insight tool.</li>';
}
memory.subscribe(renderMemory);
renderMemory();
$('#memory-btn').addEventListener('click', () => memDialog.showModal());
$('#memory-clear').addEventListener('click', () => memory.clear());

// ── Sessions & runs ──────────────────────────────────────────────────────────
$('#new-session').addEventListener('click', async () => {
  if (agent.running) return;
  await agent.newSession('manual');
  chat.clear();
});

function setBusy(busy) {
  sendBtn.hidden = busy;
  stopBtn.hidden = !busy;
  input.disabled = busy;
  appPane.classList.toggle('busy', busy);
}

async function submit(text) {
  const t = text.trim();
  if (!t || agent.running) return;
  if (!settings.isReady()) {
    settings.open('Add an API key for the selected provider, or switch to the Demo provider.');
    return;
  }
  input.value = '';
  autosize();
  controller = new AbortController();
  setBusy(true);
  try {
    await agent.run(t, { signal: controller.signal });
  } finally {
    setBusy(false);
    controller = null;
    input.focus();
  }
}

form.addEventListener('submit', (e) => {
  e.preventDefault();
  submit(input.value);
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    submit(input.value);
  }
});
function autosize() {
  input.style.height = 'auto';
  input.style.height = `${Math.min(input.scrollHeight, 160)}px`;
}
input.addEventListener('input', autosize);
stopBtn.addEventListener('click', () => controller?.abort());

// ── Mobile: tabs between the two halves ──────────────────────────────────────
document.querySelectorAll('[data-pane]').forEach((b) =>
  b.addEventListener('click', () => {
    document.querySelectorAll('[data-pane]').forEach((x) => x.setAttribute('aria-selected', String(x === b)));
    document.body.dataset.pane = b.dataset.pane;
  }),
);

// ── Boot ─────────────────────────────────────────────────────────────────────
(async () => {
  $('#table-chips').innerHTML = '<span class="table-chip loading">loading DuckDB…</span>';
  try {
    await db.ready;
    await loadSample();
    await refreshTables();
  } catch (err) {
    console.error(err);
    $('#table-chips').innerHTML = '<span class="table-chip error">DuckDB failed to load</span>';
    chat.notice(`The in-browser database failed to load (${esc(err.message)}). Tools will return errors. Check your connection or ad-blocker and reload.`, 'error');
  }
  await agent.newSession('start');
  sendBtn.disabled = false;
})();
