'use strict';

const { errors } = require('@strapi/utils');
const { createRateLimiter } = require('../utils/rate-limit');
const { cleanEditorValue } = require('../utils/sanitizer');
const { resolveEditorField } = require('../utils/editor-fields');
const { displayName } = require('./comments');
const { resolveFieldPreset, allowedInlineTags, checkPreset } = require('../../../shared/presets.mjs');
const { canonicalJson } = require('../../../shared/diff.mjs');
const { parseFieldIdentity } = require('../../../shared/field-identity.mjs');
const {
  MAX_OPEN_SUGGESTIONS_PER_FIELD,
  MAX_PROPOSED_CHARS,
  normalizeSuggestionNote,
} = require('../../../shared/suggestions.mjs');

/**
 * Block suggestions (2.4).
 *
 * Data access only: callers (controllers/suggestions.js) check the RBAC
 * actions and Content Manager access first. Rows live in the hidden content
 * type `plugin::magic-editor-x.suggestion` (table `magic_editor_suggestions`)
 * and are read and written with the query engine, like comments.
 *
 * Proposed blocks are untrusted: each is normalised and sanitised with the
 * field's sanitiser (inline tags of the field preset, the raw HTML policy) and
 * checked against the field preset before it is stored. Decisions are
 * conditional updates (`status: 'open'` in the where clause), so two reviewers
 * cannot both accept or reject the same suggestion.
 *
 * Retention: suggestions of a document locale are deleted with that entry
 * (Document Service middleware, utils/comment-retention.js); the author and
 * decider snapshots are cleared when the admin user is deleted.
 */

const UID = 'plugin::magic-editor-x.suggestion';
const ID_PATTERN = /^[a-z0-9]{1,64}$/;
/** Preset rules about the whole document; a single proposed block is checked for its own rules only. */
const DOCUMENT_RULES = new Set(['TOO_MANY_BLOCKS', 'TOO_MANY_CHARACTERS']);

const notFound = () => new errors.NotFoundError('Not found');

/**
 * Stored row -> API object. Never exposes admin ids: `own` tells the viewer
 * whether they suggested it.
 * @param {object} row - Database row.
 * @param {number|null} viewerId - Admin id of the caller.
 * @returns {object} Suggestion DTO.
 */
const toDto = (row, viewerId) => ({
  id: row.documentId,
  op: row.op,
  blockId: row.blockId,
  afterBlockId: row.op === 'insert' ? row.afterBlockId || null : null,
  proposed: row.op === 'delete' ? null : row.proposed || null,
  baseHash: row.baseHash || null,
  note: row.note || null,
  status: row.status,
  author: {
    name: row.authorId == null ? null : row.authorName || null,
    own: viewerId != null && row.authorId != null && Number(row.authorId) === Number(viewerId),
    deleted: row.authorId == null,
  },
  decidedAt: row.status === 'open' ? null : row.decidedAt || null,
  decidedBy:
    row.status === 'open' ? null : { name: row.decidedById == null ? null : row.decidedByName || null },
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

/**
 * Counts by status.
 * @param {Array<{ status: string }>} rows - Rows or DTOs.
 * @returns {{ open: number, accepted: number, rejected: number }} Counts.
 */
const countStatuses = (rows) => {
  const counts = { open: 0, accepted: 0, rejected: 0 };
  for (const row of rows) if (row.status in counts) counts[row.status] += 1;
  return counts;
};

/**
 * Validation error with a code and block ids (never content).
 * @param {string} message - Message.
 * @param {string} code - Code.
 * @param {object} [extra] - Extra details.
 * @returns {errors.ValidationError} Error.
 */
const invalid = (message, code, extra = {}) => new errors.ValidationError(message, { code, ...extra });

module.exports = ({ strapi }) => {
  const query = () => strapi.db.query(UID);
  const conf = (key, fallback) => {
    const value = strapi.config.get(`plugin::magic-editor-x.suggestions.${key}`);
    return value === undefined ? fallback : value;
  };
  let fallbackLimiter = null;

  /**
   * Query filter of one field of one document locale.
   * @param {{ uid: string, documentId: string, locale?: string|null, field: string }} target - Field identity.
   * @returns {object} Where clause.
   */
  const whereTarget = ({ uid, documentId, locale, field }) => ({
    contentType: uid,
    entryId: documentId,
    entryLocale: locale || null,
    fieldName: field,
  });

  /**
   * Loads one suggestion row by documentId.
   * @param {string} id - Suggestion id.
   * @returns {Promise<object>} Row.
   * @throws {errors.NotFoundError} When missing.
   */
  const findRow = async (id) => {
    if (typeof id !== 'string' || !ID_PATTERN.test(id)) throw notFound();
    const row = await query().findOne({ where: { documentId: id } });
    if (!row) throw notFound();
    return row;
  };

  /**
   * Cleans one proposed block with the field's sanitiser and checks it against the field preset.
   * @param {object} block - Untrusted block `{ id, type, data, tunes? }`.
   * @param {string} blockId - Id the block gets.
   * @param {object} attribute - Field attribute (custom field options).
   * @returns {{ id: string, type: string, data: object, tunes?: object }} Clean block.
   * @throws {errors.ValidationError} Not a block, too large, removed by the sanitiser or against the preset.
   */
  const cleanProposed = (block, blockId, attribute) => {
    if (canonicalJson(block).length > MAX_PROPOSED_CHARS)
      throw invalid('A proposed block is too large', 'SUGGESTION_TOO_LARGE', { blockIds: [blockId] });
    const preset = resolveFieldPreset(attribute && attribute.options);
    const rawHtml = strapi.config.get('plugin::magic-editor-x.rawHtml') || 'sanitize';
    let clean;
    try {
      clean = cleanEditorValue(
        { time: Date.now(), version: '2.31.7', blocks: [{ ...block, id: blockId }] },
        { rawHtml, inlineTags: allowedInlineTags(preset) }
      );
    } catch (error) {
      if (error && error.name === 'EditorDataError')
        throw invalid('A proposed block is not valid editor content', 'INVALID_BLOCK', {
          blockIds: [blockId],
        });
      throw error;
    }
    const cleanBlock = clean && Array.isArray(clean.blocks) ? clean.blocks[0] : null;
    if (!cleanBlock) throw invalid('A proposed block is empty', 'INVALID_BLOCK', { blockIds: [blockId] });
    if (preset.restricted) {
      const violations = checkPreset(clean, preset).filter(
        (violation) => !DOCUMENT_RULES.has(violation.code)
      );
      if (violations.length)
        throw invalid('A proposed block does not match the field settings', 'PRESET_VIOLATION', {
          blockIds: [blockId],
          violations: violations.slice(0, 10).map(({ code }) => ({ code, blockId })),
        });
    }
    const out = { id: blockId, type: cleanBlock.type, data: cleanBlock.data || {} };
    if (cleanBlock.tunes && Object.keys(cleanBlock.tunes).length) out.tunes = cleanBlock.tunes;
    return out;
  };

  return {
    UID,

    /**
     * Target of a stored suggestion (for the access check).
     * @param {string} id - Suggestion id.
     * @returns {Promise<{ row: object, target: { uid: string, documentId: string, locale: string|null, field: string, fieldKey?: string } }>}
     *   Row and the access-check target (field path, plus the key of a positional field).
     * @throws {errors.NotFoundError} When the suggestion does not exist or its identity cannot be read.
     */
    async findTarget(id) {
      const row = await findRow(id);
      const parsed = parseFieldIdentity(row.fieldName);
      // Suggestions are new in 2.4: they are always stored under an identity, never by position.
      if (!parsed || parsed.legacy) throw notFound();
      return {
        row,
        target: {
          uid: row.contentType,
          documentId: row.entryId,
          locale: row.entryLocale || null,
          field: parsed.field,
          ...(parsed.fieldKey ? { fieldKey: parsed.fieldKey } : {}),
        },
      };
    },

    /**
     * Suggestions of one field: open ones, or all (newest decisions first after the open ones),
     * bounded by MAX_OPEN_SUGGESTIONS_PER_FIELD rows.
     * @param {{ uid: string, documentId: string, locale?: string|null, field: string }} target - Field identity.
     * @param {number|null} viewerId - Caller's admin id.
     * @param {{ status?: 'open'|'all' }} [options] - Filter.
     * @returns {Promise<{ suggestions: object[], counts: { open: number, accepted: number, rejected: number } }>} Suggestions.
     */
    async list(target, viewerId, { status = 'open' } = {}) {
      const where = whereTarget(target);
      const rows = await query().findMany({
        where: status === 'all' ? where : { ...where, status: 'open' },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        limit: MAX_OPEN_SUGGESTIONS_PER_FIELD,
      });
      const [accepted, rejected] = await Promise.all([
        query().count({ where: { ...where, status: 'accepted' } }),
        query().count({ where: { ...where, status: 'rejected' } }),
      ]);
      const open = status === 'all' ? countStatuses(rows).open : rows.length;
      return {
        suggestions: rows.map((row) => toDto(row, viewerId)),
        counts: { open, accepted: Number(accepted) || 0, rejected: Number(rejected) || 0 },
      };
    },

    /**
     * Counts one suggestion request of an admin against the per-minute limit,
     * shared by all processes (`magic_editor_x_counters`, key `suggestions:<adminId>`).
     * @param {number} userId - Admin id.
     * @returns {Promise<void>}
     * @throws {errors.RateLimitError} 429 when the limit is reached.
     */
    async checkRate(userId) {
      const perMinute = Number(conf('perMinute', 20)) || 20;
      let allowed;
      try {
        const { count } = await strapi
          .plugin('magic-editor-x')
          .service('store')
          .hit(`suggestions:${userId}`, 60000);
        allowed = count <= perMinute;
      } catch {
        if (!fallbackLimiter) fallbackLimiter = createRateLimiter({ max: perMinute, windowMs: 60000 });
        allowed = fallbackLimiter.hit(`suggestions:${userId}`).allowed;
      }
      if (!allowed) throw new errors.RateLimitError('Too many suggestions. Try again in a minute.');
    },

    /**
     * Stores suggestions of one author for one field. An open suggestion of the same author for
     * the same block and operation is updated instead of duplicated (sending again replaces it).
     * Every proposed block is cleaned and checked first; nothing is stored when one is refused.
     * @param {{ uid: string, documentId: string, locale?: string|null, field: string, path: string }} target - Field
     *   identity (`field`) and the field path (`path`, for the attribute and its preset).
     * @param {{ suggestions: Array<{ op: string, blockId: string, afterBlockId?: string|null, proposed?: object|null, baseHash?: string|null }>, note?: string|null }} input - Validated input.
     * @param {{ id: number }} user - Author.
     * @returns {Promise<{ suggestions: object[], created: number, updated: number }>} Stored suggestions.
     * @throws {errors.ValidationError} Invalid block, preset violation or too many open suggestions.
     * @sideeffect Inserts or updates rows.
     */
    async create(target, input, user) {
      const contentType = strapi.contentType(target.uid);
      const resolved = contentType ? resolveEditorField(strapi, contentType, target.path) : null;
      if (!resolved) throw notFound();
      const note = normalizeSuggestionNote(input.note);
      const seen = new Set();
      const prepared = input.suggestions.map((item) => {
        const key = `${item.op}|${item.blockId}`;
        if (seen.has(key))
          throw invalid('A block is suggested twice', 'DUPLICATE_SUGGESTION', { blockIds: [item.blockId] });
        seen.add(key);
        if (item.op === 'delete') return { ...item, proposed: null, afterBlockId: null };
        if (!item.proposed)
          throw invalid('A proposed block is missing', 'INVALID_BLOCK', { blockIds: [item.blockId] });
        return {
          ...item,
          afterBlockId: item.op === 'insert' ? item.afterBlockId || null : null,
          proposed: cleanProposed(item.proposed, item.blockId, resolved.attribute),
        };
      });
      const where = whereTarget(target);
      const own = await query().findMany({
        where: { ...where, status: 'open', authorId: user.id },
        select: ['id', 'blockId', 'op'],
        limit: MAX_OPEN_SUGGESTIONS_PER_FIELD,
      });
      const ownByKey = new Map(own.map((row) => [`${row.op}|${row.blockId}`, row]));
      const fresh = prepared.filter((item) => !ownByKey.has(`${item.op}|${item.blockId}`)).length;
      const open = await query().count({ where: { ...where, status: 'open' } });
      if (Number(open) + fresh > MAX_OPEN_SUGGESTIONS_PER_FIELD) {
        throw invalid('This field has too many open suggestions', 'TOO_MANY_SUGGESTIONS');
      }
      const name = displayName(user);
      const stored = [];
      let created = 0;
      let updated = 0;
      for (const item of prepared) {
        const data = {
          afterBlockId: item.afterBlockId,
          proposed: item.proposed,
          baseHash: item.op === 'insert' ? null : item.baseHash || null,
          note,
          authorName: name,
        };
        const existing = ownByKey.get(`${item.op}|${item.blockId}`);
        if (existing) {
          stored.push(await query().update({ where: { id: existing.id }, data }));
          updated += 1;
        } else {
          stored.push(
            await query().create({
              data: {
                ...where,
                ...data,
                blockId: item.blockId,
                op: item.op,
                status: 'open',
                authorId: user.id,
              },
            })
          );
          created += 1;
        }
      }
      return { suggestions: stored.map((row) => toDto(row, user.id)), created, updated };
    },

    /**
     * Accepts or rejects an open suggestion. Conditional on `status: 'open'`, so only one
     * decision wins when reviewers act at the same time.
     * @param {object} row - Suggestion row.
     * @param {'accepted'|'rejected'} status - Decision.
     * @param {{ id: number }} user - Reviewer.
     * @returns {Promise<object>} The decided suggestion.
     * @throws {errors.ApplicationError} 409 `ALREADY_DECIDED` when it is no longer open (via the controller).
     * @sideeffect Updates the row.
     */
    async decide(row, status, user) {
      const result = await query().updateMany({
        where: { id: row.id, status: 'open' },
        data: { status, decidedAt: new Date(), decidedById: user.id, decidedByName: displayName(user) },
      });
      if (!result || Number(result.count) !== 1) return null;
      return toDto(await query().findOne({ where: { id: row.id } }), user.id);
    },

    /**
     * Withdraws (deletes) the caller's own open suggestion.
     * @param {object} row - Suggestion row.
     * @param {{ id: number }} user - Caller.
     * @returns {Promise<boolean>} Whether it was removed (false: decided meanwhile).
     * @throws {errors.ForbiddenError} When the caller is not the author.
     * @sideeffect Deletes the row.
     */
    async withdraw(row, user) {
      if (row.authorId == null || Number(row.authorId) !== Number(user.id)) {
        throw new errors.ForbiddenError('Only the author can withdraw this suggestion');
      }
      const result = await query().deleteMany({ where: { id: row.id, status: 'open' } });
      return Number(result && result.count) === 1;
    },

    /**
     * Deletes the suggestions of deleted entries (Document Service `delete`).
     * @param {string} uid - Content type uid.
     * @param {string} documentId - Document id.
     * @param {Array<string|null>} locales - Locales whose entry was deleted (null: not localised).
     * @returns {Promise<number>} Rows removed.
     * @sideeffect Deletes rows.
     */
    async removeForEntries(uid, documentId, locales) {
      if (typeof uid !== 'string' || typeof documentId !== 'string' || !locales.length) return 0;
      const named = Array.from(new Set(locales.filter((locale) => typeof locale === 'string' && locale)));
      const or = [];
      if (named.length) or.push({ entryLocale: { $in: named } });
      if (locales.some((locale) => !locale)) or.push({ entryLocale: null });
      const result = await query().deleteMany({ where: { contentType: uid, entryId: documentId, $or: or } });
      return Number(result && result.count) || 0;
    },

    /**
     * Removes the personal data of a deleted admin user: author and decider snapshots
     * (the suggestion stays, shown as by a deleted user).
     * @param {number} userId - Deleted admin id.
     * @returns {Promise<void>}
     * @sideeffect Updates rows.
     */
    async anonymizeUser(userId) {
      if (userId == null) return;
      await query().updateMany({ where: { authorId: userId }, data: { authorId: null, authorName: null } });
      await query().updateMany({
        where: { decidedById: userId },
        data: { decidedById: null, decidedByName: null },
      });
    },
  };
};

module.exports.UID = UID;
module.exports.toDto = toDto;
module.exports.countStatuses = countStatuses;
