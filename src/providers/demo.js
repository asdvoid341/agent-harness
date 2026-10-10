import { toAnthropicMessages, parseAnthropicResponse } from './anthropic.js';
import { sleep } from '../harness/guardrails.js';

/**
 * Demo provider: a scripted stand-in for the LLM, so the site works without a key.
 *
 * Only the *model* is fake. The request still goes through the real harness
 * (prompt, context, validation, policy, approvals, real DuckDB tools, events).
 * It speaks the Anthropic wire format so the inspector shows realistic payloads.
 * `respond(body)` is the script engine (see usecase/demo-scripts.js).
 */
export function createDemoProvider(respond) {
  return {
    id: 'demo',
    label: 'Demo (scripted model, no key)',
    keyPlaceholder: '',
    models: ['scripted-analyst'],
    defaultModel: 'scripted-analyst',
    needsKey: false,
    supportsEffort: false,

    buildRequest({ system, tools, messages, model }) {
      return {
        url: 'demo://scripted-model (runs in your browser, no network)',
        headers: { 'content-type': 'application/json' },
        body: {
          model,
          max_tokens: 16000,
          system,
          ...(tools.length && { tools: tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.schema })) }),
          messages: toAnthropicMessages(messages, model, 'demo'),
        },
      };
    },

    async send(req, signal) {
      await sleep(450 + Math.random() * 650, signal);
      return respond(req.body);
    },

    parseResponse: (json, model) => parseAnthropicResponse(json, model, 'demo'),
  };
}
