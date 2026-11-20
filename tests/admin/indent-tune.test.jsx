/**
 * Indent tune wrapper (B1, 2.7.4): editorjs-indent-tune 1.4.4 re-queues `applyStylesToWrapper` as
 * a microtask for as long as the block measures 0 px wide. A child of a closed toggle is hidden
 * (`display: none`) and never gets a width, so a window resize or a second editor froze the tab.
 * jsdom has no layout (every element is 0 x 0), which is exactly the hidden-block case.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createIndentTune } from '../../admin/src/editor/tools/indent-tune.js';

/** A tune with the smallest Editor.js API the constructor uses. */
const makeTune = (ToolClass, level = 1) =>
  new ToolClass({
    api: { events: { on() {}, off() {} }, blocks: { getBlocksCount: () => 1 } },
    data: { indentLevel: level },
    config: { version: '2.31' },
    block: { id: 'b1', name: 'paragraph' },
  });

/** A block element (`.ce-block > .ce-block__content`) holding the tune wrapper, in a redactor. */
const mountHidden = (tune) => {
  const redactor = document.createElement('div');
  redactor.className = 'codex-editor__redactor';
  const block = document.createElement('div');
  block.className = 'ce-block';
  block.style.display = 'none';
  const content = document.createElement('div');
  content.className = 'ce-block__content';
  content.style.maxWidth = '650px';
  content.textContent = 'Hidden child of a closed toggle';
  block.appendChild(tune.wrap(content));
  redactor.appendChild(block);
  document.body.appendChild(redactor);
  return { redactor, block };
};

/** Counts queueMicrotask calls while `fn` runs and a few turns after it. */
const countMicrotasks = async (fn) => {
  const original = globalThis.queueMicrotask;
  let calls = 0;
  globalThis.queueMicrotask = (callback) => {
    calls += 1;
    // Stop a runaway loop of the unpatched library instead of hanging the test run.
    if (calls < 1000) original(callback);
  };
  try {
    fn();
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setTimeout(resolve, 0));
  } finally {
    globalThis.queueMicrotask = original;
  }
  return calls;
};

test('a hidden block (closed toggle child) does not re-queue applyStylesToWrapper', async () => {
  const { ToolClass, dispose } = createIndentTune();
  const tune = makeTune(ToolClass);
  const { redactor } = mountHidden(tune);
  const calls = await countMicrotasks(() => tune.applyStylesToWrapper(tune.wrapper, 1));
  assert.ok(calls < 5, `expected no microtask loop, saw ${calls} queueMicrotask calls`);
  dispose();
  redactor.remove();
});

test('the hidden block gets its indent once it has a width, and dispose stops waiting', async () => {
  const { ToolClass, dispose } = createIndentTune();
  const tune = makeTune(ToolClass, 2);
  const { redactor, block } = mountHidden(tune);
  tune.applyStylesToWrapper(tune.wrapper, 2);
  const observer = [...globalThis.__strictHarness.resources.observers].find((entry) =>
    entry.targets.has(block)
  );
  assert.ok(observer, 'waits for the block with a ResizeObserver');

  // The toggle opens: the block gets a width and the padding is applied.
  const native = block.getBoundingClientRect;
  block.getBoundingClientRect = () => ({ width: 720, height: 32, top: 0, left: 0, right: 720, bottom: 32 });
  observer.callback([{ target: block, contentRect: { width: 720, height: 32 } }]);
  assert.equal(tune.wrapper.getAttribute('data-indent-level'), '2');
  assert.notEqual(tune.wrapper.style.paddingLeft, '', 'indent padding applied');
  assert.equal(observer.targets.size, 0, 'observer disconnected after use');

  // A second hidden wait is released by dispose().
  block.getBoundingClientRect = native;
  tune.applyStylesToWrapper(tune.wrapper, 1);
  dispose();
  assert.equal(
    [...globalThis.__strictHarness.resources.observers].filter((entry) => entry.targets.has(block)).length,
    0,
    'dispose disconnects waiting observers'
  );
  redactor.remove();
});
