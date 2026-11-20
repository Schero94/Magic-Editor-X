/**
 * 2.7.8 re-audit minors: inline toolbar buttons are named after their tool, Alt+F10 finds the
 * toolbar items, and a block without text inserted from the block types gets focus on its control.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inlineToolbarItems, labelInlineToolbar, toolTitles } from '../../admin/src/editor/toolbar-a11y.mjs';
import { insertedBlockControl } from '../../admin/src/editor/block-tab-stops.mjs';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('toolTitles: built-in and plugin inline tools, translated through toolNames', () => {
  class Marker {
    static get title() {
      return 'Marker';
    }
  }
  const titles = toolTitles(
    { marker: { class: Marker } },
    { Bold: 'Fett', Marker: 'Markieren' },
    'Umwandeln in'
  );
  assert.equal(titles.bold, 'Fett');
  assert.equal(titles.italic, 'Italic');
  assert.equal(titles['convert-to'], 'Umwandeln in');
  assert.equal(titles.marker, 'Markieren');
});

test('labelInlineToolbar names icon-only buttons, also when the toolbar is built later', async () => {
  const holder = document.createElement('div');
  document.body.append(holder);
  const stop = labelInlineToolbar(holder, (name) => ({ bold: 'Bold', marker: 'Marker' })[name]);
  holder.innerHTML = `<div class="ce-inline-toolbar">
    <button class="ce-popover-item" data-item-name="bold"><svg></svg></button>
    <div data-item-name="marker"><button type="button"><svg></svg></button></div>
    <button aria-label="Mention an entry"></button></div>`;
  await settle();
  const buttons = holder.querySelectorAll('button');
  assert.equal(buttons[0].getAttribute('aria-label'), 'Bold');
  assert.equal(buttons[1].getAttribute('aria-label'), 'Marker');
  assert.equal(buttons[2].getAttribute('aria-label'), 'Mention an entry', 'own names stay');
  stop();
  holder.remove();
});

test('inlineToolbarItems lists enabled, rendered items (jsdom: rects stubbed)', () => {
  const holder = document.createElement('div');
  holder.innerHTML = `<div class="ce-inline-toolbar"><button id="a"></button><button id="b" disabled></button></div>`;
  document.body.append(holder);
  for (const button of holder.querySelectorAll('button')) button.getClientRects = () => [{}];
  assert.deepEqual(
    inlineToolbarItems(holder).map((element) => element.id),
    ['a']
  );
  holder.remove();
});

test('insertedBlockControl: a video block gets its Choose button, a paragraph nothing', () => {
  const visible = () => true;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="ce-block" id="v"><div class="mex-media"><button id="choose">Choose a video</button></div></div>
    <div class="ce-block" id="p"><div contenteditable="true">Text</div></div>`;
  assert.equal(insertedBlockControl(wrap.querySelector('#v'), visible).id, 'choose');
  assert.equal(insertedBlockControl(wrap.querySelector('#p'), visible), null);
  assert.equal(insertedBlockControl(document.createTextNode('x'), visible), null);
});

test('attachment "Select a file" (a div in @editorjs/attaches) becomes a keyboard button', async () => {
  const { decorateDivButtons } = await import('../../admin/src/editor/toolbar-a11y.mjs');
  const holder = document.createElement('div');
  document.body.append(holder);
  const stop = decorateDivButtons(holder);
  holder.innerHTML = '<div class="ce-block"><div class="cdx-attaches__button">Select a file</div></div>';
  await settle();
  const button = holder.querySelector('.cdx-attaches__button');
  assert.equal(button.getAttribute('role'), 'button');
  assert.equal(button.getAttribute('tabindex'), '0');
  let clicks = 0;
  button.addEventListener('click', () => (clicks += 1));
  button.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  assert.equal(clicks, 1);
  assert.equal(
    insertedBlockControl(holder.querySelector('.ce-block'), () => true),
    button
  );
  stop();
  holder.remove();
});
