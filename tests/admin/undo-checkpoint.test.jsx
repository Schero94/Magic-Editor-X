/**
 * 2.9: a one-click fix from the Quality panel is its own undo step. The field calls
 * `checkpoint()` before and after the fix, so typing right before it and the fix are undone
 * separately; during live collaboration the delegate (the room's own-change undo) takes over.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUndoManager } from '../../admin/src/editor/tools/undo.js';

const fakeEditor = (text) => {
  let data = { time: 1, version: '2.31.7', blocks: [{ id: 'h', type: 'header', data: { text, level: 4 } }] };
  return {
    get: () => data,
    set: (next) => {
      data = next;
    },
    save: async () => JSON.parse(JSON.stringify(data)),
    render: async (next) => {
      data = JSON.parse(JSON.stringify(next));
    },
  };
};
const withLevel = (editor, text, level) =>
  editor.set({ ...editor.get(), blocks: [{ id: 'h', type: 'header', data: { text, level } }] });

test('checkpoint: typing and the fix right after it are two undo steps', async () => {
  const editor = fakeEditor('Title');
  const manager = createUndoManager(editor, { debounceMs: 400 });
  await manager.reset();
  // Typing, then the fix within the 400 ms debounce.
  withLevel(editor, 'Title typed', 4);
  manager.record();
  await manager.checkpoint();
  withLevel(editor, 'Title typed', 3);
  await manager.checkpoint();
  assert.equal(manager.canUndo(), true);
  await manager.undo();
  assert.deepEqual(editor.get().blocks[0].data, { text: 'Title typed', level: 4 });
  await manager.undo();
  assert.deepEqual(editor.get().blocks[0].data, { text: 'Title', level: 4 });
  await manager.redo();
  await manager.redo();
  assert.deepEqual(editor.get().blocks[0].data, { text: 'Title typed', level: 3 });
  manager.destroy();
});

test('checkpoint: nothing is recorded while a room handles undo or remote changes apply', async () => {
  const editor = fakeEditor('Title');
  const manager = createUndoManager(editor, { debounceMs: 400 });
  await manager.reset();
  let undone = 0;
  manager.setDelegate({ undo: () => (undone += 1), redo: () => false });
  withLevel(editor, 'Title', 3);
  await manager.checkpoint();
  await manager.undo();
  assert.equal(undone, 1, 'the room undoes its own change');
  manager.setDelegate(null);
  manager.pause();
  withLevel(editor, 'Remote', 2);
  await manager.checkpoint();
  manager.resume();
  assert.equal(manager.canUndo(), false);
  manager.destroy();
});
