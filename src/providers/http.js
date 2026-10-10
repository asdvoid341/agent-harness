/**
 * Transport: one POST helper shared by all providers, plus error classification.
 * The harness's retry logic (agent.js) relies on `retryable` being right:
 * rate limits and server errors are worth retrying, bad requests and bad keys are not.
 */
const RETRYABLE = new Set([408, 409, 425, 429, 500, 502, 503, 504, 529]);

export class ProviderError extends Error {
  constructor(message, { status, retryable = false, retryAfterMs, body } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
    this.body = body;
  }
}

export async function postJson({ url, headers, body }, signal) {
  let res;
  try {
    res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal });
  } catch (err) {
    if (err.name === 'AbortError') throw err;
    throw new ProviderError(`Network error: ${err.message}`, { retryable: true });
  }
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* non-JSON error body */ }

  if (!res.ok) {
    const detail = json?.error?.message ?? (typeof json?.error === 'string' ? json.error : null) ?? text.slice(0, 300) ?? res.statusText;
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new ProviderError(`${res.status}: ${detail}`, {
      status: res.status,
      retryable: RETRYABLE.has(res.status),
      retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
      body: json ?? text,
    });
  }
  return json;
}

/** Secrets never reach the event log: credential headers are masked before emitting. */
export function redactHeaders(headers) {
  const out = {};
  for (const [k, v] of Object.entries(headers ?? {})) {
    out[k] = /^(x-api-key|authorization|x-goog-api-key)$/i.test(k) ? `${String(v).slice(0, 10)}…REDACTED` : v;
  }
  return out;
}
