'use strict';

/**
 * Core Blocks bridge (2.7): lets custom block types that a host adds to Strapi's core `blocks`
 * field (Content Manager `addRichTextBlocks`) pass Strapi's server-side validation.
 *
 * Strapi's blocks validator (`@strapi/core` `services/entity-validator/blocks-validator`, identical
 * from 5.38 to 5.63) rejects every node type it does not know with "Block node is of invalid type",
 * so such content cannot be saved through the Document Service, REST, the admin or publish. Until
 * Strapi validates registered block types itself (RFC: https://github.com/strapi/strapi/discussions/25546),
 * this module wraps `strapi.entityValidator.validateEntityCreation/validateEntityUpdate` (the object
 * the Document Service calls at write time):
 *
 * 1. Top-level nodes of `blocks` attributes (also inside components and dynamic zones) whose `type`
 *    is registered are checked against size, depth and key limits and then validated, as a clone,
 *    by their registered Yup schema (`strict: true`, so nothing is cast).
 * 2. Each such node is replaced by a unique placeholder paragraph and Strapi's original validator
 *    runs on that copy, so built-in and unregistered nodes are validated exactly as before;
 *    unregistered types still fail with Strapi's own error.
 * 3. On success the original nodes are put back at their positions in Strapi's result, so the
 *    stored JSON of a custom node is the node the caller sent. The caller's data is never mutated.
 *
 * Every failure of the bridge itself fails closed (the write is rejected) or leaves Strapi untouched;
 * it never accepts a node that neither Strapi nor a registered schema validated.
 */

const { randomBytes } = require('node:crypto');

/** Node types Strapi's blocks validator owns (block and inline). They can never be registered. */
const BUILTIN_TYPES = Object.freeze([
  'paragraph',
  'heading',
  'quote',
  'list',
  'list-item',
  'image',
  'code',
  'text',
  'link',
]);

/** Registered type names: lowercase words joined by single hyphens, 1 to 64 characters. */
const TYPE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const PLUGIN_PATTERN = /^[a-z0-9][a-z0-9.-]*$/;

/** Bounds for untrusted custom nodes; checked before any registered validator runs. */
const LIMITS = Object.freeze({
  /** Nesting depth of objects and arrays inside one custom node. */
  maxDepth: 32,
  /** Values (objects, arrays, strings, numbers, booleans, null) inside one custom node. */
  maxValues: 10000,
  /** Characters of all keys and strings inside one custom node. */
  maxChars: 256 * 1024,
  /** Custom nodes in one write (all blocks fields, components and dynamic zones together). */
  maxNodesPerWrite: 1000,
  /** Registered types per Strapi instance. */
  maxTypes: 100,
  /** Component and dynamic zone nesting followed while looking for blocks fields. */
  maxComponentDepth: 20,
});

/** Own keys that could reach an object prototype through careless consumers. */
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const BRIDGE_MARK = Symbol.for('magic-editor-x.coreBlocksBridge');
const ORIGINAL = Symbol.for('magic-editor-x.coreBlocksBridge.original');

const MESSAGES = Object.freeze({
  notJson: 'Custom block must be plain JSON (objects, arrays, strings, finite numbers, booleans, null)',
  forbiddenKey: 'Custom block must not contain the keys __proto__, constructor or prototype',
  tooDeep: `Custom block is nested deeper than ${LIMITS.maxDepth} levels`,
  tooManyValues: `Custom block has more than ${LIMITS.maxValues} values`,
  tooLarge: `Custom block is larger than ${LIMITS.maxChars} characters`,
  tooManyNodes: `A write may contain at most ${LIMITS.maxNodesPerWrite} custom blocks`,
  validatorFailed: 'Custom block could not be validated',
  restoreFailed: 'Custom block could not be saved unchanged',
});

/**
 * Error thrown by `register()` for an invalid definition. `code` is one of `INVALID_DEFINITION`,
 * `INVALID_TYPE`, `BUILTIN_TYPE`, `TYPE_TAKEN`, `INVALID_VALIDATOR`, `TOO_MANY_TYPES`.
 */
class CoreBlockDefinitionError extends Error {
  /**
   * @param {string} code - Stable error code.
   * @param {string} message - Fixed message naming the problem, never a value from the definition.
   */
  constructor(code, message) {
    super(`[magic-editor-x] core block: ${message}`);
    this.name = 'CoreBlockDefinitionError';
    this.code = code;
  }
}

const isPlainObject = (value) => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/**
 * Builds the inline node validators Strapi uses for paragraph children, with the given Yup.
 * Mirrors `@strapi/core` `blocks-validator` 5.38 to 5.63 (MIT): text nodes with the five
 * marks, links with http, https, ftp, mailto, tel or relative URLs and text children.
 * Names match the helpers of the proposed core API (strapi/strapi discussion 25546) so the
 * same validator function works when the bridge hands registrations to Strapi.
 * @param {object} yup - Yup namespace (`require('@strapi/utils').yup`).
 * @returns {{ yup: object, textNodeValidator: object, linkNodeValidator: object, inlineNodeValidator: object, checkValidLink: (link: string) => boolean }} Helpers.
 */
const createValidatorHelpers = (yup) => {
  const textNodeValidator = yup.object().shape({
    type: yup.string().equals(['text']).required(),
    text: yup
      .string()
      .test(
        'is-valid-text',
        'Text must be defined with at least an empty string',
        (text) => typeof text === 'string' || text === ''
      ),
    bold: yup.boolean(),
    italic: yup.boolean(),
    underline: yup.boolean(),
    strikethrough: yup.boolean(),
    code: yup.boolean(),
  });
  const ALLOWED_LINK_PROTOCOLS = new Set(['http:', 'https:', 'ftp:', 'mailto:', 'tel:']);
  const checkValidLink = (link) => {
    try {
      const url = new URL(link.startsWith('/') ? `https://strapi.io${link}` : link);
      return ALLOWED_LINK_PROTOCOLS.has(url.protocol);
    } catch {
      return false;
    }
  };
  const linkNodeValidator = yup.object().shape({
    type: yup.string().equals(['link']).required(),
    url: yup
      .string()
      .test('invalid-url', 'Please specify a valid link.', (value) => checkValidLink(value ?? '')),
    children: yup.array().of(textNodeValidator).required(),
  });
  const inlineNodeValidator = yup.lazy((value) => {
    switch (value && value.type) {
      case 'text':
        return textNodeValidator;
      case 'link':
        return linkNodeValidator;
      default:
        return yup.mixed().test('invalid-type', 'Inline node must be Text or Link', () => false);
    }
  });
  return Object.freeze({ yup, textNodeValidator, linkNodeValidator, inlineNodeValidator, checkValidLink });
};

const isYupSchema = (value) =>
  Boolean(value) &&
  (typeof value === 'object' || typeof value === 'function') &&
  value.__isYupSchema__ === true &&
  typeof value.validate === 'function';

/**
 * Creates the registry of custom block types.
 * @param {object} helpers - Result of `createValidatorHelpers`.
 * @returns {{ register: Function, get: Function, has: Function, list: Function, size: () => number, entries: Function, clear: Function }} Registry.
 */
const createRegistry = (helpers) => {
  const types = new Map();
  return {
    /**
     * Registers one custom block type for server-side validation.
     * @param {{ type: string, validator: object|Function, plugin?: string }} definition - `type` is the
     *   node `type` the editor writes; `validator` is a Yup schema (use `yup` from `@strapi/utils` or the
     *   helpers) or a function `(helpers) => schema` called once, now.
     * @returns {{ type: string, plugin: string }} The registered entry.
     * @throws {CoreBlockDefinitionError} On an invalid, built-in or already registered type or a
     *   validator that is not a Yup schema.
     * @sideeffect Adds the type to this registry.
     */
    register(definition) {
      if (!isPlainObject(definition))
        throw new CoreBlockDefinitionError('INVALID_DEFINITION', 'the definition must be an object');
      const unknown = Object.keys(definition).filter((key) => !['type', 'validator', 'plugin'].includes(key));
      if (unknown.length)
        throw new CoreBlockDefinitionError(
          'INVALID_DEFINITION',
          'only the keys type, validator and plugin are allowed'
        );
      const { type, validator, plugin = 'magic-editor-x' } = definition;
      if (typeof type !== 'string' || type.length > 64 || !TYPE_PATTERN.test(type))
        throw new CoreBlockDefinitionError(
          'INVALID_TYPE',
          'type must be lowercase letters and digits joined by single hyphens (1 to 64 characters)'
        );
      if (BUILTIN_TYPES.includes(type))
        throw new CoreBlockDefinitionError('BUILTIN_TYPE', `"${type}" is a built-in Strapi node type`);
      if (types.has(type))
        throw new CoreBlockDefinitionError('TYPE_TAKEN', `"${type}" is already registered`);
      if (types.size >= LIMITS.maxTypes)
        throw new CoreBlockDefinitionError(
          'TOO_MANY_TYPES',
          `at most ${LIMITS.maxTypes} types can be registered`
        );
      if (typeof plugin !== 'string' || plugin.length > 64 || !PLUGIN_PATTERN.test(plugin))
        throw new CoreBlockDefinitionError('INVALID_DEFINITION', 'plugin must be a plugin name');
      let schema = validator;
      if (typeof validator === 'function' && !isYupSchema(validator)) {
        try {
          schema = validator(helpers);
        } catch {
          throw new CoreBlockDefinitionError(
            'INVALID_VALIDATOR',
            `the validator function of "${type}" threw`
          );
        }
      }
      if (!isYupSchema(schema))
        throw new CoreBlockDefinitionError(
          'INVALID_VALIDATOR',
          `the validator of "${type}" must be a Yup schema or a function returning one`
        );
      const entry = Object.freeze({ type, plugin, schema, source: validator });
      types.set(type, entry);
      return { type, plugin };
    },
    get: (type) => (typeof type === 'string' ? types.get(type) : undefined),
    has: (type) => typeof type === 'string' && types.has(type),
    list: () => [...types.values()].map(({ type, plugin }) => ({ type, plugin })),
    entries: () => [...types.values()],
    size: () => types.size,
    clear: () => types.clear(),
  };
};

/**
 * Checks one untrusted custom node against the limits: plain JSON only, no prototype keys,
 * bounded depth, value count and size. Iterative, so a hostile depth cannot overflow the stack.
 * @param {unknown} node - Node as sent.
 * @returns {{ message: string, path: string[] }|null} The first problem, or null when the node is within limits.
 */
const inspectNode = (node) => {
  const stack = [{ value: node, depth: 0, path: [] }];
  let values = 0;
  let chars = 0;
  while (stack.length) {
    const { value, depth, path } = stack.pop();
    values += 1;
    if (values > LIMITS.maxValues) return { message: MESSAGES.tooManyValues, path: [] };
    if (value === null || typeof value === 'boolean') continue;
    if (typeof value === 'string') {
      chars += value.length;
      if (chars > LIMITS.maxChars) return { message: MESSAGES.tooLarge, path: [] };
      continue;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) return { message: MESSAGES.notJson, path };
      continue;
    }
    const isArray = Array.isArray(value);
    if (!isArray && !isPlainObject(value)) return { message: MESSAGES.notJson, path };
    if (depth >= LIMITS.maxDepth) return { message: MESSAGES.tooDeep, path };
    if (Object.getOwnPropertySymbols(value).length) return { message: MESSAGES.notJson, path };
    const keys = Object.getOwnPropertyNames(value);
    for (const key of keys) {
      if (isArray && key === 'length') continue;
      if (FORBIDDEN_KEYS.has(key)) return { message: MESSAGES.forbiddenKey, path };
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
        return { message: MESSAGES.notJson, path };
      if (!isArray) {
        chars += key.length;
        if (chars > LIMITS.maxChars) return { message: MESSAGES.tooLarge, path: [] };
      }
      stack.push({ value: descriptor.value, depth: depth + 1, path: [...path, key] });
    }
    if (isArray && keys.length - 1 !== value.length) return { message: MESSAGES.notJson, path };
  }
  return null;
};

/**
 * Collects the registered custom nodes of one write, following components and dynamic zones.
 * @param {object} params - Inputs.
 * @param {object} params.model - Content type or component schema (`attributes`).
 * @param {object} params.data - Write payload for that model.
 * @param {(uid: string) => object|undefined} params.getModel - `strapi.getModel`.
 * @param {(type: unknown) => boolean} params.isRegistered - Registry lookup.
 * @returns {{ path: (string|number)[], node: object, type: string }[]} Custom nodes in data order.
 */
const collectCustomNodes = ({ model, data, getModel, isRegistered }) => {
  const out = [];
  const visit = (currentModel, value, path, depth) => {
    if (!currentModel || !isPlainObject(currentModel.attributes) || !isPlainObject(value)) return;
    if (depth > LIMITS.maxComponentDepth) return;
    for (const [name, attribute] of Object.entries(currentModel.attributes)) {
      if (!attribute || !Object.prototype.hasOwnProperty.call(value, name)) continue;
      const field = value[name];
      if (attribute.type === 'blocks' && Array.isArray(field)) {
        field.forEach((node, index) => {
          if (node && typeof node === 'object' && isRegistered(node.type))
            out.push({ path: [...path, name, index], node, type: node.type });
        });
      } else if (attribute.type === 'component' && attribute.component) {
        const componentModel = getModel(attribute.component);
        if (attribute.repeatable && Array.isArray(field)) {
          field.forEach((item, index) => visit(componentModel, item, [...path, name, index], depth + 1));
        } else if (!Array.isArray(field)) {
          visit(componentModel, field, [...path, name], depth + 1);
        }
      } else if (attribute.type === 'dynamiczone' && Array.isArray(field)) {
        field.forEach((item, index) => {
          if (isPlainObject(item) && typeof item.__component === 'string')
            visit(getModel(item.__component), item, [...path, name, index], depth + 1);
        });
      }
    }
  };
  visit(model, data, [], 0);
  return out;
};

/**
 * Returns a copy of `root` with values replaced at the given paths. Only the containers on the
 * paths are copied; everything else is shared. `root` is never mutated.
 * @param {object} root - Object to copy.
 * @param {{ path: (string|number)[], value: unknown }[]} replacements - Paths and values.
 * @returns {object} The copy.
 * @throws {TypeError} When a path does not lead through objects or arrays.
 */
const replaceAt = (root, replacements) => {
  const copies = new Map();
  const copyOf = (container) => {
    if (container === null || typeof container !== 'object')
      throw new TypeError('path does not lead through an object');
    if (!copies.has(container))
      copies.set(container, Array.isArray(container) ? container.slice() : { ...container });
    return copies.get(container);
  };
  const next = copyOf(root);
  for (const { path, value } of replacements) {
    let source = root;
    let target = next;
    for (let i = 0; i < path.length - 1; i += 1) {
      const key = path[i];
      const child = source[key];
      const childCopy = copyOf(child);
      target[key] = childCopy;
      source = child;
      target = childCopy;
    }
    target[path[path.length - 1]] = value;
  }
  return next;
};

const getAt = (root, path) => {
  let current = root;
  for (const key of path) {
    if (current === null || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
};

/** Splits a Yup error path (`children[0].text`) into segments. */
const toPath = (yupPath) =>
  typeof yupPath === 'string' && yupPath
    ? yupPath
        .replace(/\[(\d+)\]/g, '.$1')
        .replace(/\["([^"]*)"\]/g, '.$1')
        .split('.')
        .filter((segment) => segment !== '')
    : [];

const isYupValidationError = (error) =>
  Boolean(error) &&
  error.name === 'ValidationError' &&
  (Array.isArray(error.inner) || Array.isArray(error.errors));

const isStrapiValidationError = (error) => Boolean(error) && error.name === 'ValidationError';

/**
 * Validates the collected custom nodes with their registered schemas.
 * @param {{ path: (string|number)[], node: object, type: string }[]} entries - Collected nodes.
 * @param {{ get: Function }} registry - Registry.
 * @param {(code: string) => void} onValidatorBug - Called when a schema throws something other than a Yup error.
 * @returns {Promise<{ path: string[], message: string, name: string, value?: unknown }[]>} Errors in Strapi's
 *   `details.errors` format; empty when every node is valid.
 */
const validateCustomNodes = async (entries, registry, onValidatorBug) => {
  const problems = [];
  for (const entry of entries) {
    const base = entry.path.map(String);
    const limit = inspectNode(entry.node);
    if (limit) {
      problems.push({ path: [...base, ...limit.path], message: limit.message, name: 'ValidationError' });
      continue;
    }
    const registered = registry.get(entry.type);
    try {
      // A clone, so a schema transform or test can never change what is stored.
      await registered.schema.validate(structuredClone(entry.node), { strict: true, abortEarly: false });
    } catch (error) {
      if (isYupValidationError(error)) {
        const inner = Array.isArray(error.inner) && error.inner.length ? error.inner : [error];
        for (const item of inner) {
          problems.push({
            path: [...base, ...toPath(item.path)],
            message: typeof item.message === 'string' ? item.message : MESSAGES.validatorFailed,
            name: 'ValidationError',
            value: item.value,
          });
        }
      } else {
        onValidatorBug('VALIDATOR_THREW');
        problems.push({ path: base, message: MESSAGES.validatorFailed, name: 'ValidationError' });
      }
    }
  }
  return problems;
};

const startsWith = (path, prefix) =>
  prefix.length <= path.length && prefix.every((segment, index) => String(segment) === String(path[index]));

/**
 * Wraps one entity validator function (`validateEntityCreation` or `validateEntityUpdate`).
 * @param {Function} original - Strapi's function `(model, data, options, entity) => Promise<object>`.
 * @param {object} context - Bridge context.
 * @param {() => ({ get: Function, has: Function, size: () => number }|null)} context.activeRegistry - Registry
 *   while the bridge is on, otherwise null (then the call goes straight to Strapi).
 * @param {(uid: string) => object|undefined} context.getModel - `strapi.getModel`.
 * @param {object} context.errors - `@strapi/utils` errors (ValidationError).
 * @param {(code: string) => void} context.reportOnce - Logs an operational problem once per code.
 * @returns {Function} Wrapped function, tagged with the bridge marks.
 */
const wrapValidator = (original, context) => {
  const wrapped = async function coreBlocksBridge(model, data, options, entity) {
    const registry = context.activeRegistry();
    if (!registry || registry.size() === 0 || !model || !isPlainObject(data))
      return original.call(this, model, data, options, entity);
    let entries;
    try {
      entries = collectCustomNodes({
        model,
        data,
        getModel: context.getModel,
        isRegistered: (type) => registry.has(type),
      });
    } catch {
      // Strapi then rejects custom nodes as it always did; the bridge never weakens validation.
      context.reportOnce('COLLECT_FAILED');
      return original.call(this, model, data, options, entity);
    }
    if (!entries.length) return original.call(this, model, data, options, entity);
    if (entries.length > LIMITS.maxNodesPerWrite) {
      throw new context.errors.ValidationError(MESSAGES.tooManyNodes, {
        errors: [{ path: [], message: MESSAGES.tooManyNodes, name: 'ValidationError' }],
      });
    }

    const customErrors = await validateCustomNodes(entries, registry, context.reportOnce);
    const nonce = randomBytes(12).toString('hex');
    const markers = entries.map((_, index) => `mex-core-block:${nonce}:${index}`);
    const substituted = replaceAt(
      data,
      entries.map((entry, index) => ({
        path: entry.path,
        value: { type: 'paragraph', children: [{ type: 'text', text: markers[index] }] },
      }))
    );

    let result;
    try {
      result = await original.call(this, model, substituted, options, entity);
    } catch (error) {
      if (!isStrapiValidationError(error)) throw error;
      // Error values that contain a placeholder show the node the caller sent instead.
      const strapiErrors = Array.isArray(error.details && error.details.errors) ? error.details.errors : null;
      if (strapiErrors) {
        for (const item of strapiErrors) {
          if (!Array.isArray(item.path) || !('value' in item)) continue;
          if (entries.some((entry) => startsWith(entry.path, item.path))) item.value = getAt(data, item.path);
        }
      }
      if (!customErrors.length || !strapiErrors) throw error;
      const all = [...strapiErrors, ...customErrors];
      throw new context.errors.ValidationError(
        all.length === 1 ? all[0].message : `${all.length} errors occurred`,
        { errors: all }
      );
    }
    if (customErrors.length) {
      throw new context.errors.ValidationError(
        customErrors.length === 1 ? customErrors[0].message : `${customErrors.length} errors occurred`,
        { errors: customErrors }
      );
    }

    // Put the sent nodes back. Fail closed if Strapi's result no longer holds the placeholder
    // where the node was: storing a placeholder would lose content silently.
    const misplaced = entries.findIndex((entry, index) => {
      const value = getAt(result, entry.path);
      return !(
        value &&
        value.type === 'paragraph' &&
        Array.isArray(value.children) &&
        value.children[0] &&
        value.children[0].text === markers[index]
      );
    });
    if (misplaced !== -1) {
      context.reportOnce('RESTORE_FAILED');
      throw new context.errors.ValidationError(MESSAGES.restoreFailed, {
        errors: [
          {
            path: entries[misplaced].path.map(String),
            message: MESSAGES.restoreFailed,
            name: 'ValidationError',
          },
        ],
      });
    }
    return replaceAt(
      result,
      entries.map((entry) => ({ path: entry.path, value: entry.node }))
    );
  };
  wrapped[BRIDGE_MARK] = true;
  wrapped[ORIGINAL] = original;
  return wrapped;
};

const HOOKED = ['validateEntityCreation', 'validateEntityUpdate'];

/**
 * Checks that the hook point exists in the shape the bridge expects: an object with the two
 * validator functions as writable own properties.
 * @param {unknown} validator - `strapi.entityValidator`.
 * @returns {string|null} A reason code when the hook point is missing or changed, else null.
 */
const checkHookPoint = (validator) => {
  if (!validator || typeof validator !== 'object') return 'NO_ENTITY_VALIDATOR';
  for (const name of HOOKED) {
    const descriptor = Object.getOwnPropertyDescriptor(validator, name);
    if (!descriptor || typeof descriptor.value !== 'function') return 'HOOK_CHANGED';
    if (!descriptor.writable || !descriptor.configurable) return 'HOOK_READ_ONLY';
  }
  return null;
};

/**
 * Returns Strapi's own function behind a possibly wrapped one.
 * @param {Function} fn - Current property value.
 * @returns {Function} Unwrapped function.
 */
const unwrap = (fn) => {
  let current = fn;
  while (current && current[BRIDGE_MARK] && typeof current[ORIGINAL] === 'function')
    current = current[ORIGINAL];
  return current;
};

/**
 * Installs wrappers on the entity validator. An earlier wrapper (another Strapi instance in the
 * same process) is replaced, never stacked.
 * @param {object} validator - `strapi.entityValidator`.
 * @param {object} context - See `wrapValidator`.
 * @returns {() => void} Uninstall function; restores Strapi's functions if they are still ours.
 * @sideeffect Replaces `validateEntityCreation` and `validateEntityUpdate` on Strapi's shared object.
 */
const installBridge = (validator, context) => {
  const installed = {};
  for (const name of HOOKED) {
    const original = unwrap(validator[name]);
    installed[name] = wrapValidator(original, context);
    validator[name] = installed[name];
  }
  return () => {
    for (const name of HOOKED) {
      if (validator[name] === installed[name]) validator[name] = installed[name][ORIGINAL];
    }
  };
};

/**
 * Detects native support for custom block validation in the running Strapi
 * (the registry proposed in strapi/strapi discussion 25546, or any later `custom-blocks` service).
 * @param {object} strapi - Strapi instance.
 * @returns {{ native: boolean, register?: Function }} `register` is the native registration function when known.
 */
const detectNativeSupport = (strapi) => {
  try {
    const registry = strapi && strapi.customBlocks;
    if (registry && typeof registry.register === 'function')
      return { native: true, register: registry.register.bind(registry) };
  } catch {
    // a throwing getter is treated as "not available"
  }
  try {
    if (strapi && typeof strapi.has === 'function' && strapi.has('custom-blocks')) {
      const registry = strapi.get('custom-blocks');
      return {
        native: true,
        register:
          registry && typeof registry.register === 'function' ? registry.register.bind(registry) : undefined,
      };
    }
  } catch {
    // same
  }
  return { native: false };
};

/**
 * Canary: proves that Strapi's original validator still behaves the way the bridge relies on.
 * A built-in paragraph must pass and come back as a paragraph; an unregistered probe type must be
 * rejected with a ValidationError at its own path. Uses an in-memory model and writes nothing.
 * @param {object} params - Inputs.
 * @param {Function} params.original - Strapi's `validateEntityCreation`.
 * @param {string} params.uid - An existing model uid (relations are looked up on it; the probe field is not one of its attributes).
 * @returns {Promise<{ ok: true }|{ ok: false, reason: string }>} Result with a reason code.
 */
const runCanary = async ({ original, uid }) => {
  const model = {
    uid,
    modelType: 'contentType',
    kind: 'collectionType',
    info: { displayName: 'Magic Editor X probe', singularName: 'mex-probe', pluralName: 'mex-probes' },
    options: {},
    attributes: { mexCoreBlocksProbe: { type: 'blocks' } },
  };
  const paragraph = { type: 'paragraph', children: [{ type: 'text', text: 'probe' }] };
  try {
    const result = await original(model, { mexCoreBlocksProbe: [paragraph] }, { isDraft: true });
    const value = result && result.mexCoreBlocksProbe;
    if (!Array.isArray(value) || !value[0] || value[0].type !== 'paragraph')
      return { ok: false, reason: 'PROBE_SHAPE' };
  } catch {
    return { ok: false, reason: 'PROBE_BUILTIN_REJECTED' };
  }
  const probeType = `mex-probe-${randomBytes(6).toString('hex')}`;
  try {
    await original(
      model,
      { mexCoreBlocksProbe: [{ type: probeType, children: [{ type: 'text', text: 'probe' }] }] },
      { isDraft: true }
    );
    return { ok: false, reason: 'PROBE_ACCEPTED' };
  } catch (error) {
    const list = error && error.details && Array.isArray(error.details.errors) ? error.details.errors : [];
    const atProbe = list.some(
      (item) =>
        Array.isArray(item.path) && item.path[0] === 'mexCoreBlocksProbe' && String(item.path[1]) === '0'
    );
    if (!isStrapiValidationError(error) || !atProbe) return { ok: false, reason: 'PROBE_UNEXPECTED_ERROR' };
  }
  return { ok: true };
};

module.exports = {
  BUILTIN_TYPES,
  LIMITS,
  MESSAGES,
  BRIDGE_MARK,
  CoreBlockDefinitionError,
  createValidatorHelpers,
  createRegistry,
  inspectNode,
  collectCustomNodes,
  replaceAt,
  toPath,
  validateCustomNodes,
  wrapValidator,
  checkHookPoint,
  installBridge,
  unwrap,
  detectNativeSupport,
  runCanary,
};
