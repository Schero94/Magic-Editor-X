/**
 * m1 (2.7.4): stored `<sub>`/`<sup>` survive save and paste in fields without the script buttons.
 * Editor.js 2.31 cleans a block with the sanitize rules of the inline tools in its inline toolbar.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildTools, disposeTools } from '../../admin/src/editor/tools/index.js';
import { ScriptKeepTool } from '../../admin/src/editor/tools/inline-format.js';

const KEY = 'scriptKeep$mex';

test('full preset without the script option: a button-less tool keeps sub and sup', () => {
  const tools = buildTools({});
  assert.ok(tools.paragraph.inlineToolbar.includes(KEY));
  assert.ok(tools.header.inlineToolbar.includes(KEY));
  assert.equal(tools[KEY].class, ScriptKeepTool);
  assert.deepEqual(Object.keys(ScriptKeepTool.sanitize).sort(), ['sub', 'sup']);
  assert.equal(ScriptKeepTool.isInline, true);
  assert.deepEqual(new ScriptKeepTool().render(), [], 'no inline toolbar button');
  disposeTools(tools);
});

test('script option on: the real buttons are used; restricted preset: its policy decides', () => {
  const withScript = buildTools({ inlineExtras: { script: true } });
  assert.ok(!withScript.paragraph.inlineToolbar.includes(KEY));
  assert.ok(withScript.paragraph.inlineToolbar.includes('subscript$mex'));
  disposeTools(withScript);
});
