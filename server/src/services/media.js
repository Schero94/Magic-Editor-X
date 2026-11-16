'use strict';

const {
  MEDIA_SIGN_LIMITS,
  collectFiles,
  editorValueOf,
  fileIdOf,
  fileSlots,
  hasSignatureTrace,
  hashCandidates,
  indexRows,
  matchFile,
  rewriteFiles,
  rowUrlFor,
  urlBase,
  withRowUrls,
} = require('../../../shared/media-urls.mjs');
const { isEditorAttribute } = require('../utils/editor-fields');
const { createLogger } = require('../utils/logger');

/**
 * Media Library files of stored values with a private upload provider (2.5).
 *
 * Strapi's upload plugin signs the media fields of every Document Service
 * result when the provider is private (`provider.isPrivate()`), and keeps
 * signatures out of Rich text and Blocks values. Magic Editor X values are
 * JSON fields, which Strapi does not look into, so this service does the same
 * for them:
 * - `unsignValues` before a write: a URL with a signature becomes the file's
 *   stored (unsigned) URL again, and the file id is added when it was missing;
 * - `signValues` on read: one database query for all files of a call, one
 *   provider call per distinct file (at most `MEDIA_SIGN_LIMITS.concurrency`
 *   at a time, cached for the call), through the upload plugin's own
 *   `file.signFileUrls`;
 * - `signUrls` for the editor (admin route `POST /media/signed-urls`);
 * - `migrateFileIds` adds the file id to stored file slots that have none and
 *   removes signatures that were stored before 2.5.
 *
 * A file is only rewritten when a Media Library row matches it exactly (by id,
 * documentId or URL, and always with the same URL without query) and the
 * row belongs to the configured private provider. Public providers: every
 * method returns its input unchanged and makes no query.
 */

const FILE_UID = 'plugin::upload.file';
const MIGRATION_BATCH = 100;

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);
  let privateState = null;

  const upload = () => {
    try {
      return strapi.plugin('upload') || null;
    } catch {
      return null;
    }
  };

  /** Configured upload provider name (what Strapi stores in `file.provider`). */
  const providerName = () => {
    const config = strapi.config.get('plugin::upload') || {};
    return typeof config.provider === 'string' ? config.provider : null;
  };

  /**
   * True when the upload provider is private. Asked once per process (Strapi's
   * upload plugin also decides it once, in its bootstrap).
   * @returns {Promise<boolean>} Result.
   */
  const isPrivate = () => {
    if (!privateState) {
      privateState = (async () => {
        const plugin = upload();
        const provider = plugin && plugin.provider;
        if (!provider || typeof provider.isPrivate !== 'function') return false;
        try {
          return (await provider.isPrivate()) === true;
        } catch (error) {
          logger.warn('the upload provider could not tell whether it is private', error);
          return false;
        }
      })();
    }
    return privateState;
  };

  /**
   * Loads the Media Library rows of the given keys (one query).
   * @param {{ ids?: number[], documentIds?: string[], bases?: string[], hashes?: string[] }} keys - Lookup keys.
   * @returns {Promise<Array<object>>} Rows.
   */
  const loadRows = async ({ ids = [], documentIds = [], bases = [], hashes = [] }) => {
    const or = [];
    if (ids.length) or.push({ id: { $in: ids.slice(0, MEDIA_SIGN_LIMITS.maxFiles) } });
    if (documentIds.length)
      or.push({ documentId: { $in: documentIds.slice(0, MEDIA_SIGN_LIMITS.maxFiles) } });
    if (bases.length) or.push({ url: { $in: bases.slice(0, MEDIA_SIGN_LIMITS.maxFiles) } });
    if (hashes.length) or.push({ hash: { $in: hashes.slice(0, MEDIA_SIGN_LIMITS.maxFiles * 2) } });
    if (!or.length || !strapi.getModel(FILE_UID)) return [];
    return (
      (await strapi.db.query(FILE_UID).findMany({
        where: { $or: or },
        limit: MEDIA_SIGN_LIMITS.maxFiles * 3,
      })) || []
    );
  };

  /**
   * Signs rows with the upload plugin's `signFileUrls` (provider calls bounded and cached per call).
   * @param {Array<object>} rows - Rows owned by the private provider.
   * @returns {Promise<Map<number, object>>} Signed copies by row id.
   */
  const signRows = async (rows) => {
    const out = new Map();
    const fileService = upload() && upload().service('file');
    if (!fileService || typeof fileService.signFileUrls !== 'function') return out;
    const queue = rows.filter((row) => Number.isSafeInteger(row.id) && !out.has(row.id));
    const unique = [...new Map(queue.map((row) => [row.id, row])).values()];
    let next = 0;
    const worker = async () => {
      while (next < unique.length) {
        const row = unique[next];
        next += 1;
        try {
          // signFileUrls flags its input; hand it a copy so the row stays the unsigned reference.
          const signed = await fileService.signFileUrls(JSON.parse(JSON.stringify(row)));
          if (signed && signed.isUrlSigned === true && typeof signed.url === 'string')
            out.set(row.id, signed);
        } catch (error) {
          logger.warn('a media file could not be signed', error);
        }
      }
    };
    await Promise.all(Array.from({ length: Math.min(MEDIA_SIGN_LIMITS.concurrency, unique.length) }, worker));
    return out;
  };

  const isSqlite = () => {
    const client = String((strapi.db.dialect && strapi.db.dialect.client) || '');
    return client.includes('sqlite');
  };

  const owned = (row) => Boolean(row) && row.provider === providerName();

  /**
   * Signs the Media Library file URLs of stored values (private providers only).
   * @param {unknown[]} values - Stored values.
   * @returns {Promise<unknown[]>} Values; an unchanged value keeps its identity.
   */
  const signValues = async (values) => {
    if (!Array.isArray(values) || !values.length || !(await isPrivate())) return values;
    const datas = values.map((value) =>
      value && typeof value === 'object' && Array.isArray(value.blocks) ? value : null
    );
    const keys = collectFiles(datas);
    if (!keys.slots) return values;
    const rows = (await loadRows(keys)).filter(owned);
    if (!rows.length) return values;
    const index = indexRows(rows);
    const signed = await signRows(rows);
    return values.map((value, position) => {
      if (!datas[position]) return value;
      return rewriteFiles(value, (file) => {
        const row = matchFile(file, index);
        const copy = row && signed.get(row.id);
        return copy ? withRowUrls(file, row, copy) : null;
      });
    });
  };

  /**
   * Removes signatures from the Media Library file URLs of values about to
   * be stored and adds missing file ids (private providers only).
   * @param {unknown[]} values - Values.
   * @returns {Promise<unknown[]>} Values; an unchanged value keeps its identity.
   */
  const unsignValues = async (values) => {
    if (!Array.isArray(values) || !values.length || !(await isPrivate())) return values;
    const datas = values.map((value) =>
      value && typeof value === 'object' && Array.isArray(value.blocks) ? value : null
    );
    const needs = (file) => hasSignatureTrace(file) || fileIdOf(file) === null;
    const keys = collectFiles(datas, { onlyIf: needs });
    if (!keys.slots) return values;
    const rows = (await loadRows(keys)).filter(owned);
    if (!rows.length) return values;
    const index = indexRows(rows);
    return values.map((value, position) => {
      if (!datas[position]) return value;
      return rewriteFiles(value, (file) => {
        if (!needs(file)) return null;
        const row = matchFile(file, index);
        return row ? withRowUrls(file, row, row, { fillIds: true }) : null;
      });
    });
  };

  /**
   * Signs one value (helper for single reads and writes).
   * @param {unknown} value - Stored value.
   * @returns {Promise<unknown>} Value.
   */
  const signValue = async (value) => (await signValues([value]))[0];

  /**
   * Unsigns one value.
   * @param {unknown} value - Value.
   * @returns {Promise<unknown>} Value.
   */
  const unsignValue = async (value) => (await unsignValues([value]))[0];

  /**
   * Signed URLs for the editor (admin route): every URL that is exactly a
   * file or format URL of a Media Library row of the private provider gets a
   * fresh signature, for the rows `allowRows` allows.
   * @param {string[]} urls - URLs (signed or not).
   * @param {(rows: object[]) => Promise<Set<number>>} allowRows - Permission check: ids of the rows the caller may get.
   * @returns {Promise<{ private: boolean, urls: Record<string, string> }>} Signed URL by requested URL base.
   */
  const signUrls = async (urls, allowRows) => {
    if (!(await isPrivate())) return { private: false, urls: {} };
    const bases = [...new Set(urls.map(urlBase).filter(Boolean))].slice(0, MEDIA_SIGN_LIMITS.maxFiles);
    if (!bases.length) return { private: true, urls: {} };
    const hashes = [...new Set(bases.flatMap(hashCandidates))];
    const rows = (await loadRows({ bases, hashes })).filter(owned);
    const matches = [];
    for (const base of bases) {
      for (const row of rows) {
        const hit = rowUrlFor(row, base);
        if (hit) {
          matches.push({ base, row, key: hit.key });
          break;
        }
      }
    }
    const allowedIds = await allowRows([
      ...new Map(matches.map((match) => [match.row.id, match.row])).values(),
    ]);
    const allowed = matches.filter((match) => allowedIds.has(match.row.id));
    const signed = await signRows(allowed.map((match) => match.row));
    const out = {};
    for (const { base, row, key } of allowed) {
      const copy = signed.get(row.id);
      if (!copy) continue;
      const url = key === null ? copy.url : copy.formats && copy.formats[key] && copy.formats[key].url;
      if (typeof url === 'string' && url) out[base] = url;
    }
    return { private: true, urls: out };
  };

  /**
   * Files a stored value refers to, as ids and URL bases (for the route's
   * "referenced by this field" check).
   * @param {unknown} value - Stored value.
   * @returns {{ ids: Set<number>, bases: Set<string> }} References.
   */
  const referencesOf = (value) => {
    const ids = new Set();
    const bases = new Set();
    const data = editorValueOf(value);
    for (const block of (data && data.blocks) || []) {
      for (const slot of fileSlots(block)) {
        const id = fileIdOf(slot.file);
        if (id) ids.add(id);
        const base = urlBase(slot.file.url);
        if (base) bases.add(base);
      }
    }
    return { ids, bases };
  };

  /**
   * Models (content types and components) with Magic Editor X attributes of their own.
   * @returns {Array<{ uid: string, fields: string[] }>} Models.
   */
  const editorModels = () => {
    const out = [];
    const visit = (uid, schema) => {
      const fields = Object.entries((schema && schema.attributes) || {})
        .filter(([, attribute]) => isEditorAttribute(attribute))
        .map(([name]) => name);
      if (fields.length) out.push({ uid, fields });
    };
    for (const [uid, schema] of Object.entries(strapi.contentTypes || {})) visit(uid, schema);
    for (const [uid, schema] of Object.entries(strapi.components || {})) visit(uid, schema);
    return out;
  };

  /**
   * Parses a stored JSON column value read with knex (SQLite returns text).
   * @param {unknown} raw - Column value.
   * @returns {unknown} Value.
   */
  const parseColumn = (raw) => {
    if (typeof raw !== 'string') return raw;
    try {
      return JSON.parse(raw);
    } catch {
      return raw;
    }
  };

  /**
   * Links stored file slots to their Media Library file (adds `id` and
   * `documentId` when missing, found by URL with or without signature) and,
   * for a private provider, removes stored signatures. Idempotent: a second
   * run changes nothing. Pages by id through every model with an editor field
   * (all locales, drafts and published versions); each changed row is read
   * again and written inside a transaction with a row lock (`FOR UPDATE` on
   * PostgreSQL; SQLite serialises writes), so an edit saved meanwhile is not
   * overwritten with older content.
   * @param {{ dryRun?: boolean, batchSize?: number }} [options] - Without `dryRun: false` nothing is written.
   * @returns {Promise<{ dryRun: boolean, models: number, scanned: number, changedValues: number, linked: number, unsigned: number, unmatched: number, failed: number }>} Report (counts only).
   */
  const migrateFileIds = async (options = {}) => {
    const dryRun = options.dryRun !== false;
    const batchSize = Math.min(Math.max(Number(options.batchSize) || MIGRATION_BATCH, 1), 500);
    const privateProvider = await isPrivate();
    const provider = providerName();
    const report = {
      dryRun,
      models: 0,
      scanned: 0,
      changedValues: 0,
      linked: 0,
      unsigned: 0,
      unmatched: 0,
      failed: 0,
    };
    const fix = (value, index, counts) =>
      rewriteFiles(value, (file) => {
        const missingId = fileIdOf(file) === null;
        const signedTrace = privateProvider && hasSignatureTrace(file);
        if (!missingId && !signedTrace) return null;
        const row = matchFile(file, index);
        if (!row) {
          if (missingId) counts.unmatched += 1;
          return null;
        }
        const strip = signedTrace && row.provider === provider;
        const next = withRowUrls(file, row, strip ? row : { url: file.url, formats: file.formats }, {
          fillIds: true,
        });
        if (JSON.stringify(next) === JSON.stringify(file)) return null;
        if (missingId) counts.linked += 1;
        if (strip) counts.unsigned += 1;
        return next;
      });

    for (const model of editorModels()) {
      const meta = strapi.db.metadata.get(model.uid);
      if (!meta) continue;
      report.models += 1;
      let cursor = 0;
      for (;;) {
        const rows = await strapi.db.query(model.uid).findMany({
          select: ['id', ...model.fields],
          where: { id: { $gt: cursor } },
          orderBy: { id: 'asc' },
          limit: batchSize,
        });
        if (!rows.length) break;
        cursor = rows[rows.length - 1].id;
        report.scanned += rows.length;
        const values = rows.flatMap((row) => model.fields.map((field) => editorValueOf(row[field])));
        const keys = collectFiles(values, {
          onlyIf: (file) => fileIdOf(file) === null || (privateProvider && hasSignatureTrace(file)),
        });
        if (!keys.slots) continue;
        const index = indexRows(await loadRows(keys));
        for (const row of rows) {
          const counts = { linked: 0, unsigned: 0, unmatched: 0 };
          const changed = {};
          for (const field of model.fields) {
            const value = editorValueOf(row[field]);
            if (!value || value !== row[field]) continue; // 1.x strings are converted on their next save
            const next = fix(value, index, counts);
            if (next !== value) changed[field] = next;
          }
          report.unmatched += counts.unmatched;
          if (!Object.keys(changed).length) continue;
          if (dryRun) {
            report.changedValues += Object.keys(changed).length;
            report.linked += counts.linked;
            report.unsigned += counts.unsigned;
            continue;
          }
          try {
            const written = await strapi.db.transaction(async ({ trx }) => {
              const columns = model.fields.map((field) => meta.attributes[field].columnName || field);
              let read = strapi.db.connection(meta.tableName).transacting(trx).select(columns);
              // SQLite has no row locks (and knex warns on forUpdate); it serialises writes instead.
              if (!isSqlite()) read = read.forUpdate();
              const fresh = await read.where({ id: row.id }).first();
              if (!fresh) return 0;
              const update = {};
              const again = { linked: 0, unsigned: 0, unmatched: 0 };
              model.fields.forEach((field, position) => {
                const value = parseColumn(fresh[columns[position]]);
                if (!value || typeof value !== 'object' || !Array.isArray(value.blocks)) return;
                const next = fix(value, index, again);
                if (next !== value) update[columns[position]] = JSON.stringify(next);
              });
              if (!Object.keys(update).length) return 0;
              await strapi.db
                .connection(meta.tableName)
                .transacting(trx)
                .update(update)
                .where({ id: row.id });
              report.linked += again.linked;
              report.unsigned += again.unsigned;
              return Object.keys(update).length;
            });
            report.changedValues += written;
          } catch (error) {
            report.failed += 1;
            logger.warn('media file ids: a row could not be updated', error);
          }
        }
      }
    }
    return report;
  };

  return {
    isPrivate,
    signValues,
    unsignValues,
    signValue,
    unsignValue,
    signUrls,
    referencesOf,
    migrateFileIds,
  };
};
