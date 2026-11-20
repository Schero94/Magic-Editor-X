/**
 * m5 (2.7.4): a new highlighted code block puts the caret into the code, not the optional file name.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CodeHighlightTool } from '../../admin/src/editor/tools/code-highlight.js';

const mount = (data) => {
  const tool = new CodeHighlightTool({ data, config: {}, api: {}, readOnly: false, block: null });
  const node = tool.render();
  document.body.appendChild(node);
  return { tool, node };
};

test('new block: the first focus (Editor.js caret) goes to the code area', () => {
  const { node } = mount({});
  node.querySelector('.mex-code__filename').focus();
  assert.ok(document.activeElement.classList.contains('mex-code__input'));
  // Later focus (Tab, Shift+Tab, a click) stays in the file name.
  node.querySelector('.mex-code__filename').focus();
  assert.ok(document.activeElement.classList.contains('mex-code__filename'));
  node.remove();
});

test('a click into the file name of a new block keeps it there; stored blocks are unchanged', () => {
  const fresh = mount({});
  const name = fresh.node.querySelector('.mex-code__filename');
  name.dispatchEvent(new Event('pointerdown', { bubbles: true }));
  name.focus();
  assert.equal(document.activeElement, name);
  fresh.node.remove();
  const stored = mount({ code: 'const a = 1;', language: 'javascript' });
  const storedName = stored.node.querySelector('.mex-code__filename');
  storedName.focus();
  assert.equal(document.activeElement, storedName);
  stored.node.remove();
});
