/**
 * Shared logic of the React and Vue components: name checks, the code copy
 * block and block override lookup. Framework-free.
 */

import { TAG_NAME, isSafeAttributeName, nodesTextContent } from '../render/nodes.mjs';

/**
 * Whether an element node may become a framework element (defence in depth;
 * the tree builder only produces safe names).
 * @param {{ tag: string }} node - Element node.
 * @returns {boolean} True for a safe tag name.
 */
export const isRenderableElement = (node) =>
  typeof node.tag === 'string' && TAG_NAME.test(node.tag) && node.tag !== 'script' && node.tag !== 'style';

/**
 * Safe attributes of an element node (unsafe names dropped).
 * @param {Record<string, string | true>} attrs - Node attributes.
 * @returns {Array<[string, string | true]>} Name and value pairs.
 */
export const safeAttributes = (attrs) =>
  Object.entries(attrs || {}).filter(
    ([name, value]) => isSafeAttributeName(name) && (value === true || typeof value === 'string')
  );

/**
 * The raw HTML of an element whose only child is a raw node, or null.
 * @param {{ children: Array<{ type: string, html?: string }> }} node - Element node.
 * @returns {string|null} HTML (already passed through the caller's `sanitizeRaw`).
 */
export const rawInner = (node) =>
  node.children.length === 1 && node.children[0].type === 'raw' ? String(node.children[0].html) : null;

/**
 * True for the code block wrapper that carries a copy button.
 * @param {{ type: string, attrs?: Record<string, unknown> }} node - Node.
 * @returns {boolean} Whether the node is `<div data-mex-code="copy">`.
 */
export const isCopyBlock = (node) =>
  node.type === 'element' && Boolean(node.attrs) && node.attrs['data-mex-code'] === 'copy';

/**
 * Parts of a copy block: code text and status labels.
 * @param {{ children: Array<object> }} node - Copy block node.
 * @returns {{ text: string, copied: string, failed: string }} Parts.
 */
export const copyBlockParts = (node) => {
  const pre = node.children.find((child) => child.type === 'element' && child.tag === 'pre');
  const button = node.children.find(
    (child) => child.type === 'element' && child.tag === 'button' && child.attrs['data-mex-copy']
  );
  return {
    text: pre ? nodesTextContent(pre.children) : '',
    copied: (button && button.attrs['data-mex-copied']) || 'Copied',
    failed: (button && button.attrs['data-mex-failed']) || 'Copy failed',
  };
};

/**
 * Override component for a block type from a `components` map (own keys only).
 * @param {unknown} components - Map of block type to component.
 * @param {string} type - Block type.
 * @returns {unknown} Component, or null.
 */
export const componentFor = (components, type) => {
  if (!components || typeof components !== 'object') return null;
  if (!Object.prototype.hasOwnProperty.call(components, type)) return null;
  const component = components[type];
  return typeof component === 'function' || (component && typeof component === 'object') ? component : null;
};
