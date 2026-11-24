/**
 * "Edit in Media Library" for image blocks (2.11): helpers shared by the server
 * (GET /config capability) and the admin (image block button, refresh on return).
 *
 * Strapi has no public API to open its crop dialog from a plugin. From Strapi
 * 5.54 the new Media Library is the default and opens the details drawer of an
 * asset from `/admin/plugins/upload?assetId=<id>`; its Crop button replaces the
 * file (same id, new URL and formats) and stores a focal point on a 0-100 scale
 * (`GET /upload/files/:id`). Magic Editor X stores focal points on a 0-1 scale
 * (`cleanFocalPoint`), so values are converted here.
 *
 * Pure functions only (no DOM, no Strapi), so `node --test` covers them.
 */

/** First Strapi version whose default Media Library opens the asset drawer with Crop from `?assetId=`. */
export const ASSET_EDITOR_MIN_VERSION = '5.54.0';

/** Query parameter of the Media Library page that opens the asset details drawer (`@strapi/upload`). */
export const ASSET_DETAILS_PARAM = 'assetId';

/**
 * Parses `major.minor.patch` with an optional pre-release (`5.54.0-beta.1`).
 * @param {unknown} version - Version string.
 * @returns {{ parts: number[], pre: boolean }|null} Numbers and whether it is a pre-release, or null.
 */
const parseVersion = (version) => {
  if (typeof version !== 'string') return null;
  const match = /^v?(\d{1,4})\.(\d{1,4})\.(\d{1,6})(-[0-9A-Za-z.-]{1,64})?(\+[0-9A-Za-z.-]{1,64})?$/.exec(
    version.trim()
  );
  if (!match) return null;
  return { parts: [Number(match[1]), Number(match[2]), Number(match[3])], pre: Boolean(match[4]) };
};

/**
 * Whether `version` is at least `minimum`. A pre-release counts as lower than its release
 * (`5.54.0-beta.1` < `5.54.0`), and anything unparseable answers false.
 * @param {unknown} version - Installed version.
 * @param {string} minimum - Required version (`major.minor.patch`).
 * @returns {boolean} True when the installed version is new enough.
 */
export const isVersionAtLeast = (version, minimum) => {
  const have = parseVersion(version);
  const need = parseVersion(minimum);
  if (!have || !need) return false;
  for (let index = 0; index < 3; index += 1) {
    if (have.parts[index] !== need.parts[index]) return have.parts[index] > need.parts[index];
  }
  return !have.pre || need.pre;
};

/**
 * Whether the running admin uses the Media Library that has the asset drawer with Crop. Strapi
 * 5.54+ exposes `window.strapi.featureFlags.isEnabled('useLegacyMediaLibrary')`; when the
 * project opts back into the legacy Media Library (or the API is missing, before 5.54), the drawer
 * does not exist.
 * @param {unknown} strapiGlobal - `window.strapi`.
 * @returns {boolean} True when the new Media Library is active.
 */
export const hasNewMediaLibrary = (strapiGlobal) => {
  try {
    const flags = strapiGlobal && typeof strapiGlobal === 'object' ? strapiGlobal.featureFlags : null;
    if (!flags || typeof flags.isEnabled !== 'function') return false;
    return flags.isEnabled('useLegacyMediaLibrary') === false;
  } catch {
    return false;
  }
};

/**
 * Whether the "Edit in Media Library" button can work for this admin.
 * @param {{ config?: object|null, strapiGlobal?: unknown, readOnly?: boolean }} input - GET /config
 *   data, `window.strapi` and whether the field is read-only.
 * @returns {boolean} True when the server reports Strapi 5.54+, the admin may read and update
 *   Media Library files, files are public (signed URLs of private providers must not be stored) and
 *   the admin runs the new Media Library.
 */
export const canEditInMediaLibrary = ({ config, strapiGlobal, readOnly = false } = {}) => {
  if (readOnly || !config || typeof config !== 'object') return false;
  const media = config.mediaLibrary || {};
  const permissions = config.permissions || {};
  if (media.assetEditor !== true) return false;
  if (permissions.mediaLibrary !== true || permissions.mediaLibraryUpdate !== true) return false;
  if (config.uploads && config.uploads.privateFiles === true) return false;
  return hasNewMediaLibrary(strapiGlobal);
};

/**
 * Media Library id of a stored image file (positive integer), or null.
 * @param {unknown} file - Stored `file` of an image block.
 * @returns {number|null} Id.
 */
export const mediaLibraryFileId = (file) => {
  if (!file || typeof file !== 'object') return null;
  const raw = file.id;
  const id = typeof raw === 'string' && /^\d{1,15}$/.test(raw) ? Number(raw) : raw;
  return typeof id === 'number' && Number.isSafeInteger(id) && id > 0 ? id : null;
};

/**
 * Deep link that opens the asset details drawer of one file on the Media Library page.
 * @param {string} uploadPath - Admin URL of the Media Library page (`useHref('/plugins/upload')`,
 *   for example `/admin/plugins/upload`); a query or hash is not allowed.
 * @param {unknown} fileId - Media Library file id.
 * @returns {string|null} URL, or null for an invalid id or path.
 */
export const mediaLibraryAssetHref = (uploadPath, fileId) => {
  const id = mediaLibraryFileId({ id: fileId });
  if (!id || typeof uploadPath !== 'string') return null;
  const path = uploadPath.replace(/\/+$/, '');
  if (!/^\/[A-Za-z0-9/_.-]*$/.test(path) || !path.endsWith('/plugins/upload')) return null;
  return `${path}?${ASSET_DETAILS_PARAM}=${id}`;
};

/**
 * Converts a Media Library focal point (0-100 per axis) to the block scale (0-1, two decimals).
 * @param {unknown} point - `focalPoint` of an upload file.
 * @returns {{ x: number, y: number }|undefined} Point, or undefined when missing or out of range.
 */
export const focalFromMediaLibrary = (point) => {
  if (!point || typeof point !== 'object' || Array.isArray(point)) return undefined;
  const { x, y } = point;
  if (![x, y].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 100))
    return undefined;
  return { x: Math.round(x) / 100, y: Math.round(y) / 100 };
};

/** File keys the refresh takes from the Media Library (the block keeps its own `alt`). */
const FILE_KEYS = ['url', 'width', 'height', 'size', 'hash', 'ext', 'mime', 'name', 'documentId'];

/**
 * Formats of an upload file, reduced to what the image block stores.
 * @param {unknown} formats - Upload file formats.
 * @returns {object|undefined} Formats (`url`, `width`, `height`, `size`, `mime`, `ext`, `hash`, `name`).
 */
const cleanFormats = (formats) => {
  if (!formats || typeof formats !== 'object' || Array.isArray(formats)) return undefined;
  const out = {};
  for (const [name, format] of Object.entries(formats).slice(0, 20)) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(name) || !format || typeof format !== 'object') continue;
    if (typeof format.url !== 'string' || !format.url) continue;
    const entry = {};
    for (const key of ['url', 'width', 'height', 'size', 'mime', 'ext', 'hash', 'name']) {
      if (format[key] !== undefined && format[key] !== null) entry[key] = format[key];
    }
    out[name] = entry;
  }
  return Object.keys(out).length ? out : undefined;
};

/**
 * The stored image file after the Media Library changed it (crop, replace): URL, size and formats
 * come from the Media Library, `alt` and every other key stay as the block stores them.
 * @param {object} stored - `file` of the image block.
 * @param {object} fresh - File from `GET /upload/files/:id`.
 * @returns {object|null} New file, or null when the Media Library file is the same (no change, no save).
 */
export const mergeMediaLibraryFile = (stored, fresh) => {
  if (!stored || typeof stored !== 'object' || !fresh || typeof fresh !== 'object') return null;
  const id = mediaLibraryFileId(stored);
  if (!id || mediaLibraryFileId(fresh) !== id) return null;
  if (typeof fresh.url !== 'string' || !/^(https?:\/\/|\/(?!\/))/i.test(fresh.url)) return null;
  const next = { ...stored };
  let changed = false;
  for (const key of FILE_KEYS) {
    const value = fresh[key];
    if (value === undefined || value === null) continue;
    if (next[key] !== value) {
      next[key] = value;
      changed = true;
    }
  }
  const formats = cleanFormats(fresh.formats);
  // Compared in the same reduced shape on both sides: keys the block never stores are no change.
  if (formats && JSON.stringify(formats) !== JSON.stringify(cleanFormats(stored.formats) || null)) {
    next.formats = formats;
    changed = true;
  }
  return changed ? next : null;
};

/**
 * URL to show a refreshed file in the editor. Strapi keeps the URL when a file is replaced (crop,
 * "Replace"), so the browser would show its cached copy; like the Media Library itself, the display
 * URL carries the file's `updatedAt`. The stored URL never gets this parameter.
 * @param {string} url - Stored file URL.
 * @param {unknown} version - `updatedAt` (or hash) of the Media Library file.
 * @returns {string} URL for display.
 */
export const mediaDisplayUrl = (url, version) => {
  if (typeof url !== 'string' || !url) return '';
  if (typeof version !== 'string' || !/^[A-Za-z0-9:._-]{1,64}$/.test(version)) return url;
  const [base, hash = ''] = url.split('#');
  const joined = `${base}${base.includes('?') ? '&' : '?'}mexv=${encodeURIComponent(version)}`;
  return hash ? `${joined}#${hash}` : joined;
};
