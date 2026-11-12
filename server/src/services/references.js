'use strict';

const { renderLinkPattern } = require('../../../shared/link-pattern.mjs');
const { isPlainObject, normalizeEditorDataSafe } = require('../../../shared/editor-data.mjs');
const { resolveFieldPreset, allowedInlineTags } = require('../../../shared/presets.mjs');
const { SYNCED_LIMITS, containsSynced, expandSynced, syncedRefsOf } = require('../../../shared/synced.mjs');
const { filterSyncedForField } = require('../../../shared/templates.mjs');
const { cleanEditorValue } = require('../utils/sanitizer');
const {
  collectReferences,
  applyReferences,
  renderResolved,
  entryKey,
} = require('../../../shared/resolve-references.mjs');
const { createLogger } = require('../utils/logger');

/**
 * Permission-safe reference resolution for API output (Content API `?mex=`
 * and the GraphQL fields).
 *
 * Every lookup runs with the caller's Content API auth (`ctx.state.auth`: API
 * token or users-permissions user/public role):
 * - a target type is only queried when `strapi.auth.verify(auth, { scope: ['<uid>.find'] })`
 *   passes, the same rule Strapi applies to populated relations;
 * - Media Library files need `plugin::upload.content-api.find`;
 * - entries are read with the request's publication status (`published`
 *   unless the request asked for drafts), so draft-only entries never resolve
 *   in published output;
 * - every row passes `strapi.contentAPI.sanitize.output(row, model, { auth })`
 *   before a title, slug or file field is used.
 *
 * Lookups are batched per type and locale (`documentId $in`), bounded by
 * `LIMITS` (500 references, 5 seconds per response). A reference that is
 * not resolved (missing, draft-only, not readable, over the limit or timed
 * out) is treated the same way in every case, so its existence is not
 * revealed. Logs carry counts only.
 *
 * Synced blocks (2.3) are expanded first: a reference block is replaced by
 * a copy of its source's blocks (one query for all sources of a response, at
 * most `SYNCED_LIMITS.refsPerResponse` distinct sources). Sources are shared
 * editorial content an author embedded on purpose, so they are expanded for
 * every caller who can read the containing entry, but only after they pass
 * the containing field's sanitiser (raw HTML policy, the preset's inline
 * tags) and preset (`filterSyncedForField`: blocks the field does not allow
 * are left out). Links, mentions, embedded entries and media inside the
 * expanded blocks are then resolved with the caller's permissions like any
 * other reference. A missing source expands to nothing.
 */

const UPLOAD_UID = 'plugin::upload.file';
const UPLOAD_SCOPE = 'plugin::upload.content-api.find';
const TITLE_TYPES = new Set(['string', 'text', 'email', 'uid']);
const SCALAR = new Set(['string', 'number', 'boolean']);
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_DISPLAY_FIELDS = 20;
const STORED_SYSTEM_KEYS = new Set(['id', 'documentId', 'title', 'href']);

/** Bounds per response: distinct references resolved, and the time budget of all lookups. */
const LIMITS = Object.freeze({ maxReferences: 500, timeoutMs: 5000 });

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);

  /**
   * True when the caller's Content API auth grants `scope`. Decisions are
   * cached per request in `cache`.
   * @param {object|undefined} auth - `ctx.state.auth`.
   * @param {string} scope - Action, e.g. `api::article.article.find`.
   * @param {Map<string, Promise<boolean>>} cache - Per-request cache.
   * @returns {Promise<boolean>} Result.
   */
  const can = (auth, scope, cache) => {
    if (!auth || !auth.strategy) return Promise.resolve(false);
    if (!cache.has(scope)) {
      cache.set(
        scope,
        Promise.resolve()
          .then(() => strapi.auth.verify(auth, { scope: [scope] }))
          .then(
            () => true,
            () => false
          )
      );
    }
    return cache.get(scope);
  };

  const isLocalized = (contentType) => Boolean(contentType.pluginOptions?.i18n?.localized);
  const hasDraftAndPublish = (contentType) => contentType.options?.draftAndPublish === true;
  const slugFieldFor = (contentType) => {
    const entry = Object.entries(contentType.attributes || {}).find(
      ([, attribute]) => attribute && attribute.type === 'uid'
    );
    return entry ? entry[0] : null;
  };

  /**
   * Title of a sanitised row: the custom block's `titleField`, then `title`,
   * `name`, `label`, then the first text attribute that survived sanitising.
   * @param {object} contentType - Target schema.
   * @param {object} row - Sanitised row.
   * @param {string|null} preferred - Preferred field.
   * @returns {string} Title ('' when none).
   */
  const titleOf = (contentType, row, preferred) => {
    const attributes = contentType.attributes || {};
    const candidates = [preferred, 'title', 'name', 'label'].filter(
      (name) => typeof name === 'string' && attributes[name] && TITLE_TYPES.has(attributes[name].type)
    );
    for (const [name, attribute] of Object.entries(attributes))
      if (attribute && TITLE_TYPES.has(attribute.type)) candidates.push(name);
    for (const name of candidates)
      if (typeof row[name] === 'string' && row[name].trim()) return row[name].slice(0, 200);
    return '';
  };

  /**
   * Embedded-entry block definitions by block name (title and display fields).
   * @param {Set<string>} names - Block types used in the output.
   * @returns {Promise<Map<string, { titleField: string|null, displayFields: string[] }>>} Definitions.
   */
  const definitionsFor = async (names) => {
    const out = new Map();
    if (!names.size) return out;
    const rows = await strapi.db.query('plugin::magic-editor-x.custom-block').findMany({
      where: { name: { $in: [...names].slice(0, 200) }, blockType: 'embedded-entry' },
      select: ['name', 'titleField', 'displayFields'],
      limit: 200,
    });
    for (const row of rows || []) {
      out.set(row.name, {
        titleField: typeof row.titleField === 'string' ? row.titleField : null,
        displayFields: Array.isArray(row.displayFields)
          ? row.displayFields.filter((name) => typeof name === 'string')
          : [],
      });
    }
    return out;
  };

  /**
   * Resolves link and entry references of one type and locale.
   * @param {object} group - `{ uid, locale, refs: Reference[] }`.
   * @param {object} input - `{ auth, status, cache, definitions, results, pattern }`.
   * @returns {Promise<void>}
   */
  const resolveGroup = async (
    { uid, locale, refs },
    { auth, status, cache, definitions, results, pattern }
  ) => {
    const contentType = strapi.contentType(uid);
    if (!contentType || !uid.startsWith('api::')) return;
    if (!(await can(auth, `${uid}.find`, cache))) return;
    const localized = isLocalized(contentType);
    const ids = [...new Set(refs.map((ref) => ref.documentId))];
    const rows = await strapi.documents(uid).findMany({
      filters: { documentId: { $in: ids } },
      ...(localized && locale ? { locale } : {}),
      ...(hasDraftAndPublish(contentType) ? { status } : {}),
      limit: ids.length,
    });
    const slugField = slugFieldFor(contentType);
    for (const row of rows || []) {
      if (!row || typeof row.documentId !== 'string') continue;
      const clean = (await strapi.contentAPI.sanitize.output(row, contentType, { auth })) || {};
      const slug = slugField && typeof clean[slugField] === 'string' ? clean[slugField] : null;
      const href = renderLinkPattern(pattern, {
        documentId: row.documentId,
        locale: localized ? (typeof row.locale === 'string' ? row.locale : locale) || null : null,
        slug,
        collection: contentType.info?.pluralName || '',
        singular: contentType.info?.singularName || '',
      });
      for (const ref of refs) {
        if (ref.documentId !== row.documentId) continue;
        const key = entryKey(ref.kind, uid, ref.locale, row.documentId);
        if (ref.kind === 'link') {
          // The title (sanitised row) is used for mentions; plain links keep their authored text.
          if (href) results.set(key, { href, title: titleOf(contentType, clean, null) });
          continue;
        }
        const definition = definitions.get(ref.blockType) || { titleField: null, displayFields: [] };
        const entry = {};
        const names = [...definition.displayFields, ...(ref.storedFields || [])]
          .filter((name) => FIELD_NAME.test(name) && contentType.attributes?.[name])
          .slice(0, MAX_DISPLAY_FIELDS);
        for (const name of names) if (SCALAR.has(typeof clean[name])) entry[name] = clean[name];
        if (clean.id !== undefined) entry.id = clean.id;
        entry.documentId = row.documentId;
        entry.title = titleOf(contentType, clean, definition.titleField);
        if (href) entry.href = href;
        results.set(key, { entry });
      }
    }
  };

  /**
   * Resolves Media Library references.
   * @param {Array<object>} refs - Media references.
   * @param {object} input - `{ auth, cache, results }`.
   * @returns {Promise<void>}
   */
  const resolveMedia = async (refs, { auth, cache, results }) => {
    if (!refs.length || !(await can(auth, UPLOAD_SCOPE, cache))) return;
    const model = strapi.getModel(UPLOAD_UID);
    if (!model) return;
    const ids = refs.filter((ref) => ref.id !== undefined).map((ref) => ref.id);
    const documentIds = refs.filter((ref) => ref.documentId !== undefined).map((ref) => ref.documentId);
    const or = [];
    if (ids.length) or.push({ id: { $in: ids } });
    if (documentIds.length) or.push({ documentId: { $in: documentIds } });
    const rows = await strapi.db.query(UPLOAD_UID).findMany({ where: { $or: or }, limit: refs.length });
    for (const row of rows || []) {
      const clean = (await strapi.contentAPI.sanitize.output(row, model, { auth })) || {};
      if (typeof clean.url !== 'string') continue;
      const file = {
        url: clean.url,
        alt: typeof clean.alternativeText === 'string' ? clean.alternativeText : null,
        name: clean.name,
        mime: clean.mime,
        ext: clean.ext,
        hash: clean.hash,
        width: clean.width,
        height: clean.height,
        size: clean.size,
        formats: isPlainObject(clean.formats) ? clean.formats : null,
      };
      if (row.id !== undefined) results.set(`media|id|${row.id}`, { file });
      if (typeof row.documentId === 'string') results.set(`media|doc|${row.documentId}`, { file });
    }
  };

  /**
   * Resolves references with the caller's permissions.
   * @param {Map<string, object>} refs - References by key (from `collectReferences`).
   * @param {{ auth?: object, status?: 'draft'|'published', limits?: { maxReferences?: number, timeoutMs?: number } }} options - Caller auth, publication status and (tests) tighter limits.
   * @returns {Promise<Map<string, object>>} Results by key; unresolved keys are absent.
   */
  const resolve = async (refs, options = {}) => {
    const results = new Map();
    if (!refs || !refs.size) return results;
    const limits = options.limits || {};
    const maxReferences = Math.min(limits.maxReferences || LIMITS.maxReferences, LIMITS.maxReferences);
    const timeoutMs = Math.min(limits.timeoutMs || LIMITS.timeoutMs, LIMITS.timeoutMs);
    const status = options.status === 'draft' ? 'draft' : 'published';
    const auth = options.auth;
    const list = [...refs.values()].slice(0, maxReferences);
    if (refs.size > maxReferences)
      logger.debug(`output: ${refs.size - maxReferences} references over the limit were not resolved`);

    const work = async () => {
      const cache = new Map();
      const groups = new Map();
      const media = [];
      const blockTypes = new Set();
      for (const ref of list) {
        if (ref.kind === 'media') {
          media.push(ref);
          continue;
        }
        // One query per type and locale; types without i18n ignore the locale.
        const contentType = strapi.contentType(ref.uid);
        const locale = contentType && isLocalized(contentType) ? ref.locale || null : null;
        const groupKey = `${ref.uid}|${locale || ''}`;
        if (!groups.has(groupKey)) groups.set(groupKey, { uid: ref.uid, locale, refs: [] });
        groups.get(groupKey).refs.push(ref);
        if (ref.kind === 'entry' && ref.blockType) blockTypes.add(ref.blockType);
      }
      const definitions = await definitionsFor(blockTypes);
      const pattern = strapi.config.get('plugin::magic-editor-x.links.urlPattern') || '';
      const input = { auth, status, cache, definitions, results, pattern };
      await Promise.all([
        ...[...groups.values()].map((group) => resolveGroup(group, input)),
        resolveMedia(media, input),
      ]);
    };

    let timer;
    const timeout = new Promise((resolveTimeout) => {
      timer = setTimeout(() => resolveTimeout('timeout'), timeoutMs);
    });
    try {
      const outcome = await Promise.race([work().then(() => 'done'), timeout]);
      if (outcome === 'timeout') {
        logger.warn(
          `output: reference lookup timed out after ${timeoutMs} ms; ${list.length} left unresolved`
        );
        return new Map();
      }
    } finally {
      clearTimeout(timer);
    }
    return results;
  };

  /**
   * Collects the references of several values (one batch for a whole response).
   * @param {Array<{ value: unknown, locale?: string|null }>} items - Values with the locale of their entry.
   * @returns {{ prepared: Array<{ data: object|null, locale: string|null }>, refs: Map<string, object> }} Prepared values and references.
   */
  const collect = (items) => {
    const refs = new Map();
    const prepared = items.map(({ value, locale }) => {
      const { data, refs: own } = collectReferences(value, { locale });
      for (const [key, ref] of own) {
        const merged = refs.get(key) || { ...ref, storedFields: [] };
        if (ref.kind === 'entry') {
          // The keys of the stored summary are display-field candidates too (the custom block may be gone).
          for (const block of data.blocks) {
            if (block.type !== ref.blockType || block.data?.entry?.documentId !== ref.documentId) continue;
            for (const name of Object.keys(block.data.entry))
              if (!STORED_SYSTEM_KEYS.has(name) && !merged.storedFields.includes(name))
                merged.storedFields.push(name);
          }
          merged.storedFields = merged.storedFields.slice(0, MAX_DISPLAY_FIELDS);
        }
        refs.set(key, merged);
      }
      return { data, locale: locale || null };
    });
    return { prepared, refs };
  };

  /**
   * Expands the synced blocks of several values (one source query for all).
   * @param {Array<{ value: unknown, options?: object }>} items - Values with their field options (preset).
   * @returns {Promise<Array<{ value: unknown, origins: Map<string, string> }>>} Expanded values; `origins` maps copied block ids to their source.
   */
  const expandAll = async (items) => {
    const datas = items.map((item) => {
      const data = normalizeEditorDataSafe(item.value);
      return data && containsSynced(data.blocks) ? data : null;
    });
    if (!datas.some(Boolean)) return items.map((item) => ({ value: item.value, origins: new Map() }));
    const wanted = [];
    for (const data of datas)
      for (const ref of data ? syncedRefsOf(data) : [])
        if (!wanted.includes(ref) && wanted.length < SYNCED_LIMITS.refsPerResponse) wanted.push(ref);
    const stored = await strapi.plugin('magic-editor-x').service('templates').syncedSources(wanted);
    const rawHtml = strapi.config.get('plugin::magic-editor-x.rawHtml') || 'sanitize';
    const cleaned = new Map();
    const cleanSource = (ref, inlineTags) => {
      const key = `${ref}|${inlineTags ? inlineTags.join(',') : '*'}`;
      if (!cleaned.has(key)) {
        let clean;
        try {
          clean = stored.has(ref) ? cleanEditorValue(stored.get(ref), { rawHtml, inlineTags }) : null;
        } catch {
          clean = null;
        }
        cleaned.set(key, clean);
      }
      return cleaned.get(key);
    };
    let unresolved = 0;
    const out = items.map((item, index) => {
      const data = datas[index];
      if (!data) return { value: item.value, origins: new Map() };
      const preset = resolveFieldPreset(item.options);
      const inlineTags = allowedInlineTags(preset);
      const result = expandSynced(data, (ref) => cleanSource(ref, inlineTags), {
        filter: (blocks) => filterSyncedForField(blocks, preset).blocks,
      });
      unresolved += result.unresolved;
      return { value: result.data, origins: result.origins };
    });
    if (unresolved) logger.debug(`output: ${unresolved} synced blocks expanded to nothing`);
    return out;
  };

  /**
   * Transforms values for output: expands synced blocks, resolves references
   * once for all values, then renders each.
   * @param {Array<{ value: unknown, locale?: string|null, format?: 'html'|'text'|'markdown'|'json', options?: object }>} items - Values (an item's `format` wins over `options.format`; `options` are the field options, for the preset of synced content).
   * @param {{ format?: 'html'|'text'|'markdown'|'json', auth?: object, status?: 'draft'|'published', limits?: object }} options - Output options.
   * @returns {Promise<Array<object|string|null>>} Output per item.
   */
  const transform = async (items, { format = 'json', auth, status, limits } = {}) => {
    const expanded = await expandAll(items);
    const { prepared, refs } = collect(
      expanded.map((entry, index) => ({ value: entry.value, locale: items[index].locale }))
    );
    const results = await resolve(refs, { auth, status, limits });
    return prepared.map(({ data, locale }, index) => {
      const outputFormat = items[index].format || format;
      const applied = applyReferences(data, results, { locale });
      const { origins } = expanded[index];
      // JSON output marks copied blocks with the source they come from.
      if (outputFormat === 'json' && applied && origins.size)
        applied.blocks = applied.blocks.map((block) =>
          origins.has(block.id) ? { ...block, syncedFrom: origins.get(block.id) } : block
        );
      return renderResolved(applied, outputFormat);
    });
  };

  return { LIMITS, resolve, collect, expandAll, transform };
};
