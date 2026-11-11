'use strict';

const { randomUUID } = require('node:crypto');
const { errors } = require('@strapi/utils');
const { cleanEditorValue } = require('../utils/sanitizer');
const { sha256 } = require('../utils/crypto');
const { stableStringify } = require('../../../shared/ydoc.mjs');
const { computeStats } = require('../../../shared/editor-data.mjs');

/**
 * Version history of Magic Editor X fields.
 *
 * A snapshot stores sanitised Editor.js JSON for one field of one document
 * locale. Restoring is done in the editor: the admin loads a snapshot, it
 * replaces the editor content, and the normal Content Manager save stores it
 * (so drafts, review workflows and permissions apply as usual).
 *
 * Exactly-once: version numbers are assigned under a short database lease per
 * field, identical content is not stored twice in a row, and automatic
 * snapshots during live sessions are keyed per room and time bucket by the
 * collaboration service.
 */

const UID = 'plugin::magic-editor-x.document-snapshot';
const PROCESS_ID = randomUUID();

/**
 * Builds the room / history key of a field.
 * @param {{ uid: string, documentId: string, locale?: string|null, field: string }} target - Field.
 * @returns {string} Key.
 */
const fieldKey = ({ uid, documentId, locale, field }) => `${uid}|${documentId}|${locale || '-'}|${field}`;

/**
 * Hash of normalised content (key order independent).
 * @param {object|null} content - Editor data.
 * @returns {string} Hex hash.
 */
const contentHash = (content) => sha256(stableStringify(content ? content.blocks : []));

module.exports = ({ strapi }) => {
  const query = () => strapi.db.query(UID);
  const store = () => strapi.plugin('magic-editor-x').service('store');
  const maxPerField = () =>
    Number(strapi.config.get('plugin::magic-editor-x.history.maxSnapshotsPerField')) || 50;
  const rawHtml = () => strapi.config.get('plugin::magic-editor-x.rawHtml') || 'sanitize';

  const whereTarget = ({ uid, documentId, locale, field }) => ({
    contentType: uid,
    entryId: documentId,
    fieldName: field,
    $or: [{ entryLocale: locale || null }, { entryLocale: null }],
  });

  const userName = (user) => {
    if (!user) return null;
    const name = [user.firstname, user.lastname].filter(Boolean).join(' ').trim();
    return name || user.username || null;
  };

  const toDto = (row, withContent = false) => {
    const dto = {
      id: row.documentId,
      version: row.version,
      trigger: row.trigger || 'manual',
      createdAt: row.createdAt,
      createdBy: userName(row.createdBy),
      stats: computeStats(row.jsonContent),
      restorable: Boolean(row.jsonContent && Array.isArray(row.jsonContent.blocks)),
    };
    if (withContent) dto.content = row.jsonContent;
    return dto;
  };

  return {
    fieldKey,
    contentHash,

    /**
     * Lists snapshots of one field (newest first).
     * @param {{ uid: string, documentId: string, locale?: string|null, field: string }} target - Field.
     * @returns {Promise<object[]>} Snapshots without content.
     */
    async list(target) {
      const rows = await query().findMany({
        where: whereTarget(target),
        orderBy: [{ version: 'desc' }, { id: 'desc' }],
        limit: maxPerField(),
        populate: { createdBy: { select: ['firstname', 'lastname', 'username'] } },
      });
      return rows.map((row) => toDto(row));
    },

    /**
     * Loads one snapshot with its content and its target (for the access check).
     * @param {string} documentId - Snapshot id.
     * @returns {Promise<{ target: object, snapshot: object }>} Snapshot.
     * @throws {errors.NotFoundError} When it does not exist.
     */
    async findOne(documentId) {
      if (typeof documentId !== 'string' || !/^[a-z0-9]{1,64}$/.test(documentId))
        throw new errors.NotFoundError('Not found');
      const row = await query().findOne({
        where: { documentId },
        populate: { createdBy: { select: ['firstname', 'lastname', 'username'] } },
      });
      if (!row) throw new errors.NotFoundError('Not found');
      return {
        target: {
          uid: row.contentType,
          documentId: row.entryId,
          locale: row.entryLocale || null,
          field: row.fieldName,
        },
        snapshot: toDto(row, true),
      };
    },

    /**
     * Creates a snapshot unless the latest one already has the same content.
     * @param {{ uid: string, documentId: string, locale?: string|null, field: string }} target - Field.
     * @param {unknown} content - Editor data (any stored shape).
     * @param {{ trigger?: 'manual'|'auto'|'restore', userId?: number|null }} [options] - Metadata.
     * @returns {Promise<{ created: boolean, snapshot: object }>} Result.
     * @throws {errors.ValidationError} When the content is not editor data.
     */
    async create(target, content, options = {}) {
      let clean;
      try {
        clean = cleanEditorValue(content, { rawHtml: rawHtml() });
      } catch {
        throw new errors.ValidationError('The content is not valid editor data');
      }
      if (!clean) clean = { time: Date.now(), blocks: [], version: '2.31.7' };
      const hash = contentHash(clean);
      const key = `snapver:${fieldKey(target)}`.slice(0, 255);
      let acquired = false;
      for (let attempt = 0; attempt < 50 && !acquired; attempt += 1) {
        acquired = await store().acquire(key, PROCESS_ID, 5000);
        if (!acquired) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      if (!acquired) throw new errors.ApplicationError('Version history is busy. Try again.');
      try {
        const [latest] = await query().findMany({
          where: whereTarget(target),
          orderBy: [{ version: 'desc' }, { id: 'desc' }],
          limit: 1,
          populate: { createdBy: { select: ['firstname', 'lastname', 'username'] } },
        });
        if (latest && latest.contentHash === hash) return { created: false, snapshot: toDto(latest) };
        const row = await query().create({
          data: {
            roomId: fieldKey(target),
            contentType: target.uid,
            entryId: target.documentId,
            entryLocale: target.locale || null,
            fieldName: target.field,
            version: (Number(latest?.version) || 0) + 1,
            trigger: options.trigger || 'manual',
            contentHash: hash,
            jsonContent: clean,
            createdBy: options.userId || null,
          },
          populate: { createdBy: { select: ['firstname', 'lastname', 'username'] } },
        });
        await this.prune(target);
        return { created: true, snapshot: toDto(row) };
      } finally {
        await store().release(key, PROCESS_ID);
      }
    },

    /**
     * Removes snapshots beyond the configured maximum (oldest first).
     * @param {object} target - Field.
     * @returns {Promise<number>} Removed rows.
     */
    async prune(target) {
      const rows = await query().findMany({
        where: whereTarget(target),
        orderBy: [{ version: 'desc' }, { id: 'desc' }],
        select: ['id'],
        offset: maxPerField(),
        limit: 500,
      });
      if (rows.length === 0) return 0;
      await query().deleteMany({ where: { id: { $in: rows.map((row) => row.id) } } });
      return rows.length;
    },
  };
};

module.exports.fieldKey = fieldKey;
module.exports.contentHash = contentHash;
