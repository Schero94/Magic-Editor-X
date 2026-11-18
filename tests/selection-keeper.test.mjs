import test from 'node:test';
import assert from 'node:assert/strict';
import { holdSelection } from '../admin/src/editor/selection-keeper.mjs';

/**
 * 2.6 regression (live room, typing after a pause landed at the start of the
 * paragraph): Editor.js 2.31 runs `getSelection().removeAllRanges()` while an
 * instance starts (`ReadOnly.prepare` -> `BlockSelection.toggleReadOnly`). A
 * lazily started field wiped the caret of the field being typed in; with the
 * focus still in the paragraph the browser inserted the next keys at offset 0.
 * Fake DOM: nodes with `contains`, a selection with one range, events.
 */
const node = (name, parent = null) => {
  const n = { name, parent, isConnected: true };
  n.contains = (other) => {
    for (let x = other; x; x = x.parent) if (x === n) return true;
    return false;
  };
  return n;
};
const range = (container, offset) => ({
  startContainer: container,
  startOffset: offset,
  cloneRange() {
    return range(container, offset);
  },
});
const env = () => {
  const listeners = new Map();
  const ranges = [];
  const selection = {
    get rangeCount() {
      return ranges.length;
    },
    getRangeAt: (i) => ranges[i],
    addRange: (r) => ranges.push(r),
    removeAllRanges: () => ranges.splice(0),
  };
  const page = node('page');
  const fieldA = node('field A', page);
  const paragraph = node('paragraph', fieldA);
  paragraph.isContentEditable = true;
  const text = node('text', paragraph);
  const holderB = node('field B', page);
  const doc = {
    activeElement: paragraph,
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) || []), fn]),
    removeEventListener: (type, fn) =>
      listeners.set(
        type,
        (listeners.get(type) || []).filter((f) => f !== fn)
      ),
    fire: (type) => (listeners.get(type) || []).forEach((fn) => fn()),
    listeners,
  };
  const win = { getSelection: () => selection, setTimeout: (fn) => fn() };
  ranges.push(range(text, 21));
  return { doc, win, selection, ranges, text, paragraph, holderB, fieldA };
};

test('the caret of the field being typed in survives another field starting', () => {
  const e = env();
  const hold = holdSelection(e.holderB, { doc: e.doc, win: e.win, settleMs: 0 });
  assert.equal(hold.active, true);
  // Editor.js starts in field B and clears the document selection.
  e.selection.removeAllRanges();
  e.doc.fire('selectionchange');
  assert.equal(e.selection.rangeCount, 1);
  assert.equal(e.selection.getRangeAt(0).startContainer, e.text);
  assert.equal(e.selection.getRangeAt(0).startOffset, 21, 'caret back at the end, not at offset 0');
  hold.release();
  assert.equal((e.doc.listeners.get('selectionchange') || []).length, 0, 'listener removed');
});

test('the remembered caret follows the user typing during the start, and release checks once more', () => {
  const e = env();
  const hold = holdSelection(e.holderB, { doc: e.doc, win: e.win, settleMs: 0 });
  e.ranges.splice(0, 1, range(e.text, 24));
  e.doc.fire('selectionchange');
  e.selection.removeAllRanges();
  // The clearing happened just before the start finished: release restores it.
  hold.release();
  assert.equal(e.selection.getRangeAt(0).startOffset, 24);
});

test('nothing is kept when the caret is in the starting editor, the focus moved, or the node is gone', () => {
  const own = env();
  assert.equal(holdSelection(own.fieldA, { doc: own.doc, win: own.win }).active, false, 'own editor');
  const moved = env();
  const hold = holdSelection(moved.holderB, { doc: moved.doc, win: moved.win, settleMs: 0 });
  moved.doc.activeElement = node('title input');
  moved.selection.removeAllRanges();
  moved.doc.fire('selectionchange');
  assert.equal(moved.selection.rangeCount, 0, 'focus moved elsewhere: not restored');
  hold.release();
  const gone = env();
  const hold2 = holdSelection(gone.holderB, { doc: gone.doc, win: gone.win, settleMs: 0 });
  gone.text.isConnected = false;
  gone.selection.removeAllRanges();
  gone.doc.fire('selectionchange');
  assert.equal(gone.selection.rangeCount, 0, 'node left the document: not restored');
  hold2.release();
  const none = env();
  none.selection.removeAllRanges();
  assert.equal(holdSelection(none.holderB, { doc: none.doc, win: none.win }).active, false, 'no caret');
});
