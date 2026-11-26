/**
 * 2.13 touch drag of blocks (admin/src/editor/tools/drag-drop.js): hold the "⋮⋮" handle, move the
 * finger, lift it: the block moves with Editor.js' documented `blocks.move(to, from)`. A tap or an
 * early move stays a tap; a mouse keeps the HTML drag and drop path. Pointer Events are dispatched
 * on a minimal editor DOM (jsdom has no layout: block rectangles are set per block).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

/** A minimal editor DOM: holder with blocks and the Editor.js handle; `blocks.move` is recorded. */
const setup = (count = 6) => {
  document.body.innerHTML = '<div id="root"><div id="holder"></div></div>';
  const holder = document.getElementById('holder');
  for (let index = 0; index < count; index += 1) {
    const block = document.createElement('div');
    block.className = 'ce-block';
    block.textContent = `Block ${index}`;
    // jsdom has no layout: 40 px per block from y = 100.
    block.getBoundingClientRect = () => ({ top: 100 + index * 40, bottom: 140 + index * 40, height: 40 });
    holder.append(block);
  }
  const handle = document.createElement('span');
  handle.className = 'ce-toolbar__settings-btn';
  // Editor.js' mobile layout puts the toolbar below the current block.
  handle.getBoundingClientRect = () => ({ top: 230, height: 44, left: 0, width: 44 });
  holder.append(handle);
  const moves = [];
  const editor = { blocks: { getCurrentBlockIndex: () => 2, move: (to, from) => moves.push([to, from]) } };
  const point = (type, y, extra = {}) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: 10, clientY: y });
    Object.defineProperties(event, {
      pointerType: { value: extra.pointerType || 'touch' },
      pointerId: { value: 9 },
      isPrimary: { value: true },
    });
    handle.dispatchEvent(event);
    return event;
  };
  return { holder, handle, editor, moves, point };
};

test('touch drag: hold "⋮⋮", move, lift: the current block moves with blocks.move; the next click is swallowed', async () => {
  const { createDragDrop, TOUCH_HOLD_MS } = await import('../../admin/src/editor/tools/drag-drop.js');
  const env = setup();
  const drag = createDragDrop(env.editor, env.holder);
  env.point('pointerdown', 250);
  await new Promise((resolve) => setTimeout(resolve, TOUCH_HOLD_MS + 50));
  assert.ok(
    env.holder.querySelectorAll('.ce-block')[2].classList.contains('mex-dragging'),
    'the current block'
  );
  const move = env.point('pointermove', 100 + 4 * 40 + 30);
  assert.equal(move.defaultPrevented, true, 'no scroll while dragging');
  assert.ok(env.holder.querySelector('.mex-drop-after'));
  env.point('pointerup', 100 + 4 * 40 + 30);
  assert.deepEqual(env.moves, [[4, 2]]);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  env.handle.dispatchEvent(click);
  assert.equal(click.defaultPrevented, true, 'the block menu does not open after a drag');
  assert.equal(env.holder.querySelector('.mex-dragging, .mex-drop-after, .mex-drop-before'), null);
  drag.destroy();
});

test('touch drag: a tap, or a finger that moves before the hold ends, stays a tap (no move, menu opens)', async () => {
  const { createDragDrop, TOUCH_HOLD_MS } = await import('../../admin/src/editor/tools/drag-drop.js');
  const env = setup();
  const drag = createDragDrop(env.editor, env.holder);
  env.point('pointerdown', 250);
  env.point('pointerup', 250);
  env.point('pointerdown', 250);
  env.point('pointermove', 280);
  await new Promise((resolve) => setTimeout(resolve, TOUCH_HOLD_MS + 50));
  env.point('pointerup', 300);
  assert.deepEqual(env.moves, []);
  assert.equal(env.holder.querySelector('.mex-dragging'), null);
  const click = new MouseEvent('click', { bubbles: true, cancelable: true });
  env.handle.dispatchEvent(click);
  assert.equal(click.defaultPrevented, false);
  // A mouse pointer keeps the HTML drag and drop path (the handle becomes draggable).
  env.point('pointerdown', 250, { pointerType: 'mouse' });
  assert.equal(env.handle.getAttribute('draggable'), 'true');
  drag.destroy();
});
