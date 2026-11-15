/**
 * Component blocks (2.5): Content-Type Builder components as blocks inside a
 * Magic Editor X field. Pure functions shared by the content policy, the
 * Document Service middleware, the Content API output, the editor form and
 * the Content-Type Builder option.
 *
 * Stored block: `{ type: 'component', data: { uid, values, _mex: 1 } }`.
 * - `uid`: the component uid (`category.name`).
 * - `values`: `{ [attributeName]: string | number | boolean }`; attributes
 *   without a value are left out. Plain text only, never HTML.
 * - `_mex`: the built-in marker (see `built-in-marker.mjs`); it is also the
 *   version of this shape. A later shape writes a higher number.
 *
 * Only scalar attributes are supported (`SUPPORTED_TYPES`). A component with
 * any other attribute (media, relation, component, dynamic zone, JSON,
 * password, uid, blocks, custom fields) or a private attribute cannot be
 * selected for a field, so a block never holds data that needs permission
 * checks, population or sanitising beyond plain text.
 */

/** Component uid (`category.name`). */
export const COMPONENT_UID = /^[A-Za-z0-9_-]{1,100}\.[A-Za-z0-9_-]{1,100}$/;

/** Attribute names kept in `values` (Strapi attribute names; never prototype keys). */
export const COMPONENT_ATTRIBUTE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

/** Attributes Strapi adds and never shows in forms. */
const HIDDEN_ATTRIBUTES = new Set([
  'id',
  'documentId',
  'publishedAt',
  'createdAt',
  'updatedAt',
  'createdBy',
  'updatedBy',
  'locale',
  'localizations',
]);

/** Limits of the stored data and of a supported component. */
export const COMPONENT_LIMITS = Object.freeze({
  /** Components one field may list. */
  components: 50,
  /** Attributes of a supported component (and keys of stored `values`). */
  attributes: 50,
  /** Longest single-line text (string, email, enumeration, date and time values). */
  string: 2000,
  /** Longest multi-line text (`text`, `richtext`). */
  text: 20000,
});

/** Attribute types a component block supports, and the kind of value each one stores. */
export const SUPPORTED_TYPES = Object.freeze({
  string: 'string',
  text: 'text',
  richtext: 'text',
  email: 'string',
  enumeration: 'string',
  date: 'string',
  datetime: 'string',
  time: 'string',
  integer: 'number',
  biginteger: 'string',
  float: 'number',
  decimal: 'number',
  boolean: 'boolean',
});

/** Text attributes (find and replace, diff text, history). */
export const TEXT_TYPES = Object.freeze(['string', 'text', 'richtext']);

const INT_MIN = -2147483648;
const INT_MAX = 2147483647;
const BIGINT = /^-?\d{1,19}$/;
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[^\s@<>()[\]\\,;:"]{1,255}\.[^\s@<>()[\]\\,;:"]{1,63}$/;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const TIME = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/;

const isPlainObject = (value) =>
  value !== null &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);

const hasOwn = (object, key) => Object.prototype.hasOwnProperty.call(object, key);

/**
 * Parses the field option `allowedComponents` (comma-separated uids).
 * @param {unknown} value - Option value.
 * @returns {string[]} Unique valid uids (at most `COMPONENT_LIMITS.components`).
 */
export const parseComponentList = (value) => {
  if (typeof value !== 'string' || !value.trim()) return [];
  const uids = value
    .slice(0, 6000)
    .split(/[\s,;]+/)
    .filter((uid) => COMPONENT_UID.test(uid));
  return [...new Set(uids)].slice(0, COMPONENT_LIMITS.components);
};

/**
 * Stored shape of `values` without a schema: valid keys, strings (cut to the
 * text limit), finite numbers and booleans. Everything else is dropped.
 * @param {unknown} values - Candidate.
 * @returns {Record<string, string|number|boolean>} Values.
 */
export const cleanValuesShape = (values) => {
  const out = {};
  if (!isPlainObject(values)) return out;
  let count = 0;
  for (const key of Object.keys(values)) {
    if (count >= COMPONENT_LIMITS.attributes) break;
    if (!COMPONENT_ATTRIBUTE.test(key) || FORBIDDEN_KEYS.has(key)) continue;
    const value = values[key];
    if (typeof value === 'string') out[key] = value.slice(0, COMPONENT_LIMITS.text);
    else if (typeof value === 'number' && Number.isFinite(value)) out[key] = value;
    else if (typeof value === 'boolean') out[key] = value;
    else continue;
    count += 1;
  }
  return out;
};

/**
 * Policy of the `component` block data (no schema needed): valid uid or '',
 * values in their stored shape, the built-in marker.
 * @param {Record<string, unknown>} data - Block data.
 * @param {number} marker - Built-in marker version.
 * @returns {{ uid: string, values: object, _mex: number }} Clean data.
 */
export const cleanComponentData = (data, marker) => ({
  uid: typeof data.uid === 'string' && COMPONENT_UID.test(data.uid) ? data.uid : '',
  values: cleanValuesShape(data.values),
  _mex: marker,
});

/**
 * Bounded number option of an attribute (Strapi stores `min`/`max` as numbers, bigints as strings).
 * @param {unknown} value - Candidate.
 * @returns {number|string|undefined} Value.
 */
const boundOf = (value) => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && /^-?\d{1,19}(?:\.\d+)?$/.test(value)) return value;
  return undefined;
};

/**
 * Describes one attribute, or explains why it is not supported.
 * @param {string} name - Attribute name.
 * @param {Record<string, unknown>} attribute - Strapi attribute schema.
 * @returns {{ field?: object, unsupported?: { name: string, type: string, reason: string } }} Result.
 */
const describeAttribute = (name, attribute) => {
  const type = attribute && typeof attribute.type === 'string' ? attribute.type : 'unknown';
  if (!COMPONENT_ATTRIBUTE.test(name) || FORBIDDEN_KEYS.has(name))
    return { unsupported: { name, type, reason: 'name' } };
  if (attribute.private === true) return { unsupported: { name, type, reason: 'private' } };
  if (!hasOwn(SUPPORTED_TYPES, type)) return { unsupported: { name, type, reason: 'type' } };
  const field = { name, type, required: attribute.required === true };
  if (typeof attribute.minLength === 'number' && attribute.minLength >= 0)
    field.minLength = attribute.minLength;
  if (typeof attribute.maxLength === 'number' && attribute.maxLength >= 0)
    field.maxLength = attribute.maxLength;
  const min = boundOf(attribute.min);
  const max = boundOf(attribute.max);
  if (min !== undefined) field.min = min;
  if (max !== undefined) field.max = max;
  if (typeof attribute.regex === 'string' && attribute.regex.length <= 1000) {
    try {
      new RegExp(attribute.regex);
      field.regex = attribute.regex;
    } catch {
      // An invalid pattern is ignored (Strapi cannot apply it either).
    }
  }
  if (type === 'enumeration') {
    const values = Array.isArray(attribute.enum)
      ? attribute.enum.filter((value) => typeof value === 'string' && value.length <= 500)
      : [];
    if (!values.length) return { unsupported: { name, type, reason: 'enum' } };
    field.enum = values.slice(0, 200);
  }
  const fallback = attribute.default;
  if (fallback !== undefined && fallback !== null) {
    const kind = SUPPORTED_TYPES[type];
    if (
      (kind === 'boolean' && typeof fallback === 'boolean') ||
      (kind === 'number' && typeof fallback === 'number' && Number.isFinite(fallback)) ||
      ((kind === 'string' || kind === 'text') && typeof fallback === 'string' && fallback.length <= 2000)
    )
      field.default = fallback;
  }
  return { field };
};

/**
 * @typedef {object} ComponentField
 * @property {string} name - Attribute name.
 * @property {string} type - Strapi attribute type (one of `SUPPORTED_TYPES`).
 * @property {boolean} required - Value required.
 * @property {number} [minLength] - Shortest text.
 * @property {number} [maxLength] - Longest text.
 * @property {number|string} [min] - Smallest number.
 * @property {number|string} [max] - Largest number.
 * @property {string} [regex] - Pattern the text must match.
 * @property {string[]} [enum] - Allowed values of an enumeration.
 * @property {string|number|boolean} [default] - Default value for new blocks.
 */

/**
 * @typedef {object} ComponentDescriptor
 * @property {string} uid - Component uid.
 * @property {string} displayName - Name shown to editors.
 * @property {string} category - Category.
 * @property {string} icon - Strapi icon name ('' when none).
 * @property {ComponentField[]} fields - Supported attributes in schema order.
 * @property {Array<{ name: string, type: string, reason: string }>} unsupported - Attributes that prevent use.
 * @property {boolean} supported - True when the component can be used as a block.
 */

/**
 * Describes a Strapi component schema for the editor form and the checks.
 * @param {string} uid - Component uid.
 * Attributes Strapi never shows (`id`, timestamps, `visible: false`) are
 * skipped; private ones make the component unsupported.
 * @param {string} uid - Component uid.
 * @param {unknown} schema - `strapi.components[uid]` or a Content-Type Builder component.
 * @param {{ isPrivate?: (name: string) => boolean }} [options] - Server: Strapi's private attribute rule (also `api.responses.privateAttributes`).
 * @returns {ComponentDescriptor|null} Descriptor, or null for an invalid uid or schema.
 */
export const describeComponent = (uid, schema, options = {}) => {
  if (typeof uid !== 'string' || !COMPONENT_UID.test(uid) || !isPlainObject(schema)) return null;
  const info = isPlainObject(schema.info) ? schema.info : {};
  const attributes = isPlainObject(schema.attributes) ? schema.attributes : {};
  const fields = [];
  const unsupported = [];
  for (const name of Object.keys(attributes)) {
    const attribute = isPlainObject(attributes[name]) ? attributes[name] : {};
    if (HIDDEN_ATTRIBUTES.has(name) || attribute.visible === false) continue;
    const isPrivate = typeof options.isPrivate === 'function' && options.isPrivate(name) === true;
    const result = describeAttribute(name, isPrivate ? { ...attribute, private: true } : attribute);
    if (result.field) fields.push(result.field);
    else unsupported.push(result.unsupported);
  }
  if (fields.length + unsupported.length > COMPONENT_LIMITS.attributes)
    unsupported.push({ name: '', type: '', reason: 'tooMany' });
  const displayName =
    typeof info.displayName === 'string' && info.displayName.trim()
      ? info.displayName.trim().slice(0, 200)
      : uid.split('.')[1];
  return {
    uid,
    displayName,
    category: typeof schema.category === 'string' ? schema.category.slice(0, 100) : uid.split('.')[0],
    icon: typeof info.icon === 'string' && /^[A-Za-z0-9_-]{1,60}$/.test(info.icon) ? info.icon : '',
    fields,
    unsupported,
    supported: fields.length > 0 && unsupported.length === 0,
  };
};

/**
 * Default values of a new block (attribute defaults; booleans default to false).
 * @param {ComponentDescriptor} descriptor - Descriptor.
 * @returns {Record<string, string|number|boolean>} Values.
 */
export const defaultValues = (descriptor) => {
  const out = {};
  for (const field of descriptor.fields) {
    if (field.default !== undefined) out[field.name] = field.default;
    else if (field.type === 'boolean') out[field.name] = false;
  }
  return out;
};

/**
 * True when a value counts as empty (not stored).
 * @param {unknown} value - Value.
 * @returns {boolean} Result.
 */
const isEmpty = (value) => value === undefined || value === null || value === '';

/**
 * Compares two numbers given as numbers or integer strings (bigints).
 * @param {number|string} a - Left.
 * @param {number|string} b - Right.
 * @returns {number} Negative, 0 or positive.
 */
const compare = (a, b) => {
  if (typeof a === 'string' && typeof b === 'string' && BIGINT.test(a) && BIGINT.test(b)) {
    const x = BigInt(a);
    const y = BigInt(b);
    return x < y ? -1 : x > y ? 1 : 0;
  }
  return Number(a) - Number(b);
};

/**
 * Coerces and checks one value.
 * @param {ComponentField} field - Field.
 * @param {unknown} input - Value (not empty).
 * @returns {{ value?: string|number|boolean, rule?: string }} Clean value or the broken rule.
 */
const checkValue = (field, input) => {
  const kind = SUPPORTED_TYPES[field.type];
  if (kind === 'boolean') {
    if (typeof input === 'boolean') return { value: input };
    if (input === 'true' || input === 'false') return { value: input === 'true' };
    return { rule: 'type' };
  }
  if (kind === 'number' || field.type === 'biginteger') {
    let value;
    if (field.type === 'biginteger') {
      const text = typeof input === 'number' && Number.isSafeInteger(input) ? String(input) : input;
      if (typeof text !== 'string' || !BIGINT.test(text.trim())) return { rule: 'type' };
      value = text.trim().replace(/^(-?)0+(?=\d)/, '$1');
    } else {
      const number =
        typeof input === 'number' ? input : typeof input === 'string' && input.trim() ? Number(input) : NaN;
      if (!Number.isFinite(number)) return { rule: 'type' };
      if (field.type === 'integer' && (!Number.isInteger(number) || number < INT_MIN || number > INT_MAX))
        return { rule: 'type' };
      value = number;
    }
    if (field.min !== undefined && compare(value, field.min) < 0) return { rule: 'min' };
    if (field.max !== undefined && compare(value, field.max) > 0) return { rule: 'max' };
    return { value };
  }
  // Text kinds. Numbers are accepted for plain strings (API clients); nothing else.
  let text = typeof input === 'number' && Number.isFinite(input) ? String(input) : input;
  if (typeof text !== 'string') return { rule: 'type' };
  const cap = kind === 'text' ? COMPONENT_LIMITS.text : COMPONENT_LIMITS.string;
  if (text.length > cap) return { rule: 'maxLength' };
  if (field.type === 'enumeration') return field.enum.includes(text) ? { value: text } : { rule: 'enum' };
  if (field.type === 'email' && !EMAIL.test(text)) return { rule: 'email' };
  if (field.type === 'date') {
    const match = DATE.exec(text);
    const date = match ? new Date(`${text}T00:00:00Z`) : null;
    if (!date || Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== text)
      return { rule: 'date' };
  }
  if (field.type === 'datetime') {
    const time = DATETIME.test(text) ? Date.parse(text) : NaN;
    if (!Number.isFinite(time)) return { rule: 'datetime' };
    text = new Date(time).toISOString();
  }
  if (field.type === 'time') {
    const match = TIME.exec(text);
    if (!match) return { rule: 'time' };
    text = `${match[1]}:${match[2]}:${match[3] || '00'}.${(match[4] || '').padEnd(3, '0')}`;
  }
  if (field.minLength !== undefined && text.length < field.minLength) return { rule: 'minLength' };
  if (field.maxLength !== undefined && text.length > field.maxLength) return { rule: 'maxLength' };
  if (field.regex && !new RegExp(field.regex).test(text)) return { rule: 'regex' };
  return { value: text };
};

/**
 * @typedef {object} ComponentValueError
 * @property {string} field - Attribute name.
 * @property {string} rule - required | type | min | max | minLength | maxLength | regex | enum | email | date | datetime | time.
 */

/**
 * Checks values against a component descriptor: unknown attributes are
 * dropped, values are coerced to their type (numeric strings to numbers,
 * 'true'/'false' to booleans, dates and times to Strapi's formats) and every
 * rule of the schema is checked. Deterministic; never throws.
 * @param {ComponentDescriptor} descriptor - Current component.
 * @param {unknown} values - Stored or edited values.
 * @returns {{ values: Record<string, string|number|boolean>, errors: ComponentValueError[], dropped: number }} Result.
 */
export const checkComponentValues = (descriptor, values) => {
  const input = isPlainObject(values) ? values : {};
  const out = {};
  const errors = [];
  const known = new Set();
  for (const field of descriptor.fields) {
    known.add(field.name);
    const value = hasOwn(input, field.name) ? input[field.name] : undefined;
    if (isEmpty(value)) {
      if (field.required) errors.push({ field: field.name, rule: 'required' });
      continue;
    }
    const result = checkValue(field, value);
    if (result.rule) errors.push({ field: field.name, rule: result.rule });
    else out[field.name] = result.value;
  }
  const dropped = Object.keys(input).filter((key) => !known.has(key)).length;
  return { values: out, errors, dropped };
};

/**
 * Values of a stored block for output: only the attributes the current
 * schema still has, as stored (no new checks), so removed attributes never
 * reach a site.
 * @param {ComponentDescriptor} descriptor - Current component.
 * @param {unknown} values - Stored values.
 * @returns {Record<string, string|number|boolean>} Values.
 */
export const currentValues = (descriptor, values) => {
  const input = cleanValuesShape(values);
  const out = {};
  for (const field of descriptor.fields) if (hasOwn(input, field.name)) out[field.name] = input[field.name];
  return out;
};

/**
 * Text attributes of a block for find and replace, diff and stats: string,
 * text and richtext values (keys in stored order). Without a descriptor every
 * string value counts.
 * @param {unknown} values - Stored values.
 * @param {ComponentDescriptor|null} [descriptor] - Current component.
 * @returns {string[]} Attribute names.
 */
export const textAttributes = (values, descriptor) => {
  const input = isPlainObject(values) ? values : {};
  const allowed = descriptor
    ? new Set(descriptor.fields.filter((field) => TEXT_TYPES.includes(field.type)).map((field) => field.name))
    : null;
  return Object.keys(input).filter(
    (key) => typeof input[key] === 'string' && (!allowed || allowed.has(key)) && COMPONENT_ATTRIBUTE.test(key)
  );
};

/**
 * @typedef {object} ComponentViolation
 * @property {string} code - COMPONENT_NOT_ALLOWED | COMPONENT_UNSUPPORTED | COMPONENT_INVALID.
 * @property {string} blockId - Block id.
 * @property {number} index - Block index.
 * @property {{ uid: string, field?: string, rule?: string }} params - Details (never values).
 */

/**
 * Checks and cleans the component blocks of a sanitised document against the
 * field's allowed list and the current schemas. Blocks of components that no
 * longer exist (deleted in the Content-Type Builder) keep their stored data.
 * @param {{ blocks: Array<{ id: string, type: string, data: object }> }|null} data - Sanitised document.
 * @param {string[]} allowed - Allowed uids of the field.
 * @param {(uid: string) => ComponentDescriptor|null} lookup - Current descriptor of a uid, null when it no longer exists.
 * @param {(block: object) => boolean} isComponentBlock - True for built-in component blocks.
 * @returns {{ data: typeof data, violations: ComponentViolation[] }} Cleaned document and violations (at most 50).
 */
export const checkComponentBlocks = (data, allowed, lookup, isComponentBlock) => {
  const violations = [];
  if (!data || !Array.isArray(data.blocks)) return { data, violations };
  let changed = false;
  const blocks = data.blocks.map((block, index) => {
    if (!isComponentBlock(block)) return block;
    const uid = block.data.uid;
    const add = (code, params) => {
      if (violations.length < 50)
        violations.push({ code, blockId: block.id, index, params: { uid, ...params } });
    };
    if (!uid || !allowed.includes(uid)) {
      add('COMPONENT_NOT_ALLOWED');
      return block;
    }
    const descriptor = lookup(uid);
    if (!descriptor) return block;
    if (!descriptor.supported) {
      add('COMPONENT_UNSUPPORTED');
      return block;
    }
    const result = checkComponentValues(descriptor, block.data.values);
    for (const error of result.errors) add('COMPONENT_INVALID', { field: error.field, rule: error.rule });
    changed = true;
    return { ...block, data: { ...block.data, values: result.values } };
  });
  return { data: changed ? { ...data, blocks } : data, violations };
};

/** Component descriptors known to this bundle (the admin fills it from `GET /config`). */
const active = new Map();

/**
 * Replaces the component descriptors known to this bundle (admin: from
 * `GET /config` `components`). Used where a block alone must say which of its
 * values are text (find and replace).
 * @param {ComponentDescriptor[]} descriptors - Descriptors.
 */
export const setActiveComponents = (descriptors) => {
  active.clear();
  for (const descriptor of Array.isArray(descriptors) ? descriptors : [])
    if (descriptor && typeof descriptor.uid === 'string' && Array.isArray(descriptor.fields))
      active.set(descriptor.uid, descriptor);
};

/**
 * Descriptor of a component known to this bundle.
 * @param {string} uid - Component uid.
 * @returns {ComponentDescriptor|null} Descriptor.
 */
export const activeComponent = (uid) => active.get(uid) || null;

/**
 * Merges a form edit of a component block into the block's current values
 * (2.5). The form sends only the attributes it changed; `undefined` removes
 * one. Merging into the current values keeps a collaborator's change of
 * another attribute that reached the block before the form rendered it (a
 * whole-values write from a stale render would delete that change in the
 * shared document).
 * @param {unknown} current - Current stored values of the block.
 * @param {Record<string, unknown>} patch - Changed attributes.
 * @returns {Record<string, string|number|boolean>} New values.
 */
export const mergeComponentPatch = (current, patch) => {
  const out = { ...cleanValuesShape(current) };
  for (const key of Object.keys(isPlainObject(patch) ? patch : {})) {
    if (patch[key] === undefined || patch[key] === null || patch[key] === '') delete out[key];
    else out[key] = patch[key];
  }
  return cleanValuesShape(out);
};

/**
 * Re-applies a text edit to newer text (2.5): `edited` is what the input
 * holds after a keystroke, `base` what it showed before (the last render),
 * `current` the attribute's latest value, which may already contain a
 * collaborator's change the input has not shown yet. The edit (common prefix
 * and suffix of `base` and `edited`) is replayed on `current`, so neither
 * side's typing is lost. Falls back to `edited` when the edited range cannot
 * be found in `current`.
 * @param {string} base - Text the input showed.
 * @param {string} edited - Text after the local edit.
 * @param {string} current - Latest text of the attribute.
 * @returns {string} Merged text.
 */
export const rebaseTextEdit = (base, edited, current) => {
  if (typeof base !== 'string' || typeof edited !== 'string' || typeof current !== 'string') return edited;
  if (current === base) return edited;
  let prefix = 0;
  while (prefix < base.length && prefix < edited.length && base[prefix] === edited[prefix]) prefix += 1;
  let suffix = 0;
  while (
    suffix < base.length - prefix &&
    suffix < edited.length - prefix &&
    base[base.length - 1 - suffix] === edited[edited.length - 1 - suffix]
  )
    suffix += 1;
  const removed = base.slice(prefix, base.length - suffix);
  const inserted = edited.slice(prefix, edited.length - suffix);
  const head = base.slice(0, prefix);
  const tail = base.slice(base.length - suffix);
  // Typing at the end of what the input showed continues at the end of the latest text.
  if (!removed && suffix === 0 && current.startsWith(base)) return current + inserted;
  let at = -1;
  if (current.startsWith(head) && current.slice(prefix, prefix + removed.length) === removed) at = prefix;
  else if (current.endsWith(tail)) {
    const end = current.length - suffix;
    if (current.slice(end - removed.length, end) === removed) at = end - removed.length;
  }
  if (at < 0) return edited;
  return current.slice(0, at) + inserted + current.slice(at + removed.length);
};
