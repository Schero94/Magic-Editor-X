/**
 * Code-registered block definitions (custom block SDK, 2.3).
 *
 * A definition describes one block type in one place: its name, a version,
 * a small JSON-schema-like descriptor of the stored data, an optional extra
 * sanitising step and optional text, Markdown and render-tree output. The
 * same object is registered on the server (sanitising, presets, collaboration,
 * Content API and GraphQL output), in the admin (editor tool) and handed to
 * the frontend renderers.
 *
 * Definitions are trusted developer code; block data is not. Every value is
 * cleaned by the descriptor: unknown keys are dropped, wrong types fall back to
 * the field default, strings are cut to their maximum, URLs go through
 * `sanitizeUrl`, inline HTML through the shared inline policy, arrays are
 * bounded, nesting is at most four levels deep. Cleaning never throws and is
 * deterministic.
 *
 * Pure ESM without dependencies or Node built-ins (bundled as
 * `magic-editor-x/blocks`).
 */

import { sanitizeUrl, LINK_SCHEMES } from '../sanitize-policy.mjs';

/** Field types of a block schema. */
export const BLOCK_FIELD_TYPES = Object.freeze([
  'text',
  'inline',
  'url',
  'enum',
  'number',
  'boolean',
  'array',
  'object',
]);

/** Bounds of block definitions and of the data they describe. */
export const BLOCK_LIMITS = Object.freeze({
  /** Fields per object (also the schema root). */
  maxFields: 50,
  /** Nesting of arrays and objects below the root. */
  maxDepth: 4,
  /** Largest `max` of a text or inline field. */
  maxText: 100000,
  /** Default `max` of a text field. */
  defaultText: 1000,
  /** Default `max` of an inline HTML field. */
  defaultInline: 10000,
  /** Largest `max` of an array field. */
  maxItems: 500,
  /** Default `max` of an array field. */
  defaultItems: 50,
  /** Values of an enum field. */
  maxEnumValues: 100,
  /** Values cleaned per block; later array items are dropped. */
  maxValues: 20000,
  /** Length of a URL value. */
  maxUrl: 2048,
});

/** Presets (besides `full`, which has every block) a definition can join. */
export const BLOCK_PRESETS = Object.freeze(['article', 'basic', 'minimal']);

/**
 * Names a code-registered block cannot use: every built-in block, inline tool
 * and tune name, the Media Library placeholder, the embedded entry tool, and
 * the names 2.3 gave to built-in tools (compared ignoring case).
 */
export const RESERVED_BLOCK_NAMES = Object.freeze([
  'paragraph',
  'header',
  'list',
  'checklist',
  'quote',
  'warning',
  'alert',
  'toggle',
  'code',
  'codeFlask',
  'delimiter',
  'toc',
  'synced',
  'table',
  'embed',
  'raw',
  'image',
  'simpleImage',
  'gallery',
  'video',
  'audio',
  'linkTool',
  'attaches',
  'personality',
  'button',
  'mediaLib',
  'embeddedEntry',
  'bold',
  'italic',
  'hyperlink',
  'mention',
  'marker',
  'underline',
  'strikethrough',
  'inlineCode',
  'tooltip',
  'aiAssistant',
  'alignmentTune',
  'textVariant',
  'indentTune',
]);

/**
 * Built-in names added after the block SDK shipped (2.3) that stay open to code
 * blocks, so a host that registered such a name before keeps starting (2.4: `math`).
 * A code block of that name replaces the built-in editor tool in that host; data
 * with the built-in marker (`_mex`) or exactly the built-in shape stays built-in.
 */
export const SDK_COMPATIBLE_NAMES = Object.freeze(['math']);

const RESERVED = new Set(RESERVED_BLOCK_NAMES.map((name) => name.toLowerCase()));

/** Block name rule (same as Settings-defined custom blocks). */
export const BLOCK_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9_-]{1,49}$/;
const KEY_PATTERN = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
const DEFINITION_KEYS = new Set([
  'name',
  'version',
  'title',
  'description',
  'schema',
  'sanitize',
  'text',
  'markdown',
  'render',
  'presets',
]);
const FIELD_KEYS = {
  text: ['max', 'multiline', 'default'],
  inline: ['max', 'default'],
  url: ['schemes', 'relative'],
  enum: ['values', 'default'],
  number: ['min', 'max', 'integer', 'default'],
  boolean: ['default'],
  array: ['items', 'max'],
  object: ['fields'],
};

/** Error thrown for an invalid definition (developer error, at registration time). */
export class BlockDefinitionError extends Error {
  /**
   * @param {string} message - Message naming the definition and the problem.
   * @param {string} [code] - `INVALID_DEFINITION` | `RESERVED_NAME` | `NAME_TAKEN` | `REGISTRY_SEALED`.
   */
  constructor(message, code = 'INVALID_DEFINITION') {
    super(message);
    this.name = 'BlockDefinitionError';
    this.code = code;
  }
}

const isObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const fail = (where, message) => {
  throw new BlockDefinitionError(`Magic Editor X block ${where}: ${message}`);
};

const boundedInt = (value, min, max, fallback, where, key) => {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < min || value > max)
    fail(where, `"${key}" must be an integer from ${min} to ${max}`);
  return value;
};

/**
 * Validates and normalises one field descriptor.
 * @param {unknown} input - Descriptor.
 * @param {string} where - Location for messages.
 * @param {number} depth - Nesting depth (root fields: 0).
 * @returns {Readonly<object>} Normalised descriptor.
 */
const normalizeField = (input, where, depth) => {
  if (!isObject(input)) fail(where, 'a field must be an object with a "type"');
  const type = input.type;
  if (!BLOCK_FIELD_TYPES.includes(type)) fail(where, `unknown field type ${JSON.stringify(type)}`);
  for (const key of Object.keys(input))
    if (key !== 'type' && key !== 'label' && !FIELD_KEYS[type].includes(key))
      fail(where, `unknown option "${key}" for a ${type} field`);
  const out = { type };
  if (input.label !== undefined) {
    if (typeof input.label !== 'string' || input.label.length > 100)
      fail(where, '"label" must be a string of at most 100 characters');
    out.label = input.label;
  }
  switch (type) {
    case 'text':
    case 'inline': {
      out.max = boundedInt(
        input.max,
        1,
        BLOCK_LIMITS.maxText,
        type === 'text' ? BLOCK_LIMITS.defaultText : BLOCK_LIMITS.defaultInline,
        where,
        'max'
      );
      if (input.default !== undefined && typeof input.default !== 'string')
        fail(where, '"default" must be a string');
      out.default = (input.default || '').slice(0, out.max);
      if (type === 'text') {
        if (input.multiline !== undefined && typeof input.multiline !== 'boolean')
          fail(where, '"multiline" must be a boolean');
        out.multiline = input.multiline === true;
      }
      break;
    }
    case 'url': {
      const schemes = input.schemes === undefined ? ['http', 'https'] : input.schemes;
      if (
        !Array.isArray(schemes) ||
        !schemes.length ||
        schemes.some((scheme) => !LINK_SCHEMES.includes(scheme))
      )
        fail(where, `"schemes" must be a non-empty list of ${LINK_SCHEMES.join(', ')}`);
      if (input.relative !== undefined && typeof input.relative !== 'boolean')
        fail(where, '"relative" must be a boolean');
      out.schemes = Object.freeze([...new Set(schemes)]);
      out.relative = input.relative !== false;
      break;
    }
    case 'enum': {
      const values = input.values;
      if (
        !Array.isArray(values) ||
        values.length < 1 ||
        values.length > BLOCK_LIMITS.maxEnumValues ||
        values.some((value) => typeof value !== 'string' || value.length < 1 || value.length > 100) ||
        new Set(values).size !== values.length
      )
        fail(
          where,
          `"values" must be 1 to ${BLOCK_LIMITS.maxEnumValues} distinct strings (1-100 characters)`
        );
      out.values = Object.freeze([...values]);
      if (input.default !== undefined && !values.includes(input.default))
        fail(where, '"default" must be one of "values"');
      out.default = input.default === undefined ? values[0] : input.default;
      break;
    }
    case 'number': {
      for (const key of ['min', 'max', 'default'])
        if (input[key] !== undefined && (typeof input[key] !== 'number' || !Number.isFinite(input[key])))
          fail(where, `"${key}" must be a finite number`);
      if (input.integer !== undefined && typeof input.integer !== 'boolean')
        fail(where, '"integer" must be a boolean');
      out.integer = input.integer === true;
      out.min = input.min === undefined ? -Number.MAX_SAFE_INTEGER : input.min;
      out.max = input.max === undefined ? Number.MAX_SAFE_INTEGER : input.max;
      if (out.min > out.max) fail(where, '"min" must not be greater than "max"');
      if (input.default !== undefined) {
        if (
          input.default < out.min ||
          input.default > out.max ||
          (out.integer && !Number.isInteger(input.default))
        )
          fail(where, '"default" must be a valid value of the field');
        out.default = input.default;
      }
      break;
    }
    case 'boolean':
      if (input.default !== undefined && typeof input.default !== 'boolean')
        fail(where, '"default" must be a boolean');
      out.default = input.default === true;
      break;
    case 'array':
      if (depth >= BLOCK_LIMITS.maxDepth) fail(where, `fields nest at most ${BLOCK_LIMITS.maxDepth} levels`);
      out.max = boundedInt(input.max, 1, BLOCK_LIMITS.maxItems, BLOCK_LIMITS.defaultItems, where, 'max');
      out.items = normalizeField(input.items, `${where}[]`, depth + 1);
      break;
    case 'object':
      if (depth >= BLOCK_LIMITS.maxDepth) fail(where, `fields nest at most ${BLOCK_LIMITS.maxDepth} levels`);
      out.fields = normalizeFields(input.fields, where, depth + 1);
      break;
    default:
      break;
  }
  return Object.freeze(out);
};

/**
 * Validates and normalises a map of fields.
 * @param {unknown} input - `{ key: descriptor }`.
 * @param {string} where - Location for messages.
 * @param {number} depth - Depth.
 * @returns {Readonly<Record<string, object>>} Fields in declaration order.
 */
const normalizeFields = (input, where, depth) => {
  if (!isObject(input)) fail(where, '"fields" must be an object of field descriptors');
  const keys = Object.keys(input);
  if (keys.length < 1 || keys.length > BLOCK_LIMITS.maxFields)
    fail(where, `an object needs 1 to ${BLOCK_LIMITS.maxFields} fields`);
  const out = Object.create(null);
  for (const key of keys) {
    if (!KEY_PATTERN.test(key) || FORBIDDEN_KEYS.has(key))
      fail(where, `field name ${JSON.stringify(key)} must match ${KEY_PATTERN}`);
    out[key] = normalizeField(input[key], `${where}.${key}`, depth);
  }
  return Object.freeze(out);
};

/**
 * Checks a block name against the naming rule and the reserved names.
 * @param {unknown} name - Candidate.
 * @returns {string|null} Problem description or null when the name is usable.
 */
export const blockNameProblem = (name) => {
  if (typeof name !== 'string' || !BLOCK_NAME_PATTERN.test(name))
    return `the name must match ${BLOCK_NAME_PATTERN}`;
  if (RESERVED.has(name.toLowerCase())) return `"${name}" is a built-in tool name`;
  return null;
};

/**
 * Validates a block definition and returns it frozen and normalised. Throws
 * `BlockDefinitionError` with a message naming the problem.
 *
 * @param {object} definition - `{ name, version?, title?, description?, schema, sanitize?, text?, markdown?, render?, presets? }`.
 * @returns {Readonly<object>} The normalised definition (pass it to the server, admin and renderers).
 */
export const defineBlock = (definition) => {
  if (!isObject(definition))
    throw new BlockDefinitionError('Magic Editor X block: the definition must be an object');
  const label = typeof definition.name === 'string' ? `"${definition.name.slice(0, 50)}"` : '(no name)';
  for (const key of Object.keys(definition))
    if (!DEFINITION_KEYS.has(key)) fail(label, `unknown key "${key}"`);
  const problem = blockNameProblem(definition.name);
  if (problem)
    throw new BlockDefinitionError(
      `Magic Editor X block ${label}: ${problem}`,
      problem.includes('built-in') ? 'RESERVED_NAME' : 'INVALID_DEFINITION'
    );
  const out = {
    name: definition.name,
    version: boundedInt(definition.version, 1, 1000000, 1, label, 'version'),
  };
  for (const [key, max] of [
    ['title', 100],
    ['description', 500],
  ]) {
    if (definition[key] === undefined) continue;
    if (typeof definition[key] !== 'string' || definition[key].length > max)
      fail(label, `"${key}" must be a string of at most ${max} characters`);
    out[key] = definition[key];
  }
  out.schema = normalizeFields(definition.schema, `${label} schema`, 0);
  for (const key of ['sanitize', 'text', 'markdown', 'render']) {
    if (definition[key] === undefined) continue;
    if (typeof definition[key] !== 'function') fail(label, `"${key}" must be a function`);
    out[key] = definition[key];
  }
  const presets = definition.presets === undefined ? [] : definition.presets;
  if (!Array.isArray(presets) || presets.some((preset) => !BLOCK_PRESETS.includes(preset)))
    fail(label, `"presets" must list some of ${BLOCK_PRESETS.join(', ')}`);
  out.presets = Object.freeze([...new Set(presets)]);
  return Object.freeze(out);
};

/* ------------------------------------------------------------- cleaning */

/**
 * Cleans one value by its descriptor.
 * @param {object} field - Normalised descriptor.
 * @param {unknown} value - Untrusted value.
 * @param {(html: string) => string} inline - Inline HTML sanitiser.
 * @param {{ left: number }} budget - Remaining values.
 * @returns {unknown} Clean value (undefined = omit the key).
 */
const cleanValue = (field, value, inline, budget) => {
  budget.left -= 1;
  switch (field.type) {
    case 'text':
      return typeof value === 'string' ? value.slice(0, field.max) : field.default;
    case 'inline':
      return inline(typeof value === 'string' ? value.slice(0, field.max) : field.default);
    case 'url':
      return typeof value === 'string'
        ? sanitizeUrl(value.slice(0, BLOCK_LIMITS.maxUrl), {
            schemes: field.schemes,
            allowRelative: field.relative,
          })
        : '';
    case 'enum':
      return typeof value === 'string' && field.values.includes(value) ? value : field.default;
    case 'number':
      return typeof value === 'number' &&
        Number.isFinite(value) &&
        value >= field.min &&
        value <= field.max &&
        (!field.integer || Number.isInteger(value))
        ? value
        : field.default;
    case 'boolean':
      return typeof value === 'boolean' ? value : field.default;
    case 'array': {
      const out = [];
      if (!Array.isArray(value)) return out;
      for (const item of value) {
        if (out.length >= field.max || budget.left <= 0) break;
        if (!matchesType(field.items, item)) continue;
        const clean = cleanValue(field.items, item, inline, budget);
        if (clean !== undefined) out.push(clean);
      }
      return out;
    }
    case 'object':
      return cleanObject(field.fields, isObject(value) ? value : {}, inline, budget);
    default:
      return undefined;
  }
};

/**
 * True when a raw array item has the JavaScript type its descriptor expects
 * (items of another type are dropped instead of becoming defaults).
 * @param {object} field - Item descriptor.
 * @param {unknown} item - Raw item.
 * @returns {boolean} Result.
 */
const matchesType = (field, item) => {
  switch (field.type) {
    case 'text':
    case 'inline':
    case 'url':
    case 'enum':
      return typeof item === 'string';
    case 'number':
      return typeof item === 'number';
    case 'boolean':
      return typeof item === 'boolean';
    case 'array':
      return Array.isArray(item);
    default:
      return isObject(item);
  }
};

/**
 * Cleans an object by its fields (unknown keys dropped, declared keys in declaration order).
 * @param {Record<string, object>} fields - Descriptors.
 * @param {object} value - Raw object.
 * @param {(html: string) => string} inline - Inline sanitiser.
 * @param {{ left: number }} budget - Remaining values.
 * @returns {object} Clean object.
 */
const cleanObject = (fields, value, inline, budget) => {
  const out = {};
  for (const key of Object.keys(fields)) {
    const own = Object.prototype.hasOwnProperty.call(value, key) ? value[key] : undefined;
    const clean = cleanValue(fields[key], own, inline, budget);
    if (clean !== undefined) out[key] = clean;
  }
  return out;
};

/* ------------------------------------------------------------ inspecting */

/**
 * Calls `visit(field, value, path)` for every leaf value (not arrays/objects) of clean or raw data.
 * @param {Record<string, object>} fields - Descriptors.
 * @param {unknown} data - Data.
 * @param {(field: object, value: unknown, path: Array<string|number>) => void} visit - Visitor.
 */
const eachLeaf = (fields, data, visit) => {
  const walk = (field, value, path, depth) => {
    if (depth > BLOCK_LIMITS.maxDepth + 1) return;
    if (field.type === 'array') {
      if (!Array.isArray(value)) return;
      value
        .slice(0, field.max)
        .forEach((item, index) => walk(field.items, item, [...path, index], depth + 1));
    } else if (field.type === 'object') {
      if (!isObject(value)) return;
      for (const key of Object.keys(field.fields))
        if (Object.prototype.hasOwnProperty.call(value, key))
          walk(field.fields[key], value[key], [...path, key], depth + 1);
    } else visit(field, value, path);
  };
  if (!isObject(data)) return;
  for (const key of Object.keys(fields))
    if (Object.prototype.hasOwnProperty.call(data, key)) walk(fields[key], data[key], [key], 0);
};

/**
 * Descriptor at a dotted data path (array indexes skipped), or null.
 * @param {Record<string, object>} fields - Descriptors.
 * @param {string} path - Dotted path (`items.0.title`).
 * @returns {object|null} Descriptor.
 */
const fieldAt = (fields, path) => {
  let current = { type: 'object', fields };
  for (const part of String(path).split('.')) {
    if (!part) continue;
    if (current.type === 'array') {
      if (/^\d+$/.test(part)) {
        current = current.items;
        continue;
      }
      return null;
    }
    if (current.type !== 'object' || !Object.prototype.hasOwnProperty.call(current.fields, part)) return null;
    current = current.fields[part];
  }
  return current;
};

/**
 * JSON Schema (2020-12) of one descriptor.
 * @param {object} field - Descriptor.
 * @returns {object} Schema.
 */
const fieldSchema = (field) => {
  const base = field.label ? { title: field.label } : {};
  switch (field.type) {
    case 'text':
      return { ...base, type: 'string', maxLength: field.max };
    case 'inline':
      return {
        ...base,
        type: 'string',
        description: 'Inline HTML (shared inline policy; sanitising may lengthen the text by escaping)',
      };
    case 'url':
      return {
        ...base,
        type: 'string',
        maxLength: BLOCK_LIMITS.maxUrl,
        description: `URL (${field.schemes.join(', ')}${field.relative ? ', site-relative' : ''}) or ''`,
      };
    case 'enum':
      return { ...base, type: 'string', enum: [...field.values], default: field.default };
    case 'number': {
      const out = { ...base, type: field.integer ? 'integer' : 'number' };
      if (field.min !== -Number.MAX_SAFE_INTEGER) out.minimum = field.min;
      if (field.max !== Number.MAX_SAFE_INTEGER) out.maximum = field.max;
      if (field.default !== undefined) out.default = field.default;
      return out;
    }
    case 'boolean':
      return { ...base, type: 'boolean', default: field.default };
    case 'array':
      return { ...base, type: 'array', maxItems: field.max, items: fieldSchema(field.items) };
    default:
      return { ...base, ...objectSchema(field.fields) };
  }
};

/**
 * JSON Schema of an object of fields.
 * @param {Record<string, object>} fields - Descriptors.
 * @returns {object} Schema.
 */
const objectSchema = (fields) => {
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(fields)) {
    properties[key] = fieldSchema(field);
    if (!(field.type === 'number' && field.default === undefined)) required.push(key);
  }
  return { type: 'object', properties, required, additionalProperties: false };
};

/**
 * JSON Schema (2020-12) of the stored `data` of a defined block, matching
 * what the server stores after cleaning.
 * @param {object} definition - Definition (from `defineBlock`, or a plain object that passes it).
 * @returns {object} JSON Schema.
 */
export const blockJsonSchema = (definition) => {
  const def = compileBlock(definition);
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: def.title || def.name,
    'x-magic-editor-x-block': { name: def.name, version: def.version },
    ...objectSchema(def.schema),
  };
};

/* -------------------------------------------------------------- compiling */

/** @type {WeakMap<object, object>} */
const compiled = new WeakMap();

/**
 * Compiled form of a definition, cached per object. The compiled object keeps
 * the definition's public keys plus the internal helpers the shared modules
 * use: `clean`, `fields`, `urls`, `kindOf`.
 * @param {object} definition - Definition (validated again when it did not come from `defineBlock` of this bundle).
 * @returns {Readonly<object>} Compiled definition.
 * @throws {BlockDefinitionError} When the definition is invalid.
 */
export const compileBlock = (definition) => {
  if (definition && typeof definition === 'object' && compiled.has(definition))
    return compiled.get(definition);
  const def = defineBlock(definition && typeof definition === 'object' ? { ...definition } : definition);
  const schema = def.schema;
  const run = (data, inline) =>
    cleanObject(schema, isObject(data) ? data : {}, inline, { left: BLOCK_LIMITS.maxValues });
  const result = Object.freeze({
    ...def,
    /**
     * Cleans untrusted block data (unknown keys dropped, values bounded).
     * The optional `sanitize` hook runs on the clean data; its result is
     * cleaned again, so it cannot add keys or unsafe values. A hook that
     * throws is ignored (the clean data is used).
     * @param {unknown} data - Block data.
     * @param {(html: string) => string} inline - Inline HTML sanitiser of the caller.
     * @returns {object} Clean data.
     */
    clean: (data, inline) => {
      const first = run(data, inline);
      if (!def.sanitize) return first;
      let next;
      try {
        next = def.sanitize(copyData(first), { sanitizeUrl });
      } catch {
        return first;
      }
      return isObject(next) ? run(next, inline) : first;
    },
    /**
     * Text fields of the data in schema order: `{ path, kind, value }`
     * (`html` for inline fields, `plain` for text fields).
     * @param {unknown} data - Block data.
     * @returns {Array<{ path: Array<string|number>, kind: 'html'|'plain', value: string }>} Fields.
     */
    fields: (data) => {
      const out = [];
      eachLeaf(schema, data, (field, value, path) => {
        if (typeof value !== 'string') return;
        if (field.type === 'inline') out.push({ path, kind: 'html', value });
        else if (field.type === 'text') out.push({ path, kind: 'plain', value });
      });
      return out;
    },
    /**
     * Non-empty URL values: `{ path, value }`.
     * @param {unknown} data - Block data.
     * @returns {Array<{ path: Array<string|number>, value: string }>} URLs.
     */
    urls: (data) => {
      const out = [];
      eachLeaf(schema, data, (field, value, path) => {
        if (field.type === 'url' && typeof value === 'string' && value) out.push({ path, value });
      });
      return out;
    },
    /**
     * Kind of the value at a dotted path, for the version diff.
     * @param {string} path - Dotted path.
     * @returns {'inline'|'plain'|'value'} Kind.
     */
    kindOf: (path) => {
      const field = fieldAt(schema, path);
      if (!field) return 'value';
      if (field.type === 'inline') return 'inline';
      if (field.type === 'text') return 'plain';
      return 'value';
    },
  });
  compiled.set(result, result);
  if (definition && typeof definition === 'object') compiled.set(definition, result);
  return result;
};

/**
 * JSON-safe deep copy of clean data (only plain objects, arrays and scalars).
 * @param {unknown} value - Clean data.
 * @returns {unknown} Copy.
 */
const copyData = (value) => {
  if (Array.isArray(value)) return value.map(copyData);
  if (isObject(value)) {
    const out = {};
    for (const [key, child] of Object.entries(value)) out[key] = copyData(child);
    return out;
  }
  return value;
};

/** @type {WeakMap<object[], Map<string, object>>} */
const listCache = new WeakMap();

/**
 * Compiles a list of definitions (render option `blocks`), cached per array.
 * @param {unknown} list - Definitions.
 * @returns {Map<string, object>} Compiled definitions by name.
 * @throws {BlockDefinitionError} When a definition is invalid.
 */
export const compileBlockList = (list) => {
  if (!Array.isArray(list)) return new Map();
  if (listCache.has(list)) return listCache.get(list);
  const map = new Map();
  for (const definition of list) {
    const def = compileBlock(definition);
    map.set(def.name, def);
  }
  listCache.set(list, map);
  return map;
};
