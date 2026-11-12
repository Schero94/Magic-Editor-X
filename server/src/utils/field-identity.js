'use strict';

const { isEditorAttribute } = require('./editor-fields');
const { isPositionalFieldPath, isValidFieldKey, blockIdsOf } = require('../../../shared/field-identity.mjs');
const { normalizeEditorDataSafe } = require('../../../shared/editor-data.mjs');

/**
 * Server helpers of the field identity (2.4, `shared/field-identity.mjs`):
 * reading the stored values of a positional field (every entry of a
 * repeatable component or dynamic zone that has the field) from a document.
 */

const MAX_DEPTH = 8;

/**
 * Populate entry for one component level.
 * @param {{ fields: string[], populate: Record<string, unknown> }} query - Inner query.
 * @returns {object} Populate entry.
 */
const toPopulate = (query) => {
  const out = { fields: query.fields.length ? query.fields : ['id'] };
  if (Object.keys(query.populate).length) out.populate = query.populate;
  return out;
};

/**
 * Builds the `fields`/`populate` query that reads one editor field along a
 * base path (`sections.body`, `zone.items.body`) and nothing else. Dynamic
 * zones use per-component `on` fragments (Strapi 5 Document Service populate).
 * @param {object} strapi - Strapi instance.
 * @param {object} schema - Content type or component schema.
 * @param {string[]} parts - Base path segments (no indices).
 * @param {number} [depth=0] - Recursion depth.
 * @returns {{ fields: string[], populate: Record<string, unknown> } | null} Query parts, null when the path has no editor field.
 */
const pathQuery = (strapi, schema, parts, depth = 0) => {
  if (!schema || depth > MAX_DEPTH || parts.length === 0) return null;
  const [name, ...rest] = parts;
  const attribute = schema.attributes && schema.attributes[name];
  if (!attribute) return null;
  if (rest.length === 0) return isEditorAttribute(attribute) ? { fields: [name], populate: {} } : null;
  if (attribute.type === 'component') {
    const inner = pathQuery(strapi, strapi.components[attribute.component], rest, depth + 1);
    return inner ? { fields: [], populate: { [name]: toPopulate(inner) } } : null;
  }
  if (attribute.type === 'dynamiczone') {
    const on = {};
    for (const uid of attribute.components || []) {
      const inner = pathQuery(strapi, strapi.components[uid], rest, depth + 1);
      if (inner) on[uid] = toPopulate(inner);
    }
    return Object.keys(on).length ? { fields: [], populate: { [name]: { on } } } : null;
  }
  return null;
};

/**
 * Collects the values at a base path of a loaded document, with their
 * positional path and the component entry holding them.
 * @param {object|null} data - Document (or component entry).
 * @param {string[]} parts - Base path segments.
 * @param {string} [prefix=''] - Path of `data`.
 * @param {Array<{ path: string, value: unknown, container: object }>} [out=[]] - Accumulator.
 * @param {number} [depth=0] - Recursion depth.
 * @returns {Array<{ path: string, value: unknown, container: object }>} Values in document order.
 */
const collectAt = (data, parts, prefix = '', out = [], depth = 0) => {
  if (!data || typeof data !== 'object' || depth > MAX_DEPTH || parts.length === 0) return out;
  const [name, ...rest] = parts;
  if (!Object.prototype.hasOwnProperty.call(data, name)) return out;
  const value = data[name];
  const path = prefix ? `${prefix}.${name}` : name;
  if (rest.length === 0) {
    out.push({ path, value, container: data });
    return out;
  }
  if (Array.isArray(value))
    value.forEach((item, index) => collectAt(item, rest, `${path}.${index}`, out, depth + 1));
  else collectAt(value, rest, path, out, depth + 1);
  return out;
};

/**
 * Entries of a positional field in the stored draft: one per component entry
 * that has the field, in document order.
 * @param {object} strapi - Strapi instance.
 * @param {{ uid: string, documentId: string, locale?: string|null, basePath: string }} target - Field.
 * @returns {Promise<Array<{ path: string, fieldKey: string|null, blockIds: Set<string>, componentId: string|null, value: unknown }>>} Entries.
 */
const readPositionalEntries = async (strapi, { uid, documentId, locale, basePath }) => {
  const contentType = strapi.contentType(uid);
  const parts = String(basePath).split('.');
  const query = contentType ? pathQuery(strapi, contentType, parts) : null;
  if (!query) return [];
  const document = await strapi.documents(uid).findOne({
    documentId,
    locale: locale || undefined,
    status: 'draft',
    fields: ['documentId', ...query.fields],
    populate: query.populate,
  });
  return describeEntries(collectAt(document, parts));
};

/**
 * Turns collected values into entries with their key and block ids.
 * @param {Array<{ path: string, value: unknown, container: object }>} items - Collected values.
 * @returns {Array<{ path: string, fieldKey: string|null, blockIds: Set<string>, componentId: string|null, value: unknown }>} Entries.
 */
const describeEntries = (items) =>
  items
    .filter((item) => isPositionalFieldPath(item.path))
    .map((item) => {
      // 1.x values may be JSON strings; normalising gives their block ids (and a key only from an object).
      const value = normalizeEditorDataSafe(item.value);
      const id = item.container && item.container.id;
      return {
        path: item.path,
        fieldKey: value && isValidFieldKey(value.fieldKey) ? value.fieldKey : null,
        blockIds: blockIdsOf(value),
        componentId: id === undefined || id === null ? null : String(id),
        value: item.value,
      };
    });

module.exports = { pathQuery, collectAt, readPositionalEntries, describeEntries };
