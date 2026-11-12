/**
 * Inserts the AI suggestion for a text selection (2.4: selections that cross
 * inline formatting keep it). After `deleteContents()` of a range that
 * started inside formatting (`<b>he[llo</b> wor]ld`), the collapsed point
 * sits at the end of `<b>`; inserting there would nest the answer's own
 * markup inside it. The point is moved out of every inline element it is at
 * the edge of (never out of the editable block), so the answer's tags stand
 * on their own and the text around keeps its formatting.
 * @param {Range} range - Live selection range (inside `editable`).
 * @param {DocumentFragment} fragment - Sanitised suggestion.
 * @param {HTMLElement} editable - The contenteditable element of the block.
 */
export const insertSuggestion = (range, fragment, editable) => {
  range.deleteContents();
  for (let guard = 0; guard < 40; guard += 1) {
    const node = range.startContainer;
    if (!node || node === editable || !editable.contains(node)) break;
    const length = node.nodeType === Node.TEXT_NODE ? node.length : node.childNodes.length;
    if (range.startOffset === length && length > 0) range.setStartAfter(node);
    else if (range.startOffset === 0 && node.nodeType !== Node.TEXT_NODE) range.setStartBefore(node);
    else if (range.startOffset === 0 && node.nodeType === Node.TEXT_NODE && node.parentNode !== editable)
      range.setStartBefore(node);
    else break;
    range.collapse(true);
  }
  range.insertNode(fragment);
  range.collapse(false);
};
