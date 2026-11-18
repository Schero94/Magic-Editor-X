/**
 * Keeps the caret of the editor you are typing in while another editor
 * starts (2.6).
 *
 * Editor.js 2.31 clears the document selection whenever an instance starts:
 * `ReadOnly.prepare()` calls `BlockSelection.toggleReadOnly()`, which runs
 * `window.getSelection().removeAllRanges()`. Since fields start lazily (2.5),
 * a field that comes near the viewport while you type in another one (for
 * example after `End` or a scroll moved the page) wiped your caret. The focus
 * stayed in your paragraph, so the browser put the next keystrokes at its
 * start: "text typed after a pause lands at the start of the paragraph".
 *
 * `holdSelection(holder)` remembers the caret of the focused
 * editable (only when it is not inside the starting editor's `holder`) and,
 * while the start runs, puts it back on the `selectionchange` that the
 * clearing causes. That event runs before the next key event is handled, so
 * no keystroke lands at the wrong place. The remembered position follows the
 * user's own caret moves during the start. Nothing is restored when the focus
 * moved elsewhere or the remembered node left the document.
 */

/**
 * True when `node` is inside `container` (or is it).
 * @param {Node|null} container - Container.
 * @param {Node|null} node - Node.
 * @returns {boolean} Result.
 */
const inside = (container, node) =>
  Boolean(container && node && (container === node || container.contains(node)));

/**
 * Focused editable that holds the selection, or null.
 * @param {Document} doc - Document.
 * @param {Selection} selection - Selection.
 * @returns {HTMLElement|null} Element.
 */
const focusedEditable = (doc, selection) => {
  const active = doc.activeElement;
  if (!active || !active.isContentEditable || !selection || selection.rangeCount === 0) return null;
  const range = selection.getRangeAt(0);
  return inside(active, range.startContainer) ? active : null;
};

/**
 * Starts keeping the caret of another focused editor in place while an
 * editor starts in `holder`. Call `release()` when the start finished
 * (`isReady` settled); it keeps watching `settleMs` longer, because Editor.js
 * finishes part of its start on idle callbacks.
 * @param {HTMLElement|null} holder - Element the starting editor renders into.
 * @param {{ doc?: Document, win?: Window, settleMs?: number }} [env] - Document and window (tests), watch time after release.
 * @returns {{ active: boolean, release: () => void }} Handle (`active` false when there was nothing to keep).
 */
export const holdSelection = (holder, env = {}) => {
  const doc = env.doc || (typeof document === 'undefined' ? null : document);
  const win = env.win || (typeof window === 'undefined' ? null : window);
  const settleMs = env.settleMs === undefined ? 300 : env.settleMs;
  const selection = win && typeof win.getSelection === 'function' ? win.getSelection() : null;
  const editable = doc && selection ? focusedEditable(doc, selection) : null;
  // Nothing to keep: no caret in a focused editable, or the caret is in the editor that starts.
  if (!editable || inside(holder, editable)) return { active: false, release: () => {} };
  let saved = selection.getRangeAt(0).cloneRange();
  const onChange = () => {
    if (doc.activeElement !== editable) return;
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      // The user's own caret moves inside the editable are followed.
      if (inside(editable, range.startContainer)) saved = range.cloneRange();
      return;
    }
    if (!saved.startContainer || !saved.startContainer.isConnected) return;
    selection.addRange(saved.cloneRange());
  };
  doc.addEventListener('selectionchange', onChange);
  let released = false;
  return {
    active: true,
    release: () => {
      if (released) return;
      released = true;
      const stop = () => {
        onChange();
        doc.removeEventListener('selectionchange', onChange);
      };
      if (settleMs > 0 && win && typeof win.setTimeout === 'function') win.setTimeout(stop, settleMs);
      else stop();
    },
  };
};
