/**
 * Shows the current find match in the editor without moving focus away from
 * the find field: the CSS Custom Highlight API marks the text (style
 * `::highlight(mex-find)` in tools/styles.js); browsers without it only
 * scroll the block into view.
 */

const NAME = 'mex-find';

/**
 * Text nodes of an element in document order.
 * @param {Node} root - Root.
 * @returns {Text[]} Text nodes.
 */
const textNodes = (root) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  return nodes;
};

/**
 * Removes the highlight.
 * @param {string} [name] - Highlight name (`mex-find`, or `mex-grammar` for the grammar check).
 */
export const clearHighlight = (name = NAME) => {
  if (typeof CSS !== 'undefined' && CSS.highlights) CSS.highlights.delete(name);
};

/**
 * Highlights a match inside its block. The DOM text of a block does not map
 * one to one onto the stored fields, so the n-th occurrence of the matched
 * text inside the block is used (n counted among matches of the same block).
 * @param {HTMLElement} blockElement - `.ce-block` element.
 * @param {{ text: string, occurrence?: number }} match - Match (see shared/find-replace.mjs) with its occurrence index in the block.
 * @param {{ matchCase?: boolean, name?: string }} [options] - Find options and highlight name.
 */
export const highlightMatch = (blockElement, match, options = {}) => {
  blockElement.scrollIntoView({ block: 'nearest' });
  if (typeof CSS === 'undefined' || !CSS.highlights || typeof Highlight === 'undefined') return;
  const name = options.name || NAME;
  const needle = options.matchCase ? match.text : match.text.toLowerCase();
  let seen = 0;
  const wanted = match.occurrence || 0;
  for (const node of textNodes(blockElement)) {
    const haystack = options.matchCase ? node.data : node.data.toLowerCase();
    let from = 0;
    let index;
    while ((index = haystack.indexOf(needle, from)) !== -1) {
      if (seen === wanted) {
        const range = document.createRange();
        range.setStart(node, index);
        range.setEnd(node, index + needle.length);
        CSS.highlights.set(name, new Highlight(range));
        return;
      }
      seen += 1;
      from = index + Math.max(1, needle.length);
    }
  }
  clearHighlight(name);
};
