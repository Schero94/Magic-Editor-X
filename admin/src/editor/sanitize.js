import createDOMPurify from 'dompurify';
import {
  INLINE_TAGS,
  INLINE_ATTRIBUTES,
  INLINE_CLASSES,
  INTERNAL_LINK_ATTRIBUTES,
  cleanInternalLinkAttributes,
  sanitizeUrl,
  sanitizeEditorData,
  MATH_ATTRIBUTE,
  FOOTNOTE_ATTRIBUTES,
} from '../../../shared/sanitize-policy.mjs';
import { normalizeEditorData } from '../../../shared/editor-data.mjs';
import { canonicalInlineExtras } from '../../../shared/render/inline.mjs';
import { COLOR_ATTRIBUTE, HIGHLIGHT_ATTRIBUTE } from '../../../shared/inline-format.mjs';
import { ANNOTATION_ATTRIBUTE } from '../../../shared/blocks/annotations.mjs';

/**
 * Admin-side sanitising with DOMPurify, using the same policy as the server
 * (shared/sanitize-policy.mjs). A private DOMPurify instance keeps our hooks
 * away from other code on the page.
 */

let purify = null;
const instance = () => {
  if (purify) return purify;
  purify = createDOMPurify(window);
  purify.addHook('uponSanitizeAttribute', (node, data) => {
    const tag = node.nodeName.toLowerCase();
    // 2.5: annotation values (`data-mex-a-<key>`) on an annotation span; validated by `canonicalInlineExtras`.
    if (
      tag === 'span' &&
      ANNOTATION_VALUE_ATTRIBUTE.test(data.attrName) &&
      typeof node.hasAttribute === 'function' &&
      node.hasAttribute(ANNOTATION_ATTRIBUTE)
    ) {
      data.forceKeepAttr = true;
      return;
    }
    if (data.attrName === 'class') {
      const allowed = INLINE_CLASSES[tag] || [];
      const kept = String(data.attrValue)
        .split(/\s+/)
        .filter((name) => allowed.includes(name));
      if (kept.length === 0) data.keepAttr = false;
      else data.attrValue = kept.join(' ');
    }
    if (data.attrName === 'href') {
      const safe = sanitizeUrl(data.attrValue);
      if (!safe) data.keepAttr = false;
      else data.attrValue = safe;
    }
    if (data.attrName === 'target' && !['_blank', '_self', '_parent', '_top'].includes(data.attrValue))
      data.keepAttr = false;
  });
  purify.addHook('afterSanitizeAttributes', (node) => {
    if (node.nodeName === 'A' && node.getAttribute('target') === '_blank')
      node.setAttribute('rel', 'noopener noreferrer');
    // Internal-link attributes: only on <a>, only valid values, uid and documentId together.
    if (typeof node.hasAttribute !== 'function') return;
    if (!INTERNAL_LINK_ATTRIBUTES.some((name) => node.hasAttribute(name))) return;
    const kept =
      node.nodeName === 'A'
        ? cleanInternalLinkAttributes(
            Object.fromEntries(INTERNAL_LINK_ATTRIBUTES.map((name) => [name, node.getAttribute(name)]))
          )
        : {};
    for (const name of INTERNAL_LINK_ATTRIBUTES) {
      if (kept[name]) node.setAttribute(name, kept[name]);
      else node.removeAttribute(name);
    }
  });
  return purify;
};

// The `data-mex-a-*` prefix rule (sanitize-html syntax) is handled by the hook above.
const ALLOWED_ATTR = Array.from(new Set(Object.values(INLINE_ATTRIBUTES).flat())).filter(
  (name) => !name.endsWith('*')
);

/** 2.5: `data-mex-a-<key>` (annotation value attribute). */
const ANNOTATION_VALUE_ATTRIBUTE = /^data-mex-a-[a-z][a-z0-9]{0,23}$/;

/**
 * 2.7.8: results of `sanitizeInline` by input string. Every change of a
 * field sanitised the whole document again (form value, rendered key, draft
 * fingerprint), which cost about 155 ms per keystroke at 2,000 blocks. The
 * sanitiser is a pure function of its input (fixed config, hooks that only
 * read the node), so an unchanged string gets the same output from the
 * cache; only changed text is parsed again. Least recently used entries are
 * dropped beyond the limit, and very long strings are not kept. The server
 * still sanitises on save and stays the authority.
 */
const INLINE_CACHE_LIMIT = 20000;
const INLINE_CACHE_MAX_LENGTH = 65536;
const inlineCache = new Map();

/**
 * Sanitises inline HTML without the cache.
 * @param {string} input - Untrusted HTML.
 * @returns {string} Safe HTML.
 */
const sanitizeInlineUncached = (input) =>
  canonicalInlineExtras(
    instance().sanitize(input, {
      ALLOWED_TAGS: [...INLINE_TAGS],
      ALLOWED_ATTR,
      ALLOW_DATA_ATTR: false,
      // DOMPurify checks attribute values like URIs; `api::article.article` looks
      // like an unknown scheme and was dropped, which removed the entry reference
      // of internal links whenever content was shown again. The values are
      // validated by cleanInternalLinkAttributes in the hook above, and math and
      // footnote attributes (2.4: a note is inline HTML, "See: …" looks like a
      // scheme too) by `canonicalInlineExtras` below.
      ADD_URI_SAFE_ATTR: [
        ...INTERNAL_LINK_ATTRIBUTES,
        MATH_ATTRIBUTE,
        ...FOOTNOTE_ATTRIBUTES,
        // 2.5: tokens and the annotation name (validated by `canonicalInlineExtras`).
        COLOR_ATTRIBUTE,
        HIGHLIGHT_ATTRIBUTE,
        ANNOTATION_ATTRIBUTE,
      ],
    })
  );

/**
 * Sanitises inline HTML (paragraph text, captions, table cells).
 * Memoised by input (see `inlineCache`).
 * @param {string} html - Untrusted HTML.
 * @returns {string} Safe HTML.
 */
export const sanitizeInline = (html) => {
  const input = String(html || '');
  if (input === '') return '';
  if (input.length > INLINE_CACHE_MAX_LENGTH) return sanitizeInlineUncached(input);
  const hit = inlineCache.get(input);
  if (hit !== undefined) {
    // Refresh the entry so it is dropped last.
    inlineCache.delete(input);
    inlineCache.set(input, hit);
    return hit;
  }
  const clean = sanitizeInlineUncached(input);
  inlineCache.set(input, clean);
  if (inlineCache.size > INLINE_CACHE_LIMIT) inlineCache.delete(inlineCache.keys().next().value);
  return clean;
};

/** Size of the inline sanitiser cache (tests). @returns {number} Entries. */
export const inlineCacheSize = () => inlineCache.size;

/**
 * Sanitises markup of a custom block template (admin-defined, rendered for every editor).
 * @param {string} html - Template HTML.
 * @returns {string} Safe HTML.
 */
export const sanitizeTemplate = (html) =>
  instance().sanitize(String(html || ''), {
    ALLOWED_TAGS: [
      'div',
      'span',
      'p',
      'h2',
      'h3',
      'h4',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'small',
      'br',
      'hr',
      'ul',
      'ol',
      'li',
      'blockquote',
      'figure',
      'figcaption',
      'img',
      'a',
      'section',
      'header',
      'footer',
      'code',
      'pre',
      'mark',
    ],
    ALLOWED_ATTR: [
      'class',
      'data-field',
      'title',
      'href',
      'target',
      'rel',
      'src',
      'alt',
      'width',
      'height',
      'loading',
    ],
    ALLOW_DATA_ATTR: false,
  });

/**
 * Sanitises an SVG icon string for toolbox buttons.
 * @param {string} svg - SVG markup.
 * @returns {string} Safe SVG.
 */
export const sanitizeSvg = (svg) =>
  instance().sanitize(String(svg || ''), {
    USE_PROFILES: { svg: true, svgFilters: false },
    FORBID_TAGS: ['style', 'use', 'image', 'foreignObject', 'a', 'script'],
    FORBID_ATTR: ['style', 'href', 'xlink:href'],
  });

/**
 * Normalises and sanitises a full field value before it is rendered in the editor.
 * Invalid values become an empty document (the raw value is kept in the form until the user edits).
 * @param {unknown} value - Stored value.
 * @param {'sanitize'|'allow'|'disable'} [rawHtml='allow'] - Raw HTML policy. The admin keeps raw HTML as typed;
 *   the server applies the configured policy on save.
 * @returns {{ data: object|null, error: string|null }} Clean data or an error code.
 */
export const prepareEditorValue = (value, rawHtml = 'allow') => {
  try {
    const data = normalizeEditorData(value);
    if (!data) return { data: null, error: null };
    return {
      data: sanitizeEditorData(data, {
        sanitizeInlineHtml: sanitizeInline,
        sanitizeRawHtml: (html) => html,
        rawHtml,
      }),
      error: null,
    };
  } catch (error) {
    return { data: null, error: (error && error.code) || 'INVALID' };
  }
};

export { sanitizeUrl };

/**
 * Sanitises the shared document of a collaboration room for rendering.
 * Blocks are cleaned one by one and cached by object identity: the room
 * reader returns the same object for a block that did not change, so only
 * changed blocks are sanitised again (large documents stay fast).
 * @param {{ time?: number, version?: string, blocks: Array<object> }} data - Shared document (untrusted).
 * @param {WeakMap<object, object|null>} cache - Per-field cache.
 * @returns {{ time: number, version: string, blocks: Array<object> }} Safe document.
 */
export const prepareRemoteData = (data, cache) => {
  const blocks = [];
  for (const block of (data && data.blocks) || []) {
    let clean = cache.get(block);
    if (clean === undefined) {
      const prepared = prepareEditorValue({ time: data.time, version: data.version, blocks: [block] }).data;
      clean = prepared && prepared.blocks.length === 1 ? prepared.blocks[0] : null;
      cache.set(block, clean);
    }
    if (clean) blocks.push(clean);
  }
  return { time: (data && data.time) || Date.now(), version: (data && data.version) || '2.31.7', blocks };
};
