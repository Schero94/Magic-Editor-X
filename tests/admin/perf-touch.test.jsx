/**
 * 2.12.1 performance and touch fixes of the editor field, measured in the browser by
 * scripts/bench-browser (npm run bench:browser). These tests pin the mechanisms in jsdom:
 * cached indent width (no forced layout per block), footnote block marking for
 * content-visibility, visual viewport variables for full screen and sheets, and the idle copy
 * that feeds the problem count.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { createIndentTune } from '../../admin/src/editor/tools/indent-tune.js';
import { FOOTNOTE_BLOCK_CLASS, markFootnoteBlocks } from '../../admin/src/editor/footnote-blocks.mjs';
import {
  useVisualViewport,
  viewportMetrics,
} from '../../admin/src/components/EditorField/useVisualViewport.js';
import { useIdleValue } from '../../admin/src/components/EditorField/useIdleValue.js';

const makeTune = (ToolClass, level = 1) =>
  new ToolClass({
    api: { events: { on() {}, off() {} }, blocks: { getBlocksCount: () => 1 } },
    data: { indentLevel: level },
    config: { version: '2.31' },
    block: { id: 'b1', name: 'paragraph' },
  });

test('the indent tune measures the redactor once, not every block it styles', () => {
  const { ToolClass, dispose } = createIndentTune();
  const redactor = document.createElement('div');
  redactor.className = 'codex-editor__redactor';
  let measured = 0;
  redactor.getBoundingClientRect = () => {
    measured += 1;
    return { width: 720, height: 600, top: 0, left: 0, right: 720, bottom: 600 };
  };
  document.body.appendChild(redactor);
  const wrappers = [];
  for (let i = 0; i < 20; i += 1) {
    const tune = makeTune(ToolClass, 2);
    const block = document.createElement('div');
    block.className = 'ce-block';
    block.getBoundingClientRect = () => {
      throw new Error('a block is not measured while its redactor has a width');
    };
    const content = document.createElement('div');
    content.className = 'ce-block__content';
    content.textContent = `Block ${i}`;
    block.appendChild(tune.wrap(content));
    redactor.appendChild(block);
    tune.applyStylesToWrapper(tune.wrapper, 2);
    wrappers.push(tune.wrapper);
  }
  assert.equal(measured, 1, 'one measurement for 20 blocks');
  assert.ok(wrappers.every((wrapper) => wrapper.getAttribute('data-indent-level') === '2'));
  dispose();
  redactor.remove();
});

test('blocks with footnote markers are marked and unmarked without visiting other blocks', () => {
  const holder = document.createElement('div');
  holder.innerHTML = [
    '<div class="ce-block" id="a"><p>Text <sup data-mex-footnote="f1"></sup></p></div>',
    '<div class="ce-block" id="b"><p>Plain</p></div>',
    '<div class="ce-block" id="c"><p>More <sup data-mex-footnote="f2"></sup></p></div>',
  ].join('');
  const marked = new Set();
  markFootnoteBlocks(holder, marked, 'sup[data-mex-footnote]');
  const has = (id) => holder.querySelector(`#${id}`).classList.contains(FOOTNOTE_BLOCK_CLASS);
  assert.deepEqual([has('a'), has('b'), has('c')], [true, false, true]);
  holder.querySelector('#a sup').remove();
  markFootnoteBlocks(holder, marked, 'sup[data-mex-footnote]');
  assert.deepEqual([has('a'), has('b'), has('c')], [false, false, true]);
  assert.equal(marked.size, 1);
  markFootnoteBlocks(null, marked, 'sup[data-mex-footnote]');
});

test('viewport metrics report the part an on-screen keyboard covers', () => {
  assert.deepEqual(viewportMetrics({ height: 844, offsetTop: 0 }, 844), { height: 844, top: 0, keyboard: 0 });
  assert.deepEqual(viewportMetrics({ height: 480.4, offsetTop: 10 }, 844), {
    height: 480,
    top: 10,
    keyboard: 354,
  });
  assert.equal(viewportMetrics({ height: 900, offsetTop: 0 }, 844).keyboard, 0);
});

test('full screen and sheets get the visual viewport as CSS variables while active', async () => {
  const fake = new EventTarget();
  fake.height = 500;
  fake.offsetTop = 0;
  const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  Object.defineProperty(window, 'visualViewport', { configurable: true, get: () => fake });
  const element = document.createElement('div');
  const ref = { current: element };
  const Probe = ({ active }) => {
    useVisualViewport(ref, active);
    return null;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  try {
    await act(async () => root.render(<Probe active={false} />));
    assert.equal(element.style.getPropertyValue('--mex-vv-height'), '');
    await act(async () => root.render(<Probe active />));
    assert.equal(element.style.getPropertyValue('--mex-vv-height'), '500px');
    fake.height = 300;
    await act(async () => {
      fake.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => window.requestAnimationFrame(resolve));
    });
    assert.equal(element.style.getPropertyValue('--mex-vv-height'), '300px');
    assert.equal(element.style.getPropertyValue('--mex-keyboard-inset'), `${window.innerHeight - 300}px`);
    await act(async () => root.render(<Probe active={false} />));
    assert.equal(element.style.getPropertyValue('--mex-vv-height'), '', 'removed when inactive');
  } finally {
    await act(async () => root.unmount());
    if (original) Object.defineProperty(window, 'visualViewport', original);
    else delete window.visualViewport;
  }
});

test('the idle copy follows the value only after changes pause', async () => {
  const seen = [];
  const Probe = ({ value }) => {
    seen.push(useIdleValue(value, 30));
    return null;
  };
  const container = document.createElement('div');
  const root = createRoot(container);
  await act(async () => root.render(<Probe value="a" />));
  await act(async () => root.render(<Probe value="b" />));
  await act(async () => root.render(<Probe value="c" />));
  assert.equal(seen.at(-1), 'a', 'still the first value right after the changes');
  await act(async () => new Promise((resolve) => setTimeout(resolve, 120)));
  assert.equal(seen.at(-1), 'c');
  await act(async () => root.unmount());
});
