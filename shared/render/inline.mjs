/**
 * Strict inline HTML parser for the renderers.
 *
 * Stored inline HTML is sanitised on save, but a renderer must not rely on
 * that: values can come from older versions, imports or other writers. This
 * module tokenises a string into a small tree and keeps only the tags,
 * attributes and classes of the shared policy (`INLINE_TAGS`,
 * `INLINE_ATTRIBUTES`, `INLINE_CLASSES`). Everything else becomes text, which
 * the serialisers escape. Output is therefore built only from known tags with
 * validated attributes, never by passing input through.
 *
 * No DOM and no dependencies: works in Node, browsers and edge runtimes.
 */

import {
  INLINE_TAGS,
  INLINE_ATTRIBUTES,
  INLINE_CLASSES,
  sanitizeUrl,
  sanitizeTarget,
  cleanInternalLinkAttributes,
} from '../sanitize-policy.mjs';

/** Tags whose content is dropped together with the tag. */
const DROP_WITH_CONTENT = new Set([
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'noscript',
  'noembed',
  'noframes',
  'template',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'select',
  'option',
  'plaintext',
]);

const ALLOWED = new Set(INLINE_TAGS);
const VOID = new Set(['br']);
const MAX_INPUT = 500000;
const MAX_NODES = 50000;
const MAX_DEPTH = 64;

const NAMED_ENTITIES = Object.freeze({
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: '\u00a0',
  shy: '­',
  copy: '©',
  reg: '®',
  trade: '™',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  laquo: '«',
  raquo: '»',
  euro: '€',
  middot: '·',
  bull: '•',
  times: '×',
  deg: '°',
  tab: '\t',
  newline: '\n',
  colon: ':',
  sol: '/',
  lpar: '(',
  rpar: ')',
});

/**
 * Decodes HTML character references (named subset, decimal and hex). Unknown
 * named references stay as written. Invalid code points become U+FFFD.
 * @param {string} text - Text with references.
 * @returns {string} Decoded text.
 */
export const decodeEntities = (text) =>
  String(text).replace(
    /&(#[xX][0-9a-fA-F]{1,8}|#[0-9]{1,10}|[A-Za-z][A-Za-z0-9]{1,31});?/g,
    (match, body) => {
      if (body[0] === '#') {
        const code =
          body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
        if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff))
          return '�';
        return String.fromCodePoint(code);
      }
      const named = NAMED_ENTITIES[body] ?? NAMED_ENTITIES[body.toLowerCase()];
      return named === undefined ? match : named;
    }
  );

/**
 * Escapes text for HTML element content and attribute values.
 * @param {unknown} text - Plain text.
 * @returns {string} Escaped text.
 */
export const escapeHtml = (text) =>
  String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Parses the attribute section of a start tag.
 * @param {string} source - Text between the tag name and `>`.
 * @returns {Record<string, string>} Attributes (lower-case names, decoded values, first wins).
 */
const parseAttributes = (source) => {
  const out = {};
  const pattern = /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let match;
  while ((match = pattern.exec(source))) {
    const name = match[1].toLowerCase();
    if (Object.prototype.hasOwnProperty.call(out, name)) continue;
    const raw = match[2] ?? match[3] ?? match[4] ?? '';
    out[name] = decodeEntities(raw);
  }
  return out;
};

/**
 * Finds the end of a start or end tag, respecting quoted attribute values.
 * @param {string} html - Source.
 * @param {number} from - Index after `<`.
 * @returns {number} Index of the closing `>`, or -1.
 */
const findTagEnd = (html, from) => {
  let quote = '';
  for (let i = from; i < html.length; i += 1) {
    const char = html[i];
    if (quote) {
      if (char === quote) quote = '';
    } else if (char === '"' || char === "'") quote = char;
    else if (char === '>') return i;
  }
  return -1;
};

/**
 * Keeps the allowed attributes of an allowed tag.
 * @param {string} tag - Tag name.
 * @param {Record<string, string>} attribs - Parsed attributes.
 * @returns {Record<string, string>} Clean attributes.
 */
const cleanAttributes = (tag, attribs) => {
  const allowed = INLINE_ATTRIBUTES[tag] || [];
  const out = {};
  for (const name of allowed) {
    if (!Object.prototype.hasOwnProperty.call(attribs, name) || name.startsWith('data-mex-')) continue;
    const value = attribs[name];
    if (name === 'href') {
      const url = sanitizeUrl(value);
      if (url) out.href = url;
    } else if (name === 'target') {
      const target = sanitizeTarget(value);
      if (target) out.target = target;
    } else if (name === 'rel') {
      const rel = String(value)
        .split(/\s+/)
        .filter((token) => /^[a-z-]{1,20}$/.test(token));
      if (rel.length) out.rel = rel.join(' ');
    } else if (name === 'class') {
      const classes = String(value)
        .split(/\s+/)
        .filter((token) => (INLINE_CLASSES[tag] || []).includes(token));
      if (classes.length) out.class = classes.join(' ');
    } else {
      out[name] = String(value).slice(0, 2000);
    }
  }
  if (tag === 'a') Object.assign(out, cleanInternalLinkAttributes(attribs));
  return out;
};

/**
 * @typedef {{ type: 'text', value: string }} InlineText
 * @typedef {{ type: 'element', tag: string, attrs: Record<string, string>, children: InlineNode[] }} InlineElement
 * @typedef {InlineText | InlineElement} InlineNode
 */

/**
 * Parses untrusted inline HTML into a tree of allowed elements and text.
 * Comments, CDATA, processing instructions and doctype are dropped; dangerous
 * containers (script, style, svg, iframe, ...) are dropped with their content;
 * other unknown tags are removed and their text kept.
 * @param {unknown} input - Inline HTML.
 * @returns {InlineNode[]} Tree.
 */
export const parseInline = (input) => {
  const html = typeof input === 'string' ? input.slice(0, MAX_INPUT) : '';
  const root = { type: 'element', tag: '#root', attrs: {}, children: [] };
  const stack = [root];
  let nodes = 0;
  let text = '';
  const flush = () => {
    if (!text) return;
    const parent = stack[stack.length - 1];
    const last = parent.children[parent.children.length - 1];
    const value = decodeEntities(text);
    if (last && last.type === 'text') last.value += value;
    else if (nodes < MAX_NODES) {
      parent.children.push({ type: 'text', value });
      nodes += 1;
    }
    text = '';
  };
  let i = 0;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt === -1) {
      text += html.slice(i);
      break;
    }
    text += html.slice(i, lt);
    i = lt;
    if (html.startsWith('<!--', i)) {
      const end = html.indexOf('-->', i + 4);
      flush();
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html.startsWith('<![CDATA[', i)) {
      const end = html.indexOf(']]>', i + 9);
      flush();
      i = end === -1 ? html.length : end + 3;
      continue;
    }
    if (html[i + 1] === '!' || html[i + 1] === '?') {
      const end = html.indexOf('>', i + 2);
      flush();
      i = end === -1 ? html.length : end + 1;
      continue;
    }
    const closing = html[i + 1] === '/';
    const nameMatch = /^[A-Za-z][A-Za-z0-9-]{0,40}/.exec(html.slice(i + (closing ? 2 : 1), i + 45));
    if (!nameMatch) {
      text += '<';
      i += 1;
      continue;
    }
    const end = findTagEnd(html, i + 1);
    if (end === -1) {
      // An unterminated tag is text, which the serialiser escapes.
      text += html.slice(i);
      break;
    }
    flush();
    const tag = nameMatch[0].toLowerCase();
    const body = html.slice(i + (closing ? 2 : 1) + nameMatch[0].length, end);
    i = end + 1;
    if (closing) {
      if (!ALLOWED.has(tag)) continue;
      for (let s = stack.length - 1; s > 0; s -= 1) {
        if (stack[s].tag === tag) {
          stack.length = s;
          break;
        }
      }
      continue;
    }
    if (DROP_WITH_CONTENT.has(tag)) {
      const selfClosing = /\/\s*$/.test(body);
      if (selfClosing) continue;
      const closeIndex = html.slice(i).search(new RegExp(`</${tag}[\\s/>]`, 'i'));
      if (closeIndex === -1) break;
      const closeEnd = html.indexOf('>', i + closeIndex);
      i = closeEnd === -1 ? html.length : closeEnd + 1;
      continue;
    }
    if (!ALLOWED.has(tag) || nodes >= MAX_NODES) continue;
    const element = {
      type: 'element',
      tag,
      attrs: cleanAttributes(tag, parseAttributes(body)),
      children: [],
    };
    stack[stack.length - 1].children.push(element);
    nodes += 1;
    if (!VOID.has(tag) && stack.length < MAX_DEPTH) stack.push(element);
  }
  flush();
  return root.children;
};

/**
 * Applies the internal-link resolver to one link element.
 * @param {Record<string, string>} attrs - Clean link attributes.
 * @param {((ref: { uid: string, documentId: string, locale: string|null, href: string|null }) => unknown) | undefined} resolver - `options.links`.
 * @returns {Record<string, string> | null} Attributes, or null to render the link text only.
 */
export const resolveLinkAttributes = (attrs, resolver) => {
  if (typeof resolver !== 'function' || !attrs['data-mex-uid'] || !attrs['data-mex-document-id'])
    return attrs;
  let result;
  try {
    result = resolver({
      uid: attrs['data-mex-uid'],
      documentId: attrs['data-mex-document-id'],
      locale: attrs['data-mex-locale'] || null,
      href: attrs.href || null,
    });
  } catch {
    result = undefined;
  }
  if (result === false) return null;
  if (typeof result === 'string') {
    const url = sanitizeUrl(result);
    if (url) return { ...attrs, href: url };
  }
  return attrs;
};

const ATTRIBUTE_ORDER = [
  'href',
  'target',
  'rel',
  'title',
  'class',
  'data-tooltip',
  'data-mex-uid',
  'data-mex-document-id',
  'data-mex-locale',
];

/**
 * Serialises attributes in a fixed order.
 * @param {Record<string, string>} attrs - Attributes.
 * @returns {string} ` name="value"` pairs.
 */
const serializeAttributes = (attrs) =>
  ATTRIBUTE_ORDER.filter((name) => attrs[name] !== undefined && attrs[name] !== '')
    .map((name) => ` ${name}="${escapeHtml(attrs[name])}"`)
    .join('');

/**
 * Serialises a parsed tree to safe HTML.
 * @param {InlineNode[]} nodes - Parsed nodes.
 * @param {{ links?: Function }} [options] - Render options (`links` resolver).
 * @returns {string} HTML containing only allowed tags.
 */
export const nodesToHtml = (nodes, options = {}) =>
  nodes
    .map((node) => {
      if (node.type === 'text') return escapeHtml(node.value);
      if (node.tag === 'br') return '<br>';
      let attrs = node.attrs;
      if (node.tag === 'a') {
        attrs = resolveLinkAttributes(attrs, options.links);
        if (!attrs || !attrs.href) return nodesToHtml(node.children, options);
        if (attrs.target === '_blank') {
          const rel = new Set(
            String(attrs.rel || '')
              .split(/\s+/)
              .filter(Boolean)
          );
          rel.add('noopener');
          rel.add('noreferrer');
          attrs = { ...attrs, rel: Array.from(rel).sort().join(' ') };
        }
      }
      return `<${node.tag}${serializeAttributes(attrs)}>${nodesToHtml(node.children, options)}</${node.tag}>`;
    })
    .join('');

/**
 * Plain text of a parsed tree (`<br>` becomes a line break).
 * @param {InlineNode[]} nodes - Parsed nodes.
 * @returns {string} Text.
 */
export const nodesToText = (nodes) =>
  nodes
    .map((node) => {
      if (node.type === 'text') return node.value;
      if (node.tag === 'br') return '\n';
      return nodesToText(node.children);
    })
    .join('');

/**
 * Safe inline HTML.
 * @param {unknown} html - Untrusted inline HTML.
 * @param {{ links?: Function }} [options] - Render options.
 * @returns {string} Safe HTML.
 */
export const inlineToHtml = (html, options) => nodesToHtml(parseInline(html), options);

/**
 * Plain text of inline HTML, with non-breaking spaces turned into spaces.
 * @param {unknown} html - Inline HTML.
 * @returns {string} Text.
 */
export const inlineToText = (html) => nodesToText(parseInline(html)).replace(/\u00a0/g, ' ');
