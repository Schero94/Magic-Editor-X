'use strict';

const { createLogger } = require('./logger');
const { isEditorAttribute, schemaHasEditorFields } = require('./editor-fields');
const { guardQuery, collectGuarded } = require('./publish-guard');
const { fieldChanges, fieldIdentity } = require('../../../shared/audit.mjs');

/**
 * Audit trail of Magic Editor X fields (2.4): a Document Service middleware
 * that reads the editor fields of the affected document versions before and
 * after `create`, `update`, `publish`, `unpublish`, `discardDraft` and
 * `delete`, and records one `entry.<action>` event per changed field with
 * counts and block ids (`shared/audit.mjs` `fieldChanges`: id + fingerprint
 * comparison, linear in the number of blocks; no word diff, no content).
 *
 * Covers the Content Manager, the Content API and scripts that use the
 * Document Service. Writes around it (raw SQL, `db.query`) are not recorded.
 * The extra reads only fetch editor fields (`fields` + `populate` of the
 * components and zones that contain them). A failure is logged without data
 * and never blocks the write.
 */

/** Which version is read before and after each action (`dp`: Draft & Publish). */
const PLANS = Object.freeze({
  create: { event: 'entry.create', before: null, after: (dp) => (dp ? 'draft' : 'published') },
  update: {
    event: 'entry.update',
    before: (dp) => (dp ? 'draft' : 'published'),
    after: (dp) => (dp ? 'draft' : 'published'),
  },
  publish: { event: 'entry.publish', before: () => 'published', after: () => 'published', dpOnly: true },
  unpublish: { event: 'entry.unpublish', before: () => 'published', after: null, dpOnly: true },
  discardDraft: { event: 'entry.discard', before: () => 'draft', after: () => 'draft', dpOnly: true },
  delete: { event: 'entry.delete', before: (dp) => (dp ? 'draft' : 'published'), after: null },
});

/**
 * Locales to read for a Document Service `locale` parameter.
 * @param {unknown} locale - Parameter (string, '*', array or undefined).
 * @returns {Array<string|undefined>} Locale arguments.
 */
const localeArgs = (locale) => {
  if (Array.isArray(locale)) return locale.filter((item) => typeof item === 'string').slice(0, 50);
  return [typeof locale === 'string' ? locale : undefined];
};

/**
 * Registers the middleware (call in register).
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi.
 */
const registerAuditTrail = (strapi) => {
  const logger = createLogger(strapi);
  const schemaCache = new Map();
  const queries = new Map();

  /**
   * Editor field values of one document by `<locale>\u0000<field identity>`.
   * @param {object} contentType - Schema.
   * @param {{ fields: string[], populate: object }} query - Editor field query.
   * @param {string} documentId - Document.
   * @param {unknown} locale - Locale parameter.
   * @param {'draft'|'published'} status - Version.
   * @returns {Promise<Map<string, { locale: string|null, field: string, value: unknown }>>} Values.
   */
  const readValues = async (contentType, query, documentId, locale, status) => {
    const localized = Boolean(contentType.pluginOptions?.i18n?.localized);
    const out = new Map();
    for (const item of localized ? localeArgs(locale) : [undefined]) {
      const rows = await strapi.documents(contentType.uid).findMany({
        filters: { documentId },
        status,
        ...(item ? { locale: item } : {}),
        fields: [...new Set([...query.fields, 'documentId', ...(localized ? ['locale'] : [])])],
        ...(Object.keys(query.populate).length ? { populate: query.populate } : {}),
      });
      for (const row of Array.isArray(rows) ? rows : []) {
        const rowLocale = localized && typeof row.locale === 'string' ? row.locale : null;
        for (const { field, value } of collectGuarded(
          strapi,
          contentType,
          row,
          '',
          [],
          0,
          isEditorAttribute
        )) {
          const identity = fieldIdentity(field, value);
          out.set(`${rowLocale || ''}\u0000${identity}`, { locale: rowLocale, field: identity, value });
        }
      }
    }
    return out;
  };

  strapi.documents.use(async (ctx, next) => {
    const plan = PLANS[ctx.action];
    if (!plan || typeof ctx.uid !== 'string' || !ctx.uid.startsWith('api::')) return next();
    const audit = strapi.plugin('magic-editor-x').service('audit');
    if (!audit.enabled()) return next();
    const contentType = ctx.contentType || strapi.contentType(ctx.uid);
    if (!contentType || !schemaHasEditorFields(strapi, contentType, schemaCache)) return next();
    const dp = contentType.options?.draftAndPublish === true;
    if (plan.dpOnly && !dp) return next();
    if (!queries.has(contentType.uid))
      queries.set(contentType.uid, guardQuery(strapi, contentType, 0, isEditorAttribute));
    const query = queries.get(contentType.uid);
    if (!query) return next();
    const params = ctx.params || {};

    let before = new Map();
    let usable = true;
    if (plan.before && typeof params.documentId === 'string') {
      try {
        before = await readValues(contentType, query, params.documentId, params.locale, plan.before(dp));
      } catch (error) {
        usable = false;
        logger.warn('audit trail could not read the previous version', { code: error && error.code });
      }
    }

    const result = await next();
    if (!usable) return result;

    try {
      const documentId =
        typeof params.documentId === 'string' ? params.documentId : result && result.documentId;
      if (typeof documentId !== 'string') return result;
      let after = new Map();
      if (plan.after) {
        const locale =
          params.locale !== undefined ? params.locale : result && result.locale ? result.locale : undefined;
        after = await readValues(contentType, query, documentId, locale, plan.after(dp));
      }
      const events = [];
      for (const key of new Set([...before.keys(), ...after.keys()])) {
        const was = before.get(key);
        const now = after.get(key);
        const summary = fieldChanges(was ? was.value : null, now ? now.value : null);
        if (!summary.changed) continue;
        const entry = now || was;
        events.push({
          event: plan.event,
          target: { uid: contentType.uid, documentId, locale: entry.locale, field: entry.field },
          counts: summary.counts,
          blockIds: summary.blockIds,
        });
      }
      if (events.length) await audit.recordMany(events);
    } catch (error) {
      logger.warn('audit trail could not record a change', { code: error && error.code });
    }
    return result;
  });
};

const unsubscribers = new WeakMap();

/**
 * Subscribes the admin-user cleanup (call in bootstrap): when an admin user
 * is deleted, the audit trail keeps their events without id and name, and
 * synced source versions lose the author name snapshot (like comments).
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi.
 */
const subscribeAuditActorCleanup = (strapi) => {
  const logger = createLogger(strapi);
  const onDelete = async (event) => {
    const id = event && event.result && event.result.id;
    if (id == null) return;
    const plugin = strapi.plugin('magic-editor-x');
    try {
      await plugin.service('audit').anonymizeUser(id);
      await plugin.service('synced-versions').anonymizeUser(id);
    } catch (error) {
      logger.error('audit actors of a deleted admin could not be anonymised', { code: error && error.code });
    }
  };
  const unsubscribe = strapi.db.lifecycles.subscribe({ models: ['admin::user'], afterDelete: onDelete });
  if (typeof unsubscribe === 'function') unsubscribers.set(strapi, unsubscribe);
};

/**
 * Removes the subscription (call in destroy).
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi.
 */
const unsubscribeAuditActorCleanup = (strapi) => {
  const unsubscribe = unsubscribers.get(strapi);
  if (unsubscribe) unsubscribe();
  unsubscribers.delete(strapi);
};

module.exports = {
  registerAuditTrail,
  subscribeAuditActorCleanup,
  unsubscribeAuditActorCleanup,
  PLANS,
  localeArgs,
};
