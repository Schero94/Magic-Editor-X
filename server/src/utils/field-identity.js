'use strict';

const { createHash } = require('node:crypto');
const { isEditorAttribute } = require('./editor-fields');
const {
  isPositionalFieldPath,
  isValidFieldKey,
  blockIdsOf,
  ownerOfBlocks,
} = require('../../../shared/field-identity.mjs');
const { normalizeEditorDataSafe } = require('../../../shared/editor-data.mjs');

/**
 * Server helpers of the field identity (2.4, `shared/field-identity.mjs`):
 * reading the stored values of a positional field (every entry of a
 * repeatable component or dynamic zone that has the field) from a document.
 */

const MAX_DEPTH = 8;

/** How long the key of an emptied entry is remembered (2.5): 400 days. */
const REMEMBER_TTL_MS = 400 * 24 * 3600 * 1000;

/**
 * Scope of remembered field keys (2.5): one document, locale and base path.
 * @param {{ uid: string, documentId: string, locale?: string|null, basePath: string }} target - Field.
 * @returns {string} 40 hex characters.
 */
const fieldKeyScope = ({ uid, documentId, locale, basePath }) =>
  createHash('sha256')
    .update([uid, documentId, locale || '', basePath].join('\u0000'))
    .digest('hex')
    .slice(0, 40);

/**
 * The locale a read without locale uses (Document Service default): the
 * default locale for localized types, '' otherwise.
 * @param {object} strapi - Strapi instance.
 * @param {string} uid - Content type.
 * @param {unknown} locale - Locale parameter.
 * @returns {Promise<string>} Locale ('' when not localized or unknown).
 */
const effectiveLocaleOf = async (strapi, uid, locale) => {
  const contentType = strapi.contentType(uid);
  if (!contentType || !contentType.pluginOptions?.i18n?.localized) return '';
  if (typeof locale === 'string' && locale && locale !== '*') return locale;
  try {
    return (await strapi.plugin('i18n')?.service('locales')?.getDefaultLocale?.()) || '';
  } catch {
    return '';
  }
};

/**
 * Scope of remembered keys for a write or read target (locale resolved like the Document Service).
 * @param {object} strapi - Strapi instance.
 * @param {{ uid: string, documentId: string, locale?: unknown, basePath: string }} target - Field.
 * @returns {Promise<string>} Scope.
 */
const fieldKeyScopeOf = async (strapi, { uid, documentId, locale, basePath }) =>
  fieldKeyScope({ uid, documentId, locale: await effectiveLocaleOf(strapi, uid, locale), basePath });

/**
 * The plugin store service, or null (unit tests, plugin not loaded).
 * @param {object} strapi - Strapi instance.
 * @returns {object|null} Store.
 */
const storeOf = (strapi) => {
  try {
    const store = strapi.plugin('magic-editor-x').service('store');
    return store && typeof store.rememberedFieldKeys === 'function' ? store : null;
  } catch {
    return null;
  }
};

/**
 * Remembered keys of emptied entries in one scope (2.5); empty when unavailable.
 * @param {object} strapi - Strapi instance.
 * @param {{ uid: string, documentId: string, locale?: unknown, basePath: string }} target - Field.
 * @returns {Promise<{ scope: string, keys: Map<string, string> }>} Scope and component row id -> key.
 */
const rememberedKeysOf = async (strapi, target) => {
  const scope = await fieldKeyScopeOf(strapi, target);
  const store = storeOf(strapi);
  if (!store) return { scope, keys: new Map() };
  try {
    return { scope, keys: await store.rememberedFieldKeys(scope) };
  } catch {
    return { scope, keys: new Map() };
  }
};

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
 *   An empty (null) entry carries the key remembered for its component row (2.5) with `remembered: true`.
 * @returns {Promise<Array<{ path: string, fieldKey: string|null, blockIds: Set<string>, componentId: string|null, value: unknown, remembered?: boolean }>>} Entries.
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
  const entries = describeEntries(collectAt(document, parts));
  // 2.5: an entry emptied and saved is stored as null; its key is remembered per component row.
  const empty = entries.filter((entry) => !entry.fieldKey && entry.componentId && entry.blockIds.size === 0);
  if (empty.length === 0) return entries;
  const { keys } = await rememberedKeysOf(strapi, { uid, documentId, locale, basePath });
  const used = new Set(entries.map((entry) => entry.fieldKey).filter(Boolean));
  for (const entry of empty) {
    const key = keys.get(entry.componentId);
    if (!isValidFieldKey(key) || used.has(key) || normalizeEditorDataSafe(entry.value) !== null) continue;
    entry.fieldKey = key;
    entry.remembered = true;
    used.add(key);
  }
  return entries;
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

/**
 * Base paths of every editor field inside a repeatable component or dynamic
 * zone of a schema (`sections.body`, `zone.body`, `groups.items.body`).
 * @param {object} strapi - Strapi instance.
 * @param {object} schema - Content type or component schema.
 * @param {string} [prefix=''] - Base path of `schema`.
 * @param {boolean} [positional=false] - Whether `schema` sits inside a repeatable component or zone.
 * @param {number} [depth=0] - Recursion depth.
 * @returns {string[]} Base paths (unique).
 */
const positionalBasePaths = (strapi, schema, prefix = '', positional = false, depth = 0) => {
  const out = new Set();
  if (!schema || depth > MAX_DEPTH) return [];
  for (const [name, attribute] of Object.entries(schema.attributes || {})) {
    const path = prefix ? `${prefix}.${name}` : name;
    if (isEditorAttribute(attribute)) {
      if (positional) out.add(path);
    } else if (attribute.type === 'component') {
      const inner = strapi.components[attribute.component];
      const below = positional || attribute.repeatable === true;
      for (const item of positionalBasePaths(strapi, inner, path, below, depth + 1)) out.add(item);
    } else if (attribute.type === 'dynamiczone') {
      for (const uid of attribute.components || []) {
        for (const item of positionalBasePaths(strapi, strapi.components[uid], path, true, depth + 1))
          out.add(item);
      }
    }
  }
  return Array.from(out);
};

/**
 * Collects the values at a base path of a loaded document with the component
 * uid and row id that hold them (for writing a key into a component row).
 * @param {object} strapi - Strapi instance.
 * @param {object} schema - Schema of `data`.
 * @param {object|null} data - Document or component entry.
 * @param {string[]} parts - Base path segments.
 * @param {string|null} [componentUid=null] - Component uid of `data` (null for the document).
 * @param {string} [prefix=''] - Path of `data`.
 * @param {Array<object>} [out=[]] - Accumulator.
 * @param {number} [depth=0] - Recursion depth.
 * @returns {Array<{ path: string, attribute: string, value: unknown, componentUid: string|null, rowId: unknown }>} Values.
 */
const collectRows = (strapi, schema, data, parts, componentUid = null, prefix = '', out = [], depth = 0) => {
  if (!schema || !data || typeof data !== 'object' || depth > MAX_DEPTH || parts.length === 0) return out;
  const [name, ...rest] = parts;
  if (!Object.prototype.hasOwnProperty.call(data, name)) return out;
  const attribute = schema.attributes && schema.attributes[name];
  const value = data[name];
  const path = prefix ? `${prefix}.${name}` : name;
  if (rest.length === 0) {
    out.push({ path, attribute: name, value, componentUid, rowId: data.id });
    return out;
  }
  if (!attribute) return out;
  const items = Array.isArray(value) ? value : [value];
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return;
    const uid = attribute.type === 'dynamiczone' ? item.__component : attribute.component;
    const itemPath = Array.isArray(value) ? `${path}.${index}` : path;
    collectRows(strapi, strapi.components[uid], item, rest, uid, itemPath, out, depth + 1);
  });
  return out;
};

/**
 * Keys for the new draft entries after "Discard changes" (2.5). Strapi 5.61
 * replaces the draft with a copy of the published version (new component
 * rows); a published version saved before 2.4 has no keys, so the entries
 * would lose the identity their versions and comments use. A new entry gets
 * the key of the one old draft entry that shares block ids with it (Editor.js
 * block ids are random and survive edits; `ownerOfBlocks` in both directions),
 * each old key at most once. Entries without such evidence stay keyless (2.4
 * behaviour: they get a key with their next save).
 * @param {Array<{ fieldKey: string|null, blockIds: Set<string> }>} before - Old draft entries.
 * @param {Array<{ fieldKey: string|null, blockIds: Set<string> }>} after - New draft entries.
 * @returns {Map<number, string>} Index in `after` -> key to write.
 */
const discardKeyPlan = (before, after) => {
  const plan = new Map();
  const keyed = before.filter((entry) => isValidFieldKey(entry.fieldKey) && entry.blockIds.size > 0);
  const used = new Set(after.map((entry) => entry.fieldKey).filter((key) => isValidFieldKey(key)));
  after.forEach((entry, index) => {
    if (isValidFieldKey(entry.fieldKey) || entry.blockIds.size === 0) return;
    const owner = ownerOfBlocks(entry.blockIds, keyed);
    if (owner === -1) return;
    // The old entry must point back to exactly this new entry.
    if (ownerOfBlocks(keyed[owner].blockIds, after) !== index) return;
    const key = keyed[owner].fieldKey;
    if (used.has(key)) return;
    used.add(key);
    plan.set(index, key);
  });
  return plan;
};

/**
 * Registers the Document Service middleware that keeps field keys through
 * `discardDraft` (2.5, see `discardKeyPlan`). It reads the positional editor
 * fields of the draft before the discard and of the new draft after it, and
 * writes the keys into the new component rows (`db.query(...).update` on the
 * component, so no write middleware, lifecycle or audit event runs twice).
 * Registered after the audit trail, so the audit's "after" read sees the
 * keys. A failure is logged without data and never blocks the discard.
 * @param {object} strapi - Strapi instance.
 * @param {{ warn: Function }} logger - Plugin logger.
 */
const registerDiscardKeys = (strapi, logger) => {
  const pathsCache = new Map();
  strapi.documents.use(async (ctx, next) => {
    if (ctx.action !== 'discardDraft' || typeof ctx.uid !== 'string' || !ctx.uid.startsWith('api::'))
      return next();
    const params = ctx.params || {};
    const contentType = ctx.contentType || strapi.contentType(ctx.uid);
    if (!contentType || typeof params.documentId !== 'string') return next();
    if (!pathsCache.has(contentType.uid))
      pathsCache.set(contentType.uid, positionalBasePaths(strapi, contentType));
    const basePaths = pathsCache.get(contentType.uid);
    if (basePaths.length === 0) return next();
    const localized = Boolean(contentType.pluginOptions?.i18n?.localized);

    /** Entries per `<locale>\u0000<base path>` of the draft. */
    const readDraft = async () => {
      const out = new Map();
      for (const basePath of basePaths) {
        const parts = basePath.split('.');
        const query = pathQuery(strapi, contentType, parts);
        if (!query) continue;
        const rows = await strapi.documents(contentType.uid).findMany({
          filters: { documentId: params.documentId },
          status: 'draft',
          ...(localized && params.locale !== undefined ? { locale: params.locale } : {}),
          fields: ['documentId', ...(localized ? ['locale'] : []), ...query.fields],
          populate: query.populate,
        });
        for (const row of Array.isArray(rows) ? rows : []) {
          const collected = collectRows(strapi, contentType, row, parts).filter((item) =>
            isPositionalFieldPath(item.path)
          );
          const entries = collected.map((item) => {
            const value = normalizeEditorDataSafe(item.value);
            return {
              ...item,
              normalized: value,
              fieldKey: value && isValidFieldKey(value.fieldKey) ? value.fieldKey : null,
              blockIds: blockIdsOf(value),
            };
          });
          out.set(`${localized ? row.locale || '' : ''}\u0000${basePath}`, entries);
        }
      }
      return out;
    };

    let before = null;
    try {
      before = await readDraft();
    } catch (error) {
      logger.warn('field keys could not be read before discarding a draft', { code: error && error.code });
    }
    const result = await next();
    if (!before || before.size === 0) return result;
    try {
      const after = await readDraft();
      for (const [scope, entries] of after) {
        const plan = discardKeyPlan(before.get(scope) || [], entries);
        for (const [index, key] of plan) {
          const entry = entries[index];
          if (!entry.componentUid || entry.rowId === undefined || entry.rowId === null) continue;
          await strapi.db.query(entry.componentUid).update({
            where: { id: entry.rowId },
            data: { [entry.attribute]: { ...entry.normalized, fieldKey: key } },
          });
        }
      }
    } catch (error) {
      logger.warn('field keys could not be kept after discarding a draft', { code: error && error.code });
    }
    return result;
  });
};

module.exports = {
  pathQuery,
  collectAt,
  readPositionalEntries,
  describeEntries,
  REMEMBER_TTL_MS,
  fieldKeyScope,
  fieldKeyScopeOf,
  rememberedKeysOf,
  positionalBasePaths,
  collectRows,
  discardKeyPlan,
  registerDiscardKeys,
};
