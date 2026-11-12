import createDOMPurify from 'dompurify';
import {
  INLINE_TAGS,
  INLINE_ATTRIBUTES,
  INLINE_CLASSES,
  INTERNAL_LINK_ATTRIBUTES,
  cleanInternalLinkAttributes,
  sanitizeUrl,
  sanitizeEditorData,
} from '../../../shared/sanitize-policy.mjs';
import { normalizeEditorData } from '../../../shared/editor-data.mjs';

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

const ALLOWED_ATTR = Array.from(new Set(Object.values(INLINE_ATTRIBUTES).flat()));

/**
 * Sanitises inline HTML (paragraph text, captions, table cells).
 * @param {string} html - Untrusted HTML.
 * @returns {string} Safe HTML.
 */
export const sanitizeInline = (html) =>
  instance().sanitize(String(html || ''), {
    ALLOWED_TAGS: [...INLINE_TAGS],
    ALLOWED_ATTR,
    ALLOW_DATA_ATTR: false,
    // DOMPurify checks attribute values like URIs; `api::article.article` looks
    // like an unknown scheme and was dropped, which removed the entry reference
    // of internal links whenever content was shown again. The values are
    // validated by cleanInternalLinkAttributes in the hook above.
    ADD_URI_SAFE_ATTR: [...INTERNAL_LINK_ATTRIBUTES],
  });

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
