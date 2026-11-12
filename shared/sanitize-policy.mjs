/**
 * One content policy for every Magic Editor X block, shared by the server
 * (sanitize-html) and the admin (DOMPurify).
 *
 * The policy says, per block type, which data keys hold inline HTML, which hold
 * URLs, which hold plain text and which are enumerations. `sanitizeEditorData`
 * walks a normalised document and calls the injected `sanitizeInlineHtml`
 * function for HTML strings, so each side can use its own parser while the rules
 * stay identical.
 */

import { isPlainObject } from './editor-data.mjs';

/** Inline tags the editor tools produce. Everything else is removed (text is kept). */
export const INLINE_TAGS = Object.freeze([
  'b',
  'strong',
  'i',
  'em',
  'u',
  's',
  'mark',
  'code',
  'a',
  'br',
  'span',
  'sub',
  'sup',
]);

/**
 * Data attributes of an internal link (`<a href data-mex-uid data-mex-document-id data-mex-locale>`),
 * written by the hyperlink tool's entry picker. Frontends can resolve the entry
 * from them; the `href` stays a normal URL. A mention (inline entry reference,
 * 2.3) is an internal link with `data-mex-mention="true"`: the same rules,
 * link checks and resolution apply, and API output may replace its text with
 * the entry's current title.
 */
export const INTERNAL_LINK_ATTRIBUTES = Object.freeze([
  'data-mex-uid',
  'data-mex-document-id',
  'data-mex-locale',
  'data-mex-mention',
]);

const INTERNAL_LINK_RULES = Object.freeze({
  'data-mex-uid': /^api::[a-z0-9-]{1,60}\.[a-z0-9-]{1,60}$/,
  'data-mex-document-id': /^[a-z0-9]{1,64}$/,
  'data-mex-locale': /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/,
  // Boolean flag: written as "true"; an empty value (`<a data-mex-mention>`) is accepted and normalised.
  'data-mex-mention': /^(?:|true)$/,
});

/**
 * Keeps only valid internal-link attributes. A reference needs both a uid and a
 * documentId; when either is missing or invalid, all of them are dropped. The
 * mention flag is normalised to `"true"`.
 * @param {Record<string, unknown>} attribs - Attributes of an `<a>` element.
 * @returns {Record<string, string>} Valid internal-link attributes (possibly empty).
 */
export const cleanInternalLinkAttributes = (attribs) => {
  const out = {};
  if (!attribs || typeof attribs !== 'object') return out;
  for (const name of INTERNAL_LINK_ATTRIBUTES) {
    const value = attribs[name];
    if (typeof value === 'string' && INTERNAL_LINK_RULES[name].test(value)) out[name] = value;
  }
  if (!out['data-mex-uid'] || !out['data-mex-document-id']) return {};
  if (out['data-mex-mention'] !== undefined) out['data-mex-mention'] = 'true';
  return out;
};

/**
 * True when link attributes describe a mention (internal link with the mention flag).
 * @param {Record<string, unknown>|null|undefined} attrs - Clean link attributes.
 * @returns {boolean} Result.
 */
export const isMentionLink = (attrs) =>
  Boolean(
    attrs && attrs['data-mex-mention'] === 'true' && attrs['data-mex-uid'] && attrs['data-mex-document-id']
  );

/** Attributes allowed per inline tag. */
export const INLINE_ATTRIBUTES = Object.freeze({
  a: ['href', 'target', 'rel', 'title', ...INTERNAL_LINK_ATTRIBUTES],
  span: ['class', 'data-tooltip'],
  mark: ['class'],
  u: ['class'],
  s: ['class'],
  code: ['class'],
});

/** Class names the inline tools use. */
export const INLINE_CLASSES = Object.freeze({
  span: ['cdx-tooltip'],
  mark: ['cdx-marker'],
  u: ['cdx-underline'],
  s: ['cdx-strikethrough', 'cdx-strikethroughs'],
  code: ['inline-code'],
});

/** URL schemes allowed in links. Relative URLs ("/uploads/x.png", "#top") are allowed too. */
export const LINK_SCHEMES = Object.freeze(['http', 'https', 'mailto', 'tel']);

const MAX_URL_LENGTH = 2048;
const TARGETS = new Set(['_blank', '_self', '_parent', '_top']);

/**
 * Validates a URL for use in stored content.
 * Allows http(s), mailto, tel and site-relative URLs; rejects javascript:, data:,
 * protocol-relative URLs, control characters and credentials.
 * @param {unknown} value - Candidate URL.
 * @param {{ schemes?: readonly string[], allowRelative?: boolean }} [options] - Allowed schemes.
 * @returns {string} The URL, or '' when it is not allowed.
 */
export const sanitizeUrl = (value, options = {}) => {
  const schemes = options.schemes || LINK_SCHEMES;
  const allowRelative = options.allowRelative !== false;
  if (typeof value !== 'string') return '';
  const url = value.trim();
  if (!url || url.length > MAX_URL_LENGTH) return '';
  // eslint-disable-next-line no-control-regex -- control characters are exactly what must be rejected here
  if (/[\u0000-\u001f\u007f\s]/.test(url) && !/^(mailto|tel):/i.test(url)) return '';
  if (url.startsWith('//') || url.startsWith('\\')) return '';
  const scheme = /^([a-zA-Z][a-zA-Z0-9+.-]{0,20}):/.exec(url);
  if (!scheme) {
    return allowRelative && /^[/#?.]/.test(url) ? url : '';
  }
  if (!schemes.includes(scheme[1].toLowerCase())) return '';
  if (scheme[1].toLowerCase().startsWith('http')) {
    try {
      const parsed = new URL(url);
      if (parsed.username || parsed.password) return '';
    } catch {
      return '';
    }
  }
  return url;
};

/**
 * Plain text: keep as is but bound the length. Rendering code must escape it.
 * @param {unknown} value - Candidate text.
 * @param {number} [max=100000] - Maximum length.
 * @returns {string} Text.
 */
const plain = (value, max = 100000) => (typeof value === 'string' ? value.slice(0, max) : '');

/**
 * Picks one value from an allowed list.
 * @param {unknown} value - Candidate.
 * @param {readonly string[]} allowed - Allowed values.
 * @param {string} fallback - Default.
 * @returns {string} Allowed value.
 */
const oneOf = (value, allowed, fallback) =>
  typeof value === 'string' && allowed.includes(value) ? value : fallback;

/**
 * Bounded integer.
 * @param {unknown} value - Candidate.
 * @param {number} min - Minimum.
 * @param {number} max - Maximum.
 * @param {number|undefined} fallback - Default.
 * @returns {number|undefined} Integer within range.
 */
const int = (value, min, max, fallback) => {
  const number = typeof value === 'string' ? Number(value) : value;
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
};

const bool = (value) => value === true;

/** Most images in a gallery block. */
export const MAX_GALLERY_IMAGES = 50;
/** Most text tracks (captions, subtitles) of a video or audio block. */
export const MAX_MEDIA_TRACKS = 8;
/** Kinds of a `<track>`. */
export const TRACK_KINDS = Object.freeze(['captions', 'subtitles', 'descriptions', 'chapters']);
const SRCLANG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8}){0,3}$/;

/**
 * Focal point of an image: `{ x, y }` in 0..1 with two decimals.
 * @param {unknown} value - Candidate.
 * @returns {{ x: number, y: number }|undefined} Clean point or undefined.
 */
export const cleanFocalPoint = (value) => {
  if (!isPlainObject(value)) return undefined;
  const { x, y } = value;
  if (![x, y].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)) return undefined;
  return { x: Math.round(x * 100) / 100, y: Math.round(y * 100) / 100 };
};

/**
 * Cleans a Media Library file reference of a gallery, video or audio block.
 * The URL must be http(s) or site-relative; when the file names a MIME type it
 * must start with `mimePrefix` (else the URL is emptied).
 * @param {unknown} value - Stored file.
 * @param {{ mimePrefix?: string, image?: boolean, vtt?: boolean }} kind - Expected file kind.
 * @returns {object} Clean file (`url` always present).
 */
export const cleanMediaFile = (value, kind = {}) => {
  const file = isPlainObject(value) ? value : {};
  const out = { url: sanitizeUrl(file.url, { schemes: ['http', 'https'] }) };
  for (const key of ['mime', ...(kind.image ? ['alt'] : []), 'name', 'hash', 'ext'])
    if (typeof file[key] === 'string') out[key] = plain(file[key], 500);
  for (const key of ['width', 'height', 'size']) if (Number.isFinite(file[key])) out[key] = file[key];
  if (kind.image && isPlainObject(file.formats))
    out.formats = generic(file.formats, (s) => plain(s, 2048), 0, 'formats');
  if (file.id !== undefined && (Number.isInteger(file.id) || typeof file.id === 'string')) out.id = file.id;
  if (typeof file.documentId === 'string') out.documentId = plain(file.documentId, 64);
  const mime = typeof out.mime === 'string' ? out.mime.toLowerCase() : '';
  if (kind.mimePrefix && mime && !mime.startsWith(kind.mimePrefix)) out.url = '';
  if (kind.vtt && out.url) {
    const path = out.url.split(/[?#]/)[0].toLowerCase();
    const ext = typeof out.ext === 'string' ? out.ext.toLowerCase() : '';
    if (mime !== 'text/vtt' && ext !== '.vtt' && !path.endsWith('.vtt')) out.url = '';
  }
  return out;
};

/**
 * Text tracks (WebVTT captions/subtitles) of a video or audio block.
 * @param {unknown} tracks - Stored tracks.
 * @returns {Array<object>} Clean tracks (entries without a usable file are dropped).
 */
const mediaTracks = (tracks) => {
  if (!Array.isArray(tracks)) return [];
  const out = [];
  let hasDefault = false;
  for (const track of tracks.slice(0, MAX_MEDIA_TRACKS)) {
    if (!isPlainObject(track)) continue;
    const file = cleanMediaFile(track.file, { vtt: true });
    if (!file.url) continue;
    const clean = {
      file,
      kind: oneOf(track.kind, TRACK_KINDS, 'captions'),
      srclang: typeof track.srclang === 'string' && SRCLANG.test(track.srclang) ? track.srclang : '',
      label: plain(track.label, 100),
    };
    if (track.default === true && !hasDefault) {
      clean.default = true;
      hasDefault = true;
    }
    out.push(clean);
  }
  return out;
};

/**
 * Generic sanitiser for unknown block types and custom blocks: every string is
 * treated as inline HTML, every key that names a URL is validated as a URL.
 * @param {unknown} value - Data value.
 * @param {(html: string) => string} inline - Inline HTML sanitiser.
 * @param {number} depth - Current depth.
 * @param {string} [key] - Key of the value in its parent.
 * @returns {unknown} Sanitised value.
 */
const generic = (value, inline, depth = 0, key = '') => {
  if (depth > 20) return null;
  if (typeof value === 'string') {
    if (/^(url|href|link|src|photo|source|embed)$/i.test(key)) return sanitizeUrl(value);
    return inline(value);
  }
  if (Array.isArray(value)) return value.map((item) => generic(item, inline, depth + 1, key));
  if (isPlainObject(value)) {
    const out = {};
    for (const [childKey, child] of Object.entries(value))
      out[childKey] = generic(child, inline, depth + 1, childKey);
    return out;
  }
  return value;
};

/**
 * Sanitises the items of a list block (nested-list, list v2 and legacy string items).
 * @param {unknown} items - Items array.
 * @param {(html: string) => string} inline - Inline HTML sanitiser.
 * @param {number} depth - Nesting depth.
 * @returns {Array} Clean items.
 */
const listItems = (items, inline, depth = 0) => {
  if (!Array.isArray(items) || depth > 12) return [];
  return items.map((item) => {
    if (typeof item === 'string') return inline(item);
    if (!isPlainObject(item)) return { content: '', items: [] };
    const out = { content: inline(typeof item.content === 'string' ? item.content : plain(item.text)) };
    if (isPlainObject(item.meta)) {
      const meta = {};
      if (typeof item.meta.checked === 'boolean') meta.checked = item.meta.checked;
      const start = int(item.meta.start, 0, 100000, undefined);
      if (start !== undefined) meta.start = start;
      if (typeof item.meta.counterType === 'string') {
        meta.counterType = oneOf(
          item.meta.counterType,
          ['numeric', 'lower-roman', 'upper-roman', 'lower-alpha', 'upper-alpha'],
          'numeric'
        );
      }
      out.meta = meta;
    }
    out.items = listItems(item.items, inline, depth + 1);
    return out;
  });
};

/**
 * Per-type sanitisers. Each receives the block data and the inline sanitiser and
 * returns new data. Unknown keys are dropped for known types, so stored content
 * only ever contains what the tool itself writes.
 * @type {Record<string, (data: object, inline: (html: string) => string, ctx: { rawHtml: string, rawSanitizer: (html: string) => string }) => object>}
 */
export const BLOCK_POLICIES = {
  paragraph: (d, inline) => ({ text: inline(d.text) }),
  header: (d, inline) => ({ text: inline(d.text), level: int(d.level, 1, 6, 2) }),
  quote: (d, inline) => ({
    text: inline(d.text),
    caption: inline(d.caption),
    alignment: oneOf(d.alignment, ['left', 'center'], 'left'),
  }),
  list: (d, inline) => {
    const out = {
      style: oneOf(d.style, ['ordered', 'unordered', 'checklist'], 'unordered'),
      items: listItems(d.items, inline),
    };
    if (isPlainObject(d.meta)) {
      const meta = {};
      const start = int(d.meta.start, 0, 100000, undefined);
      if (start !== undefined) meta.start = start;
      if (typeof d.meta.counterType === 'string') {
        meta.counterType = oneOf(
          d.meta.counterType,
          ['numeric', 'lower-roman', 'upper-roman', 'lower-alpha', 'upper-alpha'],
          'numeric'
        );
      }
      out.meta = meta;
    }
    return out;
  },
  checklist: (d, inline) => ({
    items: Array.isArray(d.items)
      ? d.items
          .filter(isPlainObject)
          .map((item) => ({ text: inline(item.text), checked: bool(item.checked) }))
      : [],
  }),
  warning: (d, inline) => ({ title: inline(d.title), message: inline(d.message) }),
  alert: (d, inline) => ({
    type: oneOf(
      d.type,
      ['primary', 'secondary', 'info', 'success', 'warning', 'danger', 'light', 'dark'],
      'info'
    ),
    align: oneOf(d.align, ['left', 'center', 'right'], 'left'),
    message: inline(d.message),
  }),
  toggle: (d, inline) => ({
    text: inline(d.text),
    status: oneOf(d.status, ['open', 'closed'], 'open'),
    fk: typeof d.fk === 'string' ? d.fk.slice(0, 64) : undefined,
    items: int(d.items, 0, 5000, 0),
  }),
  code: (d) => ({ code: plain(d.code, 500000) }),
  codeFlask: (d) => {
    const out = {
      code: plain(d.code, 500000),
      language:
        typeof d.language === 'string' && /^[a-z0-9+#-]{1,32}$/i.test(d.language) ? d.language : 'plaintext',
    };
    if (typeof d.showlinenumbers === 'boolean') out.showlinenumbers = d.showlinenumbers;
    return out;
  },
  raw: (d, _inline, ctx) => {
    const html = plain(d.html, 500000);
    if (ctx.rawHtml === 'allow') return { html };
    if (ctx.rawHtml === 'disable') return { html: '' };
    return { html: ctx.rawSanitizer(html) };
  },
  table: (d, inline) => ({
    withHeadings: bool(d.withHeadings),
    stretched: bool(d.stretched),
    content: Array.isArray(d.content)
      ? d.content
          .slice(0, 500)
          .map((row) => (Array.isArray(row) ? row.slice(0, 100).map((cell) => inline(cell)) : []))
      : [],
  }),
  image: (d, inline) => {
    const file = isPlainObject(d.file) ? d.file : {};
    const cleanFile = { url: sanitizeUrl(file.url, { schemes: ['http', 'https'] }) };
    for (const key of ['mime', 'alt', 'name', 'hash', 'ext'])
      if (typeof file[key] === 'string') cleanFile[key] = plain(file[key], 500);
    for (const key of ['width', 'height', 'size']) if (Number.isFinite(file[key])) cleanFile[key] = file[key];
    if (isPlainObject(file.formats))
      cleanFile.formats = generic(file.formats, (s) => plain(s, 2048), 0, 'formats');
    if (file.id !== undefined && (Number.isInteger(file.id) || typeof file.id === 'string'))
      cleanFile.id = file.id;
    if (typeof file.documentId === 'string') cleanFile.documentId = plain(file.documentId, 64);
    const out = {
      file: cleanFile,
      caption: inline(d.caption),
      withBorder: bool(d.withBorder),
      withBackground: bool(d.withBackground),
      stretched: bool(d.stretched),
    };
    // Intentionally empty alternative text (decorative image), set in the image block.
    if (d.decorative === true) out.decorative = true;
    const focalPoint = cleanFocalPoint(d.focalPoint);
    if (focalPoint) out.focalPoint = focalPoint;
    return out;
  },
  simpleImage: (d, inline) => {
    const out = {
      url: sanitizeUrl(d.url, { schemes: ['http', 'https'] }),
      caption: inline(d.caption),
      withBorder: bool(d.withBorder),
      withBackground: bool(d.withBackground),
      stretched: bool(d.stretched),
    };
    if (typeof d.alt === 'string') out.alt = plain(d.alt, 500);
    if (d.decorative === true) out.decorative = true;
    return out;
  },
  gallery: (d, inline) => {
    const images = [];
    for (const item of Array.isArray(d.images) ? d.images : []) {
      if (images.length >= MAX_GALLERY_IMAGES) break;
      if (!isPlainObject(item)) continue;
      const file = cleanMediaFile(item.file, { image: true, mimePrefix: 'image/' });
      if (!file.url) continue;
      const image = { file, caption: inline(item.caption) };
      if (item.decorative === true) image.decorative = true;
      const focalPoint = cleanFocalPoint(item.focalPoint);
      if (focalPoint) image.focalPoint = focalPoint;
      images.push(image);
    }
    return {
      images,
      layout: oneOf(d.layout, ['grid', 'carousel'], 'grid'),
      columns: int(d.columns, 1, 6, 3),
      caption: inline(d.caption),
    };
  },
  video: (d, inline) => {
    const out = {
      file: cleanMediaFile(d.file, { mimePrefix: 'video/' }),
      title: plain(d.title, 200),
      caption: inline(d.caption),
      loop: bool(d.loop),
      muted: bool(d.muted),
      tracks: mediaTracks(d.tracks),
    };
    if (isPlainObject(d.poster)) {
      const poster = cleanMediaFile(d.poster, { image: true, mimePrefix: 'image/' });
      if (poster.url) out.poster = poster;
    }
    return out;
  },
  audio: (d, inline) => ({
    file: cleanMediaFile(d.file, { mimePrefix: 'audio/' }),
    title: plain(d.title, 200),
    caption: inline(d.caption),
    loop: bool(d.loop),
    tracks: mediaTracks(d.tracks),
  }),
  linkTool: (d) => {
    const meta = isPlainObject(d.meta) ? d.meta : {};
    const image = isPlainObject(meta.image)
      ? { url: sanitizeUrl(meta.image.url, { schemes: ['http', 'https'] }) }
      : undefined;
    const cleanMeta = { title: plain(meta.title, 500), description: plain(meta.description, 2000) };
    if (typeof meta.site_name === 'string') cleanMeta.site_name = plain(meta.site_name, 200);
    if (image && image.url) cleanMeta.image = image;
    return { link: sanitizeUrl(d.link, { schemes: ['http', 'https'] }), meta: cleanMeta };
  },
  attaches: (d) => {
    const file = isPlainObject(d.file) ? d.file : {};
    const cleanFile = { url: sanitizeUrl(file.url, { schemes: ['http', 'https'] }) };
    if (typeof file.name === 'string') cleanFile.name = plain(file.name, 255);
    if (typeof file.extension === 'string') cleanFile.extension = plain(file.extension, 16);
    if (Number.isFinite(file.size)) cleanFile.size = file.size;
    if (typeof file.title === 'string') cleanFile.title = plain(file.title, 255);
    return { file: cleanFile, title: plain(d.title, 255) };
  },
  embed: (d, inline) => ({
    service: typeof d.service === 'string' && /^[a-z0-9_-]{1,40}$/i.test(d.service) ? d.service : '',
    source: sanitizeUrl(d.source, { schemes: ['https', 'http'], allowRelative: false }),
    embed: sanitizeUrl(d.embed, { schemes: ['https'], allowRelative: false }),
    width: int(d.width, 1, 10000, undefined),
    height: int(d.height, 1, 10000, undefined),
    caption: inline(d.caption),
  }),
  personality: (d) => ({
    name: plain(d.name, 500),
    description: plain(d.description, 2000),
    link: sanitizeUrl(d.link, { schemes: ['http', 'https', 'mailto'] }),
    photo: sanitizeUrl(d.photo, { schemes: ['http', 'https'] }),
  }),
  button: (d) => ({
    text: plain(d.text, 200),
    link: sanitizeUrl(d.link),
    style: oneOf(d.style, ['primary', 'secondary', 'outline', 'ghost', 'danger', 'success'], 'primary'),
    openInNewTab: bool(d.openInNewTab),
  }),
  delimiter: () => ({}),
  toc: (d) => {
    const minLevel = int(d.minLevel, 1, 6, 2);
    const maxLevel = int(d.maxLevel, 1, 6, 4);
    return {
      title: plain(d.title, 200),
      minLevel: Math.min(minLevel, maxLevel),
      maxLevel: Math.max(minLevel, maxLevel),
      style: oneOf(d.style, ['ordered', 'unordered'], 'unordered'),
    };
  },
};

/**
 * Block types added in 2.3 and the key their data always has. Before 2.3 a
 * custom block could use one of these names; such stored data lacks the key
 * and keeps being treated as custom block data (generic policy, neutral
 * rendering), so it is never stripped.
 */
export const MEDIA_BLOCK_MARKERS = Object.freeze({ gallery: 'images', video: 'file', audio: 'file' });

/**
 * True when a block is a built-in block type whose policy applies.
 * @param {{ type?: unknown, data?: unknown }} block - Block.
 * @returns {boolean} Result.
 */
export const isBuiltInBlock = (block) => {
  if (!block || typeof block.type !== 'string') return false;
  if (!Object.prototype.hasOwnProperty.call(BLOCK_POLICIES, block.type)) return false;
  const marker = Object.prototype.hasOwnProperty.call(MEDIA_BLOCK_MARKERS, block.type)
    ? MEDIA_BLOCK_MARKERS[block.type]
    : null;
  if (!marker) return true;
  return isPlainObject(block.data) && Object.prototype.hasOwnProperty.call(block.data, marker);
};

/**
 * Sanitises tune data. Known tunes are validated; unknown tunes are dropped.
 * @param {unknown} tunes - Block tunes.
 * @returns {object|undefined} Clean tunes, or undefined when none remain.
 */
export const sanitizeTunes = (tunes) => {
  if (!isPlainObject(tunes)) return undefined;
  const out = {};
  if (isPlainObject(tunes.alignmentTune)) {
    out.alignmentTune = {
      alignment: oneOf(tunes.alignmentTune.alignment, ['left', 'center', 'right', 'justify'], 'left'),
    };
  }
  if (typeof tunes.textVariant === 'string') {
    out.textVariant = oneOf(tunes.textVariant, ['', 'call-out', 'citation', 'details'], '');
  }
  if (isPlainObject(tunes.indentTune)) {
    out.indentTune = { indentLevel: int(tunes.indentTune.indentLevel, 0, 10, 0) };
  }
  return Object.keys(out).length ? out : undefined;
};

/**
 * Sanitises a normalised Editor.js document.
 * @param {{ time: number, blocks: Array<{id: string, type: string, data: object, tunes?: object}>, version: string }} data - Normalised document.
 * @param {{ sanitizeInlineHtml: (html: string) => string, sanitizeRawHtml: (html: string) => string, rawHtml?: 'sanitize'|'allow'|'disable' }} options - Sanitisers and raw HTML policy.
 * @returns {typeof data} A new, sanitised document.
 */
export const sanitizeEditorData = (data, options) => {
  if (!data) return data;
  const inline = (value) => (typeof value === 'string' ? options.sanitizeInlineHtml(value) : '');
  const ctx = { rawHtml: options.rawHtml || 'sanitize', rawSanitizer: options.sanitizeRawHtml };
  const blocks = data.blocks.map((block) => {
    const policy = isBuiltInBlock(block) ? BLOCK_POLICIES[block.type] : null;
    const cleanData = policy ? policy(block.data || {}, inline, ctx) : generic(block.data || {}, inline, 0);
    for (const key of Object.keys(cleanData)) if (cleanData[key] === undefined) delete cleanData[key];
    const out = { id: block.id, type: block.type, data: cleanData };
    const tunes = sanitizeTunes(block.tunes);
    if (tunes) out.tunes = tunes;
    return out;
  });
  return { time: data.time, blocks, version: data.version };
};

/**
 * Validates a link target attribute.
 * @param {unknown} value - Candidate target.
 * @returns {string|null} Allowed target or null.
 */
export const sanitizeTarget = (value) => (typeof value === 'string' && TARGETS.has(value) ? value : null);
