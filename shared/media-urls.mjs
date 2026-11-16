/**
 * Media Library file URLs of stored values (2.5, private upload providers).
 *
 * A private upload provider (`isPrivate() === true`, e.g. a private S3
 * bucket) serves files only through short-lived signed URLs. Magic Editor X
 * stores the Media Library file id with the unsigned URL and signs on read.
 * This module is pure: it lists the file slots of a value, matches them with
 * Media Library rows and rewrites their URLs. The server does the database
 * query and asks the provider for the signatures (`services/media.js`).
 *
 * File slots: the image block file, gallery images, video and audio files,
 * video posters, text tracks (`mediaSlots`) and, for signing only, the
 * attaches block file. Blocks that hold a bare URL (simpleImage,
 * personality photo, link previews, embeds) have no Media Library file and
 * are never touched.
 */

import { isPlainObject, normalizeEditorDataSafe } from './editor-data.mjs';
import { isBuiltInBlock } from './sanitize-policy.mjs';
import { mediaSlots } from './resolve-references.mjs';

/** Distinct files handled per call (one database query, provider calls bounded by it). */
export const MEDIA_SIGN_LIMITS = Object.freeze({ maxFiles: 500, concurrency: 8 });

const DOCUMENT_ID = /^[A-Za-z0-9]{1,64}$/;

/**
 * The URL without its query and fragment (`https://x/a.png?sig=1#f` -> `https://x/a.png`).
 * Plain string work: `new URL` would reject the site-relative `/uploads/...` URLs of the local provider.
 * @param {unknown} url - URL.
 * @returns {string} Base ('' for a non-string).
 */
export const urlBase = (url) => {
  if (typeof url !== 'string') return '';
  const hash = url.indexOf('#');
  const noHash = hash === -1 ? url : url.slice(0, hash);
  const query = noHash.indexOf('?');
  return query === -1 ? noHash : noHash.slice(0, query);
};

/**
 * Media Library file id of a stored file (`id` as a number or digit string).
 * @param {unknown} file - Stored file.
 * @returns {number|null} Id.
 */
export const fileIdOf = (file) => {
  if (!isPlainObject(file)) return null;
  if (Number.isSafeInteger(file.id) && file.id > 0) return file.id;
  if (typeof file.id === 'string' && /^[1-9][0-9]{0,15}$/.test(file.id)) return Number(file.id);
  return null;
};

/**
 * @param {unknown} file - Stored file.
 * @returns {string|null} Media Library documentId.
 */
const documentIdOf = (file) =>
  isPlainObject(file) && typeof file.documentId === 'string' && DOCUMENT_ID.test(file.documentId)
    ? file.documentId
    : null;

/**
 * File slots of a block: the Media Library slots of `mediaSlots` plus the
 * attaches block file.
 * @param {{ type: string, data: unknown }} block - Block.
 * @returns {Array<{ file: object, image: boolean, set: (data: object, file: object) => object }>} Slots.
 */
export const fileSlots = (block) => {
  const slots = mediaSlots(block);
  if (
    block &&
    block.type === 'attaches' &&
    isBuiltInBlock(block) &&
    isPlainObject(block.data) &&
    isPlainObject(block.data.file)
  )
    slots.push({ file: block.data.file, image: false, set: (data, file) => ({ ...data, file }) });
  return slots;
};

/**
 * URLs of a stored file: its own and those of its formats.
 * @param {object} file - Stored file.
 * @returns {string[]} URLs.
 */
const urlsOf = (file) => {
  const urls = typeof file.url === 'string' && file.url ? [file.url] : [];
  if (isPlainObject(file.formats))
    for (const format of Object.values(file.formats))
      if (isPlainObject(format) && typeof format.url === 'string' && format.url) urls.push(format.url);
  return urls;
};

/**
 * True when a stored file carries a signature trace (a query in a URL or an `isUrlSigned` flag).
 * @param {object} file - Stored file.
 * @returns {boolean} Result.
 */
export const hasSignatureTrace = (file) => {
  if (!isPlainObject(file)) return false;
  if (file.isUrlSigned !== undefined) return true;
  if (isPlainObject(file.formats))
    for (const format of Object.values(file.formats))
      if (isPlainObject(format) && format.isUrlSigned !== undefined) return true;
  return urlsOf(file).some((url) => url.includes('?'));
};

/**
 * Lists the Media Library files a list of values refers to.
 * @param {unknown[]} values - Stored values (objects; other shapes are skipped).
 * @param {{ onlyIf?: (file: object) => boolean, max?: number }} [options] - Filter and bound.
 * @returns {{ ids: number[], documentIds: string[], bases: string[], slots: number }} Lookup keys.
 */
export const collectFiles = (values, options = {}) => {
  const ids = new Set();
  const documentIds = new Set();
  const bases = new Set();
  const max = Math.min(options.max || MEDIA_SIGN_LIMITS.maxFiles, MEDIA_SIGN_LIMITS.maxFiles);
  let slots = 0;
  for (const value of values) {
    const data = isPlainObject(value) && Array.isArray(value.blocks) ? value : null;
    if (!data) continue;
    for (const block of data.blocks) {
      for (const slot of fileSlots(block)) {
        const base = urlBase(slot.file.url);
        if (!base) continue;
        if (options.onlyIf && !options.onlyIf(slot.file)) continue;
        if (bases.size >= max) break;
        slots += 1;
        bases.add(base);
        const id = fileIdOf(slot.file);
        if (id) ids.add(id);
        const documentId = documentIdOf(slot.file);
        if (documentId) documentIds.add(documentId);
      }
    }
  }
  return { ids: [...ids], documentIds: [...documentIds], bases: [...bases], slots };
};

/**
 * Index of Media Library rows for `matchFile`.
 * @param {Array<object>} rows - `plugin::upload.file` rows (`id`, `documentId`, `url`, `formats`).
 * @returns {{ byId: Map<number, object>, byDocumentId: Map<string, object>, byBase: Map<string, object> }} Index.
 */
export const indexRows = (rows) => {
  const byId = new Map();
  const byDocumentId = new Map();
  const byBase = new Map();
  for (const row of rows || []) {
    if (!isPlainObject(row) || typeof row.url !== 'string' || !row.url) continue;
    if (Number.isSafeInteger(row.id)) byId.set(row.id, row);
    if (typeof row.documentId === 'string') byDocumentId.set(row.documentId, row);
    const base = urlBase(row.url);
    if (base && !byBase.has(base)) byBase.set(base, row);
  }
  return { byId, byDocumentId, byBase };
};

/**
 * The Media Library row of a stored file. The id is tried first, then the
 * documentId, then the URL; a row found by id or documentId is used only when
 * its URL is the stored one (without query), so a stale or foreign id (content
 * copied from another project) never swaps the file.
 * @param {object} file - Stored file.
 * @param {ReturnType<typeof indexRows>} index - Row index.
 * @returns {object|null} Row.
 */
export const matchFile = (file, index) => {
  const base = urlBase(file && file.url);
  if (!base) return null;
  const id = fileIdOf(file);
  const byId = id ? index.byId.get(id) : null;
  if (byId && urlBase(byId.url) === base) return byId;
  const documentId = documentIdOf(file);
  const byDocument = documentId ? index.byDocumentId.get(documentId) : null;
  if (byDocument && urlBase(byDocument.url) === base) return byDocument;
  return index.byBase.get(base) || null;
};

/**
 * Removes `isUrlSigned` flags (set by Strapi's `signFileUrls`) from a file and its formats.
 * @param {object} file - File copy (changed in place).
 * @returns {object} The file.
 */
const dropFlags = (file) => {
  delete file.isUrlSigned;
  if (isPlainObject(file.formats)) {
    const formats = {};
    for (const [key, format] of Object.entries(file.formats)) {
      if (isPlainObject(format)) {
        const { isUrlSigned: _flag, ...rest } = format;
        formats[key] = rest;
      } else formats[key] = format;
    }
    file.formats = formats;
  }
  return file;
};

/**
 * A stored file with the URLs of `source` (a Media Library row, signed or
 * not): the file URL and every format whose stored URL is the row format's
 * URL (without query). Other keys are kept.
 * @param {object} file - Stored file.
 * @param {object} row - Unsigned Media Library row (to match formats).
 * @param {{ url: string, formats?: object|null }} source - URLs to write (the row itself to unsign, the signed row to sign).
 * @param {{ fillIds?: boolean }} [options] - Also store the row's `id` and `documentId` when the file has none.
 * @returns {object} New file.
 */
export const withRowUrls = (file, row, source, options = {}) => {
  const next = dropFlags({ ...file });
  if (typeof source.url === 'string' && source.url) next.url = source.url;
  if (isPlainObject(next.formats) && isPlainObject(row.formats)) {
    const formats = {};
    for (const [key, format] of Object.entries(next.formats)) {
      const rowFormat = row.formats[key];
      const sourceFormat = isPlainObject(source.formats) ? source.formats[key] : null;
      if (
        isPlainObject(format) &&
        isPlainObject(rowFormat) &&
        isPlainObject(sourceFormat) &&
        typeof sourceFormat.url === 'string' &&
        urlBase(format.url) === urlBase(rowFormat.url)
      )
        formats[key] = { ...format, url: sourceFormat.url };
      else formats[key] = format;
    }
    next.formats = formats;
  }
  if (options.fillIds) {
    if (fileIdOf(next) === null && Number.isSafeInteger(row.id)) next.id = row.id;
    if (!documentIdOf(next) && typeof row.documentId === 'string' && DOCUMENT_ID.test(row.documentId))
      next.documentId = row.documentId;
  }
  return next;
};

/**
 * Rewrites the file slots of a value. `rewrite(file)` returns a new file or
 * null (unchanged). The value is returned as is when nothing changed, so
 * callers can compare by identity.
 * @param {unknown} value - Stored value.
 * @param {(file: object) => object|null} rewrite - File rewriter.
 * @returns {unknown} New value or the same value.
 */
export const rewriteFiles = (value, rewrite) => {
  if (!isPlainObject(value) || !Array.isArray(value.blocks)) return value;
  let changed = false;
  const blocks = value.blocks.map((block) => {
    let data = block && block.data;
    for (const slot of fileSlots(block)) {
      const next = rewrite(slot.file);
      if (next && next !== slot.file) data = slot.set(data, next);
    }
    if (data === (block && block.data)) return block;
    changed = true;
    return { ...block, data };
  });
  return changed ? { ...value, blocks } : value;
};

/**
 * Normalises a value for the file walk without changing a value that is
 * already an object (1.x JSON strings are parsed; anything else is left out).
 * @param {unknown} value - Stored value.
 * @returns {object|null} Editor data or null.
 */
export const editorValueOf = (value) => {
  if (isPlainObject(value) && Array.isArray(value.blocks)) return value;
  if (typeof value === 'string') return normalizeEditorDataSafe(value);
  return null;
};

/**
 * Candidate Media Library hashes of a URL: the last path segment without its
 * extension, and the same without a format prefix (`thumbnail_abc` -> `abc`),
 * for the admin route that receives format URLs.
 * @param {string} url - URL.
 * @returns {string[]} Hashes.
 */
export const hashCandidates = (url) => {
  const segment = urlBase(url).split('/').pop() || '';
  const dot = segment.lastIndexOf('.');
  const name = dot > 0 ? segment.slice(0, dot) : segment;
  if (!name || name.length > 255) return [];
  const out = [name];
  const underscore = name.indexOf('_');
  if (underscore > 0 && underscore < name.length - 1) out.push(name.slice(underscore + 1));
  return out;
};

/**
 * The URL of `row` (or one of its formats) whose base is `base`, as `{ key }`
 * (`key` null for the file itself, the format name otherwise), or null.
 * @param {object} row - Media Library row.
 * @param {string} base - URL without query.
 * @returns {{ key: string|null }|null} Match.
 */
export const rowUrlFor = (row, base) => {
  if (!isPlainObject(row) || !base) return null;
  if (urlBase(row.url) === base) return { key: null };
  if (isPlainObject(row.formats))
    for (const [key, format] of Object.entries(row.formats))
      if (isPlainObject(format) && urlBase(format.url) === base) return { key };
  return null;
};
