'use strict';

const { randomUUID } = require('node:crypto');
const { errors } = require('@strapi/utils');
const { cleanEditorValue } = require('../utils/sanitizer');
const { sha256 } = require('../utils/crypto');
const { recordAudit } = require('../utils/audit-record');
const { stableStringify } = require('../../../shared/ydoc.mjs');
const { comparableBlocks } = require('../../../shared/default-tunes.mjs');
const { computeStats } = require('../../../shared/editor-data.mjs');
const {
  parseFieldIdentity,
  basePathOf,
  blockIdsOf,
  ownerOfBlocks,
  fieldIdentity,
} = require('../../../shared/field-identity.mjs');

/** Legacy rows read per batch / at most per call when mapping positional rows (2.4). */
const LEGACY_BATCH = 50;
const LEGACY_MAX = 2000;

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
 * Hash of normalised content (key order independent; default tune values
 * count as "no tune", 2.4, so the editor's own output and stored content
 * without tunes hash the same).
 * @param {object|null} content - Editor data.
 * @returns {string} Hex hash.
 */
const contentHash = (content) => sha256(stableStringify(comparableBlocks(content ? content.blocks : [])));

/** Longest version name. */
const MAX_LABEL_LENGTH = 120;

/**
 * Normalises a version name: plain text, trimmed, control characters removed,
 * bounded. Empty names become null.
 * @param {unknown} value - Candidate label.
 * @returns {string|null} Label or null.
 */
const normalizeLabel = (value) => {
  if (typeof value !== 'string') return null;
  const text = value
    // eslint-disable-next-line no-control-regex -- control characters are removed from names
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, MAX_LABEL_LENGTH)
    .trim();
  return text || null;
};

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

  /**
   * Access target of a stored row: `field` is the path to check (`sections.body` plus `fieldKey` for
   * keyed positional rows, the stored path otherwise).
   * @param {object} row - Snapshot row.
   * @returns {{ uid: string, documentId: string, locale: string|null, field: string, fieldKey?: string, legacy: boolean }} Target.
   */
  const targetOfRow = (row) => {
    const parsed = parseFieldIdentity(row.fieldName) || { field: String(row.fieldName), fieldKey: null };
    return {
      uid: row.contentType,
      documentId: row.entryId,
      locale: row.entryLocale || null,
      field: parsed.field,
      ...(parsed.fieldKey ? { fieldKey: parsed.fieldKey } : {}),
      legacy: Boolean(parsed.legacy),
    };
  };

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
      label: typeof row.label === 'string' && row.label ? row.label : null,
      createdAt: row.createdAt,
      createdBy: userName(row.createdBy),
      stats: computeStats(row.jsonContent),
      restorable: Boolean(row.jsonContent && Array.isArray(row.jsonContent.blocks)),
    };
    // 2.4: a version saved under a positional path that could not be mapped to one entry is read-only.
    const parsed = parseFieldIdentity(row.fieldName);
    if (parsed && parsed.legacy) {
      dto.positional = true;
      dto.restorable = false;
    }
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
        target: targetOfRow(row),
        snapshot: toDto(row, true),
      };
    },

    /**
     * Creates a snapshot unless the latest one already has the same content.
     * @param {{ uid: string, documentId: string, locale?: string|null, field: string }} target - Field.
     * @param {unknown} content - Editor data (any stored shape).
     * @param {{ trigger?: 'manual'|'auto'|'restore', userId?: number|null, label?: string|null }} [options] - Metadata.
     *   A `label` names the new version; when the content equals the latest version, the latest one is named instead.
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
      // Versions keep the content only; the field's identity is the row's fieldName (2.4).
      delete clean.fieldKey;
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
        const label = normalizeLabel(options.label);
        // Versions stored before 2.4 carry a hash with default tunes: compare their content again.
        const same =
          latest &&
          (latest.contentHash === hash || (latest.jsonContent && contentHash(latest.jsonContent) === hash));
        if (same) {
          if (!label) return { created: false, snapshot: toDto(latest) };
          const named = await query().update({
            where: { id: latest.id },
            data: { label },
            populate: { createdBy: { select: ['firstname', 'lastname', 'username'] } },
          });
          return { created: false, snapshot: toDto(named || { ...latest, label }) };
        }
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
            label,
            createdBy: options.userId || null,
          },
          populate: { createdBy: { select: ['firstname', 'lastname', 'username'] } },
        });
        await this.prune(target);
        const snapshot = toDto(row);
        await recordAudit(strapi, {
          event: 'version.create',
          target: { ...target },
          counts: { version: snapshot.version, blocks: clean.blocks.length },
          meta: { trigger: snapshot.trigger },
          actor: options.trigger === 'auto' ? 'system' : undefined,
        });
        return { created: true, snapshot };
      } finally {
        await store().release(key, PROCESS_ID);
      }
    },

    /**
     * Names or renames a version. An empty label removes the name.
     * @param {string} documentId - Version id.
     * @param {string|null} label - New label (plain text, max 120 characters).
     * @returns {Promise<object>} The version without content.
     * @throws {errors.NotFoundError} When the version does not exist.
     * @sideeffect Updates the `label` column of one version row.
     */
    async rename(documentId, label) {
      if (typeof documentId !== 'string' || !/^[a-z0-9]{1,64}$/.test(documentId))
        throw new errors.NotFoundError('Not found');
      const row = await query().findOne({ where: { documentId }, select: ['id'] });
      if (!row) throw new errors.NotFoundError('Not found');
      const updated = await query().update({
        where: { id: row.id },
        data: { label: normalizeLabel(label) },
        populate: { createdBy: { select: ['firstname', 'lastname', 'username'] } },
      });
      return toDto(updated);
    },

    /**
     * Maps versions stored under positional paths before 2.4 (`sections.0.body`)
     * to the entry they belong to, by block ids: a version whose blocks appear
     * in exactly one current entry belongs to it. Mapped versions of entries
     * with a key are moved to the entry's identity (`fieldName`, `roomId`), once.
     * Versions that match no entry or several stay where they are (read-only,
     * listed as older versions saved by position). Nothing is deleted.
     * @param {{ uid: string, documentId: string, locale: string|null, basePath: string }} target - Field without index.
     * @param {Array<{ path: string, fieldKey: string|null, blockIds: Set<string> }>} entries - Stored entries (access.checkField).
     * @returns {Promise<{ mapped: number, byPath: Map<string, object[]>, unmapped: object[] }>} Rows proven per entry path
     *   (only those not moved, i.e. of entries without a key) and the unmapped rows (newest first).
     * @sideeffect Updates `fieldName` and `roomId` of mapped legacy rows.
     */
    async adoptLegacy({ uid, documentId, locale, basePath }, entries) {
      const top = String(basePath).split('.')[0];
      const candidates = await query().findMany({
        where: {
          contentType: uid,
          entryId: documentId,
          fieldName: { $startsWith: `${top}.`, $notContains: '#' },
          $or: [{ entryLocale: locale || null }, { entryLocale: null }],
        },
        select: ['id', 'fieldName'],
        orderBy: [{ id: 'asc' }],
        limit: LEGACY_MAX,
      });
      const ids = candidates
        .filter((row) => {
          const parsed = parseFieldIdentity(row.fieldName);
          return parsed && parsed.legacy && basePathOf(row.fieldName) === basePath;
        })
        .map((row) => row.id);
      const byPath = new Map();
      const unmapped = [];
      let mapped = 0;
      for (let start = 0; start < ids.length; start += LEGACY_BATCH) {
        const rows = await query().findMany({
          where: { id: { $in: ids.slice(start, start + LEGACY_BATCH) } },
          populate: { createdBy: { select: ['firstname', 'lastname', 'username'] } },
        });
        for (const row of rows) {
          const owner = ownerOfBlocks(blockIdsOf(row.jsonContent), entries);
          const entry = owner === -1 ? null : entries[owner];
          if (entry && entry.fieldKey) {
            const identity = fieldIdentity(basePath, entry.fieldKey, true);
            // Guarded by the old name: concurrent mappings write the same result once.
            await query().updateMany({
              where: { id: row.id, fieldName: row.fieldName },
              data: { fieldName: identity, roomId: fieldKey({ uid, documentId, locale, field: identity }) },
            });
            mapped += 1;
          } else if (entry) {
            if (!byPath.has(entry.path)) byPath.set(entry.path, []);
            byPath.get(entry.path).push(row);
          } else unmapped.push(row);
        }
      }
      const newest = (a, b) => Number(b.version) - Number(a.version) || Number(b.id) - Number(a.id);
      for (const rows of byPath.values()) rows.sort(newest);
      unmapped.sort(newest);
      return {
        mapped,
        byPath: new Map(Array.from(byPath, ([path, rows]) => [path, rows.map((row) => toDto(row))])),
        unmapped: unmapped.slice(0, maxPerField()).map((row) => toDto(row)),
      };
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
module.exports.LEGACY_MAX = LEGACY_MAX;
module.exports.contentHash = contentHash;
module.exports.normalizeLabel = normalizeLabel;
module.exports.MAX_LABEL_LENGTH = MAX_LABEL_LENGTH;
