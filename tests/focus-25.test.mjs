/**
 * 2.5 focus fixes in the admin editor:
 * - live catch-up (apply-remote) deletes blocks without moving the user's
 *   focus or caret (Editor.js `blocks.delete` calls `Caret.setToBlock`);
 * - Tab in Magic Editor X dialogs and popovers is not taken by the Editor.js
 *   document keydown handler (`editor/dialog-keys.js`).
 * Runs with a minimal fake DOM (no browser); the browser checks are in the
 * 2.5 acceptance scripts.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

/** Minimal DOM: focusable elements, a selection with one range. */
const createDom = () => {
  const ranges = [];
  const body = { name: 'body', isConnected: true };
  const document = { body, activeElement: body };
  const element = (name) => {
    const el = {
      name,
      isConnected: true,
      focus: () => {
        document.activeElement = el;
      },
      blur: () => {
        if (document.activeElement === el) document.activeElement = body;
      },
    };
    return el;
  };
  const range = (node) => ({
    startContainer: node,
    endContainer: node,
    cloneRange() {
      return { ...this };
    },
  });
  const selection = {
    get rangeCount() {
      return ranges.length;
    },
    getRangeAt: (i) => ranges[i],
    removeAllRanges: () => ranges.splice(0),
    addRange: (r) => ranges.push(r),
  };
  return { document, window: { getSelection: () => selection }, element, range, selection, ranges };
};

/**
 * Fake Editor.js with the 2.31 delete behaviour: after removing a block it
 * inserts a default block when none is left and puts the caret at the end of
 * the current block (focus + selection move into the editor).
 */
const createEditor = (dom, ids) => {
  const make = (id, type = 'paragraph', data = { text: '' }) => ({
    id,
    type,
    data,
    holder: dom.element(`block-${id}`),
  });
  const list = ids.map((id) => make(id));
  let current = -1;
  let generated = 0;
  const caretToCurrent = () => {
    const block = list[current];
    if (!block) return;
    block.holder.focus();
    dom.selection.removeAllRanges();
    dom.selection.addRange(dom.range(block.holder));
  };
  const blocks = {
    getBlocksCount: () => list.length,
    getBlockByIndex: (index) => list[index],
    getBlockIndex: (id) => list.findIndex((block) => block.id === id),
    delete: (index) => {
      const [gone] = list.splice(index, 1);
      gone.holder.isConnected = false;
      if (list.length === 0) {
        generated += 1;
        list.push(make(`default${generated}`));
        current = 0;
      } else if (current >= list.length) current = list.length - 1;
      caretToCurrent();
    },
    insert: (type, data, _config, index, _focus, _replace, id) => {
      list.splice(index, 0, make(id, type, data));
    },
    move: (to, from) => {
      const [block] = list.splice(from, 1);
      list.splice(to, 0, block);
    },
    update: async () => {},
    clear: async () => {
      list.splice(0);
    },
  };
  return { blocks, list, setCurrent: (index) => (current = index) };
};

const withDom = async (dom, fn) => {
  const saved = { document: globalThis.document, window: globalThis.window };
  globalThis.document = dom.document;
  globalThis.window = dom.window;
  try {
    return await fn();
  } finally {
    globalThis.document = saved.document;
    globalThis.window = saved.window;
  }
};

const { deleteBlockKeepingFocus } = await import('../admin/src/editor/focus-guard.mjs');
const APPLY_REMOTE = fs.readFileSync(new URL('../admin/src/editor/apply-remote.js', import.meta.url), 'utf8');

/** The delete/insert path of apply-remote for a field that shows `ids` and must show `target`. */
const catchUp = (editor, target) => {
  const targetIds = new Set(target);
  for (let index = editor.blocks.getBlocksCount() - 1; index >= 0; index -= 1)
    if (!targetIds.has(editor.list[index].id)) deleteBlockKeepingFocus(editor, index);
  target.forEach((id, index) => {
    if (editor.list[index] && editor.list[index].id === id) return;
    editor.blocks.insert('paragraph', { text: id }, undefined, index, false, false, id);
  });
  while (editor.blocks.getBlocksCount() > target.length)
    deleteBlockKeepingFocus(editor, editor.blocks.getBlocksCount() - 1);
};

test('apply-remote deletes blocks only through the focus guard', () => {
  assert.ok(!/editor\.blocks\.delete\(/.test(APPLY_REMOTE), 'no bare editor.blocks.delete in apply-remote');
  assert.equal((APPLY_REMOTE.match(/deleteBlockKeepingFocus\(editor/g) || []).length, 2);
});

test('first live catch-up of an empty field keeps the focus where the user is', async () => {
  const dom = createDom();
  await withDom(dom, async () => {
    // The user types in another field; this field shows only Editor.js's empty paragraph.
    const other = dom.element('other-field');
    other.focus();
    dom.selection.addRange(dom.range(other));
    const editor = createEditor(dom, ['empty1']);
    catchUp(editor, ['r1', 'r2']);
    assert.deepEqual(
      editor.list.map((block) => block.id),
      ['r1', 'r2']
    );
    assert.equal(dom.document.activeElement, other, 'focus stays in the other field');
    assert.equal(dom.ranges.length, 1);
    assert.equal(dom.ranges[0].startContainer, other, 'selection stays in the other field');
  });
});

test('nothing focused before the catch-up: nothing focused after it', async () => {
  const dom = createDom();
  await withDom(dom, async () => {
    const editor = createEditor(dom, ['empty1']);
    catchUp(editor, ['r1']);
    assert.equal(dom.document.activeElement, dom.document.body);
    assert.equal(dom.ranges.length, 0);
  });
});

test('a remote delete keeps the caret of someone typing in another block of the same field', async () => {
  const dom = createDom();
  await withDom(dom, async () => {
    const editor = createEditor(dom, ['a', 'b', 'c']);
    editor.setCurrent(0);
    const typing = editor.list[0].holder;
    typing.focus();
    const caret = dom.range(typing);
    caret.offset = 3;
    dom.selection.addRange(caret);
    catchUp(editor, ['a', 'b']);
    assert.deepEqual(
      editor.list.map((block) => block.id),
      ['a', 'b']
    );
    assert.equal(dom.document.activeElement, typing);
    assert.equal(dom.ranges[0].offset, 3, 'the caret was not moved to the end of the block');
  });
});

test('when the caret was in the deleted block, Editor.js places it', async () => {
  const dom = createDom();
  await withDom(dom, async () => {
    const editor = createEditor(dom, ['a', 'b']);
    editor.setCurrent(1);
    editor.list[1].holder.focus();
    dom.selection.addRange(dom.range(editor.list[1].holder));
    catchUp(editor, ['a']);
    assert.equal(dom.document.activeElement, editor.list[0].holder);
  });
});

test('without a DOM (server rendering) the helper only deletes', () => {
  const calls = [];
  deleteBlockKeepingFocus({ blocks: { delete: (index) => calls.push(index) } }, 4);
  assert.deepEqual(calls, [4]);
});

/* ------------------------------------------- keys outside the editors */

const { hideFromEditor, installEditorKeyGuard } = await import('../admin/src/editor/focus-guard.mjs');

/** Fake window: capture listeners on window and the root element, an Editor.js-like document listener. */
const createKeyDom = () => {
  const listeners = { window: [], root: [] };
  const target = (inEditor, name) => ({
    nodeType: 1,
    name,
    closest: (selector) => (selector === '.codex-editor' && inEditor ? {} : null),
  });
  const doc = {
    body: { nodeType: 1, closest: () => null },
    documentElement: {
      addEventListener: (type, fn) => listeners.root.push(fn),
      removeEventListener: (type, fn) => listeners.root.splice(listeners.root.indexOf(fn), 1),
    },
  };
  const win = {
    document: doc,
    addEventListener: (type, fn) => listeners.window.push(fn),
    removeEventListener: (type, fn) => listeners.window.splice(listeners.window.indexOf(fn), 1),
  };
  /** Dispatches like a browser: window capture, document capture (Editor.js), root capture, target. */
  const press = (eventTarget, init) => {
    const event = Object.create({
      get keyCode() {
        return init.keyCode;
      },
      get code() {
        return init.code || '';
      },
    });
    Object.assign(event, {
      target: eventTarget,
      key: init.key,
      ctrlKey: Boolean(init.ctrlKey),
      metaKey: false,
    });
    for (const fn of listeners.window) fn(event);
    const editorSaw = { keyCode: event.keyCode, code: event.code };
    for (const fn of listeners.root) fn(event);
    return { editorSaw, targetSaw: { keyCode: event.keyCode, code: event.code, key: event.key } };
  };
  return { win, doc, target, press, listeners };
};

test('Tab, Enter, arrows and Backspace typed outside the editors are hidden from Editor.js only', () => {
  const dom = createKeyDom();
  const uninstall = installEditorKeyGuard(dom.win);
  const dialogButton = dom.target(false, 'dialog button');
  const tab = dom.press(dialogButton, { keyCode: 9, key: 'Tab' });
  assert.equal(tab.editorSaw.keyCode, 0, 'Editor.js sees no Tab');
  assert.deepEqual(tab.targetSaw, { keyCode: 9, code: '', key: 'Tab' }, 'the dialog sees the real key');
  for (const keyCode of [8, 13, 37, 38, 39, 40, 46])
    assert.equal(dom.press(dialogButton, { keyCode, key: 'x' }).editorSaw.keyCode, 0, String(keyCode));
  const slash = dom.press(dialogButton, { keyCode: 191, key: '/', code: 'Slash', ctrlKey: true });
  assert.equal(slash.editorSaw.code, '', 'Ctrl+/ does not open the block menu from a dialog');
  assert.equal(slash.targetSaw.code, 'Slash');
  // Escape and letters are untouched; so is everything inside an editor (table cells use Tab).
  assert.equal(dom.press(dialogButton, { keyCode: 27, key: 'Escape' }).editorSaw.keyCode, 27);
  assert.equal(dom.press(dialogButton, { keyCode: 65, key: 'a' }).editorSaw.keyCode, 65);
  assert.equal(dom.press(dom.target(true, 'table cell'), { keyCode: 9, key: 'Tab' }).editorSaw.keyCode, 9);
  // Block selection shortcuts arrive on body.
  assert.equal(dom.press(dom.doc.body, { keyCode: 8, key: 'Backspace' }).editorSaw.keyCode, 8);
  uninstall();
  assert.equal(dom.listeners.window.length, 0);
  assert.equal(dom.listeners.root.length, 0);
});

test('the key guard is installed once per window and removed with the last field', () => {
  const dom = createKeyDom();
  const first = installEditorKeyGuard(dom.win);
  const second = installEditorKeyGuard(dom.win);
  assert.equal(dom.listeners.window.length, 1);
  first();
  first();
  assert.equal(dom.listeners.window.length, 1, 'still used by the second field');
  second();
  assert.equal(dom.listeners.window.length, 0);
  assert.equal(hideFromEditor({ target: null, keyCode: 9 }, dom.doc), false);
  assert.equal(typeof installEditorKeyGuard(null), 'function');
});

test('a text field keeps its focus and caret; the document selection is not put back into it', async () => {
  const dom = createDom();
  await withDom(dom, async () => {
    const input = dom.element('title');
    Object.assign(input, {
      tagName: 'INPUT',
      selectionStart: 7,
      selectionEnd: 7,
      selectionDirection: 'none',
    });
    input.setSelectionRange = (start, end) =>
      Object.assign(input, { selectionStart: start, selectionEnd: end });
    input.focus();
    const editor = createEditor(dom, ['a', 'b']);
    editor.setCurrent(0);
    // Editor.js moves focus into the editor and the input's caret to its start on blur.
    const originalDelete = editor.blocks.delete;
    editor.blocks.delete = (index) => {
      originalDelete(index);
      Object.assign(input, { selectionStart: 0, selectionEnd: 0 });
    };
    catchUp(editor, ['b']);
    assert.equal(dom.document.activeElement, input);
    assert.equal(input.selectionStart, 7);
    assert.equal(
      dom.ranges[0].startContainer,
      editor.list[0].holder,
      'Editor.js selection untouched, not re-added'
    );
  });
});
