/**
 * Range comments (2.4): DOM side of comment anchors.
 *
 * - `anchorFromSelection` turns a selection inside one text field of a block
 *   (paragraph, heading, list item, table cell, quote, caption, ...) into an
 *   anchor: the field's data path, Yjs relative positions on its Y.Text in the
 *   live room (when there is one) and a text quote.
 * - `locateAnchor` finds the anchored text again: relative positions first,
 *   then the quote, otherwise the thread's text "changed" (block still there)
 *   or the thread is "detached" (block gone).
 * - `updateCommentHighlights` paints the ranges with the CSS Custom Highlight
 *   API (`::highlight(mex-comment)` / `mex-comment-active` in tools/styles.js).
 *   The Editor.js DOM is never changed.
 *
 * The text of an element is built like `htmlTextMap` builds the text of the
 * stored HTML (text nodes in order, `<br>` as a line feed), so text offsets of
 * the DOM and of the HTML source line up whenever both texts are equal. When
 * they differ (a remote change not shown yet, markup the editor shows in
 * another way such as rendered math), only the quote is used.
 */

import {
  buildQuote,
  cleanAnchor,
  findQuote,
  htmlTextMap,
  sourceRangeToText,
  textLeaves,
  textRangeToSource,
} from '../../../shared/comment-anchor.mjs';
import {
  encodeRange,
  resolveRange,
  sharedTextAt,
  sharedTextLeaves,
} from '../../../shared/comment-relpos.mjs';

const TEXT_NODE = 3;
const ELEMENT_NODE = 1;
const FRAGMENT_NODE = 11;

/**
 * Text of a node as the anchor model sees it, with the pieces it is made of.
 * @param {Node} root - Element or fragment.
 * @returns {{ text: string, pieces: Array<{ node: Node, start: number, br: boolean }> }} Text and pieces.
 */
export const domTextMap = (root) => {
  const pieces = [];
  let text = '';
  const walk = (node, depth) => {
    if (depth > 64) return;
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === TEXT_NODE) {
        pieces.push({ node: child, start: text.length, br: false });
        text += child.data;
      } else if (child.nodeType === ELEMENT_NODE) {
        if (child.tagName === 'BR') {
          pieces.push({ node: child, start: text.length, br: true });
          text += '\n';
        } else walk(child, depth + 1);
      } else if (child.nodeType === FRAGMENT_NODE) walk(child, depth + 1);
    }
  };
  if (root) walk(root, 0);
  return { text, pieces };
};

/**
 * Text offset of a DOM boundary point inside `root`.
 * @param {HTMLElement} root - Text element.
 * @param {Node} container - Boundary container.
 * @param {number} offset - Boundary offset.
 * @returns {number} Offset (characters before the point).
 */
export const textOffsetOf = (root, container, offset) => {
  const range = root.ownerDocument.createRange();
  range.setStart(root, 0);
  range.setEnd(container, offset);
  return domTextMap(range.cloneContents()).text.length;
};

/**
 * DOM boundary point of a text offset.
 * @param {{ text: string, pieces: Array<object> }} map - `domTextMap(root)`.
 * @param {HTMLElement} root - Text element.
 * @param {number} offset - Text offset.
 * @param {boolean} isEnd - The point ends a range (prefer the end of the previous text node).
 * @returns {{ node: Node, offset: number }} Point.
 */
const pointAt = (map, root, offset, isEnd) => {
  for (const piece of map.pieces) {
    const length = piece.br ? 1 : piece.node.data.length;
    const inside = isEnd ? offset <= piece.start + length : offset < piece.start + length;
    if (offset < piece.start || !inside) continue;
    if (!piece.br) return { node: piece.node, offset: offset - piece.start };
    const parent = piece.node.parentNode;
    const index = Array.prototype.indexOf.call(parent.childNodes, piece.node);
    return { node: parent, offset: offset === piece.start ? index : index + 1 };
  }
  return { node: root, offset: root.childNodes.length };
};

/**
 * DOM range of a text range inside `root`.
 * @param {HTMLElement} root - Text element.
 * @param {number} start - Text start.
 * @param {number} end - Text end.
 * @param {{ text: string, pieces: Array<object> }} [map] - `domTextMap(root)` (computed when missing).
 * @returns {Range|null} Range.
 */
export const rangeOfText = (root, start, end, map = domTextMap(root)) => {
  if (!(end > start) || start < 0 || end > map.text.length) return null;
  const from = pointAt(map, root, start, false);
  const to = pointAt(map, root, end, true);
  const range = root.ownerDocument.createRange();
  range.setStart(from.node, from.offset);
  range.setEnd(to.node, to.offset);
  return range;
};

/**
 * Outermost elements with a `contenteditable` attribute inside a block (the
 * text fields; Editor.js sets `contenteditable="false"` on them in read-only
 * mode, so they are found in both modes).
 * @param {HTMLElement} block - `.ce-block` element.
 * @returns {HTMLElement[]} Text elements in document order.
 */
export const textElements = (block) =>
  Array.from(block.querySelectorAll('[contenteditable]')).filter((element) => {
    const outer = element.parentElement && element.parentElement.closest('[contenteditable]');
    return !outer || !block.contains(outer);
  });

/**
 * The text element of `block` that contains `node`.
 * @param {HTMLElement} block - Block element.
 * @param {Node} node - Node.
 * @returns {HTMLElement|null} Element.
 */
const textElementOf = (block, node) => {
  const element = node.nodeType === ELEMENT_NODE ? node : node.parentElement;
  return (
    textElements(block).find((candidate) => candidate === element || candidate.contains(element)) || null
  );
};

/**
 * Picks the leaf for an element when several fields have the same text: the
 * n-th element with that text gets the n-th leaf with that text.
 * @param {HTMLElement} block - Block element.
 * @param {HTMLElement} element - Text element.
 * @param {string} text - Its text.
 * @param {Array<object>} leaves - Leaves with that text, in data order.
 * @returns {object|null} Leaf.
 */
const leafForElement = (block, element, text, leaves) => {
  if (leaves.length <= 1) return leaves[0] || null;
  const same = textElements(block).filter((candidate) => domTextMap(candidate).text === text);
  const rank = same.indexOf(element);
  return rank >= 0 && rank < leaves.length ? leaves[rank] : null;
};

/**
 * Builds the anchor of a selection.
 * @param {object} options - Options.
 * @param {Range} options.range - Selection range.
 * @param {HTMLElement} options.holder - Editor.js holder.
 * @param {import('yjs').Doc|null} [options.doc] - Live room document (null without a room).
 * @param {object|null} [options.blockData] - Saved data of the block (fields without a room).
 * @returns {{ blockId: string, anchor: object } | { error: 'outside'|'multiple'|'empty' }} Anchor or the reason why not.
 */
export const anchorFromSelection = ({ range, holder, doc = null, blockData = null }) => {
  if (!range || !holder) return { error: 'outside' };
  const startElement =
    range.startContainer.nodeType === ELEMENT_NODE
      ? range.startContainer
      : range.startContainer.parentElement;
  const endElement =
    range.endContainer.nodeType === ELEMENT_NODE ? range.endContainer : range.endContainer.parentElement;
  const block = startElement && startElement.closest('.ce-block[data-id]');
  if (!block || !holder.contains(block)) return { error: 'outside' };
  if (!endElement || endElement.closest('.ce-block[data-id]') !== block) return { error: 'multiple' };
  const element = textElementOf(block, range.startContainer);
  if (!element || textElementOf(block, range.endContainer) !== element) return { error: 'multiple' };
  const blockId = block.getAttribute('data-id');
  const map = domTextMap(element);
  const start = textOffsetOf(element, range.startContainer, range.startOffset);
  const end = textOffsetOf(element, range.endContainer, range.endOffset);
  const quote = buildQuote(map.text, start, end);
  if (!quote) return { error: 'empty' };
  let path = null;
  let relative = null;
  const entry = doc ? doc.getMap('blocks').get(blockId) : null;
  if (entry && typeof entry.get === 'function') {
    const leaves = sharedTextLeaves(entry.get('data')).filter(
      (leaf) => htmlTextMap(leaf.text.toString()).text === map.text
    );
    const leaf = leafForElement(block, element, map.text, leaves);
    if (leaf) {
      path = leaf.path;
      const source = textRangeToSource(htmlTextMap(leaf.text.toString()), start, end);
      relative = source ? encodeRange(leaf.text, source.start, source.end) : null;
    }
  } else if (blockData) {
    const leaves = textLeaves(blockData).filter((leaf) => htmlTextMap(leaf.value).text === map.text);
    const leaf = leafForElement(block, element, map.text, leaves);
    if (leaf) path = leaf.path;
  }
  const anchor = cleanAnchor({
    path,
    start: relative ? relative.start : null,
    end: relative ? relative.end : null,
    quote,
  });
  return anchor ? { blockId, anchor } : { error: 'empty' };
};

/**
 * Finds an anchored range in the editor.
 * @param {object} options - Options.
 * @param {HTMLElement|null} options.block - The thread's block element (null when the block is gone).
 * @param {string} options.blockId - Block id.
 * @param {object} options.anchor - Anchor (`cleanAnchor` shape).
 * @param {import('yjs').Doc|null} [options.doc] - Live room document.
 * @returns {{ status: 'anchored'|'changed'|'detached', range: Range|null, via: 'relative'|'quote'|null }} Result.
 */
export const locateAnchor = ({ block, blockId, anchor, doc = null }) => {
  if (!block) return { status: 'detached', range: null, via: null };
  const clean = cleanAnchor(anchor);
  if (!clean) return { status: 'changed', range: null, via: null };
  const elements = textElements(block).map((element) => ({ element, map: domTextMap(element) }));
  if (doc && clean.start && clean.path) {
    const ytext = sharedTextAt(doc, blockId, clean.path);
    const source = ytext ? resolveRange(doc, ytext, clean.start, clean.end) : null;
    if (source) {
      const html = htmlTextMap(ytext.toString());
      const text = sourceRangeToText(html, source.start, source.end);
      const candidates = elements.filter((item) => item.map.text === html.text);
      if (text && candidates.length) {
        let chosen = candidates[0];
        if (candidates.length > 1) {
          const leaves = sharedTextLeaves(doc.getMap('blocks').get(blockId).get('data')).filter(
            (leaf) => htmlTextMap(leaf.text.toString()).text === html.text
          );
          const rank = leaves.findIndex((leaf) => leaf.text === ytext);
          if (rank >= 0 && rank < candidates.length) chosen = candidates[rank];
        }
        const range = rangeOfText(chosen.element, text.start, text.end, chosen.map);
        if (range) return { status: 'anchored', range, via: 'relative' };
      }
    }
  }
  let best = null;
  for (const item of elements) {
    const found = findQuote(item.map.text, clean.quote);
    if (found && (!best || found.score > best.found.score)) best = { item, found };
  }
  if (best) {
    const range = rangeOfText(best.item.element, best.found.start, best.found.end, best.item.map);
    if (range) return { status: 'anchored', range, via: 'quote' };
  }
  return { status: 'changed', range: null, via: null };
};

/* ------------------------------------------------------------ highlights */

const HIGHLIGHT = 'mex-comment';
const HIGHLIGHT_ACTIVE = 'mex-comment-active';

/** Ranges per editor field: one page can show several fields, all painted by the same two highlights. */
const owners = new Map();

/**
 * True when the browser supports the CSS Custom Highlight API.
 * @returns {boolean} Result.
 */
export const highlightsSupported = () =>
  typeof CSS !== 'undefined' && Boolean(CSS.highlights) && typeof Highlight !== 'undefined';

/** Rebuilds the two highlights from every field's ranges. */
const paint = () => {
  if (!highlightsSupported()) return;
  const all = [];
  const active = [];
  for (const { ranges, activeId } of owners.values()) {
    for (const [id, range] of ranges) (id === activeId ? active : all).push(range);
  }
  if (all.length) CSS.highlights.set(HIGHLIGHT, new Highlight(...all));
  else CSS.highlights.delete(HIGHLIGHT);
  if (active.length) CSS.highlights.set(HIGHLIGHT_ACTIVE, new Highlight(...active));
  else CSS.highlights.delete(HIGHLIGHT_ACTIVE);
};

/**
 * Sets the highlighted ranges of one field.
 * @param {string} owner - Field key.
 * @param {Map<string, Range>} ranges - Ranges per thread id.
 * @param {string|null} activeId - Thread shown as active.
 */
export const updateCommentHighlights = (owner, ranges, activeId) => {
  owners.set(owner, { ranges, activeId });
  paint();
};

/**
 * Removes the highlights of one field.
 * @param {string} owner - Field key.
 */
export const clearCommentHighlights = (owner) => {
  if (!owners.delete(owner)) return;
  paint();
};

/**
 * The thread whose range contains a DOM point.
 * @param {Map<string, Range>} ranges - Ranges per thread id.
 * @param {Node} node - Point container.
 * @param {number} offset - Point offset.
 * @returns {string|null} Thread id.
 */
export const threadAtPoint = (ranges, node, offset) => {
  for (const [id, range] of ranges) {
    try {
      if (range.isPointInRange(node, offset)) return id;
    } catch {
      // a point in another document or a detached node
    }
  }
  return null;
};
