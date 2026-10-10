export const $ = (sel, root = document) => root.querySelector(sel);

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function h(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const fmtTokens = (n) => (n == null ? '–' : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
export const fmtCost = (c) => (c == null ? 'n/a' : c === 0 ? '$0.00' : c < 0.01 ? `$${c.toFixed(4)}` : `$${c.toFixed(3)}`);
export const fmtMs = (ms) => (ms == null ? '–' : ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`);
export const shorten = (s, n) => {
  const str = String(s ?? '');
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

/** Pretty-print for the inspector; tool outputs are JSON strings, so parse them when possible. */
export function pretty(value, max = 16_000) {
  let v = value;
  if (typeof v === 'string') {
    try { v = JSON.parse(v); } catch { /* plain string */ }
  }
  let s = typeof v === 'string' ? v : JSON.stringify(v, null, 2) ?? '';
  if (s.length > max) s = `${s.slice(0, max)}\n… (${(s.length - max).toLocaleString()} more characters)`;
  return s;
}

export function markdown(text) {
  if (window.marked && window.DOMPurify) return window.DOMPurify.sanitize(window.marked.parse(String(text ?? '')));
  return `<p>${esc(text).replace(/\n/g, '<br>')}</p>`;
}

export function download(filename, text, type = 'application/json') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function storage(kind = 'local') {
  const get = () => (kind === 'session' ? window.sessionStorage : window.localStorage);
  return {
    read(key, fallback = null) {
      try {
        const v = get().getItem(key);
        return v == null ? fallback : JSON.parse(v);
      } catch {
        return fallback;
      }
    },
    write(key, value) {
      try { get().setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
    },
    remove(key) {
      try { get().removeItem(key); } catch { /* storage unavailable */ }
    },
  };
}
