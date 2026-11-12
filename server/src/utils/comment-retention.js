'use strict';

const { createLogger } = require('./logger');

/**
 * Retention of block comments (2.3).
 *
 * - Entry deleted: a Document Service middleware on `delete` removes the
 *   comments of every document locale the call deleted (`result.entries`),
 *   after the delete succeeded. It covers the Content Manager (also bulk
 *   delete), the Content API and scripts that use the Document Service.
 * - Admin user deleted: a database lifecycle on `admin::user` (`afterDelete`,
 *   which both `deleteById` and `deleteByIds` of the admin user service fire
 *   per user) clears the author id and name snapshot and the "resolved by"
 *   snapshot. The comment text stays and is shown as written by a deleted user.
 *
 * Failures are logged without ids or content and never block the delete.
 */

const unsubscribers = new WeakMap();

/**
 * Locales of the entries a Document Service `delete` removed.
 * @param {unknown} result - Return value of `documents(uid).delete()`.
 * @returns {Array<string|null>} Distinct locales (null for types without i18n).
 */
const deletedLocales = (result) => {
  const entries = result && Array.isArray(result.entries) ? result.entries : [];
  const locales = new Set();
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') continue;
    locales.add(typeof entry.locale === 'string' && entry.locale ? entry.locale : null);
  }
  return Array.from(locales);
};

/**
 * Registers the Document Service middleware (call in register).
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi.
 */
const registerCommentRetention = (strapi) => {
  const logger = createLogger(strapi);
  strapi.documents.use(async (ctx, next) => {
    const result = await next();
    if (ctx.action !== 'delete' || typeof ctx.uid !== 'string' || !ctx.uid.startsWith('api::')) return result;
    const documentId = (result && result.documentId) || (ctx.params && ctx.params.documentId);
    const locales = deletedLocales(result);
    if (typeof documentId !== 'string' || locales.length === 0) return result;
    try {
      await strapi
        .plugin('magic-editor-x')
        .service('comments')
        .removeForEntries(ctx.uid, documentId, locales);
    } catch (error) {
      logger.error('comments of a deleted entry could not be removed', error);
    }
    return result;
  });
};

/**
 * Subscribes the admin-user cleanup (call in bootstrap).
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi.
 */
const subscribeCommentAuthorCleanup = (strapi) => {
  const logger = createLogger(strapi);
  const onDelete = async (event) => {
    const id = event && event.result && event.result.id;
    if (id == null) return;
    try {
      await strapi.plugin('magic-editor-x').service('comments').anonymizeUser(id);
    } catch (error) {
      logger.error('comment authors of a deleted admin could not be anonymised', error);
    }
  };
  const unsubscribe = strapi.db.lifecycles.subscribe({ models: ['admin::user'], afterDelete: onDelete });
  if (typeof unsubscribe === 'function') unsubscribers.set(strapi, unsubscribe);
};

/**
 * Removes the lifecycle subscription (call in destroy).
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi.
 */
const unsubscribeCommentAuthorCleanup = (strapi) => {
  const unsubscribe = unsubscribers.get(strapi);
  if (unsubscribe) unsubscribe();
  unsubscribers.delete(strapi);
};

module.exports = {
  deletedLocales,
  registerCommentRetention,
  subscribeCommentAuthorCleanup,
  unsubscribeCommentAuthorCleanup,
};
