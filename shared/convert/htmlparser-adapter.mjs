/**
 * Server adapter for `htmlToBlocks`: parses HTML with htmlparser2 and maps the
 * domhandler tree to the converter's minimal node tree. Entities in text are
 * decoded by the parser; the converter escapes text again.
 */

import { parseDocument } from 'htmlparser2';

const MAX_DEPTH = 200;
const MAX_NODES = 200000;

/**
 * Maps a domhandler node.
 * @param {object} node - domhandler node.
 * @param {{ count: number }} budget - Node budget.
 * @param {number} [depth=0] - Depth.
 * @returns {object|null} Converter node.
 */
const fromHandlerNode = (node, budget, depth = 0) => {
  if (!node || depth > MAX_DEPTH || budget.count > MAX_NODES) return null;
  budget.count += 1;
  if (node.type === 'text') return { type: 'text', data: node.data || '' };
  if (node.type === 'comment') return { type: 'comment', data: node.data || '' };
  if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') return null;
  const attribs = {};
  for (const [key, value] of Object.entries(node.attribs || {})) attribs[key.toLowerCase()] = String(value);
  return {
    type: 'element',
    name: String(node.name).toLowerCase(),
    attribs,
    children: (node.children || []).map((child) => fromHandlerNode(child, budget, depth + 1)).filter(Boolean),
  };
};

/**
 * Parses HTML with htmlparser2.
 * @param {string} html - Untrusted HTML.
 * @returns {Array<object>} Top-level nodes.
 */
export const parseHtmlWithHtmlparser2 = (html) => {
  const doc = parseDocument(String(html), { lowerCaseTags: true, lowerCaseAttributeNames: true });
  const budget = { count: 0 };
  return (doc.children || []).map((node) => fromHandlerNode(node, budget)).filter(Boolean);
};
