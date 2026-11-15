'use strict';

const { z } = require('zod');
const { errors } = require('@strapi/utils');
const { isEditorAttribute } = require('../utils/editor-fields');
const { pathQuery, collectAt } = require('../utils/field-identity');
const { cleanEditorValue } = require('../utils/sanitizer');
const { createRateLimiter } = require('../utils/rate-limit');
const { apiUidSchema, documentIdSchema, localeSchema, fieldPathSchema } = require('../utils/validation');
const { resolveFieldPreset, allowedInlineTags } = require('../../../shared/presets.mjs');
const { isValidFieldKey } = require('../../../shared/field-identity.mjs');
const { REUSE_LIMITS } = require('../../../shared/reuse.mjs');

/**
 * "Use existing content" (2.5): reads the Magic Editor X fields of another
 * entry (or another locale of this one) for the "Insert from another entry"
 * dialog. Read only; inserting happens in the editor, so the blocks reach the
 * target through the normal editor change, live room and save.
 *
 * Access: Content Manager read on the type, the document locale (conditions
 * and locale permissions through `services/access.js` `readableDocument`) and
 * on each field (field-level permissions, `canReadField`); everything else is
 * 404. Values are cleaned with the source field's policy like a save
 * (`cleanEditorValue` with the configured raw HTML policy and the source
 * preset's inline tags). Source: the stored draft ("as last saved"). Nothing
 * here logs content.
 */

const TITLE_LIMIT = 200;
const MAX_TYPES = 100;
const MAX_LOCALES = 50;
const MAX_DEPTH = 8;

const notFound = () => new errors.NotFoundError('Not found');

/** `GET /reuse/source` query (strict). `field` limits the answer to one field path (with indices). */
const sourceQuerySchema = z.strictObject({
  uid: apiUidSchema,
  documentId: documentIdSchema,
  locale: localeSchema.optional(),
  field: fieldPathSchema.optional(),
});

module.exports = ({ strapi }) => {
  const access = () => strapi.plugin('magic-editor-x').service('access');
  const conf = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.reuse.${key}`);
    return value === undefined ? fallback : value;
  };
  let fallbackLimiter = null;

  /**
   * Base paths (no indices) of every editor field of a schema, in schema order.
   * @param {object} contentType - Content type.
   * @returns {Array<{ path: string, attribute: object }>} Fields.
   */
  const editorBasePaths = (contentType) => {
    const out = [];
    const seen = new Set();
    const walk = (schema, prefix, depth) => {
      if (!schema || depth > MAX_DEPTH) return;
      for (const [name, attribute] of Object.entries(schema.attributes || {})) {
        const path = prefix ? `${prefix}.${name}` : name;
        if (isEditorAttribute(attribute)) {
          if (!seen.has(path)) {
            seen.add(path);
            out.push({ path, attribute });
          }
        } else if (attribute.type === 'component')
          walk(strapi.components[attribute.component], path, depth + 1);
        else if (attribute.type === 'dynamiczone')
          for (const uid of attribute.components || []) walk(strapi.components[uid], path, depth + 1);
      }
    };
    walk(contentType, '', 0);
    return out;
  };

  /**
   * Permission query filters of the caller on a type (conditions, locale permissions).
   * @param {object} pc - Permission checker.
   * @returns {Promise<object|undefined>} Filters.
   */
  const readFilters = async (pc) => {
    const query = await pc.sanitizedQuery.read({});
    return query && query.filters ? query.filters : undefined;
  };

  const isLocalized = (contentType) => Boolean(contentType.pluginOptions?.i18n?.localized);
  const hasDraftAndPublish = (contentType) => contentType.options?.draftAndPublish === true;

  return {
    sourceQuerySchema,
    editorBasePaths,

    /**
     * Counts one request of an admin (`reuse.perMinute`, shared by all processes).
     * @param {number|string} userId - Admin id.
     * @returns {Promise<void>}
     * @throws {errors.RateLimitError} 429 when the limit is reached.
     */
    async checkRate(userId) {
      const max = Number(conf('perMinute', 60)) || 60;
      const key = `reuse:${userId}`;
      let allowed;
      try {
        const { count } = await strapi.plugin('magic-editor-x').service('store').hit(key, 60000);
        allowed = count <= max;
      } catch {
        if (!fallbackLimiter) fallbackLimiter = createRateLimiter({ max, windowMs: 60000 });
        allowed = fallbackLimiter.hit(key).allowed;
      }
      if (!allowed) throw new errors.RateLimitError('Too many requests. Try again in a minute.');
    },

    /**
     * Content types the caller can take content from: `api::` types with at least one editor
     * field the caller may read, and (localised types) the locales with at least one entry the
     * caller can read.
     * @param {object} userAbility - CASL ability.
     * @returns {Promise<Array<{ uid: string, kind: string, displayName: string, localized: boolean, locales: Array<{ code: string, name: string }>|null }>>} Types, by display name.
     */
    async types(userAbility) {
      if (!userAbility) return [];
      const checkerOf = (uid) =>
        strapi.plugin('content-manager').service('permission-checker').create({ userAbility, model: uid });
      let allLocales = null;
      const out = [];
      const candidates = Object.values(strapi.contentTypes)
        .filter((contentType) => contentType.uid.startsWith('api::'))
        .sort((a, b) => a.uid.localeCompare(b.uid));
      for (const contentType of candidates) {
        if (out.length >= MAX_TYPES) break;
        const fields = editorBasePaths(contentType);
        if (!fields.length) continue;
        let pc;
        try {
          pc = checkerOf(contentType.uid);
          if (pc.cannot.read()) continue;
        } catch {
          continue;
        }
        if (!fields.some(({ path }) => access().canReadField(pc, contentType, path))) continue;
        const filters = await readFilters(pc);
        const documents = strapi.documents(contentType.uid);
        let locales = null;
        if (isLocalized(contentType)) {
          if (!allLocales) {
            const service = strapi.plugin('i18n')?.service('locales');
            const list = service ? await service.find() : [];
            allLocales = (Array.isArray(list) ? list : [])
              .filter((entry) => entry && typeof entry.code === 'string')
              .slice(0, MAX_LOCALES)
              .map((entry) => ({ code: entry.code, name: String(entry.name || entry.code).slice(0, 100) }));
          }
          locales = [];
          for (const entry of allLocales) {
            const count = await documents.count({
              ...(filters ? { filters } : {}),
              locale: entry.code,
              status: 'draft',
            });
            if (count > 0) locales.push(entry);
          }
          if (!locales.length) continue;
        } else {
          const count = await documents.count({ ...(filters ? { filters } : {}), status: 'draft' });
          if (count === 0) continue;
        }
        out.push({
          uid: contentType.uid,
          kind: contentType.kind,
          displayName: contentType.info?.displayName || contentType.uid,
          localized: isLocalized(contentType),
          locales,
        });
      }
      return out.sort((a, b) => a.displayName.localeCompare(b.displayName));
    },

    /**
     * The non-empty editor fields of one document locale the caller may read, with their
     * cleaned blocks (the stored draft). Fields of repeatable components and dynamic zones are
     * listed per entry (`sections.0.body`), with their field key when they have one.
     * @param {{ userAbility: object, uid: string, documentId: string, locale?: string, field?: string }} input - Validated input.
     * @returns {Promise<{ uid: string, documentId: string, locale: string|null, title: string, status: 'draft', hasPublished: boolean|null, updatedAt: string|null, fields: Array<object>, limited: boolean }>} Source.
     * @throws {errors.NotFoundError} When the type, document or requested field does not exist or cannot be read.
     */
    async source({ userAbility, uid, documentId, locale, field }) {
      const {
        contentType,
        locale: effectiveLocale,
        checker: pc,
      } = await access().readableDocument({
        userAbility,
        uid,
        documentId,
        locale,
      });
      const documents = strapi.documents(uid);
      const localeArg = effectiveLocale || undefined;
      let paths = editorBasePaths(contentType);
      if (field) {
        const base = field
          .split('.')
          .filter((part) => !/^\d+$/.test(part))
          .join('.');
        paths = paths.filter((entry) => entry.path === base);
        if (!paths.length || !access().canReadField(pc, contentType, field)) throw notFound();
      }
      const rawHtml = strapi.config.get('plugin::magic-editor-x.rawHtml') || 'sanitize';
      const fields = [];
      let bytes = 0;
      let limited = false;
      for (const { path, attribute } of paths) {
        if (!access().canReadField(pc, contentType, path)) continue;
        const parts = path.split('.');
        const query = pathQuery(strapi, contentType, parts);
        if (!query) continue;
        const row = await documents.findOne({
          documentId,
          locale: localeArg,
          status: 'draft',
          fields: ['documentId', ...query.fields],
          populate: query.populate,
        });
        const preset = resolveFieldPreset(attribute.options);
        for (const item of collectAt(row, parts)) {
          if (field && item.path !== field) continue;
          if (fields.length >= REUSE_LIMITS.fields) {
            limited = true;
            break;
          }
          let value;
          try {
            value = cleanEditorValue(item.value, { rawHtml, inlineTags: allowedInlineTags(preset) });
          } catch {
            // Stored content that cannot be read (too large, too deep) is not offered.
            continue;
          }
          if (!value || !Array.isArray(value.blocks) || value.blocks.length === 0) continue;
          let blocks = value.blocks.slice(0, REUSE_LIMITS.blocksPerField);
          let size = JSON.stringify(blocks).length;
          while (blocks.length > 1 && bytes + size > REUSE_LIMITS.bytes) {
            blocks = blocks.slice(0, Math.max(1, Math.floor(blocks.length / 2)));
            size = JSON.stringify(blocks).length;
          }
          if (bytes + size > REUSE_LIMITS.bytes) {
            limited = true;
            continue;
          }
          bytes += size;
          fields.push({
            field: item.path,
            fieldKey: isValidFieldKey(value.fieldKey) ? value.fieldKey : null,
            preset: preset.name,
            blockCount: value.blocks.length,
            truncated: blocks.length < value.blocks.length,
            blocks,
          });
        }
      }
      if (field && !fields.length) throw notFound();

      // Title (only when the caller may read the title field) and publication state.
      let title = '';
      const titleField = await strapi.plugin('magic-editor-x').service('links').titleFieldFor(contentType);
      const meta = await documents.findOne({
        documentId,
        locale: localeArg,
        status: 'draft',
        fields: [
          'documentId',
          'updatedAt',
          ...(effectiveLocale ? ['locale'] : []),
          ...(titleField ? [titleField] : []),
        ],
      });
      if (titleField && meta && !pc.cannot.read(null, titleField)) {
        const clean = (await pc.sanitizeOutput(meta)) || {};
        if (typeof clean[titleField] === 'string') title = clean[titleField].slice(0, TITLE_LIMIT);
      }
      let hasPublished = null;
      if (hasDraftAndPublish(contentType)) {
        const published = await documents.findFirst({
          filters: { documentId },
          locale: localeArg,
          status: 'published',
          fields: ['documentId'],
        });
        hasPublished = Boolean(published);
      }
      const updatedAt = meta && meta.updatedAt ? new Date(meta.updatedAt).toISOString() : null;
      return {
        uid,
        documentId,
        locale: effectiveLocale,
        title,
        status: 'draft',
        hasPublished,
        updatedAt,
        fields,
        limited,
      };
    },
  };
};
