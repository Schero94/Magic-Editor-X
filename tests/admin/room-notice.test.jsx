/**
 * 2.7.8 re-audit major 5: "Discard changes" in the live-session notice asks first (it affects
 * everyone in the room), and the notice after a discard offers Undo with focus on it.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { renderStrict, settle } from './harness/index.jsx';
import { RoomNotice, RoomResetNotice } from '../../admin/src/components/EditorField/RoomNotice.jsx';

const t = (_id, text) => text;

const click = async (element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    element.click();
  });
  await settle();
};

const button = (root, name) =>
  Array.from(root.querySelectorAll('button')).find((node) => node.textContent.trim() === name);

test('Discard opens a confirmation that names everyone; Cancel discards nothing', async () => {
  let discarded = 0;
  const handle = await renderStrict(
    <RoomNotice t={t} disabled={false} onDiscard={async () => (discarded += 1)} />
  );
  await click(button(document.body, 'Discard changes'));
  const dialog = document.querySelector('[role="alertdialog"]');
  assert.ok(dialog, 'confirmation shown');
  assert.match(dialog.textContent, /Discard the unsaved changes for everyone\?/);
  assert.match(dialog.textContent, /for everyone editing this entry/);
  await click(button(dialog, 'Cancel'));
  assert.equal(discarded, 0);
  assert.equal(document.querySelector('[role="alertdialog"]'), null);
  await click(button(document.body, 'Discard changes'));
  await click(button(document.querySelector('[role="alertdialog"]'), 'Discard for everyone'));
  assert.equal(discarded, 1);
  await handle.unmount();
});

test('after a discard, Undo has focus and calls back; the remote notice offers Restore', async () => {
  let undone = 0;
  const handle = await renderStrict(
    <RoomResetNotice t={t} kind="self" autoFocus onUndo={() => (undone += 1)} onDismiss={() => {}} />
  );
  assert.equal(document.activeElement && document.activeElement.textContent.trim(), 'Undo');
  assert.equal(
    document.querySelector('[data-testid="mex-room-reset-notice"] [role="status"]') !== null,
    true
  );
  await click(button(document.body, 'Undo'));
  assert.equal(undone, 1);
  await handle.unmount();
  const remote = await renderStrict(
    <RoomResetNotice t={t} kind="remote" onUndo={() => {}} onDismiss={() => {}} />
  );
  assert.ok(button(document.body, 'Restore my text'));
  assert.match(document.body.textContent, /Someone in this live session/);
  await remote.unmount();
});
