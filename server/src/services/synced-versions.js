'use strict';

const { randomUUID } = require('node:crypto');
const { errors } = require('@strapi/utils');
const { sha256 } = require('../utils/crypto');
const { normalizeLabel } = require('./history');
const { displayName } = require('./templates');
const { stableStringify } = require('../../../shared/ydoc.mjs');

/**
 * Version history of synced block sources (2.4).
 *
 * Storage: rows of the existing `plugin::magic-editor-x.document-snapshot`
 * content type (table `magic_editor_doc_snapshots`) with
 * `contentType: 'plugin::magic-editor-x.template'`, `entryId: <source
 * documentId>`, `entryLocale: null`, `fieldName: 'blocks'` and `roomId`
 * `plugin::magic-editor-x.template|<id>|-|blocks`. Chosen over a new table
 * because versions of a source are the same thing as versions of a field
 * (numbered Editor.js documents with a hash, a trigger, a label and the same
 * per-field limit `history.maxSnapshotsPerField`), and the version lease
 * (`snapver:<roomId>`), numbering and pruning work the same way. The field
 * history routes never return these rows: `GET /history/:id` checks the
 * row's target with `services/access.js` `checkField`, which answers 404 for
 * every non-`api::` type.
 *
 * A version stores the clean blocks, the source name (`sourceName`), the
 * author as id + name snapshot (`authorId`, `authorName`; the id is never
 * returned and both are cleared when the admin is deleted), the time and a
 * number. A save identical to the latest version (same name and blocks) is
 * not stored. Deleting a source deletes its versions.
 */

const SNAPSHOT_UID = 'plugin::magic-editor-x.document-snapshot';
const TEMPLATE_UID = 'plugin::magic-editor-x.template';
const FIELD = 'blocks';
const ID_PATTERN = /^[a-z0-9]{1,64}$/;
const PROCESS_ID = randomUUID();

const notFound = () => new errors.NotFoundError('Not found');

/**
 * Room / version key of a source.
 * @param {string} documentId - Source documentId.
 * @returns {string} Key.
 */
const sourceKey = (documentId) => `${TEMPLATE_UID}|${documentId}|-|${FIELD}`;

/**
 * Hash of what a version holds (name and blocks, key order independent).
 * @param {string} name - Source name.
 * @param {{ blocks?: unknown[] }|null} blocks - Editor.js document.
 * @returns {string} Hex hash.
 */
const versionHash = (name, blocks) =>
  sha256(stableStringify([String(name || ''), blocks && Array.isArray(blocks.blocks) ? blocks.blocks : []]));

module.exports = ({ strapi }) => {
  const query = () => strapi.db.query(SNAPSHOT_UID);
  const store = () => strapi.plugin('magic-editor-x').service('store');
  const maxPerSource = () =>
    Number(strapi.config.get('plugin::magic-editor-x.history.maxSnapshotsPerField')) || 50;
  const where = (documentId) => ({ contentType: TEMPLATE_UID, entryId: documentId, fieldName: FIELD });

  const toDto = (row, withContent = false) => {
    const blocks =
      row.jsonContent && Array.isArray(row.jsonContent.blocks)
        ? row.jsonContent
        : { time: 0, version: '2.31.7', blocks: [] };
    const dto = {
      id: row.documentId,
      version: row.version,
      trigger: row.trigger || 'manual',
      label: typeof row.label === 'string' && row.label ? row.label : null,
      name: row.sourceName || '',
      createdAt: row.createdAt,
      createdBy: row.authorName ? { name: row.authorName } : null,
      blockCount: blocks.blocks.length,
    };
    if (withContent) dto.content = blocks;
    return dto;
  };

  const findVersionRow = async (sourceId, versionId) => {
    if (!ID_PATTERN.test(String(sourceId)) || !ID_PATTERN.test(String(versionId))) throw notFound();
    const row = await query().findOne({ where: { ...where(sourceId), documentId: versionId } });
    if (!row) throw notFound();
    return row;
  };

  const api = {
    TEMPLATE_UID,
    sourceKey,
    versionHash,

    /**
     * Stores a version of a synced source unless the latest one is identical.
     * @param {{ documentId: string, name: string, blocks: object }} source - Saved source (clean blocks).
     * @param {object|null} user - Admin user (name snapshot).
     * @param {'manual'|'restore'} [trigger='manual'] - Why.
     * @returns {Promise<{ created: boolean, version: object|null }>} Result.
     */
    async record(source, user, trigger = 'manual') {
      const key = `snapver:${sourceKey(source.documentId)}`.slice(0, 255);
      const hash = versionHash(source.name, source.blocks);
      let acquired = false;
      for (let attempt = 0; attempt < 50 && !acquired; attempt += 1) {
        acquired = await store().acquire(key, PROCESS_ID, 5000);
        if (!acquired) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!acquired) throw new errors.ApplicationError('Version history is busy. Try again.');
      try {
        const [latest] = await query().findMany({
          where: where(source.documentId),
          orderBy: [{ version: 'desc' }, { id: 'desc' }],
          limit: 1,
        });
        if (latest && latest.contentHash === hash) return { created: false, version: toDto(latest) };
        const row = await query().create({
          data: {
            roomId: sourceKey(source.documentId),
            contentType: TEMPLATE_UID,
            entryId: source.documentId,
            entryLocale: null,
            fieldName: FIELD,
            version: (Number(latest?.version) || 0) + 1,
            trigger,
            contentHash: hash,
            jsonContent: source.blocks,
            sourceName: String(source.name || '').slice(0, 100),
            authorId: user && Number.isInteger(user.id) ? user.id : null,
            authorName: displayName(user),
          },
        });
        await api.prune(source.documentId);
        return { created: true, version: toDto(row) };
      } finally {
        await store().release(key, PROCESS_ID);
      }
    },

    /**
     * Versions of a source, newest first, without content.
     * @param {string} sourceId - Source documentId (the caller checked the kind).
     * @returns {Promise<object[]>} Versions.
     */
    async list(sourceId) {
      const rows = await query().findMany({
        where: where(sourceId),
        orderBy: [{ version: 'desc' }, { id: 'desc' }],
        limit: maxPerSource(),
      });
      return rows.map((row) => toDto(row));
    },

    /**
     * One version with its blocks.
     * @param {string} sourceId - Source documentId.
     * @param {string} versionId - Version documentId.
     * @returns {Promise<object>} Version.
     * @throws {errors.NotFoundError} When it is not a version of that source.
     */
    async findOne(sourceId, versionId) {
      return toDto(await findVersionRow(sourceId, versionId), true);
    },

    /**
     * Names or renames a version ('' or null removes the name).
     * @param {string} sourceId - Source documentId.
     * @param {string} versionId - Version documentId.
     * @param {string|null} label - Name.
     * @returns {Promise<object>} Version without content.
     */
    async rename(sourceId, versionId, label) {
      const row = await findVersionRow(sourceId, versionId);
      const updated = await query().update({ where: { id: row.id }, data: { label: normalizeLabel(label) } });
      return toDto(updated || { ...row, label: normalizeLabel(label) });
    },

    /**
     * Removes versions beyond the limit (oldest first).
     * @param {string} sourceId - Source documentId.
     * @returns {Promise<number>} Removed rows.
     */
    async prune(sourceId) {
      const rows = await query().findMany({
        where: where(sourceId),
        orderBy: [{ version: 'desc' }, { id: 'desc' }],
        select: ['id'],
        offset: maxPerSource(),
        limit: 500,
      });
      if (rows.length === 0) return 0;
      await query().deleteMany({ where: { id: { $in: rows.map((row) => row.id) } } });
      return rows.length;
    },

    /**
     * Deletes every version of a source (the source was deleted).
     * @param {string} sourceId - Source documentId.
     * @returns {Promise<number>} Removed rows.
     */
    async removeAll(sourceId) {
      const result = await query().deleteMany({ where: where(sourceId) });
      return Number(result && result.count) || 0;
    },

    /**
     * Clears the author of a deleted admin user.
     * @param {number} userId - Admin id.
     * @returns {Promise<void>}
     */
    async anonymizeUser(userId) {
      if (!Number.isInteger(Number(userId))) return;
      await query().updateMany({
        where: { contentType: TEMPLATE_UID, authorId: Number(userId) },
        data: { authorId: null, authorName: null },
      });
    },
  };
  return api;
};

module.exports.sourceKey = sourceKey;
module.exports.versionHash = versionHash;
