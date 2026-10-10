/**
 * Long-term memory.
 *
 * Short-term memory is simply the message history of the current session.
 * Long-term memory survives sessions: the agent saves short insights with the
 * `save_insight` tool, and they are injected into the system prompt the next
 * time a session starts (never mid-session; the prompt stays frozen).
 *
 * Stored in this browser only (localStorage). If storage is unavailable
 * (private mode, blocked site data) memory simply lasts for this page.
 */
export class MemoryStore {
  constructor(key = 'agent-harness:insights', max = 12) {
    this.key = key;
    this.max = max;
    this.items = this.load();
    this.listeners = new Set();
  }

  subscribe(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  load() {
    try {
      const v = JSON.parse(localStorage.getItem(this.key) ?? '[]');
      return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  persist() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.items));
    } catch {
      /* storage unavailable: memory lasts for this page only */
    }
    const items = this.list();
    this.listeners.forEach((fn) => fn(items));
  }

  list() {
    return [...this.items];
  }

  add(text) {
    const t = String(text).trim();
    if (!t) return this.items.length;
    this.items = [...this.items.filter((i) => i !== t), t].slice(-this.max);
    this.persist();
    return this.items.length;
  }

  clear() {
    this.items = [];
    this.persist();
  }
}
