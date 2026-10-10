/**
 * Guardrails: the limits that keep an autonomous loop safe and affordable.
 *
 *  - Hard caps per run: model calls (iterations), tokens and dollars.
 *  - Tool timeouts so a hung tool can't stall the loop.
 *  - Tool output size caps (applied in agent.js via context.truncate).
 *  - Per-call policy (allow / ask / deny) lives on each tool; "ask" routes to a
 *    human approval step in the UI.
 */
export const DEFAULT_LIMITS = {
  maxIterations: 8,
  maxTokensPerRun: 250_000,
  maxCostUsd: 0.5,
  maxToolOutputChars: 6000,
  toolTimeoutMs: 30_000,
  contextBudget: 24_000,
  maxRetries: 3,
};

export function checkRunLimits(run, limits) {
  if (run.iterations >= limits.maxIterations) {
    return {
      kind: 'max_iterations',
      message: `Stopped: reached the limit of ${limits.maxIterations} model calls for one request. Ask a narrower question, or raise the limit in Settings.`,
    };
  }
  const tokens = run.input + run.output;
  if (tokens >= limits.maxTokensPerRun) {
    return { kind: 'max_tokens', message: `Stopped: this request used ${tokens.toLocaleString()} tokens (limit ${limits.maxTokensPerRun.toLocaleString()}).` };
  }
  if (run.costKnown && run.cost >= limits.maxCostUsd) {
    return { kind: 'max_cost', message: `Stopped: this request cost about $${run.cost.toFixed(3)} (limit $${limits.maxCostUsd}).` };
  }
  return null;
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Run cancelled', 'AbortError'));
    const id = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(id);
      reject(new DOMException('Run cancelled', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function withTimeout(promise, ms, label) {
  let id;
  const timeout = new Promise((_, reject) => {
    id = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(id));
}
