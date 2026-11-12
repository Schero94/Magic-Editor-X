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
  isMentionLink,
  MATH_ATTRIBUTE,
  FOOTNOTE_ID,
  MAX_INLINE_TEX,
  MAX_FOOTNOTE_NOTE,
} from '../sanitize-policy.mjs';
import { escapeHtml, serializeNodes } from './nodes.mjs';

export { escapeHtml };

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
 * @param {{ inNote?: boolean }} [options] - Parse options.
 * @returns {Record<string, string>} Clean attributes.
 */
const cleanAttributes = (tag, attribs, options = {}) => {
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
  // Notes of footnotes never carry entry references (API output resolves only the field's own links).
  if (tag === 'a' && !options.inNote) Object.assign(out, cleanInternalLinkAttributes(attribs));
  return out;
};

/**
 * @typedef {{ type: 'text', value: string }} InlineText
 * @typedef {{ type: 'element', tag: string, attrs: Record<string, string>, children: InlineNode[], note?: InlineNode[] }} InlineElement
 * @typedef {InlineText | InlineElement} InlineNode
 */

/** Longest placeholder text of a footnote marker (the number is computed when rendering). */
const MAX_MARKER_TEXT = 16;

/**
 * True for an element that holds inline math (`<span data-mex-math>`).
 * @param {InlineNode} node - Parsed node.
 * @returns {boolean} Result.
 */
export const isMathNode = (node) =>
  node.type === 'element' && node.tag === 'span' && node.attrs[MATH_ATTRIBUTE] === 'true';

/**
 * True for a footnote marker (`<sup data-mex-footnote>`).
 * @param {InlineNode} node - Parsed node.
 * @returns {boolean} Result.
 */
export const isFootnoteNode = (node) =>
  node.type === 'element' && node.tag === 'sup' && typeof node.attrs['data-mex-footnote'] === 'string';

/**
 * Special inline elements (2.4): inline math keeps only its text (the TeX
 * source, bounded) and footnote markers keep a short placeholder text plus
 * their parsed note. Runs after parsing so nested markup inside these
 * elements is flattened instead of kept.
 * @param {InlineNode[]} nodes - Parsed nodes.
 * @param {number} [depth=0] - Depth.
 * @returns {InlineNode[]} The same nodes.
 */
const finalizeSpecial = (nodes, depth = 0) => {
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    if (isMathNode(node)) {
      const tex = nodesToText(node.children, { raw: true }).slice(0, MAX_INLINE_TEX);
      node.children = tex ? [{ type: 'text', value: tex }] : [];
    } else if (isFootnoteNode(node)) {
      const text = nodesToText(node.children, { raw: true }).slice(0, MAX_MARKER_TEXT);
      node.children = text ? [{ type: 'text', value: text }] : [];
    } else if (depth < MAX_DEPTH) finalizeSpecial(node.children, depth + 1);
  }
  return nodes;
};

/**
 * Attributes of an inline math span or a footnote marker, or null when the
 * element is an ordinary span/sup. Inside a footnote note, footnote markers
 * are ordinary `<sup>` elements (no nested notes).
 * @param {string} tag - Tag name.
 * @param {Record<string, string>} attribs - Parsed attributes.
 * @param {{ inNote?: boolean }} options - Parse options.
 * @returns {{ attrs: Record<string, string>, note?: InlineNode[] } | null} Special element data.
 */
const specialElement = (tag, attribs, options) => {
  if (tag === 'span' && Object.prototype.hasOwnProperty.call(attribs, MATH_ATTRIBUTE)) {
    // Boolean flag like `data-mex-mention`: `""` and `"true"` are accepted and normalised.
    if (!/^(?:|true)$/.test(attribs[MATH_ATTRIBUTE])) return null;
    return { attrs: { [MATH_ATTRIBUTE]: 'true' } };
  }
  if (tag === 'sup' && !options.inNote) {
    const id = attribs['data-mex-footnote'];
    if (typeof id !== 'string' || !FOOTNOTE_ID.test(id)) return null;
    const source = typeof attribs['data-mex-note'] === 'string' ? attribs['data-mex-note'] : '';
    const note = parseInline(source.slice(0, MAX_FOOTNOTE_NOTE), { inNote: true });
    return { attrs: { 'data-mex-footnote': id }, note };
  }
  return null;
};

/**
 * Parses untrusted inline HTML into a tree of allowed elements and text.
 * Comments, CDATA, processing instructions and doctype are dropped; dangerous
 * containers (script, style, svg, iframe, ...) are dropped with their content;
 * other unknown tags are removed and their text kept.
 *
 * 2.4: `<span data-mex-math>` keeps only its text (TeX source) and
 * `<sup data-mex-footnote="id" data-mex-note="…">` gets its note parsed into
 * `note` (same rules, no nested footnotes; internal-link attributes are not
 * kept inside notes, so notes never carry entry references).
 * @param {unknown} input - Inline HTML.
 * @param {{ inNote?: boolean }} [options] - Internal: parsing a footnote note.
 * @returns {InlineNode[]} Tree.
 */
export const parseInline = (input, options = {}) => {
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
    const attribs = parseAttributes(body);
    const special = specialElement(tag, attribs, options);
    const element = {
      type: 'element',
      tag,
      attrs: special ? special.attrs : cleanAttributes(tag, attribs, options),
      children: [],
    };
    if (special && special.note) element.note = special.note;
    stack[stack.length - 1].children.push(element);
    nodes += 1;
    if (!VOID.has(tag) && stack.length < MAX_DEPTH) stack.push(element);
  }
  flush();
  return finalizeSpecial(root.children);
};

/**
 * Applies the internal-link resolver to one link element.
 * @param {Record<string, string>} attrs - Clean link attributes.
 * @param {((ref: { uid: string, documentId: string, locale: string|null, href: string|null, mention?: true }) => unknown) | undefined} resolver - `options.links`.
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
      ...(isMentionLink(attrs) ? { mention: true } : {}),
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
  'data-mex-mention',
  MATH_ATTRIBUTE,
  'data-mex-footnote',
  'data-mex-note',
];

/**
 * Key of the per-render state (math renderer, footnote collector) that the
 * tree builder puts on its options. Without it, math and footnotes are
 * written in their stored form (re-serialising stored values).
 */
export const RENDER_STATE = Symbol.for('magic-editor-x.render-state');

/**
 * Stored form of a footnote note (canonical inline HTML).
 * @param {InlineNode[]|undefined} note - Parsed note.
 * @returns {string} HTML.
 */
const storedNote = (note) => serializeNodes(inlineNodesToRender(note || [], { storage: true }));

/** Class the renderers add to mentions (`<a data-mex-mention>`); never stored. */
export const MENTION_CLASS = 'mex-mention';

/**
 * Builds render nodes from a parsed inline tree: attributes in a fixed order,
 * links resolved with `options.links`, `rel="noopener noreferrer"` added to
 * `target="_blank"` links, links without a valid href reduced to their
 * content. Mentions get the class `mex-mention` unless `storage` is set
 * (re-serialising stored values keeps them as stored). The result contains
 * only allowed tags and validated attributes.
 * @param {InlineNode[]} nodes - Parsed nodes (from `parseInline`).
 * @param {{ links?: Function, storage?: boolean }} [options] - Render options (`links` resolver; `storage`: internal, no render-only classes).
 * @returns {import('./nodes.mjs').RenderNode[]} Render nodes.
 */
export const inlineNodesToRender = (nodes, options = {}) => {
  /** @type {import('./nodes.mjs').RenderNode[]} */
  const out = [];
  const state = options[RENDER_STATE];
  for (const node of nodes) {
    if (node.type === 'text') {
      out.push({ type: 'text', value: node.value });
      continue;
    }
    if (node.tag === 'br') {
      out.push({ type: 'element', tag: 'br', attrs: {}, children: [] });
      continue;
    }
    if (isMathNode(node)) {
      const tex = nodesToText(node.children);
      if (state && !options.storage) {
        out.push(state.math(tex, false));
        continue;
      }
      out.push({
        type: 'element',
        tag: 'span',
        attrs: { [MATH_ATTRIBUTE]: 'true' },
        children: tex ? [{ type: 'text', value: tex }] : [],
      });
      continue;
    }
    if (isFootnoteNode(node)) {
      if (state && !options.storage) {
        out.push(state.footnote(node));
        continue;
      }
      const attrs = { 'data-mex-footnote': node.attrs['data-mex-footnote'] };
      const note = storedNote(node.note);
      if (note) attrs['data-mex-note'] = note;
      out.push({ type: 'element', tag: 'sup', attrs, children: inlineNodesToRender(node.children, options) });
      continue;
    }
    let attrs = node.attrs;
    if (node.tag === 'a') {
      attrs = resolveLinkAttributes(attrs, options.links);
      if (!attrs || !attrs.href) {
        out.push(...inlineNodesToRender(node.children, options));
        continue;
      }
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
      if (!options.storage && isMentionLink(attrs)) attrs = { ...attrs, class: MENTION_CLASS };
    }
    /** @type {Record<string, string>} */
    const ordered = {};
    for (const name of ATTRIBUTE_ORDER) {
      if (attrs[name] !== undefined && attrs[name] !== '') ordered[name] = String(attrs[name]);
    }
    out.push({
      type: 'element',
      tag: node.tag,
      attrs: ordered,
      children: inlineNodesToRender(node.children, options),
    });
  }
  return out;
};

/**
 * Render nodes of untrusted inline HTML (see `inlineNodesToRender`).
 * @param {unknown} html - Inline HTML.
 * @param {{ links?: Function }} [options] - Render options.
 * @returns {import('./nodes.mjs').RenderNode[]} Render nodes.
 */
export const inlineToNodes = (html, options) => inlineNodesToRender(parseInline(html), options);

/**
 * Serialises a parsed tree to safe HTML.
 * @param {InlineNode[]} nodes - Parsed nodes.
 * @param {{ links?: Function }} [options] - Render options (`links` resolver).
 * @returns {string} HTML containing only allowed tags.
 */
export const nodesToHtml = (nodes, options = {}) => serializeNodes(inlineNodesToRender(nodes, options));

/**
 * Plain text of a parsed tree (`<br>` becomes a line break). Inline math
 * contributes its TeX source; footnote markers contribute nothing (their
 * text is a placeholder) unless `footnote` returns a text for them.
 * @param {InlineNode[]} nodes - Parsed nodes.
 * @param {{ raw?: boolean, footnote?: (node: InlineElement) => string }} [options] - `raw`: every text as it is (internal); `footnote`: text of a marker.
 * @returns {string} Text.
 */
export const nodesToText = (nodes, options = {}) =>
  nodes
    .map((node) => {
      if (node.type === 'text') return node.value;
      if (node.tag === 'br') return '\n';
      if (!options.raw && isFootnoteNode(node))
        return typeof options.footnote === 'function' ? options.footnote(node) : '';
      return nodesToText(node.children, options);
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
 * @param {{ footnote?: (node: InlineElement) => string }} [options] - Text of footnote markers (default none).
 * @returns {string} Text.
 */
export const inlineToText = (html, options) =>
  nodesToText(parseInline(html), options).replace(/\u00a0/g, ' ');

/**
 * Applies `fn` to the note of every footnote marker in inline HTML (stored
 * form in, stored form out). Used where code rewrites inline HTML with
 * string or regular-expression rules that cannot see into the note
 * attribute (preset fixes).
 * @param {string} html - Inline HTML.
 * @param {(note: string) => string} fn - Note rewrite (stored HTML in and out).
 * @returns {string} HTML (unchanged when there is no footnote).
 */
export const mapFootnoteNotes = (html, fn) => {
  if (typeof html !== 'string' || !html.includes('data-mex-footnote')) return html;
  let changed = false;
  const visit = (nodes, depth = 0) => {
    if (depth > MAX_DEPTH) return;
    for (const node of nodes) {
      if (node.type !== 'element') continue;
      if (isFootnoteNode(node)) {
        const before = storedNote(node.note);
        const after = fn(before);
        if (after !== before) {
          node.note = parseInline(String(after || ''), { inNote: true });
          changed = true;
        }
      } else visit(node.children, depth + 1);
    }
  };
  const nodes = parseInline(html);
  visit(nodes);
  return changed ? nodesToHtml(nodes, { storage: true }) : html;
};

/**
 * Canonical stored form of inline math and footnotes (2.4), applied by the
 * server and admin sanitisers after their own HTML sanitiser: math keeps only
 * its TeX text, footnote notes are cleaned with the inline rules (no nested
 * footnotes, no entry references). With `footnotes: false` (a field preset
 * without the footnote tool) markers are removed together with their notes.
 * Strings without these elements are returned unchanged.
 * @param {string} html - Sanitised inline HTML.
 * @param {{ footnotes?: boolean }} [options] - `footnotes: false` removes footnote markers.
 * @returns {string} HTML.
 */
export const canonicalInlineExtras = (html, options = {}) => {
  if (typeof html !== 'string') return '';
  const math = html.includes(MATH_ATTRIBUTE);
  const notes = html.includes('data-mex-footnote');
  if (!math && !notes) return html;
  const nodes = parseInline(html);
  if (options.footnotes === false && notes) {
    const strip = (list, depth = 0) =>
      list.filter((node) => {
        if (node.type !== 'element') return true;
        if (isFootnoteNode(node)) return false;
        if (depth < MAX_DEPTH) node.children = strip(node.children, depth + 1);
        return true;
      });
    return nodesToHtml(strip(nodes), { storage: true });
  }
  return nodesToHtml(nodes, { storage: true });
};

/**
 * Walks parsed inline nodes including the notes of footnote markers.
 * @param {InlineNode[]} nodes - Parsed nodes.
 * @param {(node: InlineElement, inNote: boolean) => void} fn - Called for every element.
 * @param {boolean} [inNote=false] - Internal.
 * @param {number} [depth=0] - Internal.
 */
export const walkInlineElements = (nodes, fn, inNote = false, depth = 0) => {
  if (depth > MAX_DEPTH) return;
  for (const node of nodes) {
    if (node.type !== 'element') continue;
    fn(node, inNote);
    walkInlineElements(node.children, fn, inNote, depth + 1);
    if (node.note) walkInlineElements(node.note, fn, true, depth + 1);
  }
};
