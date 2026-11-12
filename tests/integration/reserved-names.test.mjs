/**
 * Custom blocks created before 2.3 under a name 2.3 gave to a built-in block
 * (`toc`, `gallery`, `video`, `audio`, `synced`) against a real host: their
 * stored data is never rewritten or stripped, on any path.
 *
 * Host requirement: start it with `MEX_LEGACY_BLOCKS=true`. Since 2.3 the
 * custom-blocks service refuses these names for new blocks, so the acceptance
 * host's `bootstrap` writes a Settings custom block named `toc` the way the
 * 2.2 service did (`strapi.db.query('plugin::magic-editor-x.custom-block')
 * .create(...)`, same columns; CONTRIBUTING.md has the snippet). The entries
 * hold the 2.2 data of `tests/fixtures/reserved-names-doc.mjs` (simple and
 * embedded-entry custom blocks under all five names).
 *
 * Checks, each byte for byte against the stored 2.2 data (every value and
 * string; object key order is the database's: PostgreSQL `jsonb` sorts keys): Content Manager
 * create and update (Document Service middleware), a version (create and
 * fetch), a live collaboration room (seeded from the stored draft, an
 * unrelated edit through Socket.IO, read back by a new client, and the
 * automatic version written when the last socket leaves), and Content API
 * output without `?mex` and with `?mex=json` (`?mex=html` renders the custom
 * block path).
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { call, tokenFor, createArticle, openSession, connect } from './helpers.mjs';
import { applyEditorDataToDoc, docToEditorData } from '../../shared/ydoc.mjs';
import { LEGACY_BLOCKS, legacyDocument } from '../fixtures/reserved-names-doc.mjs';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const ARTICLE = 'api::article.article';
const state = {};
const json = (value) => JSON.stringify(value);
/**
 * JSON text with object keys sorted. PostgreSQL stores JSON fields as `jsonb`,
 * which keeps every value but orders object keys itself (2.2 too), so the
 * comparison is byte for byte on every value and string, not on key order.
 * @param {unknown} value - Value.
 * @returns {string} Canonical JSON.
 */
const canonical = (value) =>
  JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.keys(item)
            .sort()
            .map((key) => [key, item[key]])
        )
      : item
  );
const LEGACY_IDS = new Set(LEGACY_BLOCKS.map((block) => block.id));
const legacyOf = (value) =>
  (value && Array.isArray(value.blocks) ? value.blocks : []).filter((block) => LEGACY_IDS.has(block.id));
/** The legacy blocks of a value, compared as canonical JSON text. */
const assertLegacyKept = (value, label) => {
  const expected = LEGACY_BLOCKS;
  const actual = legacyOf(value);
  assert.equal(actual.length, expected.length, `${label}: block count`);
  for (const [index, block] of expected.entries())
    assert.equal(canonical(actual[index]), canonical(block), `${label}: ${block.id}`);
};
const target = (documentId) => ({ uid: ARTICLE, documentId, locale: 'en', field: 'body' });
const send = (client, update) =>
  new Promise((resolve) =>
    client.socket
      .timeout(5000)
      .emit('mx:update', update, (error, reply) => resolve(error ? { timeout: true } : reply))
  );

before(async () => {
  const admin = await tokenFor('admin');
  const list = await call('GET', '/magic-editor-x/custom-blocks', { token: admin });
  assert.equal(list.status, 200);
  state.legacyBlock = (list.body.data || []).find((block) => block.name === 'toc');
  assert.ok(
    state.legacyBlock,
    'the host must be started with MEX_LEGACY_BLOCKS=true (Settings custom block "toc" written as in 2.2, see CONTRIBUTING.md)'
  );
  const token = await call('POST', '/admin/api-tokens', {
    token: admin,
    body: {
      name: `mex-reserved-${RUN}`,
      type: 'custom',
      lifespan: null,
      description: 'integration',
      permissions: [`${ARTICLE}.find`, `${ARTICLE}.findOne`],
    },
  });
  assert.equal(token.status, 201, json(token.body).slice(0, 300));
  state.apiToken = token.body.data.accessKey;
});

test('custom blocks: a 2.3 name is refused for new blocks, the legacy block keeps it on update', async () => {
  const admin = await tokenFor('admin');
  for (const name of ['toc', 'mention', 'gallery', 'synced']) {
    const created = await call('POST', '/magic-editor-x/custom-blocks', {
      token: admin,
      body: { name, label: 'X', blockType: 'simple' },
    });
    assert.equal(created.status, 400, name);
    assert.ok(created.body.error.details.fieldErrors.name, name);
  }
  const { id, createdAt: _c, updatedAt: _u, ...definition } = state.legacyBlock;
  const updated = await call('PUT', `/magic-editor-x/custom-blocks/${id}`, {
    token: admin,
    body: { ...definition, label: `Legacy contents box ${RUN}` },
  });
  assert.equal(updated.status, 200, json(updated.body).slice(0, 300));
  assert.equal(updated.body.data.name, 'toc');
  const renamed = await call('PUT', `/magic-editor-x/custom-blocks/${id}`, {
    token: admin,
    body: { ...definition, name: 'video' },
  });
  assert.equal(renamed.status, 400, 'another 2.3 name is still refused');
});

test('Content Manager save (Document Service) keeps legacy custom data byte for byte', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, { title: `Reserved ${RUN}`, body: legacyDocument() });
  state.documentId = article.documentId;
  assertLegacyKept(article.body, 'create response');
  const read = await call('GET', `/content-manager/collection-types/${ARTICLE}/${article.documentId}`, {
    token: editor,
  });
  assert.equal(read.status, 200);
  assertLegacyKept(read.body.data.body, 'stored draft');
  // Saving again (another field changed, the body as the editor sends it back) changes nothing.
  const updated = await call('PUT', `/content-manager/collection-types/${ARTICLE}/${article.documentId}`, {
    token: editor,
    body: { title: `Reserved ${RUN} v2`, body: read.body.data.body },
  });
  assert.equal(updated.status, 200, json(updated.body).slice(0, 300));
  assertLegacyKept(updated.body.data.body, 'update response');
  const published = await call(
    'POST',
    `/content-manager/collection-types/${ARTICLE}/${article.documentId}/actions/publish`,
    { token: await tokenFor('admin'), body: {} }
  );
  assert.equal(published.status, 200, json(published.body).slice(0, 300));
  assertLegacyKept(published.body.data.body, 'published');
});

test('a version stores and returns legacy custom data unchanged', async () => {
  const editor = await tokenFor('editor');
  const created = await call('POST', '/magic-editor-x/history', {
    token: editor,
    body: { ...target(state.documentId), content: legacyDocument(), label: `Legacy ${RUN}` },
  });
  assert.ok([200, 201].includes(created.status), json(created.body).slice(0, 300));
  const fetched = await call('GET', `/magic-editor-x/history/${created.body.data.id}`, { token: editor });
  assert.equal(fetched.status, 200);
  assertLegacyKept(fetched.body.data.content, 'version');
});

test('collaboration: an unrelated live edit leaves legacy custom data unchanged (room and version)', async () => {
  const editor = await tokenFor('editor');
  const a = await connect(await openSession(editor, target(state.documentId)));
  let late = null;
  try {
    assert.deepEqual(a.errors, []);
    assertLegacyKept(docToEditorData(a.ydoc), 'seeded room');
    // Edit only the paragraph after the legacy blocks.
    const edited = legacyDocument();
    edited.blocks[edited.blocks.length - 1].data.text = `After, edited live ${RUN}`;
    const before = Y.encodeStateVector(a.ydoc);
    applyEditorDataToDoc(a.ydoc, edited);
    const reply = await send(a, Y.encodeStateAsUpdate(a.ydoc, before));
    assert.equal(reply.ok, true, json(reply));
    late = await connect(await openSession(editor, target(state.documentId)));
    const room = docToEditorData(late.ydoc);
    assertLegacyKept(room, 'room read by a new client');
    assert.equal(room.blocks[room.blocks.length - 1].data.text, `After, edited live ${RUN}`);
  } finally {
    a.socket.disconnect();
    if (late) late.socket.disconnect();
  }
  // The last socket leaving writes an automatic version of the room.
  const query = new URLSearchParams(target(state.documentId));
  let auto = null;
  for (let attempt = 0; attempt < 50 && !auto; attempt += 1) {
    const list = await call('GET', `/magic-editor-x/history?${query}`, { token: editor });
    auto = (list.body.data || []).find((version) => version.trigger === 'auto') || null;
    if (!auto) await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.ok(auto, 'automatic version after the room emptied');
  const fetched = await call('GET', `/magic-editor-x/history/${auto.id}`, { token: editor });
  assertLegacyKept(fetched.body.data.content, 'automatic version');
  const content = fetched.body.data.content;
  assert.equal(content.blocks[content.blocks.length - 1].data.text, `After, edited live ${RUN}`);
});

test('Content API: stored data without ?mex, unchanged data with ?mex=json, custom rendering with ?mex=html', async () => {
  const get = (suffix) =>
    call('GET', `/api/articles/${state.documentId}${suffix}`, { token: state.apiToken });
  const plain = await get('');
  assert.equal(plain.status, 200, json(plain.body).slice(0, 300));
  assertLegacyKept(plain.body.data.body, 'Content API');
  const resolved = await get('?mex=json');
  assert.equal(resolved.status, 200);
  const blocks = legacyOf(resolved.body.data.body);
  assert.equal(blocks.length, LEGACY_BLOCKS.length);
  for (const [index, block] of LEGACY_BLOCKS.entries()) {
    if (block.data.entry) {
      // Embedded-entry custom blocks resolve like every embedded-entry block (here: no such entry).
      const { entry, ...rest } = blocks[index].data;
      const { entry: _stored, ...expected } = block.data;
      assert.equal(entry, null, block.id);
      assert.equal(canonical(rest), canonical(expected), block.id);
    } else assert.equal(canonical(blocks[index]), canonical(block), `?mex=json ${block.id}`);
  }
  const html = await get('?mex=html');
  assert.equal(html.status, 200);
  const rendered = html.body.data.body;
  assert.equal(typeof rendered, 'string');
  // Simple custom blocks render through the neutral custom block path.
  for (const type of ['gallery', 'audio', 'synced'])
    assert.match(rendered, new RegExp(`<div class="mex-block mex-${type}" data-mex-block="${type}">`));
  // `toc` and `video` also have embedded-entry data here, so (as for any embedded-entry type) the
  // entry renderer handles the type: an unresolved entry renders nothing. Never the built-in output.
  assert.doesNotMatch(rendered, /<nav|<video|<audio|<figure|id="mex-h-|mex-toc-/);
});
