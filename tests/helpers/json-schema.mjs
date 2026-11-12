/**
 * Minimal JSON Schema (2020-12 subset) validator for the tests: type, const,
 * enum, properties, required, additionalProperties, items, maxItems, minimum,
 * maximum, maxLength, pattern, anyOf, allOf, if/then and local $ref. Enough
 * for `schema/magic-editor-x.schema.json`; not a general validator.
 */

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
 * Validates a value.
 * @param {object} root - Root schema (for $ref).
 * @param {object} schema - Current schema.
 * @param {unknown} value - Value.
 * @param {string} [path] - JSON pointer of the value.
 * @returns {string[]} Error messages (empty when valid).
 */
export const validate = (root, schema, value, path = '') => {
  if (schema.$ref) {
    const target = schema.$ref
      .replace(/^#\//, '')
      .split('/')
      .reduce((node, key) => node[key], root);
    return validate(root, target, value, path);
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
    if (schema.pattern && !new RegExp(schema.pattern, 'u').test(value)) errors.push(`${path}: pattern`);
  }
  if (typeof value === 'number') {
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: minimum`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${path}: maximum`);
  }
  if (Array.isArray(value)) {
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: maxItems`);
    if (schema.items)
      value.forEach((item, i) => errors.push(...validate(root, schema.items, item, `${path}/${i}`)));
  }
  if (typeOf(value) === 'object') {
    for (const key of schema.required || []) if (!(key in value)) errors.push(`${path}: missing ${key}`);
    for (const [key, child] of Object.entries(value)) {
      if (schema.properties && key in schema.properties)
        errors.push(...validate(root, schema.properties[key], child, `${path}/${key}`));
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected ${key}`);
      else if (schema.additionalProperties && typeof schema.additionalProperties === 'object')
        errors.push(...validate(root, schema.additionalProperties, child, `${path}/${key}`));
    }
  }
  if (schema.anyOf && !schema.anyOf.some((option) => validate(root, option, value, path).length === 0))
    errors.push(`${path}: anyOf`);
  for (const part of schema.allOf || []) errors.push(...validate(root, part, value, path));
  if (schema.if && schema.then && validate(root, schema.if, value, path).length === 0)
    errors.push(...validate(root, schema.then, value, path));
  return errors;
};
