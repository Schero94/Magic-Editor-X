/**
 * Minimal JSON Schema (2020-12 subset) validator: type, const, enum,
 * properties, required, additionalProperties, items, maxItems, minimum,
 * maximum, maxLength, pattern, anyOf, allOf, if/then and local $ref. Enough
 * for the schemas built from `shared/schema.mjs` (the published schema and the
 * per-preset schemas of the MCP tools, 2.5); not a general validator. Only
 * schemas written by this package are passed in, so their patterns are trusted
 * and compiled once. Values are walked to a fixed depth and the error list is
 * bounded.
 */

const MAX_DEPTH = 64;
const patterns = new Map();

const typeOf = (value) => {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
};

const matchesType = (value, type) => {
  const actual = typeOf(value);
  return actual === type || (type === 'number' && actual === 'integer');
};

/**
 * Compiled pattern of a schema (cached; schemas are package code).
 * @param {string} source - Pattern source.
 * @returns {RegExp} Regular expression.
 */
const patternOf = (source) => {
  if (!patterns.has(source)) patterns.set(source, new RegExp(source, 'u'));
  return patterns.get(source);
};

/**
 * Validates a value.
 * @param {object} root - Root schema (for $ref).
 * @param {object} schema - Current schema.
 * @param {unknown} value - Value.
 * @param {string} [path] - JSON pointer of the value.
 * @param {number} [depth] - Current depth (internal).
 * @returns {string[]} Error messages `<pointer>: <reason>` (empty when valid).
 */
export const validate = (root, schema, value, path = '', depth = 0) => {
  if (depth > MAX_DEPTH) return [`${path}: too deep`];
  if (schema.$ref) {
    const target = schema.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((node, key) => node[key], root);
    return validate(root, target, value, path, depth + 1);
  }
  const errors = [];
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) return [`${path}: expected ${types.join('|')}`];
  }
  if ('const' in schema && value !== schema.const) errors.push(`${path}: const`);
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: enum ${JSON.stringify(value)}`);
  if (typeof value === 'string') {
    if (schema.maxLength !== undefined && value.length > schema.maxLength) errors.push(`${path}: maxLength`);
    if (schema.pattern && !patternOf(schema.pattern).test(value)) errors.push(`${path}: pattern`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: maxItems`);
    if (schema.items)
      value.forEach((item, i) =>
        errors.push(...validate(root, schema.items, item, `${path}/${i}`, depth + 1))
      );
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${path}: missing ${key}`);
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties && key in schema.properties)
        errors.push(...validate(root, schema.properties[key], child, `${path}/${key}`, depth + 1));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        errors.push(...validate(root, schema.additionalProperties, child, `${path}/${key}`, depth + 1));
    }
  }
  if (
    schema.anyOf &&
    !schema.anyOf.some((option) => validate(root, option, value, path, depth + 1).length === 0)
  )
    errors.push(`${path}: anyOf`);
  for (const part of schema.allOf || []) errors.push(...validate(root, part, value, path, depth + 1));
  if (schema.if && schema.then && validate(root, schema.if, value, path, depth + 1).length === 0)
    errors.push(...validate(root, schema.then, value, path, depth + 1));
  return errors;
};
