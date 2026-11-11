import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as Y from 'yjs';
import { call, tokenFor, createArticle, openSession, connect, waitFor } from './helpers.mjs';
import { applyEditorDataToDoc, docToEditorData } from '../../shared/ydoc.mjs';

/**
 * Collaboration hardening (2.1): malicious updates, forged presence, rate
 * limits, structured merges over the wire and permission revocation within
 * seconds. Synthetic accounts only (*.example.test).
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
/** Update produced by `fn` on a copy of the client's document. */
const diffOf = (client, fn) => {
  const before = Y.encodeStateVector(client.ydoc);
  fn(client.ydoc);
  return Y.encodeStateAsUpdate(client.ydoc, before);
};

test('malicious Yjs updates are refused and never poison the room', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, { title: 'Guard', body: doc([p('g1', 'safe')]) });
  const a = await connect(await openSession(editor, target(article.documentId)));
  assert.equal(a.welcome.protocol, 3);
  assert.equal(typeof a.welcome.epoch, 'string');

  const attacks = {
    rootType: (d) => d.getMap('evil').set('x', 1),
    xml: (d) => d.getMap('blocks').get('g1').get('data').set('x', new Y.XmlElement('img')),
    format: (d) => d.getMap('blocks').get('g1').get('data').get('text').format(0, 2, { bold: true }),
    protoKey: (d) => d.getMap('blocks').get('g1').get('data').set('__proto__', 'x'),
    badType: (d) => d.getMap('blocks').get('g1').set('type', '<img src=x onerror=alert(1)>'),
    metaKey: (d) => d.getMap('meta').set('owner', 1),
  };
  // A fresh socket per attack: five refused updates end a socket (tested below).
  for (const [name, fn] of Object.entries(attacks)) {
    const attacker = await connect(await openSession(editor, target(article.documentId)));
    const scratch = new Y.Doc();
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(attacker.ydoc));
    const before = Y.encodeStateVector(scratch);
    fn(scratch);
    const reply = await send(attacker, Y.encodeStateAsUpdate(scratch, before));
    assert.deepEqual(reply, { ok: false, code: 'INVALID_UPDATE' }, name);
    attacker.socket.disconnect();
  }
  // garbage bytes
  const fresh = await connect(await openSession(editor, target(article.documentId)));
  assert.deepEqual(await send(fresh, Uint8Array.from([1, 2, 3, 4, 5, 6])), {
    ok: false,
    code: 'INVALID_UPDATE',
  });
  // The room still works and holds only valid content.
  const ok = await send(
    fresh,
    diffOf(fresh, (d) => applyEditorDataToDoc(d, doc([p('g1', 'safe and sound')])))
  );
  assert.equal(ok.ok, true);
  const late = await connect(await openSession(editor, target(article.documentId)));
  assert.deepEqual(docToEditorData(late.ydoc).blocks, [
    { id: 'g1', type: 'paragraph', data: { text: 'safe and sound' } },
  ]);
  assert.equal(late.ydoc.share.has('evil'), false);
  for (const client of [a, fresh, late]) client.socket.disconnect();
});

test('an attacker who keeps sending invalid updates is disconnected', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, { title: 'Flood', body: doc([p('f1', 'x')]) });
  const a = await connect(await openSession(editor, target(article.documentId)));
  for (let i = 0; i < 6 && a.socket.connected; i += 1) await send(a, Uint8Array.from([9, 9, 9, 9]));
  await waitFor(() => a.socket.disconnected, 3000);
  assert.equal(a.socket.disconnected, true);
  assert.ok(a.errors.includes('INVALID_UPDATE'));
});

test('updates with missing dependencies get RETRY, not stored', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, { title: 'Deps', body: doc([p('d1', 'abc')]) });
  const a = await connect(await openSession(editor, target(article.documentId)));
  const text = a.ydoc.getMap('blocks').get('d1').get('data').get('text');
  text.insert(3, 'd');
  const v1 = Y.encodeStateVector(a.ydoc);
  text.insert(4, 'e');
  const second = Y.encodeStateAsUpdate(a.ydoc, v1);
  assert.deepEqual(await send(a, second), { ok: false, code: 'RETRY' });
  a.socket.disconnect();
});

test('presence: names and colours come from the server, never from the client', async () => {
  const editor = await tokenFor('editor');
  const admin = await tokenFor('admin');
  const article = await createArticle(editor, { title: 'Presence', body: doc([p('q1', 'hello')]) });
  const a = await connect(await openSession(editor, target(article.documentId)));
  const b = await connect(await openSession(admin, target(article.documentId)));
  a.socket.emit('mx:cursor', {
    blockId: 'q1',
    anchor: 1,
    focus: 3,
    name: 'Super Admin <img src=x onerror=alert(1)>',
    color: 'javascript:alert(1)',
    canEdit: true,
  });
  const peerOf = () => b.peers.find((peer) => peer.id === a.welcome.presenceId);
  assert.notEqual(await waitFor(() => Boolean(peerOf() && peerOf().cursor), 5000), -1);
  const peer = peerOf();
  assert.equal(peer.name, a.welcome.name);
  assert.ok(!peer.name.includes('@'), 'never an e-mail address');
  assert.ok(['primary', 'danger', 'success', 'warning', 'secondary', 'alternative'].includes(peer.color));
  assert.deepEqual(peer.cursor, { blockId: 'q1', anchor: 1, focus: 3 });
  assert.deepEqual(Object.keys(peer).sort(), ['canEdit', 'color', 'cursor', 'id', 'idle', 'name']);
  a.socket.emit('mx:cursor', { blockId: '../../etc', anchor: -5 });
  await sleep(800);
  assert.equal(peerOf().cursor, null, 'invalid block ids are dropped');
  a.socket.emit('mx:cursor', { idle: true });
  assert.notEqual(await waitFor(() => peerOf() && peerOf().idle === true, 5000), -1);
  a.socket.disconnect();
  assert.notEqual(await waitFor(() => !peerOf(), 5000), -1, 'leaving removes presence at once');
  b.socket.disconnect();
});

test('structured merge over the wire: two people edit different table cells', async () => {
  const editor = await tokenFor('editor');
  const admin = await tokenFor('admin');
  const table = {
    id: 't1',
    type: 'table',
    data: {
      withHeadings: false,
      content: [
        ['a', 'b'],
        ['c', 'd'],
      ],
    },
  };
  const article = await createArticle(editor, { title: 'Table', body: doc([table]) });
  const a = await connect(await openSession(editor, target(article.documentId)));
  const b = await connect(await openSession(admin, target(article.documentId)));
  const ua = diffOf(a, (d) =>
    applyEditorDataToDoc(
      d,
      doc([
        {
          ...table,
          data: {
            ...table.data,
            content: [
              ['A!', 'b'],
              ['c', 'd'],
            ],
          },
        },
      ])
    )
  );
  const ub = diffOf(b, (d) =>
    applyEditorDataToDoc(
      d,
      doc([
        {
          ...table,
          data: {
            ...table.data,
            content: [
              ['a', 'b'],
              ['c', 'D!'],
            ],
          },
        },
      ])
    )
  );
  assert.equal((await send(a, ua)).ok, true);
  assert.equal((await send(b, ub)).ok, true);
  await sleep(1200);
  const expected = [
    ['A!', 'b'],
    ['c', 'D!'],
  ];
  assert.deepEqual(docToEditorData(a.ydoc).blocks[0].data.content, expected);
  assert.deepEqual(docToEditorData(b.ydoc).blocks[0].data.content, expected);
  a.socket.disconnect();
  b.socket.disconnect();
});

test('per-socket update rate limit answers RATE_LIMITED', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, { title: 'Rate', body: doc([p('r1', '')]) });
  const a = await connect(await openSession(editor, target(article.documentId)));
  const text = a.ydoc.getMap('blocks').get('r1').get('data').get('text');
  const replies = [];
  for (let i = 0; i < 340; i += 1) {
    const before = Y.encodeStateVector(a.ydoc);
    text.insert(text.length, 'x');
    replies.push(send(a, Y.encodeStateAsUpdate(a.ydoc, before)));
  }
  const results = await Promise.all(replies);
  assert.ok(results.some((reply) => reply && reply.code === 'RATE_LIMITED'));
  a.socket.disconnect();
});

test('permission changes reach open sockets within seconds (downgrade, then revoke)', async () => {
  const admin = await tokenFor('admin');
  const suffix = crypto.randomBytes(4).toString('hex');
  const role = await call('POST', '/admin/roles', {
    token: admin,
    body: { name: `Live ${suffix}`, description: 'temp' },
  });
  assert.equal(role.status, 201);
  const roleId = role.body.data.id;
  const P = (action, subject = null, fields = null) => ({
    action,
    subject,
    properties: fields ? { fields, locales: ['en', 'de'] } : {},
    conditions: [],
  });
  const fields = ['title', 'body', 'sections.heading', 'sections.body'];
  const permissions = (update) => [
    P('plugin::content-manager.explorer.read', 'api::article.article', fields),
    ...(update ? [P('plugin::content-manager.explorer.update', 'api::article.article', fields)] : []),
    P('plugin::magic-editor-x.access'),
    P('plugin::magic-editor-x.collaborate'),
  ];
  assert.equal(
    (
      await call('PUT', `/admin/roles/${roleId}/permissions`, {
        token: admin,
        body: { permissions: permissions(true) },
      })
    ).status,
    200
  );
  const email = `live-${suffix}@example.test`;
  const created = await call('POST', '/admin/users', {
    token: admin,
    body: { firstname: 'Lena', lastname: 'Live', email, roles: [roleId] },
  });
  assert.equal(created.status, 201);
  const password = `Mx1!${crypto.randomBytes(12).toString('base64url')}`;
  const registered = await call('POST', '/admin/register', {
    body: {
      registrationToken: created.body.data.registrationToken,
      userInfo: { firstname: 'Lena', lastname: 'Live', password },
    },
  });
  assert.equal(registered.status, 200);
  const login = await call('POST', '/admin/login', { body: { email, password } });
  const userToken = login.body.data.token;
  const article = await createArticle(await tokenFor('editor'), {
    title: 'Revoke',
    body: doc([p('v1', 'x')]),
  });
  const client = await connect(await openSession(userToken, target(article.documentId)));
  assert.equal(client.welcome.canEdit, true);
  assert.equal(client.welcome.name, 'Lena L.');

  await call('PUT', `/admin/roles/${roleId}/permissions`, {
    token: admin,
    body: { permissions: permissions(false) },
  });
  const downgradeMs = await waitFor(() => client.roles.some((r) => r.canEdit === false), 5000);
  assert.ok(downgradeMs >= 0 && downgradeMs < 5000, `downgrade took ${downgradeMs} ms`);
  const refused = await send(client, Y.encodeStateAsUpdate(new Y.Doc()));
  assert.deepEqual(refused, { ok: false, code: 'READ_ONLY' });

  await call('PUT', `/admin/roles/${roleId}/permissions`, {
    token: admin,
    body: { permissions: [P('plugin::magic-editor-x.access'), P('plugin::magic-editor-x.collaborate')] },
  });
  const revokeMs = await waitFor(() => client.errors.includes('ACCESS_REVOKED'), 5000);
  assert.ok(revokeMs >= 0 && revokeMs < 5000, `revocation took ${revokeMs} ms`);
  await waitFor(() => client.socket.disconnected, 2000);
  assert.equal(client.socket.disconnected, true);
  console.log(`permission SLA: downgrade ${downgradeMs} ms, revoke ${revokeMs} ms`);
  await call('DELETE', `/admin/users/${created.body.data.id}`, { token: admin });
  await call('DELETE', `/admin/roles/${roleId}`, { token: admin });
});
