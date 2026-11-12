/**
 * Reference handling for API output (Content API `?mex=` and GraphQL fields).
 *
 * A stored Magic Editor X value can reference other data:
 * - internal links: `<a href data-mex-uid data-mex-document-id data-mex-locale>` in inline HTML
 *   (mentions are internal links with `data-mex-mention="true"`),
 * - embedded entries: custom blocks of type `embedded-entry` (`{ entry: { documentId, ... }, contentType }`),
 * - Media Library files with `id` or `documentId`: `image` blocks, gallery
 *   images, video and audio files, video posters and text tracks.
 *
 * This module is pure: it lists the references of a value (`collectReferences`),
 * applies a resolution map produced by the server with the caller's permissions
 * (`applyReferences`) and renders the result (`renderResolved`). It only uses
 * the public renderer functions.
 */

import { normalizeEditorDataSafe, isPlainObject } from './editor-data.mjs';
import { isBuiltInBlock, isMentionLink } from './sanitize-policy.mjs';
import { parseInline, nodesToHtml } from './render/inline.mjs';
import {
  renderHtml,
  renderText,
  renderMarkdown,
  inlineToHtml,
  escapeHtml,
  escapeMarkdown,
} from './render/index.mjs';

/** Output formats of `?mex=` (and the GraphQL `format` argument, lower-cased). */
export const OUTPUT_FORMATS = Object.freeze(['html', 'text', 'markdown', 'json']);

const API_UID = /^api::[a-z0-9_-]{1,100}\.[a-z0-9_-]{1,100}$/;
const DOCUMENT_ID = /^[A-Za-z0-9]{1,64}$/;
const LOCALE = /^[A-Za-z0-9-]{1,20}$/;
const BLOCK_NAME = /^[a-zA-Z][a-zA-Z0-9_-]{0,49}$/;
const MAX_DEPTH = 12;

/**
 * @typedef {object} Reference
 * @property {'link'|'entry'|'media'} kind - Reference kind.
 * @property {string} [uid] - Target content type (link, entry).
 * @property {string} [documentId] - Target documentId (link, entry, media by documentId).
 * @property {string|null} [locale] - Target locale (link, entry); null = default locale.
 * @property {number} [id] - Media file id.
 * @property {string} [blockType] - Block type of an embedded entry (for its custom block definition).
 */

/**
 * @param {unknown} value - Candidate.
 * @returns {string|null} Locale code or null.
 */
const cleanLocale = (value) => (typeof value === 'string' && LOCALE.test(value) ? value : null);

/**
 * Key of a link or entry reference.
 * @param {'link'|'entry'} kind - Kind.
 * @param {string} uid - Content type uid.
 * @param {string|null} locale - Locale.
 * @param {string} documentId - documentId.
 * @returns {string} Key.
 */
export const entryKey = (kind, uid, locale, documentId) => `${kind}|${uid}|${locale || ''}|${documentId}`;

/**
 * Key of a media reference.
 * @param {{ id?: unknown, documentId?: unknown }} file - Stored file.
 * @returns {string|null} Key or null when the file has no usable id.
 */
export const mediaKey = (file) => {
  if (!isPlainObject(file)) return null;
  if (Number.isSafeInteger(file.id) && file.id > 0) return `media|id|${file.id}`;
  if (typeof file.id === 'string' && /^[1-9][0-9]{0,15}$/.test(file.id)) return `media|id|${Number(file.id)}`;
  if (typeof file.documentId === 'string' && DOCUMENT_ID.test(file.documentId))
    return `media|doc|${file.documentId}`;
  return null;
};

/**
 * True for a stored embedded-entry block (custom block of type `embedded-entry`).
 * @param {{ type?: unknown, data?: unknown }} block - Block.
 * @returns {boolean} Result.
 */
export const isEmbeddedEntryBlock = (block) =>
  Boolean(block) &&
  typeof block.type === 'string' &&
  !isBuiltInBlock(block) &&
  isPlainObject(block.data) &&
  isPlainObject(block.data.entry) &&
  typeof block.data.entry.documentId === 'string' &&
  DOCUMENT_ID.test(block.data.entry.documentId) &&
  typeof block.data.contentType === 'string' &&
  API_UID.test(block.data.contentType);

/**
 * Media Library file slots of a built-in block: the image file, gallery
 * images, video/audio file, poster and track files.
 * @param {{ type: string, data: unknown }} block - Block.
 * @returns {Array<{ file: object, image: boolean, set: (data: object, file: object) => object }>} Slots (`set` returns new data).
 */
export const mediaSlots = (block) => {
  const d = block && isPlainObject(block.data) ? block.data : null;
  if (!d || !isBuiltInBlock(block)) return [];
  const slots = [];
  if (block.type === 'image' && isPlainObject(d.file))
    slots.push({ file: d.file, image: true, set: (data, file) => ({ ...data, file }) });
  if (block.type === 'gallery' && Array.isArray(d.images))
    d.images.forEach((item, index) => {
      if (isPlainObject(item) && isPlainObject(item.file))
        slots.push({
          file: item.file,
          image: true,
          set: (data, file) => ({
            ...data,
            images: data.images.map((other, i) => (i === index ? { ...other, file } : other)),
          }),
        });
    });
  if (block.type === 'video' || block.type === 'audio') {
    if (isPlainObject(d.file))
      slots.push({ file: d.file, image: false, set: (data, file) => ({ ...data, file }) });
    if (block.type === 'video' && isPlainObject(d.poster))
      slots.push({ file: d.poster, image: true, set: (data, file) => ({ ...data, poster: file }) });
    if (Array.isArray(d.tracks))
      d.tracks.forEach((track, index) => {
        if (isPlainObject(track) && isPlainObject(track.file))
          slots.push({
            file: track.file,
            image: false,
            set: (data, file) => ({
              ...data,
              tracks: data.tracks.map((other, i) => (i === index ? { ...other, file } : other)),
            }),
          });
      });
  }
  return slots;
};

/**
 * Calls `fn` for every string in block data (depth bounded) and stores its result.
 * @param {unknown} value - Data value.
 * @param {(text: string) => string} fn - String transformer.
 * @param {number} [depth=0] - Depth.
 * @returns {unknown} New value.
 */
const mapStrings = (value, fn, depth = 0) => {
  if (depth > MAX_DEPTH) return value;
  if (typeof value === 'string') return fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn, depth + 1));
  if (isPlainObject(value)) {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = mapStrings(item, fn, depth + 1);
    return out;
  }
  return value;
};

/**
 * Visits the internal links of one inline HTML string through the public
 * renderer (`inlineToHtml` with a `links` resolver), so the parser is the one
 * every renderer uses.
 * @param {string} text - Inline HTML.
 * @param {(ref: { uid: string, documentId: string, locale: string|null }) => string|false|undefined} resolver - Link resolver.
 * @returns {{ html: string, found: boolean }} Re-serialised HTML and whether a link was seen.
 */
const visitLinks = (text, resolver) => {
  let found = false;
  const html = inlineToHtml(text, {
    storage: true,
    links: (ref) => {
      found = true;
      return resolver(ref);
    },
  });
  return { html, found };
};

/**
 * Replaces the text of resolved mentions with the entry's current title,
 * then resolves the links like `visitLinks`. Unresolved mentions keep their
 * stored text (the link itself is removed by the resolver).
 * @param {string} text - Inline HTML.
 * @param {(ref: object) => string|false|undefined} resolver - Link resolver.
 * @param {(attrs: Record<string, string>) => string|null} titleOf - Current title of a mention, or null.
 * @returns {{ html: string, found: boolean }} Re-serialised HTML and whether a link was seen.
 */
const visitMentions = (text, resolver, titleOf) => {
  const nodes = parseInline(text);
  const walk = (list, depth) => {
    if (depth > 64) return;
    for (const node of list) {
      if (node.type !== 'element') continue;
      if (node.tag === 'a' && isMentionLink(node.attrs)) {
        const title = titleOf(node.attrs);
        if (title) node.children = [{ type: 'text', value: title }];
        continue;
      }
      walk(node.children, depth + 1);
    }
  };
  walk(nodes, 0);
  let found = false;
  const html = nodesToHtml(nodes, {
    storage: true,
    links: (ref) => {
      found = true;
      return resolver(ref);
    },
  });
  return { html, found };
};

/**
 * Lists the references of a stored value.
 * @param {unknown} value - Stored field value (any shape `normalizeEditorDataSafe` accepts).
 * @param {{ locale?: string|null }} [options] - Locale of the entry that holds the value (used when a reference has none).
 * @returns {{ data: object|null, refs: Map<string, Reference> }} Normalised value and its references by key.
 */
export const collectReferences = (value, options = {}) => {
  const data = normalizeEditorDataSafe(value);
  const refs = new Map();
  if (!data) return { data: null, refs };
  const fallbackLocale = cleanLocale(options.locale);
  for (const block of data.blocks) {
    if (isEmbeddedEntryBlock(block)) {
      const uid = block.data.contentType;
      const { documentId } = block.data.entry;
      const key = entryKey('entry', uid, fallbackLocale, documentId);
      if (!refs.has(key))
        refs.set(key, { kind: 'entry', uid, documentId, locale: fallbackLocale, blockType: block.type });
      continue;
    }
    for (const slot of mediaSlots(block)) {
      const key = mediaKey(slot.file);
      if (key && !refs.has(key)) {
        const [, by, id] = key.split('|');
        refs.set(key, by === 'id' ? { kind: 'media', id: Number(id) } : { kind: 'media', documentId: id });
      }
    }
    mapStrings(block.data, (text) => {
      if (!text.includes('data-mex-uid')) return text;
      visitLinks(text, (ref) => {
        if (!API_UID.test(ref.uid || '') || !DOCUMENT_ID.test(ref.documentId || '')) return undefined;
        const locale = cleanLocale(ref.locale) || fallbackLocale;
        const key = entryKey('link', ref.uid, locale, ref.documentId);
        if (!refs.has(key)) refs.set(key, { kind: 'link', uid: ref.uid, documentId: ref.documentId, locale });
        return undefined;
      });
      return text;
    });
  }
  return { data, refs };
};

/** File keys copied from a resolved Media Library file (images; other files skip `alt` and `formats`). */
const FILE_KEYS = ['url', 'alt', 'name', 'mime', 'ext', 'hash', 'width', 'height', 'size', 'formats'];
const OTHER_FILE_KEYS = ['url', 'name', 'mime', 'ext', 'hash', 'width', 'height', 'size'];

/**
 * Applies a resolution map to a value.
 *
 * - Internal links: the href becomes the resolved href; a link without a
 *   resolution (missing, draft-only, or not readable by the caller) is removed
 *   and only its text stays. Mentions (`data-mex-mention`) also take the
 *   resolved entry's current `title` as their text; unresolved mentions keep
 *   the text stored when they were inserted.
 * - Embedded entries: `data.entry` becomes the resolved summary
 *   (`{ id, documentId, title, href, ...displayFields }`) or `null`.
 * - Images: `data.file` takes the current url, size and formats of a
 *   resolved file (and its alternative text when the block has none); without a resolution the stored file is kept unchanged.
 * @param {object|null} data - Normalised value (from `collectReferences`).
 * @param {Map<string, object>} resolved - Results by reference key: `{ href, title? }` for links, `{ entry }` for entries, `{ file }` for media.
 * @param {{ locale?: string|null }} [options] - Same options as `collectReferences`.
 * @returns {object|null} A new value (the input is not changed).
 */
export const applyReferences = (data, resolved, options = {}) => {
  if (!data) return null;
  const fallbackLocale = cleanLocale(options.locale);
  const linkResolver = (ref) => {
    const locale = cleanLocale(ref.locale) || fallbackLocale;
    const hit = resolved.get(entryKey('link', ref.uid, locale, ref.documentId));
    return hit && typeof hit.href === 'string' && hit.href ? hit.href : false;
  };
  // A mention shows the current title only when its link resolves (readable, published as requested).
  const mentionTitle = (attrs) => {
    const locale = cleanLocale(attrs['data-mex-locale']) || fallbackLocale;
    const hit = resolved.get(entryKey('link', attrs['data-mex-uid'], locale, attrs['data-mex-document-id']));
    return hit &&
      typeof hit.href === 'string' &&
      hit.href &&
      typeof hit.title === 'string' &&
      hit.title.trim()
      ? hit.title.trim().slice(0, 200)
      : null;
  };
  const blocks = data.blocks.map((block) => {
    if (isEmbeddedEntryBlock(block)) {
      const hit = resolved.get(
        entryKey('entry', block.data.contentType, fallbackLocale, block.data.entry.documentId)
      );
      return { ...block, data: { ...block.data, entry: hit && hit.entry ? { ...hit.entry } : null } };
    }
    let next = block.data;
    for (const slot of mediaSlots(block)) {
      const key = mediaKey(slot.file);
      const hit = key ? resolved.get(key) : null;
      if (!hit || !isPlainObject(hit.file)) continue;
      const file = { ...slot.file };
      for (const name of slot.image ? FILE_KEYS : OTHER_FILE_KEYS) {
        // Alternative text written in the block wins; the library's text only fills an empty one.
        if (name === 'alt' && typeof file.alt === 'string' && file.alt.trim()) continue;
        if (hit.file[name] !== undefined && hit.file[name] !== null) file[name] = hit.file[name];
        else if (name === 'formats') delete file.formats;
      }
      next = slot.set(next, file);
    }
    next = mapStrings(next, (text) => {
      if (!text.includes('data-mex-uid')) return text;
      const { html, found } = text.includes('data-mex-mention')
        ? visitMentions(text, linkResolver, mentionTitle)
        : visitLinks(text, linkResolver);
      return found ? html : text;
    });
    return next === block.data ? block : { ...block, data: next };
  });
  return { ...data, blocks };
};

/**
 * Renderer overrides for the embedded-entry blocks of a resolved value: a
 * resolved entry becomes a link with its title, an unresolved one renders
 * nothing.
 * @param {object|null} data - Resolved value.
 * @param {'html'|'text'|'markdown'} format - Output format.
 * @returns {Record<string, Function>} Overrides by block type.
 */
const entryOverrides = (data, format) => {
  const overrides = {};
  for (const block of (data && data.blocks) || []) {
    if (!isPlainObject(block.data) || !Object.prototype.hasOwnProperty.call(block.data, 'entry')) continue;
    if (isBuiltInBlock(block)) continue;
    if (overrides[block.type]) continue;
    const type = block.type;
    overrides[type] = (rendered) => {
      const entry = rendered && isPlainObject(rendered.data) ? rendered.data.entry : null;
      if (!isPlainObject(entry)) return '';
      const title = typeof entry.title === 'string' ? entry.title : '';
      const href = typeof entry.href === 'string' ? entry.href : '';
      if (format === 'text') return title;
      if (format === 'markdown') {
        const label = escapeMarkdown(title || href);
        return href ? `[${label}](<${href}>)` : label;
      }
      const cls = BLOCK_NAME.test(type) ? ` mex-${type}` : '';
      const inner = href
        ? `<a class="mex-entry-link" href="${escapeHtml(href)}">${escapeHtml(title || href)}</a>`
        : `<span class="mex-entry-title">${escapeHtml(title)}</span>`;
      return `<div class="mex-block mex-entry${cls}" data-mex-block="${escapeHtml(type)}">${inner}</div>`;
    };
  }
  return overrides;
};

/**
 * Renders a resolved value. Raw HTML blocks are left out (the renderers'
 * default); use the `json` format to get them.
 * @param {object|null} data - Value from `applyReferences`.
 * @param {'html'|'text'|'markdown'|'json'} format - Output format.
 * @returns {object|string|null} The value for `json`, a string otherwise ('' when empty).
 */
export const renderResolved = (data, format) => {
  if (format === 'json') return data || null;
  if (!data) return '';
  const options = { overrides: entryOverrides(data, format) };
  if (format === 'text') return renderText(data, options);
  if (format === 'markdown') return renderMarkdown(data, options);
  return renderHtml(data, options);
};
