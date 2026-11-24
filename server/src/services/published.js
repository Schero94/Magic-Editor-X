'use strict';

const { pathQuery, collectAt, describeEntries } = require('../utils/field-identity');
const { normalizeEditorDataSafe } = require('../../../shared/editor-data.mjs');

/**
 * "Changes since last publish" (2.11): reads one Magic Editor X field of the
 * published version of a document with the Document Service, so the editor
 * can mark what changed in the draft since the last publish.
 *
 * Access is checked before this service runs (`access.checkField`: Content
 * Manager read on the type, field and draft). The published version is read
 * with the same permission query (conditions such as "is creator" and locale
 * permissions), so a published version the caller may not read counts as
 * not published.
 */
module.exports = ({ strapi }) => ({
  /**
   * Whether the content type uses Draft & Publish.
   * @param {string} uid - Content type uid.
   * @returns {boolean} True for Draft & Publish types.
   */
  hasDraftAndPublish(uid) {
    const contentType = strapi.contentType(uid);
    return Boolean(contentType && contentType.options && contentType.options.draftAndPublish === true);
  },

  /**
   * Reads the published value of one editor field.
   * @param {{ userAbility: object, uid: string, documentId: string, locale: string|null, field: string,
   *   fieldKey: string|null, positional: boolean, basePath: string }} target - Field, resolved by `access.checkField`.
   * @param {{ content?: boolean }} [options] - `content: false` answers whether a published version exists only.
   * @returns {Promise<{ published: boolean, publishedAt: string|null, content: object|null }>}
   *   `content` is the normalised field value (null when the field is empty or the entry of a
   *   repeatable component or dynamic zone did not exist when it was published).
   */
  async read(target, { content = true } = {}) {
    const { userAbility, uid, documentId, locale, field, fieldKey, positional, basePath } = target;
    const contentType = strapi.contentType(uid);
    const parts = String(basePath || field).split('.');
    const query = contentType ? pathQuery(strapi, contentType, parts) : null;
    if (!query) return { published: false, publishedAt: null, content: null };
    const checker = strapi
      .plugin('content-manager')
      .service('permission-checker')
      .create({ userAbility, model: uid });
    const permission = await checker.sanitizedQuery.read({});
    const filters =
      permission && permission.filters ? { $and: [{ documentId }, permission.filters] } : { documentId };
    const document = await strapi.documents(uid).findFirst({
      filters,
      locale: locale || undefined,
      status: 'published',
      fields: content ? ['documentId', 'publishedAt', ...query.fields] : ['documentId', 'publishedAt'],
      ...(content ? { populate: query.populate } : {}),
    });
    if (!document) return { published: false, publishedAt: null, content: null };
    const publishedAt = document.publishedAt ? new Date(document.publishedAt).toISOString() : null;
    if (!content) return { published: true, publishedAt, content: null };
    const items = collectAt(document, parts);
    let item;
    if (positional) {
      const entries = describeEntries(items);
      item = fieldKey
        ? entries.find((candidate) => candidate.fieldKey === fieldKey)
        : entries.find((candidate) => candidate.path === field);
    } else item = items.find((candidate) => candidate.path === field) || items[0];
    const value = item ? item.value : null;
    return { published: true, publishedAt, content: normalizeEditorDataSafe(value) };
  },
});
