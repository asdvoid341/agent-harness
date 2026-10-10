import { validate } from './tools.js';
import { measureContext, estimateTokens, truncate, transcriptForSummary, COMPACTION_SYSTEM, COMPACTION_INSTRUCTIONS } from './context.js';
import { checkRunLimits, withTimeout, sleep } from './guardrails.js';
import { costOf } from './pricing.js';
import { postJson, redactHeaders } from '../providers/http.js';

/**
 * The agent loop.
 *
 * An agent is a loop: call the model → run the tools it asks for → append the
 * results → call the model again, until it answers without asking for tools.
 * Everything else in this file exists to make that loop safe, observable and
 * affordable: guardrails, validation, approvals, retries, context management
 * and an event for every step.
 *
 * Messages are stored in one provider-neutral format:
 *   { role: 'user',      content: [{ type: 'text', text }] }
 *   { role: 'user',      content: [{ type: 'tool_result', id, name, output, isError }] }
 *   { role: 'assistant', content: [{ type: 'text', text } | { type: 'tool_call', id, name, input }], native }
 * `native` keeps the provider's exact assistant payload so it can be replayed
 * byte-for-byte (required for reasoning blocks and Gemini thought signatures).
 */
export class Agent {
  constructor({ bus, tools, buildSystemPrompt, approve, getConfig }) {
    this.bus = bus;
    this.tools = tools;
    this.buildSystemPrompt = buildSystemPrompt;
    this.approve = approve;
    this.getConfig = getConfig;
    this.session = null;
    this.running = false;
  }

  /** A session freezes the system prompt and tool set; history starts empty. */
  async newSession(reason = 'start') {
    const prompt = await this.buildSystemPrompt();
    this.session = {
      id: Math.random().toString(36).slice(2, 8),
      system: prompt.text,
      sections: prompt.sections,
      tools: this.tools.definitions(),
      messages: [],
      carryOver: null,
      runs: 0,
    };
    this.bus.emit('session:start', {
      sessionId: this.session.id,
      reason,
      sections: prompt.sections,
      system: prompt.text,
      tools: this.session.tools,
      systemTokens: estimateTokens(prompt.text),
      toolTokens: estimateTokens(this.session.tools),
    });
    return this.session;
  }

  async run(userText, { signal } = {}) {
    if (this.running) throw new Error('A run is already in progress.');
    this.running = true;
    const s = this.session ?? (await this.newSession());
    const cfg = this.getConfig();
    const { provider, model, limits } = cfg;
    const run = { n: ++s.runs, iterations: 0, input: 0, output: 0, cost: 0, costKnown: true, toolCalls: 0, t0: performance.now() };
    let startLen = null;
    let finalText = '';
    let outcome = 'answered';

    this.bus.emit('run:start', { run: run.n, userText, provider: provider.id, model });

    try {
      // ── 1. Context check (and compaction, between turns only) ──────────────
      await this.bus.pause('Context check', signal);
      const userMsg = { role: 'user', content: [{ type: 'text', text: userText }] };
      const ctx = measureContext({ system: s.system, tools: s.tools, messages: [...s.messages, userMsg] });
      const overBudget = ctx.total > limits.contextBudget && s.messages.length > 0;
      this.bus.emit('context:check', { ...ctx, budget: limits.contextBudget, overBudget });
      if (overBudget) await this.compact(cfg, run, signal);

      if (s.carryOver) {
        userMsg.content.unshift({ type: 'text', text: `<session_summary>\n${s.carryOver}\n</session_summary>` });
        s.carryOver = null;
      }
      startLen = s.messages.length;
      this.append(userMsg);

      // ── 2. The loop ────────────────────────────────────────────────────────
      while (true) {
        const limit = checkRunLimits(run, limits);
        if (limit) {
          this.bus.emit('guardrail:limit', limit);
          finalText = limit.message;
          outcome = 'limited';
          break;
        }

        run.iterations++;
        await this.bus.pause(`Model call #${run.iterations}`, signal);
        const res = await this.callModel(cfg, { system: s.system, tools: s.tools, messages: s.messages }, run, signal, 'agent');
        this.append({ role: 'assistant', content: res.content, native: res.native });

        const calls = res.content.filter((b) => b.type === 'tool_call');
        const text = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n\n');

        // ── 3. Decide: continue or stop? ─────────────────────────────────────
        if (!calls.length) {
          const reasons = {
            end: 'No tool calls in the reply, so this is the final answer. Loop ends.',
            max_tokens: 'Hit the max_tokens ceiling. The answer may be cut off.',
            refusal: 'The model declined this request (refusal stop reason).',
          };
          this.bus.emit('loop:decide', { continue: false, stopReason: res.stopReason, reason: reasons[res.stopReason] ?? `Stop reason: ${res.stopReason}` });
          finalText = text;
          outcome = res.stopReason === 'end' ? 'answered' : res.stopReason;
          break;
        }
        this.bus.emit('loop:decide', {
          continue: true,
          stopReason: res.stopReason,
          tools: calls.map((c) => c.name),
          reason: `Model asked for ${calls.length} tool call${calls.length > 1 ? 's' : ''} (${calls.map((c) => c.name).join(', ')}): run them, then loop.`,
        });

        // ── 4. Tools: validate → policy → (approve) → execute ───────────────
        // All results of one turn go back together in a single user message.
        const results = [];
        for (const call of calls) results.push(await this.executeTool(call, cfg, signal));
        this.append({ role: 'user', content: results });
        run.toolCalls += calls.length;
      }
    } catch (err) {
      outcome = err.name === 'AbortError' ? 'aborted' : 'error';
      this.recover(startLen);
      if (outcome === 'aborted') this.bus.emit('run:aborted', {});
      else this.bus.emit('run:error', { message: err.message, status: err.status, hint: hintFor(err) });
    } finally {
      this.running = false;
    }

    this.bus.emit('run:end', {
      run: run.n,
      outcome,
      finalText,
      iterations: run.iterations,
      toolCalls: run.toolCalls,
      input: run.input,
      output: run.output,
      cost: run.costKnown ? run.cost : null,
      ms: Math.round(performance.now() - run.t0),
    });
  }

  append(msg) {
    const s = this.session;
    s.messages.push(msg);
    this.bus.emit('history:append', { index: s.messages.length - 1, role: msg.role, blocks: msg.content.map((b) => b.type), tokens: estimateTokens(msg.native ?? msg.content) });
  }

  /**
   * Keep history valid after an error or cancel. Only *trailing* messages are
   * touched, never earlier turns:
   *  - nothing came back from the model yet → drop this run's user message
   *  - an assistant turn is waiting on tool results → close them as cancelled
   */
  recover(startLen) {
    const s = this.session;
    if (startLen == null) return;
    if (!s.messages.slice(startLen).some((m) => m.role === 'assistant')) {
      s.messages.length = startLen;
      return;
    }
    const last = s.messages.at(-1);
    const pending = last?.role === 'assistant' ? last.content.filter((b) => b.type === 'tool_call') : [];
    if (pending.length) {
      this.append({ role: 'user', content: pending.map((c) => ({ type: 'tool_result', id: c.id, name: c.name, output: 'Cancelled: the run was stopped before this tool finished.', isError: true })) });
    }
  }

  async callModel(cfg, { system, tools, messages }, run, signal, purpose) {
    const { provider, model, apiKey, effort, limits } = cfg;
    const req = provider.buildRequest({ system, tools, messages, model, apiKey, effort });
    this.bus.emit('model:request', {
      purpose,
      iteration: run.iterations,
      provider: provider.id,
      model,
      url: req.url,
      headers: redactHeaders(req.headers),
      body: req.body,
      estimatedTokens: measureContext({ system, tools, messages }).total,
      messageCount: messages.length,
    });

    const t = performance.now();
    const json = await this.sendWithRetry(provider, req, limits.maxRetries, signal);
    const res = provider.parseResponse(json, model);
    const ms = Math.round(performance.now() - t);

    const cost = costOf(model, res.usage);
    run.input += res.usage.input;
    run.output += res.usage.output;
    if (cost == null) run.costKnown = false;
    else run.cost += cost;

    this.bus.emit('model:response', {
      purpose,
      iteration: run.iterations,
      ms,
      stopReason: res.stopReason,
      usage: res.usage,
      cost,
      reasoning: res.reasoning,
      content: res.content,
      raw: json,
    });
    return res;
  }

  /** Retry transient failures (429, 5xx, network) with exponential backoff + jitter. */
  async sendWithRetry(provider, req, maxAttempts, signal) {
    const send = provider.send ?? postJson;
    for (let attempt = 1; ; attempt++) {
      try {
        return await send(req, signal);
      } catch (err) {
        if (err.name === 'AbortError' || !err.retryable || attempt >= maxAttempts) throw err;
        const delayMs = Math.round(Math.min(err.retryAfterMs ?? 1000 * 2 ** (attempt - 1) + Math.random() * 300, 20_000));
        this.bus.emit('model:retry', { attempt, maxAttempts, delayMs, status: err.status, message: err.message });
        await sleep(delayMs, signal);
      }
    }
  }

  async executeTool(call, cfg, signal) {
    const { limits } = cfg;
    const { id, name, input } = call;
    this.bus.emit('tool:call', { id, name, input });
    await this.bus.pause(`Validate ${name}`, signal);

    // Validation: does the tool exist, and do the arguments match its schema?
    const tool = this.tools.get(name);
    const errors = !tool
      ? [`Unknown tool "${name}". Available tools: ${this.tools.names().join(', ')}.`]
      : call.inputError ? [call.inputError] : validate(tool.schema, input);
    this.bus.emit('tool:validate', { id, name, ok: errors.length === 0, errors });
    if (errors.length) {
      return this.toolResult(call, `Invalid tool call:\n- ${errors.join('\n- ')}\nFix the call to match the tool's schema and try again.`, true);
    }

    // Policy: allow / ask (human approval) / deny.
    const policy = tool.policy?.(input) ?? { decision: 'allow', reason: 'No policy on this tool, so it always runs.' };
    this.bus.emit('tool:policy', { id, name, ...policy });
    if (policy.decision === 'deny') return this.toolResult(call, `Blocked by policy: ${policy.reason}`, true);
    if (policy.decision === 'ask') {
      await this.bus.pause(`Approval for ${name}`, signal);
      this.bus.emit('guardrail:approval', { id, name, input, reason: policy.reason });
      const approved = await this.approve({ id, name, input, reason: policy.reason, signal });
      this.bus.emit('guardrail:decision', { id, name, approved });
      if (!approved) return this.toolResult(call, 'The user denied this action. Do not retry it. Tell the user what you would have done instead.', true);
    }

    // Execution, with a timeout. Errors become tool results the model can read.
    await this.bus.pause(`Execute ${name}`, signal);
    this.bus.emit('tool:execute', { id, name });
    const t = performance.now();
    let content;
    let display;
    let isError = false;
    try {
      const out = await withTimeout(tool.run(input, { signal }), limits.toolTimeoutMs, name);
      content = out.content;
      display = out.display;
    } catch (err) {
      if (err.name === 'AbortError') throw err;
      content = `Error: ${err.message}`;
      isError = true;
    }
    const serialized = typeof content === 'string' ? content : JSON.stringify(content);
    return this.toolResult(call, serialized, isError, { ms: Math.round(performance.now() - t), display });
  }

  /** Cap the output size *before* it enters history, emit, and build the result block. */
  toolResult(call, output, isError, { ms = 0, display } = {}) {
    const { text, truncated, originalLength } = truncate(output, this.getConfig().limits.maxToolOutputChars);
    this.bus.emit('tool:result', { id: call.id, name: call.name, output: text, isError, ms, truncated, chars: originalLength, display });
    return { type: 'tool_result', id: call.id, name: call.name, output: text, isError };
  }

  /** Client-side compaction: summarize everything into one message, start fresh. */
  async compact(cfg, run, signal) {
    const s = this.session;
    const before = measureContext({ system: s.system, tools: s.tools, messages: s.messages });
    this.bus.emit('context:compact', { messages: s.messages.length, tokens: before.total });
    await this.bus.pause('Compaction', signal);
    const prompt = `${COMPACTION_INSTRUCTIONS}\n\n<transcript>\n${transcriptForSummary(s.messages)}\n</transcript>`;
    const res = await this.callModel(
      cfg,
      { system: COMPACTION_SYSTEM, tools: [], messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }] },
      run,
      signal,
      'compaction',
    );
    const summary = res.content.filter((b) => b.type === 'text').map((b) => b.text).join('\n').trim();
    s.messages = [];
    s.carryOver = summary || '(summary unavailable)';
    this.bus.emit('context:compacted', { summary: s.carryOver, before: before.total, after: estimateTokens(s.carryOver) });
  }
}

function hintFor(err) {
  if (err.status === 401 || err.status === 403) return 'Check that your API key is correct and has access to this model.';
  if (err.status === 404) return 'The model name may be wrong. Check it in Settings.';
  if (err.status === 429) return 'Rate limited or out of credit. Wait a moment or check your provider billing.';
  if (err.status === 400) return 'The provider rejected the request. Open the timeline entry on the right to see the raw error.';
  if (err.status == null) return 'Network or CORS problem. An ad-blocker or corporate proxy may be blocking the provider API.';
  return 'Open the timeline on the right for the raw error.';
}
