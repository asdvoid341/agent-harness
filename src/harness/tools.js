/**
 * Tool registry + argument validation.
 *
 * A tool is: { name, description, schema, run(input, ctx), policy?(input) }.
 *  - `description` and `schema` are what the model sees. Descriptions are prompts:
 *    they are the model's only documentation for when and how to call the tool.
 *  - `run` is what the harness executes. The model never executes anything; it
 *    only *asks*, and the harness decides.
 *  - `run` returns { content, display? }: `content` goes back to the model,
 *    `display` is a richer payload for the UI only (tables, charts).
 *  - `policy` (optional) classifies a call as allow / ask / deny.
 */
export class ToolRegistry {
  constructor(tools = []) {
    this.tools = new Map();
    tools.forEach((t) => this.register(t));
  }

  register(tool) {
    if (!tool.name || !tool.schema || typeof tool.run !== 'function') {
      throw new Error(`Invalid tool definition: ${tool.name ?? '(unnamed)'}`);
    }
    this.tools.set(tool.name, tool);
  }

  get(name) {
    return this.tools.get(name);
  }

  names() {
    return [...this.tools.keys()];
  }

  /** Provider-neutral definitions; each provider adapter reshapes these. */
  definitions() {
    return [...this.tools.values()].map(({ name, description, schema }) => ({ name, description, schema }));
  }
}

/**
 * A deliberately small JSON-Schema validator (the subset our tools use).
 * Model-generated arguments are untrusted input: wrong types, missing fields
 * and invented parameters all happen. Errors are returned to the model as a
 * tool result so it can correct itself on the next turn.
 */
export function validate(schema, value, path = 'input') {
  const errors = [];
  const actual = Array.isArray(value) ? 'array' : value === null ? 'null' : typeof value;

  if (schema.type) {
    const ok =
      schema.type === 'integer' ? Number.isInteger(value)
      : schema.type === 'number' ? typeof value === 'number' && Number.isFinite(value)
      : actual === schema.type;
    if (!ok) {
      errors.push(`${path}: expected ${schema.type}, got ${actual}`);
      return errors;
    }
  }

  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path}: must be one of ${schema.enum.map((v) => JSON.stringify(v)).join(', ')}`);
  }

  if (typeof value === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: must be at least ${schema.minLength} characters`);
    if (schema.maxLength != null && value.length > schema.maxLength) errors.push(`${path}: must be at most ${schema.maxLength} characters`);
  }

  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) errors.push(`${path}: must be >= ${schema.minimum}`);
    if (schema.maximum != null && value > schema.maximum) errors.push(`${path}: must be <= ${schema.maximum}`);
  }

  if (actual === 'array') {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: needs at least ${schema.minItems} item(s)`);
    if (schema.maxItems != null && value.length > schema.maxItems) errors.push(`${path}: allows at most ${schema.maxItems} item(s)`);
    if (schema.items) value.forEach((item, i) => errors.push(...validate(schema.items, item, `${path}[${i}]`)));
  }

  if (actual === 'object') {
    for (const key of schema.required ?? []) {
      if (!(key in value)) errors.push(`${path}.${key}: is required`);
    }
    for (const [key, v] of Object.entries(value)) {
      const prop = schema.properties?.[key];
      if (prop) errors.push(...validate(prop, v, `${path}.${key}`));
      else if (schema.additionalProperties === false) {
        errors.push(`${path}.${key}: unknown parameter (allowed: ${Object.keys(schema.properties ?? {}).join(', ')})`);
      }
    }
  }

  return errors;
}
