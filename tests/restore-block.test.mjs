import test from 'node:test';
import assert from 'node:assert/strict';
import { restoreBlockInEditor } from '../admin/src/editor/restore-block.mjs';

/** Minimal Editor.js Blocks API double (getById, getBlockIndex, getBlocksCount, insert, update). */
const fakeEditor = (blocks) => {
  const list = blocks.map((block) => ({ ...block }));
  let generated = 0;
  const api = (block) => block && { id: block.id, name: block.type };
  return {
    list,
    blocks: {
      getById: (id) => api(list.find((block) => block.id === id)),
      getBlockIndex: (id) => list.findIndex((block) => block.id === id),
      getBlocksCount: () => list.length,
      insert: (type, data, _config, index, _focus, replace, id) => {
        const block = { id: id || `gen${(generated += 1)}`, type, data };
        list.splice(index, replace ? 1 : 0, block);
        return api(block);
      },
      update: async (id, data, tunes) => {
        const block = list.find((item) => item.id === id);
        block.data = data;
        if (tunes) block.tunes = tunes;
        return api(block);
      },
    },
  };
};

const p = (id, text) => ({ id, type: 'paragraph', data: { text } });

test('replaces a block of the same type in place', async () => {
  const editor = fakeEditor([p('a', 'A'), p('b', 'new')]);
  const index = await restoreBlockInEditor(editor, p('b', 'old'), { replaceId: 'b' });
  assert.equal(index, 1);
  assert.deepEqual(editor.list[1], { id: 'b', type: 'paragraph', data: { text: 'old' } });
});

test('a block of another type replaces the current one and keeps its id', async () => {
  const editor = fakeEditor([p('a', 'A')]);
  await restoreBlockInEditor(
    editor,
    { id: 'a', type: 'header', data: { text: 'H', level: 2 } },
    { replaceId: 'a' }
  );
  assert.deepEqual(editor.list, [{ id: 'a', type: 'header', data: { text: 'H', level: 2 } }]);
});

test('a removed block goes back after its neighbour with its original id', async () => {
  const editor = fakeEditor([p('a', 'A'), p('c', 'C')]);
  const index = await restoreBlockInEditor(editor, p('b', 'B'), { afterId: 'a' });
  assert.equal(index, 1);
  assert.deepEqual(
    editor.list.map((block) => block.id),
    ['a', 'b', 'c']
  );
});

test('before a neighbour, at the end, and a fresh id when the old one is taken', async () => {
  const editor = fakeEditor([p('a', 'A')]);
  assert.equal(await restoreBlockInEditor(editor, p('z', 'Z'), { beforeId: 'a' }), 0);
  assert.equal(await restoreBlockInEditor(editor, p('y', 'Y'), {}), 2);
  await restoreBlockInEditor(editor, p('a', 'again'), { afterId: 'missing' });
  assert.deepEqual(
    editor.list.map((block) => block.id),
    ['z', 'a', 'y', 'gen1']
  );
  await assert.rejects(restoreBlockInEditor(editor, null), /Nothing to restore/);
});
