// 2.5: local draft buffer rules and lazy start helpers (admin/src/editor/drafts-logic.mjs, lazy-init.mjs).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_DRAFT_TTL_HOURS,
  MAX_DRAFT_CHARS,
  VOLUNTARY_LOGOUT_WINDOW_MS,
  bufferAction,
  buildDraftRecord,
  createLogoutMiddleware,
  draftIdentity,
  hashText,
  isExpired,
  isLogoutMutationStart,
  isValidDraftRecord,
  relativeTimeOf,
  restoreDecision,
  savedValueOf,
  ttlMsOf,
  valueAtPath,
} from '../admin/src/editor/drafts-logic.mjs';
import { DEFAULT_LAZY_MARGIN_PX, isNearViewport, lazyMarginOf } from '../admin/src/editor/lazy-init.mjs';

const KEY = 'AbCdEfGhIjKlMnOpQrStUv';
const doc = (text) => ({
  time: 1,
  version: '2.31.7',
  blocks: [{ id: 'b1', type: 'paragraph', data: { text } }],
});

test('draftIdentity keys by admin, entry (or "new"), locale and field identity', () => {
  const base = { owner: 7, uid: 'api::article.article', documentId: 'd1', locale: 'en', field: 'body' };
  assert.equal(draftIdentity(base), '7|api::article.article|d1|en|body');
  assert.equal(
    draftIdentity({ ...base, documentId: null, locale: null }),
    '7|api::article.article|new|-|body'
  );
  // A field inside a repeatable component or dynamic zone: its saved key, else the path.
  assert.equal(
    draftIdentity({ ...base, field: 'sections.2.body', fieldKey: KEY }),
    `7|api::article.article|d1|en|sections.body#${KEY}`
  );
  assert.equal(
    draftIdentity({ ...base, field: 'sections.2.body' }),
    '7|api::article.article|d1|en|sections.2.body'
  );
  assert.equal(
    draftIdentity({ ...base, field: 'sections.2.body', fieldKey: 'bad' }).endsWith('sections.2.body'),
    true
  );
  // A stable field ignores a key.
  assert.equal(draftIdentity({ ...base, fieldKey: KEY }), '7|api::article.article|d1|en|body');
  assert.equal(draftIdentity({ ...base, owner: null }), null);
  assert.equal(draftIdentity({ ...base, uid: null }), null);
  assert.equal(draftIdentity({ ...base, field: 'x'.repeat(600) }), null);
  // Two admins never share a buffer.
  assert.notEqual(draftIdentity(base), draftIdentity({ ...base, owner: 8 }));
});

test('buildDraftRecord stores content without fieldKey, with base hash and lifetime', () => {
  const record = buildDraftRecord({
    id: 'x',
    data: { ...doc('a'), fieldKey: KEY },
    baseKey: 'saved',
    now: 1000,
    ttlMs: 5000,
  });
  assert.equal(isValidDraftRecord(record), true);
  assert.equal(record.data.fieldKey, undefined);
  assert.equal(record.baseHash, hashText('saved'));
  assert.equal(record.expiresAt, 6000);
  assert.equal(buildDraftRecord({ id: 'x', data: null, baseKey: '', now: 1, ttlMs: 1 }), null);
  const huge = doc('x'.repeat(MAX_DRAFT_CHARS + 1));
  assert.equal(buildDraftRecord({ id: 'x', data: huge, baseKey: '', now: 1, ttlMs: 1 }), null);
});

test('isValidDraftRecord rejects other shapes; isExpired and ttlMsOf bounds', () => {
  assert.equal(isValidDraftRecord(null), false);
  assert.equal(
    isValidDraftRecord({ v: 2, id: 'x', baseHash: 'h', savedAt: 1, expiresAt: 2, data: doc('') }),
    false
  );
  assert.equal(
    isValidDraftRecord({ v: 1, id: 'x', baseHash: 'h', savedAt: 1, expiresAt: 2, data: {} }),
    false
  );
  assert.equal(isExpired({ expiresAt: 10 }, 10), true);
  assert.equal(isExpired({ expiresAt: 11 }, 10), false);
  assert.equal(ttlMsOf(undefined), DEFAULT_DRAFT_TTL_HOURS * 3600000);
  assert.equal(ttlMsOf(1), 3600000);
  assert.equal(ttlMsOf(0), DEFAULT_DRAFT_TTL_HOURS * 3600000);
  assert.equal(ttlMsOf(721), DEFAULT_DRAFT_TTL_HOURS * 3600000);
});

test('restoreDecision: never automatic, conflict when the saved content changed', () => {
  const record = buildDraftRecord({ id: 'x', data: doc('mine'), baseKey: 'S1', now: 0, ttlMs: 1000 });
  const common = { record, now: 10, recordKey: 'R', shownKey: 'S1', savedKey: 'S1' };
  assert.deepEqual(restoreDecision({ ...common, record: null }), { action: 'none' });
  assert.deepEqual(restoreDecision(common), { action: 'offer', conflict: false });
  assert.deepEqual(restoreDecision({ ...common, savedKey: 'S2', shownKey: 'S2' }), {
    action: 'offer',
    conflict: true,
  });
  // Same content as shown (e.g. the live room has it) or as saved: removed silently.
  assert.deepEqual(restoreDecision({ ...common, shownKey: 'R' }), { action: 'delete' });
  assert.deepEqual(restoreDecision({ ...common, savedKey: 'R' }), { action: 'delete' });
  assert.deepEqual(restoreDecision({ ...common, now: 5000 }), { action: 'delete' });
  assert.deepEqual(restoreDecision({ ...common, record: { id: 'x' } }), { action: 'delete' });
  // Read-only fields keep the buffer and show nothing.
  assert.deepEqual(restoreDecision({ ...common, readOnly: true }), { action: 'none' });
});

test('bufferAction: live and synced collaboration never buffers, offline gaps do', () => {
  assert.equal(bufferAction({ dirty: true }), 'write');
  assert.equal(bufferAction({ dirty: false }), 'delete');
  const live = { active: true, status: 'live', pending: false };
  assert.equal(bufferAction({ dirty: true, collaboration: live }), 'delete');
  assert.equal(bufferAction({ dirty: true, collaboration: { ...live, pending: true } }), 'write');
  assert.equal(bufferAction({ dirty: true, collaboration: { ...live, status: 'offline' } }), 'write');
  assert.equal(bufferAction({ dirty: true, collaboration: { ...live, status: 'reconnecting' } }), 'write');
  assert.equal(bufferAction({ dirty: true, collaboration: { active: false, status: 'error' } }), 'write');
});

test('relativeTimeOf picks the unit', () => {
  assert.deepEqual(relativeTimeOf(0, 30000), { value: -30, unit: 'second' });
  assert.deepEqual(relativeTimeOf(0, 5 * 60000), { value: -5, unit: 'minute' });
  assert.deepEqual(relativeTimeOf(0, 3 * 3600000), { value: -3, unit: 'hour' });
  assert.deepEqual(relativeTimeOf(0, 50 * 3600000), { value: -2, unit: 'day' });
  assert.deepEqual(relativeTimeOf(100, 0), { value: -0, unit: 'second' });
});

test('savedValueOf follows the saved key, falls back to the path', () => {
  const values = {
    body: doc('top'),
    sections: [
      { body: { ...doc('first'), fieldKey: 'K'.repeat(22) } },
      { body: { ...doc('second'), fieldKey: KEY } },
    ],
    zone: [{ __component: 'blocks.group', items: [{ body: doc('deep') }] }],
  };
  assert.equal(savedValueOf(values, 'body').blocks[0].data.text, 'top');
  // The entry moved: the path names another entry, the key still finds it.
  assert.equal(savedValueOf(values, 'sections.0.body', KEY).blocks[0].data.text, 'second');
  assert.equal(savedValueOf(values, 'sections.0.body').blocks[0].data.text, 'first');
  assert.equal(savedValueOf(values, 'zone.0.items.0.body').blocks[0].data.text, 'deep');
  assert.equal(savedValueOf(values, 'sections.5.body'), null);
  assert.equal(savedValueOf(null, 'body'), null);
  assert.equal(valueAtPath({ a: { b: 1 } }, 'a.b'), 1);
  assert.equal(valueAtPath({ a: 1 }, 'a.b.c'), undefined);
});

test('logout middleware clears only after the admin logs out on purpose', () => {
  let cleared = 0;
  let now = 1000;
  const factory = createLogoutMiddleware({ onLogout: () => (cleared += 1), now: () => now });
  const dispatch = factory()({})((action) => action);
  const logoutStart = {
    type: 'adminApi/executeMutation/pending',
    meta: { arg: { endpointName: 'logout' } },
  };
  assert.equal(isLogoutMutationStart(logoutStart), true);
  assert.equal(isLogoutMutationStart({ type: 'adminApi/executeMutation/pending', meta: { arg: {} } }), false);
  // Ended session (refresh refused): `admin/logout` without the mutation keeps the buffers.
  dispatch({ type: 'admin/logout' });
  assert.equal(cleared, 0);
  // Voluntary logout.
  dispatch(logoutStart);
  now += 500;
  assert.deepEqual(dispatch({ type: 'admin/logout' }), { type: 'admin/logout' });
  assert.equal(cleared, 1);
  // The mark is used once; a later forced logout does not clear.
  dispatch({ type: 'admin/logout' });
  assert.equal(cleared, 1);
  // A mutation long before the logout action does not count.
  dispatch(logoutStart);
  now += VOLUNTARY_LOGOUT_WINDOW_MS + 1;
  dispatch({ type: 'admin/logout' });
  assert.equal(cleared, 1);
  // A failing callback never blocks the action.
  const failing = createLogoutMiddleware({
    onLogout: () => {
      throw new Error('x');
    },
  })()({})((action) => action.type);
  failing(logoutStart);
  assert.equal(failing({ type: 'admin/logout' }), 'admin/logout');
  assert.equal(dispatch(null), null);
});

test('lazy start helpers', () => {
  assert.equal(lazyMarginOf(undefined), DEFAULT_LAZY_MARGIN_PX);
  assert.equal(lazyMarginOf(0), 0);
  assert.equal(lazyMarginOf(-1), DEFAULT_LAZY_MARGIN_PX);
  assert.equal(lazyMarginOf(1.5), DEFAULT_LAZY_MARGIN_PX);
  const box = (top, height = 300) => ({ top, bottom: top + height, width: 600, height });
  assert.equal(isNearViewport(box(100), 900, 800), true);
  assert.equal(isNearViewport(box(1650), 900, 800), true);
  assert.equal(isNearViewport(box(1800), 900, 800), false);
  assert.equal(isNearViewport(box(-1200), 900, 800), false);
  assert.equal(isNearViewport({ top: 0, bottom: 0, width: 0, height: 0 }, 900, 800), false);
  assert.equal(isNearViewport(null, 900, 800), false);
});

test('EditorField wiring: lazy start gates Editor.js; the notice and placeholder are wired', () => {
  const source = fs.readFileSync(
    new URL('../admin/src/components/EditorField/index.jsx', import.meta.url),
    'utf8'
  );
  // 2.5: also waits until the media of a private upload provider are signed (bounded).
  assert.match(
    source,
    /if \(!config \|\| !holderRef\.current \|\| !lazy\.active \|\| \(privateFiles && !mediaSigned\)\)/
  );
  assert.match(source, /\[toolsKey, adminLocale, lazy\.active, mediaSigned\]/);
  assert.match(source, /<DraftNotice/);
  assert.match(source, /<LazyPlaceholder/);
  assert.match(source, /useDraftBuffer\(/);
  const index = fs.readFileSync(new URL('../admin/src/index.js', import.meta.url), 'utf8');
  assert.match(
    index,
    /app\.addMiddlewares\(\[\s*createLogoutMiddleware\(\{ onLogout: \(\) => clearDrafts\(\) \}\),\s*createSessionMiddleware,\s*(\/\/[^\n]*\n\s*)?createSessionGuardMiddleware,\s*createSignInTabCloser,?\s*\]\)/
  );
});
