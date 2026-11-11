/**
 * Browser adapter for `htmlToBlocks`: parses HTML with DOMParser into an inert
 * document (scripts do not run, nothing is attached to the page, images are
 * not loaded) and maps it to the converter's minimal node tree.
 */

const MAX_DEPTH = 200;
const MAX_NODES = 200000;

/**
 * Maps a DOM node to `{ type, name, attribs, children }` / `{ type, data }`.
 * @param {Node} node - DOM node.
 * @param {{ count: number }} budget - Node budget.
 * @param {number} [depth=0] - Depth.
 * @returns {object|null} Converter node, or null for other node types.
 */
export const fromDomNode = (node, budget = { count: 0 }, depth = 0) => {
  if (!node || depth > MAX_DEPTH || budget.count > MAX_NODES) return null;
  budget.count += 1;
  if (node.nodeType === 3) return { type: 'text', data: node.nodeValue || '' };
  if (node.nodeType === 8) return { type: 'comment', data: node.nodeValue || '' };
  if (node.nodeType !== 1) return null;
  const attribs = {};
  for (const attribute of Array.from(node.attributes || []))
    attribs[attribute.name.toLowerCase()] = attribute.value;
  return {
    type: 'element',
    name: String(node.nodeName).toLowerCase(),
    attribs,
    children: Array.from(node.childNodes || [])
      .map((child) => fromDomNode(child, budget, depth + 1))
      .filter(Boolean),
  };
};

/**
 * Parses HTML with the browser's DOMParser.
 * @param {string} html - Untrusted HTML.
 * @param {typeof DOMParser} [Parser=globalThis.DOMParser] - DOMParser implementation.
 * @returns {Array<object>} Nodes of the document body.
 */
export const parseHtmlWithDom = (html, Parser = globalThis.DOMParser) => {
  const doc = new Parser().parseFromString(String(html), 'text/html');
  const budget = { count: 0 };
  return Array.from(doc.body ? doc.body.childNodes : [])
    .map((node) => fromDomNode(node, budget))
    .filter(Boolean);
};
