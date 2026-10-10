/**
 * Provider registry. Every adapter implements the same small interface:
 *   buildRequest({ system, tools, messages, model, apiKey, effort }) → { url, headers, body }
 *   parseResponse(json, model) → { content, reasoning, stopReason, usage, native }
 *   send?(req, signal)          (optional; defaults to an HTTP POST)
 * The harness only ever talks to this interface, so adding a provider never
 * touches the agent loop.
 */
import { anthropic } from './anthropic.js';
import { openai } from './openai.js';
import { gemini } from './gemini.js';
import { createDemoProvider } from './demo.js';
import { scriptedResponse } from '../usecase/demo-scripts.js';

export const PROVIDERS = {
  demo: createDemoProvider(scriptedResponse),
  anthropic,
  openai,
  gemini,
};
