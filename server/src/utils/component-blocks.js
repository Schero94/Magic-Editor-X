'use strict';

const { describeComponent, checkComponentBlocks, currentValues } = require('../../../shared/components.mjs');
const { isBuiltInBlock } = require('../../../shared/sanitize-policy.mjs');

/**
 * Component blocks (2.6): server helpers over `strapi.components`.
 */

/**
 * True for a built-in component block (not custom block data named `component` from before 2.5).
 * @param {{ type?: unknown, data?: unknown }} block - Block.
 * @returns {boolean} Result.
 */
const isComponentBlock = (block) => Boolean(block) && block.type === 'component' && isBuiltInBlock(block);

/**
 * Current descriptor of a component, or null when the component does not exist.
 * Descriptors are cached per schema object (the Content-Type Builder restarts
 * Strapi after a change, which builds new schema objects).
 * @param {object} strapi - Strapi instance.
 * @returns {(uid: string) => import('../../../shared/components.mjs').ComponentDescriptor|null} Lookup.
 */
const createComponentLookup = (strapi) => {
  /** @type {WeakMap<object, object>} */
  const cache = new WeakMap();
  return (uid) => {
    const components = strapi && strapi.components;
    if (!components || typeof uid !== 'string' || !Object.prototype.hasOwnProperty.call(components, uid))
      return null;
    const schema = components[uid];
    if (!schema || typeof schema !== 'object') return null;
    if (!cache.has(schema)) {
      let isPrivate;
      try {
        const { contentTypes } = require('@strapi/utils');
        isPrivate = (name) => {
          try {
            return contentTypes.isPrivateAttribute(schema, name);
          } catch {
            // Outside a running Strapi (no `strapi` global): the attribute's own flag.
            return Boolean(schema.attributes && schema.attributes[name] && schema.attributes[name].private);
          }
        };
      } catch {
        isPrivate = undefined;
      }
      cache.set(schema, describeComponent(uid, schema, { isPrivate }));
    }
    return cache.get(schema);
  };
};

/**
 * Save check of the Document Service middleware: cleans the values of every
 * component block against the current schema (unknown attributes dropped,
 * types coerced) and reports violations with the preset error contract.
 * `COMPONENT_NOT_ALLOWED` comes from `checkPreset` for restricted fields, so
 * it is reported here only for unrestricted ones.
 * @param {object} strapi - Strapi instance.
 * @returns {(data: object|null, preset: import('../../../shared/presets.mjs').FieldPreset) => { data: object|null, violations: object[] }} Checker.
 */
const createComponentChecker = (strapi) => {
  const lookup = createComponentLookup(strapi);
  return (data, preset) => {
    if (!data || !Array.isArray(data.blocks) || !data.blocks.some(isComponentBlock))
      return { data, violations: [] };
    const result = checkComponentBlocks(data, preset.components || [], lookup, isComponentBlock);
    const violations = preset.restricted
      ? result.violations.filter((violation) => violation.code !== 'COMPONENT_NOT_ALLOWED')
      : result.violations;
    return { data: result.data, violations };
  };
};

/**
 * Output step of the Content API and GraphQL (`?mex=`, `…Rendered`/`…Resolved`):
 * component blocks whose component no longer exists or is not supported are
 * removed, and only the attributes the current schema still has are kept, so
 * a site never receives values of removed (or since private) attributes.
 * Returns the same object when nothing changes.
 * @param {object} strapi - Strapi instance.
 * @returns {(value: unknown) => unknown} Transform of one stored value.
 */
const createComponentOutput = (strapi) => {
  const lookup = createComponentLookup(strapi);
  return (value) => {
    if (!value || typeof value !== 'object' || !Array.isArray(value.blocks)) return value;
    if (!value.blocks.some(isComponentBlock)) return value;
    const blocks = [];
    // Open toggles (`data.items` = number of following blocks inside): a removed block
    // leaves every toggle it was in one item shorter.
    const open = [];
    for (const block of value.blocks) {
      let keep = block;
      if (isComponentBlock(block)) {
        const descriptor = lookup(block.data.uid);
        keep =
          descriptor && descriptor.supported
            ? { ...block, data: { ...block.data, values: currentValues(descriptor, block.data.values) } }
            : null;
      }
      for (const entry of open) {
        entry.remaining -= 1;
        if (!keep) entry.block.data.items -= 1;
      }
      while (open.length && open[open.length - 1].remaining <= 0) open.pop();
      if (!keep) continue;
      if (keep.type === 'toggle' && keep.data && Number(keep.data.items) > 0) {
        keep = { ...keep, data: { ...keep.data } };
        open.push({ block: keep, remaining: Number(keep.data.items) });
      }
      blocks.push(keep);
    }
    return { ...value, blocks };
  };
};

module.exports = { isComponentBlock, createComponentLookup, createComponentChecker, createComponentOutput };
