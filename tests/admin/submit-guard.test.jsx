/**
 * Save race guard (m12, 2.7.4): text typed less than 40 ms before Ctrl/Cmd+Enter or a Save click
 * reaches the form before the Content Manager saves it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createSubmitGuard, isSaveShortcut } from '../../admin/src/editor/submit-guard.mjs';

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A field holder and a Save button outside it; `form` is what the Content Manager would save. */
const setup = () => {
  const holder = document.createElement('div');
  const input = document.createElement('div');
  input.contentEditable = 'true';
  holder.appendChild(input);
  const save = document.createElement('button');
  save.type = 'button';
  save.textContent = 'Save';
  document.body.append(holder, save);
  const state = { pending: true, typed: 'Alpha one', form: 'Alpha', saved: [] };
  const stop = createSubmitGuard({
    holder,
    isPending: () => state.pending,
    flush: async () => {
      await wait(5);
      state.form = state.typed;
      state.pending = false;
    },
  });
  // The Content Manager: a bubbling window shortcut listener and the button's onClick.
  const onKey = (event) => {
    if (isSaveShortcut(event)) state.saved.push(state.form);
  };
  window.addEventListener('keydown', onKey);
  save.addEventListener('click', () => state.saved.push(state.form));
  const cleanup = () => {
    stop();
    window.removeEventListener('keydown', onKey);
    holder.remove();
    save.remove();
  };
  return { holder, input, save, state, cleanup };
};

test('Ctrl/Cmd+Enter right after typing saves the typed text, once', async () => {
  const { input, state, cleanup } = setup();
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', metaKey: true, bubbles: true }));
  assert.deepEqual(state.saved, [], 'held while the input is not in the form');
  await wait(60);
  assert.deepEqual(state.saved, ['Alpha one']);
  cleanup();
});

test('a Save click right after typing saves the typed text, once', async () => {
  const { save, state, cleanup } = setup();
  save.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  await wait(60);
  assert.deepEqual(state.saved, ['Alpha one']);
  cleanup();
});

test('nothing pending: shortcuts and clicks pass straight through', async () => {
  const { input, save, state, cleanup } = setup();
  state.pending = false;
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true }));
  save.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  assert.deepEqual(state.saved, ['Alpha', 'Alpha']);
  cleanup();
});

test('plain Enter and clicks inside the editor are never held', async () => {
  const { input, state, cleanup } = setup();
  let enter = 0;
  const count = (event) => {
    if (event.key === 'Enter') enter += 1;
  };
  window.addEventListener('keydown', count);
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  const inner = document.createElement('button');
  input.appendChild(inner);
  let clicks = 0;
  inner.addEventListener('click', () => (clicks += 1));
  inner.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  assert.equal(enter, 1);
  assert.equal(clicks, 1);
  assert.equal(state.saved.length, 0);
  window.removeEventListener('keydown', count);
  cleanup();
});
