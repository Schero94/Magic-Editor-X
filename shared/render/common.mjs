/**
 * Shared preparation for the renderers: normalises a stored value, cleans each
 * block with the shared content policy (using the strict inline parser) and
 * groups toggle children, so the three output formats see the same tree.
 */

import { normalizeEditorDataSafe, isPlainObject } from '../editor-data.mjs';
import {
  BLOCK_POLICIES,
  sanitizeTunes,
  sanitizeUrl,
  isBuiltInBlock,
  cleanMediaFile,
} from '../sanitize-policy.mjs';
import { inlineToHtml } from './inline.mjs';

/**
 * @typedef {object} PreparedBlock
 * @property {string} id - Block id.
 * @property {string} type - Block type.
 * @property {object} data - Data cleaned by the shared policy (built-in types) or the original data (other types).
 * @property {object} raw - Normalised data before cleaning (read only for optional keys such as `decorative`).
 * @property {object|undefined} tunes - Clean tunes.
 * @property {boolean} known - True for built-in block types.
 * @property {PreparedBlock[]} children - Toggle content.
 */

/** Policy-pass inline cleaner: keeps the stored attributes (links are resolved later). */
const keepInline = (html) => inlineToHtml(html);

/**
 * Normalises any stored value and returns cleaned blocks with toggle children grouped.
 * @param {unknown} value - Stored field value (object, JSON string, legacy shapes).
 * @param {{ rawHtml?: string, sanitizeRaw?: (html: string) => string }} [options] - Render options.
 * @returns {PreparedBlock[]} Blocks in document order.
 */
export const prepareBlocks = (value, options = {}) => {
  const data = normalizeEditorDataSafe(value);
  if (!data) return [];
  const rawPolicy =
    options.rawHtml === 'allow' && typeof options.sanitizeRaw === 'function' ? 'allow' : 'disable';
  const ctx = { rawHtml: rawPolicy, rawSanitizer: () => '' };
  const flat = data.blocks.map((block) => {
    const raw = isPlainObject(block.data) ? block.data : {};
    const known = isBuiltInBlock({ type: block.type, data: raw });
    const clean = known ? BLOCK_POLICIES[block.type](raw, keepInline, ctx) : raw;
    for (const key of Object.keys(clean)) if (clean[key] === undefined) delete clean[key];
    return {
      id: block.id,
      type: block.type,
      data: clean,
      raw,
      tunes: sanitizeTunes(block.tunes),
      known,
      children: [],
    };
  });
  /**
   * Builds the tree from position `start` until `end`.
   * @param {number} start - First index.
   * @param {number} end - Index after the last one.
   * @param {number} depth - Toggle nesting depth.
   * @returns {PreparedBlock[]} Blocks.
   */
  const group = (start, end, depth) => {
    const out = [];
    let i = start;
    while (i < end) {
      const block = flat[i];
      i += 1;
      if (block.type === 'toggle' && depth < 16) {
        const count = Math.max(0, Math.min(Number(block.data.items) || 0, end - i));
        block.children = group(i, i + count, depth + 1);
        i += count;
      }
      out.push(block);
    }
    return out;
  };
  return group(0, flat.length, 0);
};

/** Strapi Media Library format names, smallest first (used for stable ordering). */
const FORMAT_ORDER = ['thumbnail', 'xsmall', 'small', 'medium', 'large', 'xlarge'];

/**
 * Image source set from the Media Library `formats` of a file.
 * @param {object} file - Clean file object.
 * @returns {Array<{ url: string, width: number }>} Candidates sorted by width (duplicates removed).
 */
export const imageCandidates = (file) => {
  const out = [];
  const seen = new Set();
  const push = (url, width) => {
    const clean = sanitizeUrl(url, { schemes: ['http', 'https'] });
    if (!clean || !Number.isInteger(width) || width <= 0 || seen.has(width)) return;
    seen.add(width);
    out.push({ url: clean, width });
  };
  if (isPlainObject(file.formats)) {
    const names = Object.keys(file.formats).sort(
      (a, b) =>
        (FORMAT_ORDER.indexOf(a) + 1 || 99) - (FORMAT_ORDER.indexOf(b) + 1 || 99) ||
        (a < b ? -1 : a > b ? 1 : 0)
    );
    for (const name of names) {
      const format = file.formats[name];
      if (isPlainObject(format)) push(format.url, Number(format.width));
    }
  }
  push(file.url, Number(file.width));
  return out.sort((a, b) => a.width - b.width);
};

/**
 * Runs the caller's media hook and re-validates its result.
 * @param {object} file - Clean file from the block.
 * @param {object} block - Prepared block.
 * @param {{ media?: Function }} options - Render options.
 * @param {{ mimePrefix?: string, vtt?: boolean }} [kind] - Kind of a non-image file (video, audio, track); images when omitted.
 * @returns {object} File to render.
 */
export const resolveMedia = (file, block, options, kind) => {
  if (typeof options.media !== 'function') return file;
  if (kind) {
    let other;
    try {
      other = options.media({ ...file }, { id: block.id, type: block.type });
    } catch {
      other = null;
    }
    return isPlainObject(other) ? cleanMediaFile(other, kind) : file;
  }
  let next;
  try {
    next = options.media({ ...file }, { id: block.id, type: block.type });
  } catch {
    next = null;
  }
  if (!isPlainObject(next)) return file;
  const policy = BLOCK_POLICIES.image({ file: next }, (s) => s, {
    rawHtml: 'disable',
    rawSanitizer: () => '',
  });
  return policy.file;
};

/** Default iframe hosts for embed blocks. */
export const DEFAULT_EMBED_HOSTS = Object.freeze([
  'www.youtube-nocookie.com',
  'www.youtube.com',
  'youtube.com',
  'player.vimeo.com',
  'codepen.io',
  'player.twitch.tv',
  'clips.twitch.tv',
  'embed.figma.com',
  'www.figma.com',
  'miro.com',
]);

/**
 * Embed URL usable in an iframe, or ''.
 * @param {string} url - Clean embed URL.
 * @param {readonly string[]} hosts - Allowed hosts (exact match).
 * @returns {string} URL or ''.
 */
export const embedFrameUrl = (url, hosts) => {
  if (!url || !/^https:\/\//i.test(url)) return '';
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && hosts.includes(parsed.hostname.toLowerCase()) ? url : '';
  } catch {
    return '';
  }
};

/**
 * Value of `options.overrides[type]` when it is a function.
 * @param {object} options - Render options.
 * @param {string} type - Block type.
 * @returns {Function|null} Override.
 */
export const overrideFor = (options, type) => {
  const overrides = options && options.overrides;
  if (!overrides || typeof overrides !== 'object' || !Object.prototype.hasOwnProperty.call(overrides, type))
    return null;
  return typeof overrides[type] === 'function' ? overrides[type] : null;
};

/**
 * Top-level scalar values of a custom block, in key order, for neutral rendering.
 * @param {object} data - Block data.
 * @returns {Array<[string, string]>} Key and text pairs.
 */
export const scalarFields = (data) =>
  Object.keys(isPlainObject(data) ? data : {})
    .filter((key) => /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(key))
    .filter((key) => ['string', 'number', 'boolean'].includes(typeof data[key]))
    .map((key) => [key, String(data[key])]);

/** Human-readable file size. */
export const formatSize = (bytes) => {
  if (!Number.isFinite(bytes) || bytes < 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};
