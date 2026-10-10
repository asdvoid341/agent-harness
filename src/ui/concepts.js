/**
 * The "conceptual guide": what each part of a harness is for.
 * `nodes` ties a concept to the diagram nodes that light it up.
 */
export const CONCEPTS = [
  {
    id: 'loop',
    title: 'The agent loop',
    nodes: ['decide'],
    file: 'src/harness/agent.js',
    body: 'An agent is a loop: call the model, run whatever tools it asks for, append the results, and call it again until it replies without asking for a tool. Everything else in a harness exists to make that loop safe, observable and affordable.',
  },
  {
    id: 'react',
    title: 'Think → Act → Observe (the ReAct pattern)',
    nodes: ['decide', 'execute'],
    file: 'src/harness/agent.js',
    body: 'Most agents follow the ReAct pattern (“reason + act”). The model thinks about what to do, acts by asking for a tool, then observes the result, and repeats until it can answer. Each pass through the harness loop is one Think → Act → Observe cycle.',
  },
  {
    id: 'prompt',
    title: 'Prompt assembly',
    nodes: ['prompt'],
    file: 'src/harness/prompt.js',
    body: 'The system prompt is built from named parts: role, operating rules, the live environment (which tables exist) and long-term memory. It is assembled once per session and then frozen. Changing it mid-conversation would throw away the provider’s prompt cache and, on newer Claude models, the reasoning the model kept from earlier turns.',
  },
  {
    id: 'tools',
    title: 'Tools are a contract',
    nodes: ['prompt', 'validate'],
    file: 'src/harness/tools.js',
    body: 'The model never runs anything. It sees each tool’s name, description and JSON schema, and asks for a call. The harness owns execution. Tool descriptions are prompts: they are the model’s only documentation for when and how to use the tool.',
  },
  {
    id: 'context',
    title: 'Context management',
    nodes: ['context'],
    file: 'src/harness/context.js',
    body: 'The model is stateless. Every call resends the whole conversation, so the harness measures it against a budget. History is append-only: past turns are never edited or snipped. Large tool outputs are truncated before they enter history. When the budget is exceeded, the session is compacted: summarized into one message, then continued from that summary.',
  },
  {
    id: 'provider',
    title: 'Model calls & provider adapters',
    nodes: ['model'],
    file: 'src/providers/',
    body: 'Anthropic, OpenAI and Gemini each shape messages, tool calls and tool results differently. The harness keeps one internal format and a small adapter per provider translates it. The provider’s exact reply is also kept, so it can be sent back unchanged, which matters for reasoning blocks and Gemini’s thought signatures.',
  },
  {
    id: 'reliability',
    title: 'Retries & error handling',
    nodes: ['model'],
    file: 'src/providers/http.js',
    body: 'Rate limits (429) and server errors (5xx) are retried with exponential backoff plus jitter. Bad requests and bad keys are not retried. Tool failures are not crashes: they become tool results, so the model can read the error and recover.',
  },
  {
    id: 'validation',
    title: 'Validating tool calls',
    nodes: ['validate'],
    file: 'src/harness/tools.js',
    body: 'Model-generated arguments are untrusted input. They can have the wrong types, miss fields, or invent parameters. Each call is checked against its schema before anything runs. The errors go back to the model, which usually fixes the call on the next turn.',
  },
  {
    id: 'guardrails',
    title: 'Guardrails & human approval',
    nodes: ['policy', 'decide'],
    file: 'src/harness/guardrails.js',
    body: 'A policy sorts every call into allow, ask or deny. Read-only SQL runs automatically, data changes wait for a human to approve, and file or network access is blocked. Each run is also capped on model calls, tokens and dollars, and each tool call has a timeout, so a looping agent cannot burn your budget.',
  },
  {
    id: 'execution',
    title: 'Tool execution',
    nodes: ['execute'],
    file: 'src/usecase/tools.js',
    body: 'Each tool returns two channels: compact JSON for the model (to save context) and a rich display for the user (full tables, charts). What the model needs to reason with is rarely what a person wants to look at.',
  },
  {
    id: 'memory',
    title: 'Memory',
    nodes: ['prompt', 'context'],
    file: 'src/harness/memory.js',
    body: 'Short-term memory is the conversation history. Long-term memory survives sessions: the agent saves short, verified insights, and they are injected into the next session’s system prompt. In this demo they are stored only in your browser.',
  },
  {
    id: 'stopping',
    title: 'Stop conditions',
    nodes: ['decide', 'answer'],
    file: 'src/harness/agent.js',
    body: 'The loop continues while the model asks for tools. It stops on a final answer, on hitting max_tokens, on a refusal, on a guardrail limit, or when the user cancels. After an error or cancel, the history is repaired by closing any open tool calls, so the next turn is valid.',
  },
  {
    id: 'observability',
    title: 'Observability',
    nodes: ['input', 'answer'],
    file: 'src/harness/events.js',
    body: 'Every step emits an event. This whole panel is just a subscriber, and so is the chat on the left. Use step mode to pause before each phase, or export the trace as JSON to debug a run after the fact.',
  },
];

export const NODE_CONCEPT = {
  input: 'observability',
  prompt: 'prompt',
  context: 'context',
  model: 'provider',
  decide: 'loop',
  validate: 'validation',
  policy: 'guardrails',
  execute: 'execution',
  answer: 'stopping',
};
