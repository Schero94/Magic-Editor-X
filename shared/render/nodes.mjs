// @ts-check
/**
 * Framework-neutral render nodes and their HTML serialiser.
 *
 * The HTML renderer, the React component and the Vue component all consume
 * the same tree:
 *
 * - `{ type: 'element', tag, attrs, children }`: `tag` is a lower-case tag
 *   name, `attrs` maps lower-case attribute names to a string or `true`
 *   (boolean attribute), `children` are nodes.
 * - `{ type: 'text', value }`: plain text, always escaped on output.
 * - `{ type: 'raw', html }`: HTML that already went through the caller's
 *   `sanitizeRaw`. In a public tree a raw node is always the only child of
 *   its parent element (frameworks set it as that element's inner HTML).
 *
 * No DOM and no dependencies.
 */

/**
 * @typedef {{ type: 'text', value: string }} TextNode
 * @typedef {{ type: 'raw', html: string }} RawNode
 * @typedef {{ type: 'element', tag: string, attrs: Record<string, string | true>, children: RenderNode[], style?: Record<string, string> }} ElementNode
 * @typedef {ElementNode | TextNode | RawNode} RenderNode
 */

/** Elements without content or end tag. */
export const VOID_TAGS = new Set([
  'area',
  'base',
  'br',
  'col',
  'embed',
  'hr',
  'img',
  'input',
  'link',
  'meta',
  'source',
  'track',
  'wbr',
]);

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

/** Valid tag name of a render node (lower case, custom elements allowed). */
export const TAG_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/** Valid attribute name of a render node (lower case, `data-*`, `aria-*`). */
export const ATTRIBUTE_NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * True for an attribute name that may appear on a render node: lower case,
 * no event handler (`on*`), no `style` (CSP) and no `srcdoc`.
 * @param {string} name - Attribute name.
 * @returns {boolean} Whether the name is allowed.
 */
export const isSafeAttributeName = (name) =>
  ATTRIBUTE_NAME.test(name) && !name.startsWith('on') && name !== 'style' && name !== 'srcdoc';

/**
 * Text node.
 * @param {unknown} value - Text (stringified).
 * @returns {TextNode} Node.
 */
export const textNode = (value) => ({ type: 'text', value: String(value ?? '') });

/**
 * Element node with normalised attributes: `undefined`, `null`, `false` and
 * '' values are dropped (except `alt=""`), `true` stays a boolean attribute,
 * everything else becomes a string. Children that are strings become text
 * nodes; `null`, `undefined` and `false` children are dropped; arrays are
 * flattened.
 * @param {string} tag - Tag name (trusted, from the renderer).
 * @param {Record<string, unknown>} [attrs] - Attributes.
 * @param {unknown} [children] - Child nodes, strings or arrays of them.
 * @returns {ElementNode} Node.
 */
export const el = (tag, attrs, children) => {
  /** @type {Record<string, string | true>} */
  const clean = {};
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === undefined || value === null || value === false) continue;
    if (value === '' && name !== 'alt') continue;
    clean[name] = value === true ? true : String(value);
  }
  return { type: 'element', tag, attrs: clean, children: toNodes(children) };
};

/**
 * Flattens children into nodes (strings become text nodes).
 * @param {unknown} children - Node, string, array or nothing.
 * @returns {RenderNode[]} Nodes.
 */
export const toNodes = (children) => {
  /** @type {RenderNode[]} */
  const out = [];
  const visit = (/** @type {unknown} */ child) => {
    if (child === undefined || child === null || child === false || child === '') return;
    if (Array.isArray(child)) {
      for (const item of child) visit(item);
    } else if (typeof child === 'string' || typeof child === 'number') {
      out.push(textNode(child));
    } else if (typeof child === 'object') {
      out.push(/** @type {RenderNode} */ (child));
    }
  };
  visit(children);
  return out;
};

/** CSS properties a render node may set through `style` (renderer option `focalPoint: 'style'`). */
export const STYLE_PROPERTIES = Object.freeze(['object-position']);
const STYLE_VALUE = /^[0-9]{1,3}(?:\.[0-9]{1,2})?% [0-9]{1,3}(?:\.[0-9]{1,2})?%$/;

/**
 * Safe inline style declarations of an element node. Only the renderer sets
 * `style` (never overrides or stored content), only for `STYLE_PROPERTIES`
 * with percentage values.
 * @param {unknown} style - `node.style`.
 * @returns {Array<[string, string]>} Property and value pairs.
 */
export const safeStyle = (style) =>
  style && typeof style === 'object'
    ? Object.entries(style).filter(
        ([name, value]) =>
          STYLE_PROPERTIES.includes(name) && typeof value === 'string' && STYLE_VALUE.test(value)
      )
    : [];

/**
 * Serialises render nodes to HTML. Text and attribute values are escaped;
 * raw nodes are written as they are (they were sanitised by the caller).
 * Internal `block` wrapper nodes (used by the framework components) are
 * transparent.
 * @param {ReadonlyArray<RenderNode | { type: 'block', children: RenderNode[] }>} nodes - Nodes.
 * @returns {string} HTML.
 */
export const serializeNodes = (nodes) => {
  let out = '';
  for (const node of nodes) {
    if (!node || typeof node !== 'object') continue;
    if (node.type === 'text') out += escapeHtml(node.value);
    else if (node.type === 'raw') out += node.html;
    else if (node.type === 'block') out += serializeNodes(node.children);
    else if (node.type === 'element') {
      let attributes = '';
      for (const [name, value] of Object.entries(node.attrs)) {
        attributes += value === true ? ` ${name}` : ` ${name}="${escapeHtml(value)}"`;
      }
      const style = safeStyle(node.style);
      if (style.length)
        attributes += ` style="${escapeHtml(style.map(([name, value]) => `${name}:${value}`).join(';'))}"`;
      out += VOID_TAGS.has(node.tag)
        ? `<${node.tag}${attributes}>`
        : `<${node.tag}${attributes}>${serializeNodes(node.children)}</${node.tag}>`;
    }
  }
  return out;
};

/**
 * Plain text content of nodes (raw nodes contribute nothing).
 * @param {ReadonlyArray<RenderNode | { type: 'block', children: RenderNode[] }>} nodes - Nodes.
 * @returns {string} Text.
 */
export const nodesTextContent = (nodes) => {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') out += node.value;
    else if (node.type === 'element' || node.type === 'block') out += nodesTextContent(node.children);
  }
  return out;
};
