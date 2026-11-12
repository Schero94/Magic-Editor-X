/**
 * Pure logic of the Media Library blocks (gallery, video, audio) and of the
 * focal point control. No DOM, so `node --test` covers it.
 */

import {
  BLOCK_POLICIES,
  MAX_GALLERY_IMAGES,
  MAX_MEDIA_TRACKS,
  TRACK_KINDS,
  cleanFocalPoint,
} from '../../../../shared/sanitize-policy.mjs';

export { MAX_GALLERY_IMAGES, MAX_MEDIA_TRACKS, TRACK_KINDS };

/** Keep inline HTML as it is (the editor value was sanitised before the tool got it). */
const keep = (value) => (typeof value === 'string' ? value : '');
const CTX = { rawHtml: 'disable', rawSanitizer: () => '' };

/**
 * Data of a gallery block with every default filled in.
 * @param {unknown} data - Block data.
 * @returns {{ images: object[], layout: 'grid'|'carousel', columns: number, caption: string }} Data.
 */
export const normalizeGallery = (data) => BLOCK_POLICIES.gallery(isObject(data) ? data : {}, keep, CTX);

/**
 * Data of a video block with every default filled in.
 * @param {unknown} data - Block data.
 * @returns {object} Data.
 */
export const normalizeVideo = (data) => BLOCK_POLICIES.video(isObject(data) ? data : {}, keep, CTX);

/**
 * Data of an audio block with every default filled in.
 * @param {unknown} data - Block data.
 * @returns {object} Data.
 */
export const normalizeAudio = (data) => BLOCK_POLICIES.audio(isObject(data) ? data : {}, keep, CTX);

/**
 * @param {unknown} value - Candidate.
 * @returns {boolean} True for a plain object.
 */
function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

const mimeOf = (asset) => (isObject(asset) && typeof asset.mime === 'string' ? asset.mime.toLowerCase() : '');

/** @param {unknown} asset - Media Library asset. @returns {boolean} True for an image. */
export const isImageAsset = (asset) => mimeOf(asset).startsWith('image/');
/** @param {unknown} asset - Media Library asset. @returns {boolean} True for a video. */
export const isVideoAsset = (asset) => mimeOf(asset).startsWith('video/');
/** @param {unknown} asset - Media Library asset. @returns {boolean} True for an audio file. */
export const isAudioAsset = (asset) => mimeOf(asset).startsWith('audio/');

/**
 * True for a WebVTT file (MIME `text/vtt` or the `.vtt` extension).
 * @param {unknown} asset - Media Library asset.
 * @returns {boolean} Result.
 */
export const isVttAsset = (asset) => {
  if (!isObject(asset)) return false;
  const ext = typeof asset.ext === 'string' ? asset.ext.toLowerCase() : '';
  const name = typeof asset.name === 'string' ? asset.name.toLowerCase() : '';
  return mimeOf(asset) === 'text/vtt' || ext === '.vtt' || name.endsWith('.vtt');
};

/**
 * File reference of a Media Library asset as stored in a block.
 * @param {object} asset - Asset from the Media Library dialog.
 * @param {{ image?: boolean }} [options] - Images keep `alt` (the library's alternative text) and `formats`.
 * @returns {object} File.
 */
export const assetToFile = (asset, options = {}) => {
  const file = { url: typeof asset.url === 'string' ? asset.url : '' };
  for (const key of ['mime', 'name', 'hash', 'ext'])
    if (typeof asset[key] === 'string') file[key] = asset[key];
  for (const key of ['width', 'height', 'size']) if (Number.isFinite(asset[key])) file[key] = asset[key];
  if (asset.id !== undefined && asset.id !== null) file.id = asset.id;
  if (typeof asset.documentId === 'string') file.documentId = asset.documentId;
  if (options.image) {
    file.alt = typeof asset.alternativeText === 'string' ? asset.alternativeText : '';
    if (isObject(asset.formats)) file.formats = asset.formats;
  }
  return file;
};

/**
 * Appends picked images to a gallery, up to `MAX_GALLERY_IMAGES`. Non-images
 * and files without a URL are skipped.
 * @param {object[]} images - Current gallery images.
 * @param {unknown[]} assets - Picked assets.
 * @returns {{ images: object[], added: number, skipped: number }} New list and counts.
 */
export const addGalleryImages = (images, assets) => {
  const out = [...images];
  let added = 0;
  let skipped = 0;
  for (const asset of Array.isArray(assets) ? assets : []) {
    if (
      !isImageAsset(asset) ||
      typeof asset.url !== 'string' ||
      !asset.url ||
      out.length >= MAX_GALLERY_IMAGES
    ) {
      skipped += 1;
      continue;
    }
    out.push({ file: assetToFile(asset, { image: true }), caption: '' });
    added += 1;
  }
  return { images: out, added, skipped };
};

/**
 * Moves one entry of a list.
 * @template T
 * @param {T[]} list - List.
 * @param {number} from - Index to move.
 * @param {number} to - Target index (clamped).
 * @returns {T[]} New list (the same list when nothing moves).
 */
export const moveItem = (list, from, to) => {
  const target = Math.max(0, Math.min(list.length - 1, to));
  if (from < 0 || from >= list.length || from === target) return list;
  const out = [...list];
  const [item] = out.splice(from, 1);
  out.splice(target, 0, item);
  return out;
};

/**
 * Focal point from a pointer position on the preview.
 * @param {{ left: number, top: number, width: number, height: number }} rect - Preview box.
 * @param {number} clientX - Pointer x.
 * @param {number} clientY - Pointer y.
 * @returns {{ x: number, y: number }|null} Point (0..1, two decimals) or null for an empty box.
 */
export const focalFromPointer = (rect, clientX, clientY) => {
  if (!rect || !(rect.width > 0) || !(rect.height > 0)) return null;
  const clamp = (n) => Math.min(1, Math.max(0, n));
  return cleanFocalPoint({
    x: clamp((clientX - rect.left) / rect.width),
    y: clamp((clientY - rect.top) / rect.height),
  });
};

/** Arrow keys and their direction. */
const ARROWS = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };

/**
 * Keyboard alternative for the focal point: arrows move by 1 % (with Shift 10 %).
 * @param {{ x: number, y: number }|undefined} point - Current point (centre when unset).
 * @param {string} key - `KeyboardEvent.key`.
 * @param {boolean} [large] - Shift held.
 * @returns {{ x: number, y: number }|null} New point, or null when the key is not handled.
 */
export const moveFocal = (point, key, large = false) => {
  const direction = ARROWS[key];
  if (!direction) return null;
  const start = cleanFocalPoint(point) || { x: 0.5, y: 0.5 };
  const step = large ? 0.1 : 0.01;
  const clamp = (n) => Math.min(1, Math.max(0, Math.round(n * 100) / 100));
  return { x: clamp(start.x + direction[0] * step), y: clamp(start.y + direction[1] * step) };
};

/**
 * Percentages of a focal point for display and `object-position`.
 * @param {{ x: number, y: number }|undefined} point - Point.
 * @returns {{ x: number, y: number }} Whole percentages (centre when unset).
 */
export const focalPercent = (point) => {
  const clean = cleanFocalPoint(point) || { x: 0.5, y: 0.5 };
  return { x: Math.round(clean.x * 100), y: Math.round(clean.y * 100) };
};

/**
 * A new text track for a picked WebVTT file; the first track becomes the default.
 * @param {object[]} tracks - Current tracks.
 * @param {object} asset - Picked asset.
 * @param {string} [locale] - Content locale used as the default language.
 * @returns {object[]|null} New list, or null when the asset is not a WebVTT file or the list is full.
 */
export const addTrack = (tracks, asset, locale = '') => {
  if (!isVttAsset(asset) || typeof asset.url !== 'string' || !asset.url) return null;
  if (tracks.length >= MAX_MEDIA_TRACKS) return null;
  const srclang = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/.test(locale) ? locale : '';
  const track = { file: assetToFile(asset), kind: 'captions', srclang, label: '' };
  if (!tracks.some((other) => other.default)) track.default = true;
  return [...tracks, track];
};

/**
 * True when a video has captions or subtitles (the quality rule `video-no-captions`).
 * @param {{ tracks?: Array<{ kind?: string }> }} data - Video data.
 * @returns {boolean} Result.
 */
export const hasCaptions = (data) =>
  Array.isArray(data && data.tracks) &&
  data.tracks.some((track) => track && (track.kind === 'captions' || track.kind === 'subtitles'));
