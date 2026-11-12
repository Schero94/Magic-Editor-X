/**
 * Inline annotations (2.5, block SDK): marked words with a few bounded
 * attributes, such as an abbreviation with its full form or a glossary term.
 *
 * Stored form (never markup from the definition):
 * `<span data-mex-annotation="<name>" data-mex-a-<key>="<value>">text</span>`.
 * The sanitiser keeps an annotation only when its name is registered (and
 * enabled for the field) and cleans its attributes with the definition;
 * anything else is unwrapped (the text stays).
 *
 * A definition (`defineInlineAnnotation`) is shared by the server
 * (`service('blocks').registerInlineAnnotation(definition)`), the renderers
 * (`annotations: [definition]` option) and, as a summary from `GET /config`,
 * the admin, which builds the inline tool from it. `resolve` runs only on the
 * server for API output (`?mex=`, GraphQL `…Rendered`); `render` describes the
 * one element that wraps the annotated text.
 *
 * Pure ESM, no dependencies, no Node built-ins.
 */

import { sanitizeUrl, LINK_SCHEMES } from '../sanitize-policy.mjs';
import { BlockDefinitionError } from './define.mjs';
import { isSafeAttributeName } from '../render/nodes.mjs';

/** Attribute that names the annotation. */
export const ANNOTATION_ATTRIBUTE = 'data-mex-annotation';
/** Prefix of the stored attribute values (`data-mex-a-<key>`). */
export const ANNOTATION_VALUE_PREFIX = 'data-mex-a-';

/** Annotation name: lower-case letters, digits and `-`, 2 to 40 characters. */
export const ANNOTATION_NAME = /^[a-z][a-z0-9-]{1,39}$/;
/** Attribute key: lower-case letters and digits, starting with a letter, at most 24 characters. */
export const ANNOTATION_KEY = /^[a-z][a-z0-9]{0,23}$/;

/** Field types of annotation attributes. */
export const ANNOTATION_FIELD_TYPES = Object.freeze(['text', 'enum', 'url']);

/** Bounds. */
export const ANNOTATION_LIMITS = Object.freeze({
  attributes: 8,
  text: 1000,
  textDefault: 200,
  values: 50,
  registered: 50,
  label: 100,
  resolveItems: 200,
});

/** Presets an annotation may join (like blocks; `full` is not listed, see `presets`). */
export const ANNOTATION_PRESETS = Object.freeze(['full', 'article', 'basic', 'minimal']);

/** Tags a `render` result may use for the wrapping element. */
export const ANNOTATION_RENDER_TAGS = Object.freeze([
  'abbr',
  'dfn',
  'span',
  'a',
  'mark',
  'cite',
  'q',
  'small',
  'em',
  'strong',
  'b',
  'i',
  'u',
  's',
  'time',
  'data',
  'bdi',
  'kbd',
  'var',
  'ins',
  'del',
]);

/** Name of the built-in annotation (off by default; enabled per field). */
export const ABBREVIATION = 'abbreviation';

const isObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const fail = (name, message, code = 'INVALID_DEFINITION') => {
  throw new BlockDefinitionError(`Magic Editor X inline annotation ${name}: ${message}`, code);
};

/** Definitions made by `defineInlineAnnotation` (validated). */
const defined = new WeakSet();

const cleanText = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max).trim() : '');

/**
 * Validates one attribute descriptor.
 * @param {string} where - Location for messages.
 * @param {unknown} input - Descriptor.
 * @returns {Readonly<object>} Normalised descriptor.
 */
const normalizeAttribute = (where, input) => {
  if (!isObject(input)) fail(where, 'an attribute must be an object with a "type"');
  const { type } = input;
  if (!ANNOTATION_FIELD_TYPES.includes(type)) fail(where, `unknown attribute type ${JSON.stringify(type)}`);
  const allowed = { text: ['max'], enum: ['values'], url: ['schemes', 'relative'] }[type];
  for (const key of Object.keys(input))
    if (!['type', 'label', 'required', ...allowed].includes(key))
      fail(where, `unknown option "${key}" for a ${type} attribute`);
  const out = { type, required: input.required === true };
  if (input.label !== undefined) {
    if (typeof input.label !== 'string' || input.label.length > ANNOTATION_LIMITS.label)
      fail(where, `"label" must be a string of at most ${ANNOTATION_LIMITS.label} characters`);
    out.label = input.label;
  }
  if (input.required !== undefined && typeof input.required !== 'boolean')
    fail(where, '"required" must be a boolean');
  if (type === 'text') {
    const max = input.max === undefined ? ANNOTATION_LIMITS.textDefault : input.max;
    if (!Number.isInteger(max) || max < 1 || max > ANNOTATION_LIMITS.text)
      fail(where, `"max" must be an integer from 1 to ${ANNOTATION_LIMITS.text}`);
    out.max = max;
  } else if (type === 'enum') {
    const { values } = input;
    if (
      !Array.isArray(values) ||
      !values.length ||
      values.length > ANNOTATION_LIMITS.values ||
      !values.every((value) => typeof value === 'string' && value.length >= 1 && value.length <= 100) ||
      new Set(values).size !== values.length
    )
      fail(where, `"values" must be 1 to ${ANNOTATION_LIMITS.values} distinct strings`);
    out.values = Object.freeze([...values]);
  } else {
    const schemes = input.schemes === undefined ? ['http', 'https'] : input.schemes;
    if (
      !Array.isArray(schemes) ||
      !schemes.length ||
      !schemes.every((scheme) => LINK_SCHEMES.includes(scheme))
    )
      fail(where, `"schemes" must be a non-empty subset of ${LINK_SCHEMES.join(', ')}`);
    if (input.relative !== undefined && typeof input.relative !== 'boolean')
      fail(where, '"relative" must be a boolean');
    out.schemes = Object.freeze([...new Set(schemes)]);
    out.relative = input.relative !== false;
  }
  return Object.freeze(out);
};

/**
 * Defines an inline annotation. The result is frozen and validated; pass it
 * to the server (`service('blocks').registerInlineAnnotation`) and to the
 * renderers (`annotations` option).
 * @param {{ name: string, label?: string, description?: string, attributes: Record<string, object>, presets?: string[], resolve?: Function, render?: Function }} definition - Definition.
 * @returns {Readonly<object>} Frozen definition.
 * @throws {BlockDefinitionError} `INVALID_DEFINITION` for an invalid definition.
 */
export const defineInlineAnnotation = (definition) => {
  if (!isObject(definition)) fail('(unnamed)', 'the definition must be an object');
  const { name } = definition;
  if (typeof name !== 'string' || !ANNOTATION_NAME.test(name))
    fail(JSON.stringify(name), 'the name must match /^[a-z][a-z0-9-]{1,39}$/');
  for (const key of Object.keys(definition))
    if (!['name', 'label', 'description', 'attributes', 'presets', 'resolve', 'render'].includes(key))
      fail(name, `unknown key "${key}"`);
  for (const key of ['label', 'description'])
    if (
      definition[key] !== undefined &&
      (typeof definition[key] !== 'string' || definition[key].length > (key === 'label' ? 100 : 500))
    )
      fail(name, `"${key}" must be a short string`);
  if (!isObject(definition.attributes)) fail(name, '"attributes" must be an object');
  const keys = Object.keys(definition.attributes);
  if (keys.length > ANNOTATION_LIMITS.attributes)
    fail(name, `at most ${ANNOTATION_LIMITS.attributes} attributes`);
  const attributes = {};
  for (const key of keys) {
    if (!ANNOTATION_KEY.test(key)) fail(name, `attribute key "${key}" must match /^[a-z][a-z0-9]{0,23}$/`);
    attributes[key] = normalizeAttribute(`${name}.${key}`, definition.attributes[key]);
  }
  const presets = definition.presets === undefined ? [] : definition.presets;
  if (!Array.isArray(presets) || !presets.every((preset) => ANNOTATION_PRESETS.includes(preset)))
    fail(name, `"presets" must list only ${ANNOTATION_PRESETS.join(', ')}`);
  for (const key of ['resolve', 'render'])
    if (definition[key] !== undefined && typeof definition[key] !== 'function')
      fail(name, `"${key}" must be a function`);
  const out = Object.freeze({
    name,
    label: definition.label || name,
    ...(definition.description ? { description: definition.description } : {}),
    attributes: Object.freeze(attributes),
    presets: Object.freeze([...new Set(presets)]),
    ...(definition.resolve ? { resolve: definition.resolve } : {}),
    ...(definition.render ? { render: definition.render } : {}),
  });
  defined.add(out);
  return out;
};

/**
 * Cleans the attribute values of an annotation with its definition.
 * @param {Readonly<object>} definition - Definition.
 * @param {Record<string, unknown>} raw - Values by key.
 * @returns {Record<string, string>|null} Clean values (declared keys only, empty values left out), or null when a required one is missing.
 */
export const cleanAnnotationAttributes = (definition, raw) => {
  const source = raw && typeof raw === 'object' ? raw : {};
  const out = {};
  for (const [key, field] of Object.entries(definition.attributes)) {
    const value = Object.prototype.hasOwnProperty.call(source, key) ? source[key] : undefined;
    let clean;
    if (field.type === 'text') clean = cleanText(value, field.max);
    else if (field.type === 'enum')
      clean = typeof value === 'string' && field.values.includes(value) ? value : '';
    else clean = sanitizeUrl(value, { schemes: field.schemes, allowRelative: field.relative });
    if (clean) out[key] = clean;
    else if (field.required) return null;
  }
  return out;
};

/**
 * JSON Schema of an annotation's attribute values (`additionalProperties: false`).
 * @param {Readonly<object>} definition - Definition.
 * @returns {object} JSON Schema.
 */
export const annotationJsonSchema = (definition) => {
  const properties = {};
  const required = [];
  for (const [key, field] of Object.entries(definition.attributes)) {
    const schema =
      field.type === 'text'
        ? { type: 'string', minLength: 1, maxLength: field.max }
        : field.type === 'enum'
          ? { type: 'string', enum: [...field.values] }
          : { type: 'string', format: 'uri-reference', maxLength: 2048 };
    if (field.label) schema.title = field.label;
    properties[key] = schema;
    if (field.required) required.push(key);
  }
  return {
    title: definition.label,
    type: 'object',
    properties,
    ...(required.length ? { required } : {}),
    additionalProperties: false,
    'x-mex-stored-as': `<span ${ANNOTATION_ATTRIBUTE}="${definition.name}" ${ANNOTATION_VALUE_PREFIX}<key>="…">`,
  };
};

/**
 * Built-in abbreviation: renders `<abbr title="full form">`.
 */
export const abbreviationAnnotation = defineInlineAnnotation({
  name: ABBREVIATION,
  label: 'Abbreviation',
  description: 'Short form with its full form (shown as a tooltip and read by screen readers).',
  attributes: { title: { type: 'text', max: 200, required: true, label: 'Full form' } },
  render: (annotation) => ({ tag: 'abbr', attrs: { title: annotation.attrs.title } }),
});

/* --------------------------------------------------------------- registry */

/** @type {Map<string, Readonly<object>>} code-registered annotations of this bundle */
const registry = new Map();

/**
 * Registered annotation (or the built-in abbreviation) by name.
 * @param {unknown} name - Name.
 * @returns {Readonly<object>|null} Definition.
 */
export const activeAnnotation = (name) => {
  if (name === ABBREVIATION) return abbreviationAnnotation;
  return typeof name === 'string' && registry.has(name) ? registry.get(name) : null;
};

/**
 * The built-in abbreviation followed by the registered annotations.
 * @returns {Array<Readonly<object>>} Definitions.
 */
export const activeAnnotations = () => [abbreviationAnnotation, ...registry.values()];

/**
 * Registers an annotation in this bundle.
 * @param {object} definition - Definition (`defineInlineAnnotation` result or a plain object).
 * @returns {Readonly<object>} Frozen definition.
 * @throws {BlockDefinitionError} Invalid definition, `RESERVED_NAME` (`abbreviation`), `NAME_TAKEN`.
 */
export const registerAnnotationDefinition = (definition) => {
  const compiled = defined.has(definition) ? definition : defineInlineAnnotation(definition);
  if (compiled.name === ABBREVIATION && compiled !== abbreviationAnnotation)
    fail(compiled.name, 'the name is built in', 'RESERVED_NAME');
  if (compiled === abbreviationAnnotation) return compiled;
  const existing = registry.get(compiled.name);
  if (existing) {
    if (existing === compiled) return compiled;
    fail(compiled.name, 'an annotation with this name is already registered', 'NAME_TAKEN');
  }
  if (registry.size >= ANNOTATION_LIMITS.registered)
    fail(compiled.name, `at most ${ANNOTATION_LIMITS.registered} annotations`);
  registry.set(compiled.name, compiled);
  return compiled;
};

/**
 * Removes every registered annotation (tests, plugin destroy).
 */
export const clearActiveAnnotations = () => {
  registry.clear();
};

/**
 * Admin bundle: builds definitions without functions from the summaries of
 * `GET /config` (`data.annotations`) so the editor can clean and offer them.
 * Invalid summaries are skipped.
 * @param {unknown} summaries - Summaries.
 * @returns {Array<Readonly<object>>} Definitions (the built-in one excluded).
 */
export const annotationsFromSummaries = (summaries) => {
  const out = [];
  for (const summary of Array.isArray(summaries) ? summaries.slice(0, ANNOTATION_LIMITS.registered) : []) {
    if (!isObject(summary) || summary.name === ABBREVIATION) continue;
    try {
      out.push(
        defineInlineAnnotation({
          name: summary.name,
          label: typeof summary.label === 'string' ? summary.label.slice(0, 100) : undefined,
          attributes: summary.attributes,
          presets: Array.isArray(summary.presets) ? summary.presets : [],
        })
      );
    } catch {
      // A summary the admin cannot use is left out (the server still cleans the content).
    }
  }
  return out;
};

/**
 * Summary of a definition for `GET /config` (no functions).
 * @param {Readonly<object>} definition - Definition.
 * @returns {{ name: string, label: string, builtIn: boolean, presets: string[], resolves: boolean, attributes: object }} Summary.
 */
export const annotationSummary = (definition) => ({
  name: definition.name,
  label: definition.label,
  builtIn: definition === abbreviationAnnotation,
  presets: [...definition.presets],
  resolves: typeof definition.resolve === 'function',
  attributes: Object.fromEntries(
    Object.entries(definition.attributes).map(([key, field]) => [key, { ...field }])
  ),
});

/* -------------------------------------------------------------- rendering */

const CLASS_TOKEN = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;
const RENDER_ATTRIBUTES = new Set(['title', 'class', 'lang', 'dir', 'href', 'datetime', 'value', 'cite']);

/**
 * Validates the wrapper a `render` function returned.
 * @param {unknown} out - `{ tag, attrs }`.
 * @returns {{ tag: string, attrs: Record<string, string> }|null} Clean wrapper, or null for the default rendering.
 */
export const cleanAnnotationWrapper = (out) => {
  if (!isObject(out) || !ANNOTATION_RENDER_TAGS.includes(out.tag)) return null;
  const attrs = {};
  for (const [name, raw] of Object.entries(isObject(out.attrs) ? out.attrs : {})) {
    if (raw === undefined || raw === null || raw === false) continue;
    if (!['string', 'number'].includes(typeof raw)) continue;
    const allowed =
      RENDER_ATTRIBUTES.has(name) ||
      name === 'aria-label' ||
      (name.startsWith('data-') && !name.startsWith('data-mex-'));
    if (!allowed || !isSafeAttributeName(name)) continue;
    const text = String(raw).slice(0, 2000);
    if (name === 'href' || name === 'cite') {
      if (out.tag !== 'a' && name === 'href') continue;
      const url = sanitizeUrl(text);
      if (url) attrs[name] = url;
    } else if (name === 'class') {
      const classes = text.split(/\s+/).filter((token) => CLASS_TOKEN.test(token));
      if (classes.length) attrs.class = classes.join(' ');
    } else if (text) attrs[name] = text;
  }
  return { tag: out.tag, attrs };
};
