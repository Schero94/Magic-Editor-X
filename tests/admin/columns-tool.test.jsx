/**
 * Columns tool block menu (2.6.2): a menu choice goes to the block of the editor the menu was
 * opened in. Several editors can show a block with the same id (the suggestion editor next to the
 * hidden field editor, a duplicated repeatable component or dynamic zone entry), and a
 * collaborator's change re-creates the block while its menu is open. Runs the real tool in jsdom.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ColumnsTool } from '../../admin/src/editor/tools/columns.js';

const data = () => ({
  columns: [
    { id: 'c1', items: [{ id: 'a', type: 'paragraph', text: 'Alpha' }] },
    { id: 'c2', items: [{ id: 'b', type: 'paragraph', text: 'Bravo' }] },
  ],
  _mex: 1,
});

/** An Editor.js root in the document. */
const editorRoot = () => {
  const root = document.createElement('div');
  root.className = 'codex-editor';
  document.body.appendChild(root);
  return root;
};

/** A rendered tool inside an editor root, with a counting block API. */
const mount = (root, blockId = 'cols1') => {
  const block = { id: blockId, changes: 0, dispatchChange: () => (block.changes += 1) };
  const tool = new ColumnsTool({ data: data(), config: {}, api: {}, readOnly: false, block });
  const holder = document.createElement('div');
  holder.className = 'ce-block';
  holder.appendChild(tool.render());
  root.appendChild(holder);
  return { tool, block, holder };
};

/** "Number of columns > n columns" of a tool's block menu (Editor.js MenuConfig). */
const countItem = (tool, n) => {
  const menu = tool.renderSettings();
  return menu[0].children.items[n - 2];
};

test('two editors with the same block id: the menu changes the block of its own editor', () => {
  const field = editorRoot();
  const other = editorRoot();
  const a = mount(field);
  const b = mount(other);
  countItem(a.tool, 3).onActivate();
  assert.equal(a.block.changes, 1, 'the block of the menu changed');
  assert.equal(b.block.changes, 0, 'the other editor did not change');
  assert.equal(a.tool.save().columns.length, 3);
  assert.equal(b.tool.save().columns.length, 2);
  for (const tool of [a.tool, b.tool]) tool.destroy();
  field.remove();
  other.remove();
});

test('a menu left open while a collaborator re-creates the block applies to the new block of the same editor', () => {
  const field = editorRoot();
  const suggestion = editorRoot();
  const first = mount(field);
  const copy = mount(suggestion);
  const item = countItem(first.tool, 3); // menu opened on the field's block
  // A collaborator's change re-creates the block in the field editor (blocks.update).
  first.holder.remove();
  first.tool.destroy();
  const second = mount(field);
  // The suggestion editor re-renders its copy too (onRemoteData), after the field.
  copy.holder.remove();
  copy.tool.destroy();
  const copy2 = mount(suggestion);
  item.onActivate();
  assert.equal(second.block.changes, 1, 'the block the field shows now changed');
  assert.equal(second.tool.save().columns.length, 3);
  assert.equal(copy2.block.changes, 0, 'the suggestion editor with the same block id did not change');
  assert.equal(copy2.tool.save().columns.length, 2);
  for (const tool of [second.tool, copy2.tool]) tool.destroy();
  field.remove();
  suggestion.remove();
});

test('fewer columns never cuts items off: when they do not fit, nothing changes', () => {
  const root = editorRoot();
  const block = { id: 'full', changes: 0, dispatchChange: () => (block.changes += 1) };
  const many = (prefix, n) =>
    Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, type: 'paragraph', text: `${prefix}${i}` }));
  const tool = new ColumnsTool({
    data: {
      columns: [
        { id: 'c1', items: many('a', 1) },
        { id: 'c2', items: many('b', 30) },
        { id: 'c3', items: many('c', 30) },
      ],
      _mex: 1,
    },
    config: {},
    api: {},
    readOnly: false,
    block,
  });
  root.appendChild(tool.render());
  countItem(tool, 2).onActivate();
  const saved = tool.save();
  assert.equal(saved.columns.length, 3);
  assert.equal(saved.columns.flatMap((column) => column.items).length, 61);
  assert.equal(block.changes, 0);
  tool.destroy();
  root.remove();
});
