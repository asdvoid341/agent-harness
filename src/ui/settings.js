import { $, esc, storage } from './util.js';
import { DEFAULT_LIMITS } from '../harness/guardrails.js';

const local = storage('local');
const session = storage('session');
const SETTINGS_KEY = 'agent-harness:settings';
const keyName = (id) => `agent-harness:key:${id}`;

/**
 * Settings: provider, model, API key and guardrail limits.
 *
 * API keys are held in memory by default. If the visitor ticks "remember",
 * the key goes to sessionStorage (cleared when the tab closes), never to
 * localStorage, and it is only ever sent to the chosen provider's API.
 */
export function createSettings({ dialog, providers, onChange }) {
  const saved = local.read(SETTINGS_KEY, {});
  const state = {
    providerId: providers[saved.providerId] ? saved.providerId : 'demo',
    models: saved.models ?? {},
    effort: saved.effort ?? 'medium',
    limits: { ...DEFAULT_LIMITS, ...(saved.limits ?? {}) },
    keys: {},
    remember: {},
  };
  for (const id of Object.keys(providers)) {
    if (providers[id].retiredModels?.includes(state.models[id])) delete state.models[id];
    const k = session.read(keyName(id));
    if (k) {
      state.keys[id] = k;
      state.remember[id] = true;
    }
  }

  const f = {
    provider: $('#set-provider', dialog),
    key: $('#set-key', dialog),
    keyRow: $('#key-row', dialog),
    keyLink: $('#set-keylink', dialog),
    remember: $('#set-remember', dialog),
    model: $('#set-model', dialog),
    modelList: $('#model-list', dialog),
    modelRow: $('#model-row', dialog),
    effortRow: $('#effort-row', dialog),
    effort: $('#set-effort', dialog),
    iter: $('#lim-iter', dialog),
    cost: $('#lim-cost', dialog),
    context: $('#lim-context', dialog),
    output: $('#lim-output', dialog),
    error: $('#set-error', dialog),
    message: $('#set-message', dialog),
  };

  f.provider.innerHTML = Object.values(providers).map((p) => `<option value="${p.id}">${esc(p.label)}</option>`).join('');

  function syncProviderFields() {
    const p = providers[f.provider.value];
    const needsKey = p.needsKey !== false;
    f.keyRow.hidden = !needsKey;
    f.modelRow.hidden = !needsKey;
    f.effortRow.hidden = !p.supportsEffort;
    f.key.placeholder = p.keyPlaceholder ?? '';
    f.key.value = state.keys[p.id] ?? '';
    f.remember.checked = !!state.remember[p.id];
    f.keyLink.href = p.keyUrl ?? '#';
    f.modelList.innerHTML = p.models.map((m) => `<option value="${esc(m)}"></option>`).join('');
    f.model.value = state.models[p.id] ?? p.defaultModel;
    f.error.textContent = '';
  }

  function open(message = '') {
    f.provider.value = state.providerId;
    f.effort.value = state.effort;
    f.iter.value = state.limits.maxIterations;
    f.cost.value = state.limits.maxCostUsd;
    f.context.value = state.limits.contextBudget;
    f.output.value = state.limits.maxToolOutputChars;
    f.message.textContent = message;
    f.message.hidden = !message;
    syncProviderFields();
    dialog.showModal();
    (f.provider.value === 'demo' ? f.provider : f.key).focus();
  }

  f.provider.addEventListener('change', syncProviderFields);

  dialog.querySelector('form').addEventListener('submit', (e) => {
    if (e.submitter?.value === 'cancel') return;
    e.preventDefault();
    const p = providers[f.provider.value];
    const key = f.key.value.trim();
    if (p.needsKey !== false && !key) {
      f.error.textContent = `Enter your ${p.label} API key, or pick the Demo provider.`;
      f.key.focus();
      return;
    }
    const num = (el, min, max, fallback) => {
      const v = Number(el.value);
      return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
    };
    state.providerId = p.id;
    if (p.needsKey !== false) {
      state.keys[p.id] = key;
      state.remember[p.id] = f.remember.checked;
      if (f.remember.checked) session.write(keyName(p.id), key);
      else session.remove(keyName(p.id));
      state.models[p.id] = f.model.value.trim() || p.defaultModel;
    }
    state.effort = f.effort.value;
    state.limits = {
      ...state.limits,
      maxIterations: num(f.iter, 1, 30, DEFAULT_LIMITS.maxIterations),
      maxCostUsd: num(f.cost, 0.01, 20, DEFAULT_LIMITS.maxCostUsd),
      contextBudget: num(f.context, 2000, 900_000, DEFAULT_LIMITS.contextBudget),
      maxToolOutputChars: num(f.output, 500, 100_000, DEFAULT_LIMITS.maxToolOutputChars),
    };
    local.write(SETTINGS_KEY, { providerId: state.providerId, models: state.models, effort: state.effort, limits: state.limits });
    dialog.close();
    onChange?.(getConfig());
  });

  $('#forget-keys', dialog).addEventListener('click', () => {
    for (const id of Object.keys(providers)) session.remove(keyName(id));
    state.keys = {};
    state.remember = {};
    f.key.value = '';
    f.remember.checked = false;
    f.error.textContent = 'All keys cleared from this tab.';
  });

  function getConfig() {
    const provider = providers[state.providerId];
    return {
      provider,
      model: provider.needsKey === false ? provider.defaultModel : state.models[provider.id] ?? provider.defaultModel,
      apiKey: state.keys[provider.id] ?? '',
      effort: state.effort,
      limits: state.limits,
    };
  }

  const isReady = () => {
    const c = getConfig();
    return c.provider.needsKey === false || !!c.apiKey;
  };

  return { open, getConfig, isReady };
}
