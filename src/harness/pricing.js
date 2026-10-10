/**
 * Cost accounting. USD per 1M tokens (standard paid tier, text, prompts
 * under 200k tokens). Models not listed here show "n/a" unless a custom price
 * is set in Settings; the token cap still applies either way.
 * Update this table when prices change.
 *
 * Sources: Anthropic and Google Gemini API pricing pages (checked 2026-10-10).
 */
const GEMINI_FLASH_2026 = { input: 0.75, output: 3.75, cacheRead: 0.075 };
const GEMINI_FLASH_2027 = { input: 1.5, output: 7.5, cacheRead: 0.15 };
// Google doubles Gemini 3.6/3.8 Flash prices on 2027-01-01.
const geminiFlash = () => (new Date() < new Date('2027-01-01T00:00:00Z') ? GEMINI_FLASH_2026 : GEMINI_FLASH_2027);

export const PRICES = {
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.2 },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.2 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5, cacheRead: 0.01 },
  'gemini-3.8-flash': geminiFlash,
  'gemini-3.6-flash': geminiFlash,
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5, cacheRead: 0.03 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5, cacheRead: 0.025 },
  'gemini-3.1-pro-preview': { input: 2, output: 12, cacheRead: 0.2 },
  'scripted-analyst': { input: 0, output: 0, cacheRead: 0 },
};

export function priceOf(model, custom) {
  const p = PRICES[model];
  if (p) return typeof p === 'function' ? p() : p;
  if (custom && Number.isFinite(custom.input) && Number.isFinite(custom.output)) return { cacheRead: custom.input, ...custom };
  return null;
}

/** usage: { input, output, cacheRead?, cacheWrite? }, where `input` is ALL input tokens incl. cached ones */
export function costOf(model, usage, custom) {
  const p = priceOf(model, custom);
  if (!p) return null;
  const cacheRead = usage.cacheRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const fresh = Math.max(0, usage.input - cacheRead - cacheWrite);
  return (fresh * p.input + cacheWrite * p.input * 1.25 + cacheRead * p.cacheRead + usage.output * p.output) / 1_000_000;
}
