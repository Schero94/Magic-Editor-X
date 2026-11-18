import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { call, creds, tokenFor, createArticle, openSession, connect, waitFor } from './helpers.mjs';
import { applyEditorDataToDoc, docToEditorData } from '../../shared/ydoc.mjs';

/**
 * 2.6: a live collaboration socket ends with the admin session it was opened
 * in. Before 2.6 a socket kept accepting edits after its session was revoked
 * (logout elsewhere, "Sign out" of a session in the profile, expiry) until the
 * browser noticed. Now the handshake refuses a token of an ended session,
 * edits arriving after the end are refused with `SESSION_ENDED` (checked at
 * most every 5 s per socket) and the socket is closed.
 *
 * Needs Strapi with admin sessions (5.24 or later); skipped otherwise. Every
 * login here is its own session of the `editor` account, and only those
 * sessions are revoked, so other suites keep theirs. Synthetic data only.
 */

const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const target = (documentId) => ({ uid: 'api::article.article', documentId, locale: 'en', field: 'body' });
const send = (client, update) =>
  new Promise((resolve) =>
    client.socket
      .timeout(5000)
      .emit('mx:update', update, (error, reply) => resolve(error ? { timeout: true } : reply))
  );
const editText = (client, text) => {
  const before = Y.encodeStateVector(client.ydoc);
  applyEditorDataToDoc(client.ydoc, doc([p('s1', text)]));
  return Y.encodeStateAsUpdate(client.ydoc, before);
};

/** A fresh login of the editor: a new admin session with its own token. */
const login = async () => {
  const response = await call('POST', '/admin/login', {
    body: { email: creds.users.editor.email, password: creds.users.editor.password },
  });
  assert.equal(response.status, 200, 'login');
  return response.body.data.token;
};

/** Id of the session a token belongs to (`current` in the caller's own session list). */
const currentSession = async (token) => {
  const response = await call('GET', '/admin/users/me/sessions', { token });
  if (response.status === 404) return null;
  assert.equal(response.status, 200, `sessions ${response.status}`);
  const current = (response.body.data || []).find((session) => session.current);
  return current ? current.id : null;
};

const revoke = async (token, sessionId) => {
  const response = await call('DELETE', `/admin/users/me/sessions/${sessionId}`, { token });
  assert.equal(response.status, 200, `revoke ${response.status}`);
};

/** Text of the field as a fresh client sees the room. */
const roomText = async (token, documentId) => {
  const fresh = await connect(await openSession(token, target(documentId)));
  const blocks = docToEditorData(fresh.ydoc).blocks;
  fresh.socket.disconnect();
  return blocks.map((block) => block.data.text).join('|');
};

test('a socket stops accepting edits once its admin session is revoked', async (t) => {
  const tokenA = await login();
  const tokenB = await login();
  const sessionA = await currentSession(tokenA);
  if (!sessionA) return t.skip('this Strapi version has no admin sessions');
  const article = await createArticle(await tokenFor('editor'), {
    title: 'Session socket',
    body: doc([p('s1', 'Start')]),
  });
  const a = await connect(await openSession(tokenA, target(article.documentId)));
  t.after(() => a.socket.disconnect());
  assert.ok(a.welcome, 'connected');
  assert.equal((await send(a, editText(a, 'Start before'))).ok, true, 'edit accepted while signed in');

  await revoke(tokenB, sessionA);
  // The socket checks its session at most every 5 s on incoming edits.
  await sleep(5500);
  const reply = await send(a, editText(a, 'Start before after revoke'));
  assert.equal(reply.ok, false);
  assert.equal(reply.code, 'SESSION_ENDED');
  assert.ok(
    (await waitFor(() => a.errors.includes('SESSION_ENDED') && !a.socket.connected)) >= 0,
    'socket closed'
  );
  assert.equal(
    await roomText(tokenB, article.documentId),
    'Start before',
    'the refused edit is not in the room'
  );
});

test('the handshake refuses a token issued before the session ended', async (t) => {
  const tokenC = await login();
  const tokenD = await login();
  const sessionC = await currentSession(tokenC);
  if (!sessionC) return t.skip('this Strapi version has no admin sessions');
  const article = await createArticle(await tokenFor('editor'), {
    title: 'Session handshake',
    body: doc([p('s1', 'Start')]),
  });
  const session = await openSession(tokenC, target(article.documentId));
  await revoke(tokenD, sessionC);
  const c = await connect(session);
  t.after(() => c.socket.disconnect());
  assert.deepEqual(c.errors, ['SESSION_ENDED']);
  assert.equal(c.welcome, null);
  // The revoked token itself is refused by Strapi, so no new socket token can be issued for it.
  const again = await call('POST', '/magic-editor-x/collaboration/session', {
    token: tokenC,
    body: target(article.documentId),
  });
  assert.equal(again.status, 401);
});

test('a socket of an active session keeps working past the check interval', async (t) => {
  const tokenE = await login();
  if (!(await currentSession(tokenE))) return t.skip('this Strapi version has no admin sessions');
  const article = await createArticle(await tokenFor('editor'), {
    title: 'Session active',
    body: doc([p('s1', 'Start')]),
  });
  const e = await connect(await openSession(tokenE, target(article.documentId)));
  t.after(() => e.socket.disconnect());
  await sleep(5500);
  assert.equal((await send(e, editText(e, 'Start still'))).ok, true);
  assert.deepEqual(e.errors, []);
});
