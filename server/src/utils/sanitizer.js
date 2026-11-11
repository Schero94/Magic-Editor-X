'use strict';

const sanitizeHtml = require('sanitize-html');
const { normalizeEditorData } = require('../../../shared/editor-data.mjs');
const {
  INLINE_TAGS,
  INLINE_ATTRIBUTES,
  INLINE_CLASSES,
  LINK_SCHEMES,
  sanitizeEditorData,
  sanitizeTarget,
  INTERNAL_LINK_ATTRIBUTES,
  cleanInternalLinkAttributes,
} = require('../../../shared/sanitize-policy.mjs');

/**
 * Adds rel="noopener noreferrer" to links that open a new tab, drops invalid
 * targets and keeps internal-link data attributes only when they are valid.
 * @param {string} tagName - Tag name.
 * @param {Record<string, string>} attribs - Attributes.
 * @returns {{ tagName: string, attribs: Record<string, string> }} Transformed tag.
 */
const transformLink = (tagName, attribs) => {
  const out = { ...attribs };
  const target = sanitizeTarget(out.target);
  if (target) out.target = target;
  else delete out.target;
  if (target === '_blank') {
    const rel = new Set(
      String(out.rel || '')
        .split(/\s+/)
        .filter(Boolean)
    );
    rel.add('noopener');
    rel.add('noreferrer');
    out.rel = Array.from(rel)
      .filter((value) => /^[a-z-]{1,20}$/.test(value))
      .join(' ');
  } else if (out.rel) {
    out.rel = String(out.rel)
      .split(/\s+/)
      .filter((value) => /^[a-z-]{1,20}$/.test(value))
      .join(' ');
  }
  for (const name of INTERNAL_LINK_ATTRIBUTES) delete out[name];
  Object.assign(out, cleanInternalLinkAttributes(attribs));
  return { tagName, attribs: out };
};

/** sanitize-html options for inline text (paragraphs, headings, captions, cells). */
const INLINE_OPTIONS = Object.freeze({
  allowedTags: [...INLINE_TAGS],
  allowedAttributes: { ...INLINE_ATTRIBUTES },
  allowedClasses: { ...INLINE_CLASSES },
  allowedSchemes: [...LINK_SCHEMES],
  allowedSchemesAppliedToAttributes: ['href'],
  allowProtocolRelative: false,
  disallowedTagsMode: 'discard',
  nonTextTags: ['style', 'script', 'textarea', 'option', 'noscript', 'template', 'iframe', 'object', 'embed'],
  transformTags: { a: transformLink },
});

/** sanitize-html options for the Raw HTML block in "sanitize" mode. */
const RAW_OPTIONS = Object.freeze({
  allowedTags: [
    ...sanitizeHtml.defaults.allowedTags,
    'img',
    'figure',
    'figcaption',
    'picture',
    'source',
    'video',
    'audio',
    'details',
    'summary',
  ],
  allowedAttributes: {
    a: ['href', 'name', 'target', 'rel', 'title'],
    img: ['src', 'srcset', 'alt', 'title', 'width', 'height', 'loading'],
    source: ['src', 'srcset', 'type', 'media'],
    video: ['src', 'controls', 'width', 'height', 'poster', 'muted', 'loop', 'playsinline'],
    audio: ['src', 'controls'],
    td: ['colspan', 'rowspan', 'align'],
    th: ['colspan', 'rowspan', 'align', 'scope'],
    '*': ['class', 'id', 'lang', 'dir', 'title'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowedSchemesByTag: {
    img: ['http', 'https'],
    source: ['http', 'https'],
    video: ['https'],
    audio: ['https'],
  },
  allowProtocolRelative: false,
  transformTags: { a: transformLink },
});

/**
 * Sanitises inline HTML with the shared policy.
 * @param {string} html - Untrusted HTML.
 * @returns {string} Safe HTML.
 */
const sanitizeInlineHtml = (html) => sanitizeHtml(String(html), INLINE_OPTIONS);

/**
 * Sanitises Raw HTML block content.
 * @param {string} html - Untrusted HTML.
 * @returns {string} Safe HTML.
 */
const sanitizeRawHtml = (html) => sanitizeHtml(String(html), RAW_OPTIONS);

/**
 * Normalises and sanitises one Magic Editor X field value.
 * @param {unknown} value - Submitted or stored value.
 * @param {{ rawHtml?: 'sanitize'|'allow'|'disable' }} [options] - Raw HTML policy.
 * @returns {object|null} Clean Editor.js object or null.
 * @throws {import('../../../shared/editor-data.mjs').EditorDataError} When the value is not editor content or too large.
 */
const cleanEditorValue = (value, options = {}) => {
  const normalized = normalizeEditorData(value);
  if (!normalized) return null;
  return sanitizeEditorData(normalized, {
    sanitizeInlineHtml,
    sanitizeRawHtml,
    rawHtml: options.rawHtml || 'sanitize',
  });
};

module.exports = { sanitizeInlineHtml, sanitizeRawHtml, cleanEditorValue };
