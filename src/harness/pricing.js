/**
 * Cost accounting. USD per 1M tokens. Only models listed here get a dollar
 * figure; for anything else the harness still tracks tokens, and the token
 * cap still applies. Update this table when prices change.
 */
export const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'scripted-analyst': { input: 0, output: 0, cacheRead: 0 },
};

/** usage: { input, output, cacheRead?, cacheWrite? }, where `input` is ALL input tokens incl. cached ones */
export function costOf(model, usage) {
  const p = PRICES[model];
  if (!p) return null;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const fresh = Math.max(0, usage.input - cacheRead - cacheWrite);
  return (fresh * p.input + cacheWrite * p.input * 1.25 + cacheRead * p.cacheRead + usage.output * p.output) / 1_000_000;
}
