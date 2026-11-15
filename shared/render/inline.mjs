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
import {
  COLOR_ATTRIBUTE,
  HIGHLIGHT_ATTRIBUTE,
  TOKEN_PATTERN,
  colorClass,
  highlightClass,
} from '../inline-format.mjs';
import {
  ANNOTATION_ATTRIBUTE,
  ANNOTATION_VALUE_PREFIX,
  ANNOTATION_NAME,
  ANNOTATION_KEY,
  ANNOTATION_LIMITS,
  activeAnnotation,
  cleanAnnotationAttributes,
  cleanAnnotationWrapper,
} from '../blocks/annotations.mjs';

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
 * True for a text colour span (2.5, `<span data-mex-color="token">`).
 * @param {InlineNode} node - Parsed node.
 * @returns {boolean} Result.
 */
export const isColorNode = (node) =>
  node.type === 'element' && node.tag === 'span' && typeof node.attrs[COLOR_ATTRIBUTE] === 'string';

/**
 * True for a highlight (2.5, `<mark data-mex-highlight="token">`).
 * @param {InlineNode} node - Parsed node.
 * @returns {boolean} Result.
 */
export const isHighlightNode = (node) =>
  node.type === 'element' && node.tag === 'mark' && typeof node.attrs[HIGHLIGHT_ATTRIBUTE] === 'string';

/**
 * True for an inline annotation (2.5, `<span data-mex-annotation="name">`).
 * @param {InlineNode} node - Parsed node.
 * @returns {boolean} Result.
 */
export const isAnnotationNode = (node) =>
  node.type === 'element' && node.tag === 'span' && typeof node.attrs[ANNOTATION_ATTRIBUTE] === 'string';

/**
 * Name and attribute values of an annotation node.
 * @param {InlineElement} node - Annotation node.
 * @returns {{ name: string, attrs: Record<string, string> }} Annotation.
 */
export const annotationOf = (node) => {
  const attrs = {};
  for (const [name, value] of Object.entries(node.attrs))
    if (name.startsWith(ANNOTATION_VALUE_PREFIX)) attrs[name.slice(ANNOTATION_VALUE_PREFIX.length)] = value;
  return { name: node.attrs[ANNOTATION_ATTRIBUTE], attrs };
};

/**
 * Stored attributes of an annotation (name first, values sorted by key).
 * @param {string} name - Annotation name.
 * @param {Record<string, string>} values - Values by key.
 * @returns {Record<string, string>} Attributes.
 */
const annotationAttributes = (name, values) => {
  const out = { [ANNOTATION_ATTRIBUTE]: name };
  for (const key of Object.keys(values).sort()) out[`${ANNOTATION_VALUE_PREFIX}${key}`] = values[key];
  return out;
};

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
      // The editor keeps a zero-width space in an empty formula for the caret; it is not TeX.
      const tex = nodesToText(node.children, { raw: true })
        .replace(/\u200b/g, '')
        .slice(0, MAX_INLINE_TEX);
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
  // 2.5: inline annotation, then text colour (a span carries one of them; the editor nests elements).
  if (tag === 'span' && Object.prototype.hasOwnProperty.call(attribs, ANNOTATION_ATTRIBUTE)) {
    const name = attribs[ANNOTATION_ATTRIBUTE];
    if (!ANNOTATION_NAME.test(name)) return null;
    const values = {};
    for (const [attribute, value] of Object.entries(attribs)) {
      if (!attribute.startsWith(ANNOTATION_VALUE_PREFIX)) continue;
      const key = attribute.slice(ANNOTATION_VALUE_PREFIX.length);
      if (!ANNOTATION_KEY.test(key) || Object.keys(values).length >= ANNOTATION_LIMITS.attributes) continue;
      const text = String(value).slice(0, ANNOTATION_LIMITS.text);
      if (text) values[key] = text;
    }
    return { attrs: annotationAttributes(name, values) };
  }
  if (tag === 'span' && Object.prototype.hasOwnProperty.call(attribs, COLOR_ATTRIBUTE)) {
    return TOKEN_PATTERN.test(attribs[COLOR_ATTRIBUTE])
      ? { attrs: { [COLOR_ATTRIBUTE]: attribs[COLOR_ATTRIBUTE] } }
      : null;
  }
  if (tag === 'mark' && Object.prototype.hasOwnProperty.call(attribs, HIGHLIGHT_ATTRIBUTE)) {
    return TOKEN_PATTERN.test(attribs[HIGHLIGHT_ATTRIBUTE])
      ? { attrs: { [HIGHLIGHT_ATTRIBUTE]: attribs[HIGHLIGHT_ATTRIBUTE] } }
      : null;
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
        // An empty formula renders nothing.
        if (tex.trim()) out.push(state.math(tex, false));
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
    // 2.5: colour and highlight tokens get their class when rendered; storage keeps the token only.
    if (isColorNode(node) || isHighlightNode(node)) {
      const color = node.tag === 'span';
      const name = color ? COLOR_ATTRIBUTE : HIGHLIGHT_ATTRIBUTE;
      const token = node.attrs[name];
      out.push({
        type: 'element',
        tag: node.tag,
        attrs: options.storage
          ? { [name]: token }
          : { class: color ? colorClass(token) : highlightClass(token), [name]: token },
        children: inlineNodesToRender(node.children, options),
      });
      continue;
    }
    if (isAnnotationNode(node)) {
      const children = inlineNodesToRender(node.children, options);
      if (options.storage) out.push({ type: 'element', tag: 'span', attrs: { ...node.attrs }, children });
      else out.push(...renderAnnotation(node, children, options));
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

/** Compiled `annotations` render option per array (name -> definition). */
const annotationLists = new WeakMap();

/**
 * Definition of an annotation for a render call: the `annotations` option
 * (definitions from `defineInlineAnnotation`; replaces the bundle registry
 * for that call), else the bundle registry (server) and the built-in
 * abbreviation.
 * @param {string} name - Annotation name.
 * @param {object} options - Render options.
 * @returns {object|null} Definition.
 */
const annotationDefinition = (name, options) => {
  const list = options.annotations;
  if (Array.isArray(list)) {
    if (!annotationLists.has(list)) {
      const map = new Map();
      for (const item of list.slice(0, ANNOTATION_LIMITS.registered))
        if (item && typeof item === 'object' && typeof item.name === 'string' && item.attributes)
          map.set(item.name, item);
      annotationLists.set(list, map);
    }
    const found = annotationLists.get(list).get(name);
    if (found) return found;
  }
  return activeAnnotation(name);
};

/**
 * Resolved value of an annotation from `options.resolveAnnotation` (server
 * output passes the batch results): a string (max 2000 characters) or a plain
 * object; anything else, or a throw, is ignored.
 * @param {object} options - Render options.
 * @param {{ name: string, attrs: Record<string, string>, text: string }} annotation - Annotation.
 * @returns {unknown} Value or undefined.
 */
const resolvedValue = (options, annotation) => {
  if (typeof options.resolveAnnotation !== 'function') return undefined;
  let value;
  try {
    value = options.resolveAnnotation(annotation);
  } catch {
    return undefined;
  }
  if (typeof value === 'string') return value.slice(0, 2000);
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  return undefined;
};

/**
 * Render nodes of an annotation (2.5): the definition's `render` result
 * (one validated wrapper element around the annotated text), `false` for
 * the text only, or the default
 * `<span class="mex-annotation mex-annotation-<name>" data-mex-annotation …>`
 * (with the cleaned `data-mex-a-*` values only when the definition is known).
 * An annotation whose required values are missing renders its text only.
 * @param {InlineElement} node - Annotation node.
 * @param {import('./nodes.mjs').RenderNode[]} children - Rendered content.
 * @param {object} options - Render options.
 * @returns {import('./nodes.mjs').RenderNode[]} Nodes.
 */
const renderAnnotation = (node, children, options) => {
  const { name, attrs } = annotationOf(node);
  const definition = annotationDefinition(name, options);
  const values = definition ? cleanAnnotationAttributes(definition, attrs) : attrs;
  if (!values) return children;
  if (definition && typeof definition.render === 'function') {
    const text = nodesToText(node.children);
    let out;
    try {
      out = definition.render({
        name,
        attrs: { ...values },
        text,
        resolved: resolvedValue(options, { name, attrs: { ...values }, text }),
      });
    } catch {
      out = undefined;
    }
    if (out === false) return children;
    const wrapper = cleanAnnotationWrapper(out);
    if (wrapper) return [{ type: 'element', tag: wrapper.tag, attrs: wrapper.attrs, children }];
  }
  // Values are written only when a definition cleaned them (an unknown annotation's values are not validated).
  return [
    {
      type: 'element',
      tag: 'span',
      attrs: {
        class: `mex-annotation mex-annotation-${name}`,
        ...annotationAttributes(name, definition ? values : {}),
      },
      children,
    },
  ];
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
 * Inline policy of one field (2.5) for `canonicalInlineExtras`:
 * - `footnotes: false` removes footnote markers with their notes;
 * - `colors` / `highlights`: allowed tokens (unknown ones are unwrapped);
 *   undefined keeps every syntactically valid token;
 * - `annotations`: allowed definitions by name (a Map or an array of
 *   definitions); unknown names are unwrapped and values are cleaned with the
 *   definition (missing required values unwrap); undefined keeps every
 *   syntactically valid annotation;
 * - `plainTags`: tags allowed only as their special form (a field that allows
 *   `span` only for colours unwraps other spans).
 * @typedef {{ footnotes?: boolean, colors?: string[], highlights?: string[], annotations?: Map<string, object>|object[], plainTags?: string[] }} InlineExtrasPolicy
 */

const SPECIAL_MARKERS = [
  MATH_ATTRIBUTE,
  'data-mex-footnote',
  COLOR_ATTRIBUTE,
  HIGHLIGHT_ATTRIBUTE,
  ANNOTATION_ATTRIBUTE,
];

/**
 * True when a node is the special form of its tag (math, footnote, colour, highlight, annotation).
 * @param {InlineNode} node - Node.
 * @returns {boolean} Result.
 */
const isSpecialNode = (node) =>
  isMathNode(node) ||
  isFootnoteNode(node) ||
  isColorNode(node) ||
  isHighlightNode(node) ||
  isAnnotationNode(node);

/**
 * Canonical stored form of inline math and footnotes (2.4) and of colours,
 * highlights and annotations (2.5), applied by the server and admin
 * sanitisers after their own HTML sanitiser: math keeps only its TeX text,
 * footnote notes are cleaned with the inline rules (no nested footnotes, no
 * entry references), tokens and annotations follow the field's policy (see
 * `InlineExtrasPolicy`; also inside notes). Strings without these elements
 * (and without tags the policy restricts) are returned unchanged.
 * @param {string} html - Sanitised inline HTML.
 * @param {InlineExtrasPolicy} [options] - Field policy.
 * @returns {string} HTML.
 */
export const canonicalInlineExtras = (html, options = {}) => {
  if (typeof html !== 'string') return '';
  const plain = Array.isArray(options.plainTags) ? options.plainTags : [];
  const special = SPECIAL_MARKERS.some((marker) => html.includes(marker));
  const restricted = plain.some((tag) => html.includes(`<${tag}`));
  if (!special && !restricted) return html;
  const colors = Array.isArray(options.colors) ? new Set(options.colors) : null;
  const highlights = Array.isArray(options.highlights) ? new Set(options.highlights) : null;
  let annotations = null;
  if (options.annotations instanceof Map) annotations = options.annotations;
  else if (Array.isArray(options.annotations))
    annotations = new Map(options.annotations.filter(Boolean).map((item) => [item.name, item]));
  const nodes = parseInline(html);
  const filter = (list, depth = 0) => {
    const out = [];
    for (const node of list) {
      if (node.type !== 'element') {
        out.push(node);
        continue;
      }
      if (options.footnotes === false && isFootnoteNode(node)) continue;
      if (depth < MAX_DEPTH) node.children = filter(node.children, depth + 1);
      if (node.note) node.note = filter(node.note, depth + 1);
      let keep = true;
      if (isColorNode(node)) keep = !colors || colors.has(node.attrs[COLOR_ATTRIBUTE]);
      else if (isHighlightNode(node)) keep = !highlights || highlights.has(node.attrs[HIGHLIGHT_ATTRIBUTE]);
      else if (isAnnotationNode(node) && annotations) {
        const { name, attrs } = annotationOf(node);
        const definition = annotations.get(name);
        const values = definition ? cleanAnnotationAttributes(definition, attrs) : null;
        if (values) node.attrs = annotationAttributes(name, values);
        else keep = false;
      } else if (!isSpecialNode(node) && plain.includes(node.tag)) keep = false;
      if (keep) out.push(node);
      else out.push(...node.children);
    }
    return out;
  };
  return nodesToHtml(filter(nodes), { storage: true });
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
