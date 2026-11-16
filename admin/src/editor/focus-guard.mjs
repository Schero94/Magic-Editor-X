/**
 * Focus guards of the admin editor (2.5). Pure ESM without imports: used by
 * apply-remote.js and the dialog keyboard guard, and tested in Node with a
 * minimal fake DOM (tests/focus-25.test.mjs).
 */

/**
 * Deletes a block without moving the user's focus (2.5). Editor.js 2.31
 * `blocks.delete` ends with `Caret.setToBlock(currentBlock, END)` and, when the
 * last block goes, inserts a new default block and makes it current: a remote
 * delete (the first live catch-up of an empty field removes its empty
 * paragraph) pulled the focus into this field from wherever the user was, and
 * moved the caret of someone typing in another block to its end. The focus
 * and selection are put back unless they were inside the deleted block, where
 * Editor.js's choice stands.
 * @param {object} editor - Editor.js instance.
 * @param {number} index - Block index.
 */
export const deleteBlockKeepingFocus = (editor, index) => {
  const hasDom = typeof document !== 'undefined' && typeof window !== 'undefined';
  const selection = hasDom && typeof window.getSelection === 'function' ? window.getSelection() : null;
  const active = hasDom ? document.activeElement : null;
  // A text field keeps its own caret; the document selection then only points at its container
  // and must not be put back (that would take the caret out of the field and drop typed keys).
  const textField = Boolean(active) && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  const fieldCaret = textField
    ? { start: active.selectionStart, end: active.selectionEnd, direction: active.selectionDirection }
    : null;
  const range =
    !textField && selection && selection.rangeCount > 0 ? selection.getRangeAt(0).cloneRange() : null;
  editor.blocks.delete(index);
  if (!hasDom) return;
  const nothingFocused = !active || active === document.body;
  if (!nothingFocused && !active.isConnected) return;
  const now = document.activeElement;
  if (nothingFocused) {
    if (now && now !== document.body && typeof now.blur === 'function') now.blur();
  } else if (now !== active && typeof active.focus === 'function') {
    active.focus({ preventScroll: true });
  }
  if (fieldCaret) {
    if (
      typeof fieldCaret.start === 'number' &&
      typeof active.setSelectionRange === 'function' &&
      (active.selectionStart !== fieldCaret.start || active.selectionEnd !== fieldCaret.end)
    ) {
      try {
        active.setSelectionRange(fieldCaret.start, fieldCaret.end, fieldCaret.direction || 'none');
      } catch {
        // input types without a text caret (number, email) keep theirs
      }
    }
    return;
  }
  if (!selection) return;
  if (range && range.startContainer.isConnected && range.endContainer.isConnected) {
    selection.removeAllRanges();
    selection.addRange(range);
  } else if (!range && selection.rangeCount > 0) {
    selection.removeAllRanges();
  }
};

/**
 * Key codes Editor.js 2.31 acts on in its document keydown handler
 * (`UI.documentKeydown` -> `BlockEvents.keydown`): Backspace, Tab, Enter,
 * arrows, Delete. Escape is left alone (Editor.js only closes its own
 * toolbars on it, and dialogs need it).
 */
const EDITOR_KEY_CODES = new Set([8, 9, 13, 37, 38, 39, 40, 46]);

/** Editor.js wrapper class (`.codex-editor`). */
const EDITOR_WRAPPER = '.codex-editor';

/**
 * Whether Editor.js must not see a keydown: its target is an element outside
 * every Editor.js editor (a Magic Editor X dialog, popover, menu or panel, the
 * field toolbar, or another form field) and not the page itself (block
 * selection shortcuts arrive with `body` as the target).
 * @param {{ target: unknown, keyCode: number, code?: string, ctrlKey?: boolean, metaKey?: boolean }} event - Keydown.
 * @param {{ body: unknown, documentElement: unknown }} doc - Document.
 * @returns {boolean} True to hide the key from Editor.js.
 */
export const hideFromEditor = (event, doc) => {
  const target = event && event.target;
  if (!target || target.nodeType !== 1 || typeof target.closest !== 'function') return false;
  if (target === doc.body || target === doc.documentElement) return false;
  if (target.closest(EDITOR_WRAPPER)) return false;
  const slash = event.code === 'Slash' && (event.ctrlKey || event.metaKey);
  return EDITOR_KEY_CODES.has(event.keyCode) || slash;
};

let installed = null;

/**
 * Keeps Editor.js's document keydown handler away from keys typed outside the
 * editors (2.5). Editor.js 2.31 listens to `keydown` on `document` in the
 * capture phase and, while one of its blocks is "current" (the caret was in
 * the editor; clicking a button does not reset it because the selection stays
 * in the editor), passes every key typed anywhere on the page to the block:
 * Tab in a dialog opened from the editor moved the editor caret to the next
 * block behind the dialog and called `preventDefault`, so the first Tab
 * presses did nothing (one per block below the caret; after a non-paragraph
 * last block it even inserted an empty paragraph), and Tab in another field
 * of the form jumped into the editor.
 *
 * Editor.js reads `event.keyCode` (and `event.code` for Ctrl/Cmd+/). One
 * listener on `window` (capture, before `document`) shadows these two
 * properties of such events with neutral values; one listener on the root
 * element (capture, after `document`) removes the shadow again, so every
 * other listener (the dialog's focus trap, React handlers) sees the real
 * event. Keys inside an editor (also Tab between table cells) and keys with
 * `body` as target (block selection) are untouched. Installed once per
 * window while at least one editor field is mounted.
 * @param {Window} [win] - Window (default the global one).
 * @returns {() => void} Uninstall (reference counted).
 */
export const installEditorKeyGuard = (win = typeof window !== 'undefined' ? window : null) => {
  if (!win || !win.document) return () => {};
  if (installed && installed.win === win) {
    installed.count += 1;
  } else {
    const doc = win.document;
    const shadowed = new WeakSet();
    const before = (event) => {
      if (!hideFromEditor(event, doc)) return;
      try {
        Object.defineProperty(event, 'keyCode', { configurable: true, value: 0 });
        if (event.code === 'Slash') Object.defineProperty(event, 'code', { configurable: true, value: '' });
        shadowed.add(event);
      } catch {
        // A non-extensible event keeps its keys; Editor.js then behaves as without the guard.
      }
    };
    const after = (event) => {
      if (!shadowed.has(event)) return;
      shadowed.delete(event);
      delete event.keyCode;
      if (Object.prototype.hasOwnProperty.call(event, 'code')) delete event.code;
    };
    win.addEventListener('keydown', before, true);
    doc.documentElement.addEventListener('keydown', after, true);
    installed = {
      win,
      count: 1,
      remove: () => {
        win.removeEventListener('keydown', before, true);
        doc.documentElement.removeEventListener('keydown', after, true);
      },
    };
  }
  const own = installed;
  let done = false;
  return () => {
    if (done) return;
    done = true;
    own.count -= 1;
    if (own.count === 0) {
      own.remove();
      if (installed === own) installed = null;
    }
  };
};
