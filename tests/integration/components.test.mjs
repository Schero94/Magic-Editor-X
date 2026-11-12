import test from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, createArticle, openSession, connect } from './helpers.mjs';

/**
 * Editor fields inside components and dynamic zones (MEX-23-12): version
 * history and live collaboration check the Content Manager field permission
 * by the field path (`sections.body`, the zone for dynamic zones), so they
 * answer for the editor instead of 404.
 *
 * Host fields (see CONTRIBUTING.md): `sections` is a repeatable component with
 * a Magic Editor X field `body`; `zone` is a dynamic zone with
 * `blocks.text-section` (also a `body` field). The reviewer role reads
 * `sections.body` but not `zone`.
 */

const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const UID = 'api::article.article';

test('history and collaboration work for editor fields inside components and dynamic zones', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, {
    title: 'Component fields',
    sections: [{ heading: 'One', body: doc([p('c1', 'Inside a component')]) }],
    zone: [{ __component: 'blocks.text-section', heading: 'Z', body: doc([p('z1', 'Inside a zone')]) }],
  });
  for (const field of ['sections.0.body', 'zone.0.body']) {
    const target = { uid: UID, documentId: article.documentId, locale: 'en', field };
    const created = await call('POST', '/magic-editor-x/history', {
      token: editor,
      body: { ...target, content: doc([p('v1', `Version of ${field}`)]) },
    });
    assert.equal(created.status, 201, `${field}: ${JSON.stringify(created.body).slice(0, 200)}`);
    const list = await call('GET', `/magic-editor-x/history?${new URLSearchParams(target)}`, {
      token: editor,
    });
    assert.equal(list.status, 200, field);
    assert.equal(list.body.data.length, 1, field);
    assert.equal(list.body.meta.canRestore, true, field);
    const session = await openSession(editor, target);
    const client = await connect(session);
    try {
      assert.deepEqual(client.errors, [], field);
      assert.equal(client.welcome && client.welcome.canEdit, true, field);
    } finally {
      client.socket.close();
    }
  }
  // The reviewer reads `sections.body` (history without restore) but not the zone (404).
  const reviewer = await tokenFor('reviewer');
  const query = (field) =>
    new URLSearchParams({ uid: UID, documentId: article.documentId, locale: 'en', field });
  const section = await call('GET', `/magic-editor-x/history?${query('sections.0.body')}`, {
    token: reviewer,
  });
  assert.equal(section.status, 200);
  assert.equal(section.body.meta.canRestore, false);
  const zone = await call('GET', `/magic-editor-x/history?${query('zone.0.body')}`, { token: reviewer });
  assert.equal(zone.status, 404);
});
