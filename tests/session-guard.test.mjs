// 2.6: session-expiry detection and recovery (admin/src/editor/session-guard.mjs, drafts-logic.mjs, collab-client.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as Y from 'yjs';
import {
  SIGN_IN_WINDOW_NAME,
  adminBasePath,
  createSessionGuard,
  createSessionGuardMiddleware,
  isSessionEndAction,
  isSessionEndError,
  recoveryAction,
  statusOf,
} from '../admin/src/editor/session-guard.mjs';
import { bufferAction, createLogoutMiddleware } from '../admin/src/editor/drafts-logic.mjs';
import { loadCollabClient } from '../scripts/cluster/node-client.mjs';
import { createSeedUpdate, docToEditorData } from '../shared/ydoc.mjs';

/** Strapi's FetchError shape (getFetchClient): `status` on the error, the body in `response.data`. */
const fetchError = (status) => {
  const error = new Error('Request failed');
  error.name = 'FetchError';
  error.status = status;
  error.response = { data: { data: null, error: { status, name: 'Error', message: 'x' } } };
  return error;
};
const rejected = (status, endpointName = 'updateDocument', kind = 'executeMutation') => ({
  type: `adminApi/${kind}/rejected`,
  payload: { status, name: 'UnauthorizedError', message: 'Missing or invalid credentials' },
  meta: { arg: { endpointName }, rejectedWithValue: true },
});
const logoutStart = { type: 'adminApi/executeMutation/pending', meta: { arg: { endpointName: 'logout' } } };

test('which responses count as a session end: 401 after the refresh only', () => {
  assert.equal(isSessionEndError(fetchError(401)), true);
  assert.equal(isSessionEndError({ response: { status: 401 } }), true);
  assert.equal(isSessionEndError({ response: { data: { error: { status: 401 } } } }), true);
  assert.equal(isSessionEndError(Object.assign(new Error('x'), { name: 'TokenRefreshError' })), true);
  for (const status of [400, 403, 404, 409, 429, 500, 502, 503])
    assert.equal(isSessionEndError(fetchError(status)), false, String(status));
  assert.equal(isSessionEndError(new TypeError('Failed to fetch')), false, 'network error');
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  abort.status = 401;
  assert.equal(isSessionEndError(abort), false, 'aborted request');
  assert.equal(isSessionEndError(null), false);
  assert.equal(isSessionEndError('401'), false);
  assert.equal(statusOf(fetchError(418)), 418);
  assert.equal(statusOf({}), null);
});

test('admin requests: a rejected RTK action with 401 counts, auth endpoints and other statuses do not', () => {
  assert.equal(isSessionEndAction(rejected(401)), true, 'Content Manager save');
  assert.equal(isSessionEndAction(rejected(401, 'getDocument', 'executeQuery')), true);
  assert.equal(isSessionEndAction(rejected(401, 'login')), false, 'wrong password is not a session end');
  assert.equal(isSessionEndAction(rejected(401, 'logout')), false);
  assert.equal(isSessionEndAction(rejected(403)), false);
  assert.equal(isSessionEndAction(rejected(500)), false);
  assert.equal(
    isSessionEndAction({ type: 'adminApi/executeMutation/fulfilled', payload: { status: 401 } }),
    false
  );
  assert.equal(isSessionEndAction({ type: 'x/rejected' }), false);
  assert.equal(isSessionEndAction(null), false);
});

test('the guard ends once per session: one banner, later reports only count', () => {
  let t = 1000;
  const guard = createSessionGuard({ now: () => t });
  const seen = [];
  guard.subscribe((state) => seen.push(state.status));
  assert.equal(guard.isActive(), true);
  assert.equal(guard.reportError(fetchError(404)), false);
  assert.equal(guard.isActive(), true);
  assert.equal(guard.reportError(fetchError(401), 'presence'), true);
  t = 2000;
  // Polling, collaboration and the save all fail after that: no second transition.
  guard.reportError(fetchError(401), 'comments');
  guard.observeAction(rejected(401));
  guard.end('collaboration');
  assert.deepEqual(seen, ['ended'], 'one change for many failures');
  const state = guard.getState();
  assert.equal(state.status, 'ended');
  assert.equal(state.source, 'presence');
  assert.equal(state.endedAt, 1000);
  assert.equal(state.reports, 4);
  assert.equal(guard.isEnded(), true);
});

test('pause and resume: a new token (sign in here or in another tab) resumes, a null token does not', () => {
  let t = 0;
  const guard = createSessionGuard({ now: () => t });
  guard.end('request');
  guard.observeAction({ type: 'admin/setToken', payload: null });
  assert.equal(guard.isEnded(), true, 'no token, still signed out');
  t = 5000;
  guard.observeAction({ type: 'admin/setToken', payload: 'opaque' });
  assert.equal(guard.isActive(), true);
  assert.equal(guard.getState().resumedAt, 5000);
  assert.equal(guard.getState().generation, 1);
  guard.end('request');
  guard.observeAction({ type: 'admin/login', payload: { persist: false } });
  assert.equal(guard.getState().generation, 2);
  // Resuming while active changes nothing.
  assert.equal(guard.resume(), false);
});

test('logout: an ended session is not a voluntary logout, the admin own logout is', () => {
  let t = 0;
  const guard = createSessionGuard({ now: () => t });
  guard.observeAction({ type: 'admin/logout' });
  assert.equal(guard.getState().status, 'ended', 'Strapi ended the session (refresh refused)');
  guard.observeAction({ type: 'admin/login' });
  guard.observeAction(logoutStart);
  t = 1000;
  guard.observeAction({ type: 'admin/logout' });
  assert.equal(guard.getState().status, 'loggedOut', 'voluntary: no banner');
  assert.equal(guard.end('request'), false, 'a 401 after the voluntary logout shows no banner');
  // The voluntary mark expires.
  guard.observeAction({ type: 'admin/login' });
  guard.observeAction(logoutStart);
  t = 1000 + 61000;
  guard.observeAction({ type: 'admin/logout' });
  assert.equal(guard.getState().status, 'ended');
});

test('drafts: an involuntary end keeps the buffers, the voluntary logout still clears them', () => {
  let t = 0;
  let cleared = 0;
  const middleware = createLogoutMiddleware({ onLogout: () => (cleared += 1), now: () => t })()();
  const pass = (action) => middleware(() => action)(action);
  pass({ type: 'admin/logout' });
  pass(rejected(401));
  assert.equal(cleared, 0, 'session ended: buffers kept');
  pass(logoutStart);
  t = 500;
  pass({ type: 'admin/logout' });
  assert.equal(cleared, 1, 'own logout: buffers removed');
});

test('drafts: while signed out a changed field is always buffered, even in a live room, and nothing is deleted', () => {
  const live = { active: true, status: 'live', pending: false };
  assert.equal(bufferAction({ dirty: true, collaboration: live }), 'delete', 'unchanged 2.5 rule');
  assert.equal(bufferAction({ dirty: true, collaboration: live, sessionEnded: true }), 'write');
  assert.equal(bufferAction({ dirty: false, collaboration: live, sessionEnded: true }), 'keep');
  assert.equal(bufferAction({ dirty: true, sessionEnded: true }), 'write');
  assert.equal(
    bufferAction({ dirty: true, collaboration: { active: true, status: 'paused', pending: true } }),
    'write'
  );
});

test('recovery after signing in again: a form reset to the saved value gets the buffer back once', () => {
  const base = { valueKey: 'saved', savedKey: 'saved', draftKey: 'typed' };
  assert.equal(recoveryAction({ ...base, sinceResumeMs: 300 }), 'restore');
  assert.equal(
    recoveryAction({ ...base, sinceResumeMs: 300, valueKey: 'typed' }),
    'wait',
    'form not reset (yet)'
  );
  assert.equal(
    recoveryAction({ ...base, sinceResumeMs: 300, valueKey: 'other' }),
    'done',
    'the person typed on'
  );
  assert.equal(recoveryAction({ ...base, sinceResumeMs: 20000 }), 'done', 'outside the window');
  assert.equal(recoveryAction({ ...base, sinceResumeMs: null }), 'done');
  assert.equal(recoveryAction({ ...base, sinceResumeMs: 300, draftKey: null }), 'done');
  assert.equal(recoveryAction({ ...base, sinceResumeMs: 300, draftKey: 'saved' }), 'done');
});

test('the Redux middleware passes every action on and never throws', () => {
  const guard = createSessionGuard();
  const seen = [];
  const run = createSessionGuardMiddleware(guard)()((action) => {
    seen.push(action && action.type);
    return 'next';
  });
  assert.equal(run(rejected(401)), 'next');
  assert.equal(guard.isEnded(), true);
  assert.equal(run({ type: 'admin/setToken', payload: 'x' }), 'next');
  assert.equal(guard.isActive(), true);
  assert.equal(run(null), 'next');
  assert.equal(seen.length, 3);
});

test('one banner per page: the first field leads, the next one takes over when it unmounts', () => {
  const guard = createSessionGuard();
  let changes = 0;
  guard.subscribeLeader(() => (changes += 1));
  const releaseA = guard.claimLeader('a');
  const releaseB = guard.claimLeader('b');
  assert.equal(guard.leader(), 'a');
  releaseA();
  assert.equal(guard.leader(), 'b');
  releaseB();
  assert.equal(guard.leader(), null);
  assert.equal(changes, 4);
});

test('sign-in tab: admin base path from the current location', () => {
  assert.equal(adminBasePath('/admin/content-manager/collection-types/api::a.a/x'), '/admin');
  assert.equal(adminBasePath('/cms/dashboard/content-manager/single-types/api::h.h'), '/cms/dashboard');
  assert.equal(adminBasePath('/admin/plugins/magic-editor-x'), '/admin');
  assert.equal(adminBasePath('/elsewhere'), '/admin');
  assert.equal(adminBasePath(undefined), '/admin');
  assert.equal(SIGN_IN_WINDOW_NAME, 'magic-editor-x-sign-in');
});

test('the guard never reads tokens or bodies: no storage, cookie or console access in the module', () => {
  const source = fs.readFileSync(new URL('../admin/src/editor/session-guard.mjs', import.meta.url), 'utf8');
  for (const forbidden of [
    'localStorage',
    'sessionStorage',
    'document.cookie',
    'console.',
    'jwtToken',
    '.json()',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
});

/* ---- collaboration client: pause while signed out, resume after signing in ---- */

const { createCollabClient } = await loadCollabClient();
const flush = () => new Promise((resolve) => setTimeout(resolve, 60));
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });

/** Minimal fake Socket.IO server (one room) that counts connections and token requests. */
const fakeRoom = (blocks) => {
  const room = { doc: new Y.Doc(), sockets: [], opens: 0 };
  Y.applyUpdate(room.doc, createSeedUpdate({ time: 1, blocks }, 'e1'));
  room.factory = (url, options) => {
    const handlers = new Map();
    const fire = (event, payload) => (handlers.get(event) || []).forEach((fn) => fn(payload));
    const socket = {
      connected: false,
      active: true,
      fire,
      on(event, fn) {
        handlers.set(event, [...(handlers.get(event) || []), fn]);
        return socket;
      },
      removeAllListeners: () => handlers.clear(),
      timeout: () => socket,
      emit(event, payload, ack) {
        if (event === 'mx:update') {
          // 2.6: the server refuses edits of an admin session that ended.
          if (room.sessionEnded) return ack(null, { ok: false, code: 'SESSION_ENDED' });
          Y.applyUpdate(room.doc, new Uint8Array(payload));
          return ack(null, { ok: true, id: 1 });
        }
        if (event === 'mx:resync') socket.sync();
        return undefined;
      },
      sync: () =>
        fire('mx:sync', {
          update: Y.encodeStateAsUpdate(room.doc),
          stateVector: Y.encodeStateVector(room.doc),
          epoch: 'e1',
        }),
      async open() {
        // Like socket.io: the auth callback runs before every (re)connection.
        const auth = await new Promise((resolve) => options.auth(resolve));
        if (!auth.token) return;
        room.opens += 1;
        socket.connected = true;
        socket.active = true;
        fire('connect');
        fire('mx:welcome', { canEdit: true, presenceId: 'me', color: 'primary', epoch: 'e1' });
        socket.sync();
      },
      connect: () => socket.open(),
      disconnect() {
        const was = socket.connected;
        socket.connected = false;
        socket.active = false;
        if (was) fire('disconnect', 'io client disconnect');
      },
    };
    room.sockets.push(socket);
    setTimeout(() => socket.open(), 0);
    return socket;
  };
  return room;
};

test('collaboration pauses while signed out (no reconnects, edits kept) and sends them after resume', async () => {
  const room = fakeRoom([p('a', 'one')]);
  let tokens = 0;
  const states = [];
  const client = createCollabClient({
    url: 'http://127.0.0.1:1',
    requestSession: async () => {
      tokens += 1;
      return { token: `t${tokens}`, path: '/x', canEdit: true };
    },
    onRemoteData: () => {
      const { data, catchUp } = client.snapshot();
      client.markShown(catchUp, JSON.parse(JSON.stringify(data)));
    },
    onState: (state) => states.push(state.status),
    socketFactory: room.factory,
    win: null,
  });
  await flush();
  assert.equal(room.opens, 1);
  client.pause();
  assert.equal(client.isPaused(), true);
  assert.equal(states.at(-1), 'paused');
  client.pushLocal({ blocks: [p('a', 'one typed while signed out')] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(docToEditorData(room.doc).blocks[0].data.text, 'one', 'nothing sent while paused');
  assert.equal(tokens, 1, 'no token requests while paused');
  assert.equal(room.opens, 1, 'no reconnects while paused');
  client.resume();
  await flush();
  await flush();
  assert.equal(tokens, 2, 'one fresh token after signing in');
  assert.equal(room.opens, 2);
  assert.equal(
    docToEditorData(room.doc).blocks[0].data.text,
    'one typed while signed out',
    'pending edit sent'
  );
  assert.equal(states.at(-1), 'live');
  client.destroy();
});

test('collaboration: a token request answered 401 pauses the client instead of retrying', async () => {
  const room = fakeRoom([p('a', 'one')]);
  let calls = 0;
  let signedIn = false;
  const states = [];
  const client = createCollabClient({
    url: 'http://127.0.0.1:1',
    requestSession: async () => {
      calls += 1;
      if (!signedIn) throw fetchError(401);
      return { token: 't', path: '/x', canEdit: true };
    },
    onRemoteData: () => {
      const { data, catchUp } = client.snapshot();
      client.markShown(catchUp, data);
    },
    onState: (state) => states.push(state.status),
    socketFactory: room.factory,
    win: null,
  });
  await flush();
  assert.equal(states.at(-1), 'paused');
  client.pushLocal({ blocks: [p('a', 'one two')] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(calls, 1, 'one request, no retry loop');
  signedIn = true;
  client.resume();
  await flush();
  await flush();
  assert.equal(calls, 2);
  assert.equal(states.at(-1), 'live');
  assert.equal(
    docToEditorData(room.doc).blocks[0].data.text,
    'one two',
    'edit made before the first sync is kept'
  );
  client.destroy();
});

test('the sign-in tab closes itself after signing in; other tabs never do', async () => {
  const { createSignInTabCloser } = await import('../admin/src/editor/session-guard.mjs');
  const make = (name) => {
    const win = {
      name,
      closed: 0,
      setTimeout: (fn) => fn(),
      close() {
        win.closed += 1;
      },
    };
    return win;
  };
  const signIn = make(SIGN_IN_WINDOW_NAME);
  const other = make('');
  for (const win of [signIn, other]) {
    const run = createSignInTabCloser({ win })()((action) => action.type);
    assert.equal(run({ type: 'admin/setToken', payload: 'x' }), 'admin/setToken');
    assert.equal(run({ type: 'admin/login' }), 'admin/login');
  }
  assert.equal(signIn.closed, 1);
  assert.equal(signIn.name, '', 'a later login in the same tab does not close it again');
  assert.equal(other.closed, 0);
});

test('opening a field right after signing in again restores a buffer written while signed out, nothing else', async () => {
  const { autoRestoreOnOpen } = await import('../admin/src/editor/session-guard.mjs');
  const session = { status: 'active', endedAt: 1000, resumedAt: 5000 };
  const base = { conflict: false, savedAt: 2000, session, now: 6000 };
  assert.equal(autoRestoreOnOpen(base), true);
  assert.equal(autoRestoreOnOpen({ ...base, conflict: true }), false, 'saved content changed: ask');
  assert.equal(autoRestoreOnOpen({ ...base, savedAt: 900 }), false, 'older buffer: ask');
  assert.equal(autoRestoreOnOpen({ ...base, now: 5000 + 16000 }), false, 'too late: ask');
  assert.equal(autoRestoreOnOpen({ ...base, session: { ...session, status: 'ended' } }), false);
  assert.equal(
    autoRestoreOnOpen({ ...base, session: { status: 'active', endedAt: null, resumedAt: null } }),
    false,
    'no session end on this page'
  );
});

test('a request sent after the end that succeeds resumes the session; one sent before does not', () => {
  let t = 1000;
  const guard = createSessionGuard({ now: () => t });
  guard.end('request');
  assert.equal(guard.reportSuccess(900), false, 'answer of a request sent before the end');
  assert.equal(guard.isEnded(), true);
  assert.equal(guard.reportSuccess(1000), false, 'same instant');
  t = 3000;
  assert.equal(guard.reportSuccess(2000), true);
  assert.equal(guard.isActive(), true);
  assert.equal(guard.reportSuccess(2500), false, 'already active');
});

test('collaboration: text typed while signed out is merged onto the room, edits of others made meanwhile stay', async () => {
  const room = fakeRoom([p('a', 'one'), p('b', 'two')]);
  const make = () => {
    const client = createCollabClient({
      url: 'http://127.0.0.1:1',
      requestSession: async () => ({ token: 't', path: '/x', canEdit: true }),
      onRemoteData: () => {
        const { data, catchUp } = client.snapshot();
        client.markShown(catchUp, JSON.parse(JSON.stringify(data)));
      },
      onState: () => {},
      socketFactory: room.factory,
      win: null,
    });
    return client;
  };
  const first = make();
  await flush();
  first.pause();
  const base = first.pausedBase();
  assert.deepEqual(
    base.blocks.map((block) => block.data.text),
    ['one', 'two']
  );
  // Typed while signed out (kept in the draft buffer); the field is then remounted by Strapi.
  const draft = { blocks: [p('a', 'one plus signed-out text'), p('b', 'two')] };
  first.destroy();
  // Another editor changes the second block meanwhile.
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(room.doc));
  const otherText = other.getMap('blocks').get('b');
  assert.ok(otherText, 'block b exists');
  const second = make();
  await flush();
  // Simulate the other editor's change arriving through the room.
  const { applyLocalChanges } = await import('../shared/ydoc.mjs');
  applyLocalChanges(room.doc, docToEditorData(room.doc), { blocks: [p('a', 'one'), p('b', 'two and B')] });
  room.sockets.at(-1).sync();
  await flush();
  assert.equal(second.mergeLocal(base, draft), true);
  await flush();
  const texts = docToEditorData(room.doc).blocks.map((block) => block.data.text);
  assert.deepEqual(texts, ['one plus signed-out text', 'two and B'], 'both edits, nothing duplicated');
  assert.equal(second.mergeLocal(null, draft), false, 'no base: nothing merged');
  second.destroy();
});

test('2.6: the server ends the socket of an ended admin session: the client pauses, keeps the edit and reports it', async () => {
  const room = fakeRoom([p('a', 'one')]);
  let tokens = 0;
  let reported = 0;
  const states = [];
  const client = createCollabClient({
    url: 'http://127.0.0.1:1',
    requestSession: async () => {
      tokens += 1;
      return { token: `t${tokens}`, path: '/x', canEdit: true };
    },
    onSessionEnded: () => {
      reported += 1;
    },
    onRemoteData: () => {
      const { data, catchUp } = client.snapshot();
      client.markShown(catchUp, JSON.parse(JSON.stringify(data)));
    },
    onState: (state) => states.push(state.status),
    socketFactory: room.factory,
    win: null,
  });
  await flush();
  room.sessionEnded = true;
  client.pushLocal({ blocks: [p('a', 'one typed after the revoke')] });
  await new Promise((resolve) => setTimeout(resolve, 300));
  assert.equal(docToEditorData(room.doc).blocks[0].data.text, 'one', 'the refused edit is not in the room');
  assert.equal(reported, 1, 'reported once');
  assert.equal(client.isPaused(), true);
  assert.equal(states.at(-1), 'paused');
  assert.equal(room.opens, 1, 'no reconnect while the session is over');
  // Signed in again: the kept edit reaches the room.
  room.sessionEnded = false;
  client.resume();
  await flush();
  await flush();
  assert.equal(docToEditorData(room.doc).blocks[0].data.text, 'one typed after the revoke');
  client.destroy();
});

test('2.6: SESSION_ENDED as a socket error or a refused handshake pauses without reconnecting', async () => {
  for (const kind of ['error', 'handshake']) {
    const room = fakeRoom([p('a', 'one')]);
    let reported = 0;
    const client = createCollabClient({
      url: 'http://127.0.0.1:1',
      requestSession: async () => ({ token: 't', path: '/x', canEdit: true }),
      onSessionEnded: () => {
        reported += 1;
      },
      onRemoteData: () => {
        const { data, catchUp } = client.snapshot();
        client.markShown(catchUp, data);
      },
      onState: () => {},
      socketFactory: room.factory,
      win: null,
    });
    await flush();
    const socket = room.sockets[0];
    if (kind === 'error') socket.fire('mx:error', { code: 'SESSION_ENDED' });
    else
      socket.fire(
        'connect_error',
        Object.assign(new Error('SESSION_ENDED'), { data: { code: 'SESSION_ENDED' } })
      );
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(reported, 1, kind);
    assert.equal(client.isPaused(), true, kind);
    assert.equal(room.opens, 1, `${kind}: no reconnect`);
    client.destroy();
  }
});
