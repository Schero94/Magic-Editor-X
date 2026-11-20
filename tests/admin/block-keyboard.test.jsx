/**
 * 2.7.8 re-audit majors 1 and 2: the block toolbar controls are named buttons, and Tab reaches the
 * controls inside blocks (Editor.js itself only moves between text inputs).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  nextTabStop,
  tabStops,
  focusTabStop,
  skippedControl,
} from '../../admin/src/editor/block-tab-stops.mjs';
import { decorateToolbar } from '../../admin/src/editor/toolbar-a11y.mjs';

const visible = () => true;

const editor = () => {
  const holder = document.createElement('div');
  holder.innerHTML = `
    <div class="codex-editor">
      <div class="codex-editor__redactor">
        <div class="ce-block" data-id="A"><div class="ce-paragraph" contenteditable="true">Paragraph A</div></div>
        <div class="ce-block" data-id="X"><div class="mex-audio"><button type="button" id="choose">Choose an audio file</button></div></div>
        <div class="ce-block" data-id="T"><div class="mex-toggle"><button type="button" id="toggle">Show or hide</button><div contenteditable="true" id="title">Toggle</div></div></div>
        <div class="ce-block" data-id="L"><ul class="cdx-list"><li contenteditable="true" id="item">Item</li></ul></div>
        <div class="ce-block" data-id="Y"><select id="style"><option>Primary</option></select><input type="checkbox" id="newtab"><button disabled id="off">Off</button></div>
        <div class="ce-block" data-id="B"><div class="ce-paragraph" contenteditable="true" id="B">Paragraph B</div></div>
      </div>
      <div class="ce-toolbar"><div class="ce-toolbar__plus"></div><span class="ce-toolbar__settings-btn"></span></div>
    </div>`;
  document.body.append(holder);
  return holder;
};

test('tab stops: text inputs and block controls in document order, no toolbar, no disabled', () => {
  const holder = editor();
  const ids = tabStops(holder, visible).map((element) => element.id || element.textContent.trim());
  assert.deepEqual(ids, ['Paragraph A', 'choose', 'toggle', 'title', 'item', 'style', 'newtab', 'B']);
  holder.remove();
});

test('Tab from text to a control is handled; text to text is left to Editor.js', () => {
  const holder = editor();
  const a = holder.querySelector('[data-id=A] [contenteditable]');
  let step = nextTabStop(holder, a, false, visible);
  assert.equal(step.handled, true);
  assert.equal(step.target.id, 'choose');
  // From a control, every step is handled (Editor.js would skip the next control).
  step = nextTabStop(holder, holder.querySelector('#choose'), false, visible);
  assert.equal(step.target.id, 'toggle');
  step = nextTabStop(holder, holder.querySelector('#toggle'), false, visible);
  assert.equal(step.target.id, 'title');
  // Toggle title -> list item: text to text, Editor.js moves.
  assert.equal(nextTabStop(holder, holder.querySelector('#title'), false, visible).handled, false);
  // A list keeps Tab (nesting).
  assert.equal(nextTabStop(holder, holder.querySelector('#item'), false, visible).handled, false);
  // Shift+Tab from paragraph B reaches the checkbox, then the select.
  step = nextTabStop(holder, holder.querySelector('#B'), true, visible);
  assert.equal(step.target.id, 'newtab');
  step = nextTabStop(holder, step.target, true, visible);
  assert.equal(step.target.id, 'style');
  holder.remove();
});

test('focusTabStop puts the caret at the start (Tab) of a text stop', () => {
  const holder = editor();
  const title = holder.querySelector('#title');
  focusTabStop(title, false);
  assert.equal(document.activeElement, title);
  const range = window.getSelection().getRangeAt(0);
  assert.equal(range.collapsed, true);
  assert.equal(range.startOffset, 0);
  holder.remove();
});

test('toolbar: "+" and the block menu handle are named buttons that open with Enter and Space', () => {
  const holder = editor();
  const plus = holder.querySelector('.ce-toolbar__plus');
  const menu = holder.querySelector('.ce-toolbar__settings-btn');
  let clicks = 0;
  let downs = 0;
  plus.addEventListener('click', () => (clicks += 1));
  menu.addEventListener('mousedown', () => (downs += 1));
  const cleanup = decorateToolbar(holder, { add: 'Add a block', menu: 'Open the block menu' });
  for (const [node, name] of [
    [plus, 'Add a block'],
    [menu, 'Open the block menu'],
  ]) {
    assert.equal(node.getAttribute('role'), 'button');
    assert.equal(node.getAttribute('tabindex'), '0');
    assert.equal(node.getAttribute('aria-label'), name);
  }
  plus.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
  menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }));
  assert.equal(clicks, 1);
  assert.equal(downs, 1);
  cleanup();
  plus.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(clicks, 1, 'handlers removed on cleanup');
  holder.remove();
});

test('arrow keys: a control Editor.js skipped between two texts is focused instead', () => {
  const holder = editor();
  const a = holder.querySelector('[data-id=A] [contenteditable]');
  const title = holder.querySelector('#title');
  const b = holder.querySelector('#B');
  // A -> toggle title skipped the audio block and the toggle button: the nearest one going down.
  assert.equal(skippedControl(holder, a, title, visible).id, 'choose');
  // B -> list item going up skipped the checkbox and the select: the nearest one going up.
  assert.equal(skippedControl(holder, b, holder.querySelector('#item'), visible).id, 'newtab');
  // Same block or nothing in between: Editor.js' move stands.
  assert.equal(skippedControl(holder, title, holder.querySelector('#item'), visible), null);
  assert.equal(skippedControl(holder, a, a, visible), null);
  holder.remove();
});

test('component block: Design System inputs, combobox and switch are tab stops; stepper buttons are not', () => {
  const holder = document.createElement('div');
  holder.innerHTML = `
    <div class="ce-block" data-id="A"><div contenteditable="true" id="A">A</div></div>
    <div class="ce-block" data-id="X">
      <input type="text" id="headline"><div role="combobox" tabindex="0" id="tone">Info</div>
      <input type="text" id="count"><button tabindex="-1" id="up"></button>
      <button role="switch" id="featured"></button><input type="checkbox" tabindex="-1" id="hidden">
    </div>
    <div class="ce-block" data-id="B"><div contenteditable="true" id="B">B</div></div>`;
  document.body.append(holder);
  const ids = tabStops(holder, visible).map((element) => element.id);
  assert.deepEqual(ids, ['A', 'headline', 'tone', 'count', 'featured', 'B']);
  // Text -> form input in another block: handled here (Editor.js would let the browser move one further).
  const step = nextTabStop(holder, holder.querySelector('#A'), false, visible);
  assert.equal(step.handled, true);
  assert.equal(step.target.id, 'headline');
  assert.equal(nextTabStop(holder, holder.querySelector('#headline'), false, visible).target.id, 'tone');
  // The arrow keys never stop on a combobox (they change its value).
  assert.equal(
    skippedControl(holder, holder.querySelector('#A'), holder.querySelector('#B'), visible).id,
    'featured'
  );
  holder.remove();
});

test('a stop inside another stop (clear button in a combobox) moves on instead of staying', () => {
  const holder = document.createElement('div');
  holder.innerHTML = `
    <div class="ce-block" data-id="X">
      <div role="combobox" tabindex="0" id="tone">Info<button id="clear">Clear</button></div>
      <input type="text" id="count">
    </div>`;
  document.body.append(holder);
  const clear = holder.querySelector('#clear');
  assert.equal(nextTabStop(holder, clear, false, visible).target.id, 'count');
  assert.equal(nextTabStop(holder, holder.querySelector('#count'), true, visible).target.id, 'clear');
  holder.remove();
});
