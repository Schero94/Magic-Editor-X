import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { call, tokenFor, createArticle, openSession, connect } from './helpers.mjs';

/**
 * Stable identity of editor fields inside repeatable components and dynamic
 * zones (2.4). Versions, comments, live rooms and link reports are keyed by
 * the value's `fieldKey`, so they follow their entry when entries are
 * reordered, removed or inserted, and survive publish and discard draft.
 *
 * Host fields (see CONTRIBUTING.md): `sections` (repeatable `blocks.text-section`
 * with `heading` and `body`), `groups` (repeatable `blocks.group` with a
 * repeatable `items` of `blocks.text-section`), `zone` (dynamic zone with
 * `blocks.text-section`, `blocks.quote-card` (`caption`, `body`) and `blocks.group`).
 */

const UID = 'api::article.article';
const CM = `/content-manager/collection-types/${UID}`;
const RUN = randomBytes(4).toString('hex');
const KEY = /^[A-Za-z0-9_-]{16,32}$/;
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const json = (value) => JSON.stringify(value).slice(0, 300);
const qs = (params) => new URLSearchParams(params).toString();

/** Draft of an article through the Content Manager. */
const readDraft = async (token, documentId, locale = 'en', status) => {
  const response = await call('GET', `${CM}/${documentId}?${qs({ locale, ...(status ? { status } : {}) })}`, {
    token,
  });
  assert.equal(response.status, 200, json(response.body));
  return response.body.data;
};

/** Saves an article through the Content Manager (like the edit view). */
const saveDraft = async (token, documentId, data, locale = 'en') => {
  const response = await call('PUT', `${CM}/${documentId}?${qs({ locale })}`, { token, body: data });
  assert.equal(response.status, 200, json(response.body));
  return response.body.data;
};

/** Component entry as the edit view sends it back. */
const entry = ({ id, heading, body }) => ({ id, heading, body });

const target = (documentId, field, fieldKey, locale = 'en') => ({
  uid: UID,
  documentId,
  locale,
  field,
  ...(fieldKey ? { fieldKey } : {}),
});

const versions = async (token, t) => {
  const response = await call('GET', `/magic-editor-x/history?${qs(t)}`, { token });
  return response;
};
const comments = async (token, t) => call('GET', `/magic-editor-x/comments?${qs(t)}`, { token });

const state = {};

test('saving gives every positional value a key; top level and null values stay as they were', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, {
    title: `Identity ${RUN}`,
    body: doc([p('topblock01', 'Top level')]),
    sections: [
      { heading: 'A', body: doc([p('secaaaaaaa', 'Entry A')]) },
      { heading: 'B', body: doc([p('secbbbbbbb', 'Entry B')]) },
      { heading: 'Empty', body: null },
    ],
    groups: [{ title: 'G', items: [{ heading: 'Nested', body: doc([p('nestedgggg', 'Nested')]) }] }],
    zone: [
      { __component: 'blocks.quote-card', caption: 'Q', body: doc([p('quoteqqqqq', 'Quote')]) },
      { __component: 'blocks.text-section', heading: 'Z', body: doc([p('zonezzzzzz', 'Zone')]) },
    ],
  });
  const draft = await readDraft(editor, article.documentId);
  assert.equal('fieldKey' in draft.body, false, 'top-level values carry no key');
  assert.match(draft.sections[0].body.fieldKey, KEY);
  assert.match(draft.sections[1].body.fieldKey, KEY);
  assert.notEqual(draft.sections[0].body.fieldKey, draft.sections[1].body.fieldKey);
  assert.equal(draft.sections[2].body, null, 'an empty value stays null');
  assert.match(draft.groups[0].items[0].body.fieldKey, KEY, 'component in component');
  assert.match(draft.zone[0].body.fieldKey, KEY, 'dynamic zone, quote card');
  assert.match(draft.zone[1].body.fieldKey, KEY, 'dynamic zone, text section');
  state.id = article.documentId;
  state.keys = { A: draft.sections[0].body.fieldKey, B: draft.sections[1].body.fieldKey };
  state.zoneKeys = { Q: draft.zone[0].body.fieldKey, Z: draft.zone[1].body.fieldKey };
  state.draft = draft;
});

test('versions and comments follow their entry through reorder, delete and insert', async () => {
  const editor = await tokenFor('editor');
  const { id, keys } = state;
  // A version and a comment on each entry, addressed by key.
  for (const [name, index] of [
    ['A', 0],
    ['B', 1],
  ]) {
    const t = target(id, `sections.${index}.body`, keys[name]);
    const version = await call('POST', '/magic-editor-x/history', {
      token: editor,
      body: { ...t, content: doc([p(`sec${name.toLowerCase().repeat(7)}`, `Version of ${name}`)]) },
    });
    assert.equal(version.status, 201, json(version.body));
    const comment = await call('POST', '/magic-editor-x/comments', {
      token: editor,
      body: { ...t, blockId: `sec${name.toLowerCase().repeat(7)}`, body: `Comment on ${name}` },
    });
    assert.equal(comment.status, 201, json(comment.body));
  }
  // Without a key the server resolves the stored entry at that index.
  const atZero = await versions(editor, target(id, 'sections.0.body'));
  assert.equal(atZero.status, 200);
  assert.equal(atZero.body.meta.fieldKey, keys.A);

  // Reorder: B, A, empty.
  let draft = await saveDraft(editor, id, {
    sections: [
      entry(state.draft.sections[1]),
      entry(state.draft.sections[0]),
      entry(state.draft.sections[2]),
    ],
  });
  assert.equal(draft.sections[0].body.fieldKey, keys.B);
  assert.equal(draft.sections[1].body.fieldKey, keys.A);
  const first = await versions(editor, target(id, 'sections.0.body'));
  assert.equal(first.body.data.length, 1);
  assert.equal(first.body.meta.fieldKey, keys.B, 'index 0 is now B');
  const firstComments = await comments(editor, target(id, 'sections.0.body'));
  assert.deepEqual(
    firstComments.body.data.map((thread) => thread.comments[0].body),
    ['Comment on B'],
    'no foreign comments under a positional path'
  );
  const byKey = await versions(editor, target(id, 'sections.0.body', keys.A));
  assert.equal(byKey.status, 200, 'a key is found at any index');
  assert.equal(byKey.body.data.length, 1);
  const preview = await call('GET', `/magic-editor-x/history/${byKey.body.data[0].id}`, { token: editor });
  assert.equal(preview.body.data.content.blocks[0].data.text, 'Version of A');

  // Delete A: its rows are no longer served; B keeps its own.
  draft = await saveDraft(editor, id, { sections: [entry(draft.sections[0]), entry(draft.sections[2])] });
  assert.equal((await versions(editor, target(id, 'sections.0.body', keys.A))).status, 404);
  assert.equal((await comments(editor, target(id, 'sections.0.body', keys.A))).status, 404);
  const afterDelete = await versions(editor, target(id, 'sections.0.body'));
  assert.equal(afterDelete.body.meta.fieldKey, keys.B);
  assert.equal(afterDelete.body.data.length, 1);

  // Insert before B: the new entry gets its own key and no rows.
  draft = await saveDraft(editor, id, {
    sections: [
      { heading: 'New', body: doc([p('secnnnnnnn', 'New entry')]) },
      entry(draft.sections[0]),
      entry(draft.sections[1]),
    ],
  });
  assert.match(draft.sections[0].body.fieldKey, KEY);
  assert.ok(![keys.A, keys.B].includes(draft.sections[0].body.fieldKey));
  const inserted = await versions(editor, target(id, 'sections.0.body'));
  assert.equal(inserted.body.data.length, 0, 'the new entry has no versions');
  const moved = await versions(editor, target(id, 'sections.1.body'));
  assert.equal(moved.body.meta.fieldKey, keys.B);
  assert.equal(moved.body.data.length, 1);
  state.draft = draft;
});

test('dynamic zone entries of different component types keep their own rows', async () => {
  const editor = await tokenFor('editor');
  const { id, zoneKeys } = state;
  const created = await call('POST', '/magic-editor-x/history', {
    token: editor,
    body: { ...target(id, 'zone.0.body', zoneKeys.Q), content: doc([p('quoteqqqqq', 'Quote v1')]) },
  });
  assert.equal(created.status, 201);
  const draft = await readDraft(editor, id);
  await saveDraft(editor, id, {
    zone: [
      { id: draft.zone[1].id, __component: 'blocks.text-section', heading: 'Z', body: draft.zone[1].body },
      { id: draft.zone[0].id, __component: 'blocks.quote-card', caption: 'Q', body: draft.zone[0].body },
    ],
  });
  const zero = await versions(editor, target(id, 'zone.0.body'));
  assert.equal(zero.body.meta.fieldKey, zoneKeys.Z);
  assert.equal(zero.body.data.length, 0);
  const one = await versions(editor, target(id, 'zone.1.body'));
  assert.equal(one.body.meta.fieldKey, zoneKeys.Q);
  assert.equal(one.body.data.length, 1);
});

test('publish and discard draft keep the identity', async () => {
  const admin = await tokenFor('admin');
  const editor = await tokenFor('editor');
  const { id, keys } = state;
  const published = await call('POST', `${CM}/${id}/actions/publish?locale=en`, { token: admin, body: {} });
  assert.equal(published.status, 200, json(published.body));
  const live = await readDraft(admin, id, 'en', 'published');
  const draft = await readDraft(admin, id);
  assert.deepEqual(
    live.sections.map((item) => item.body && item.body.fieldKey),
    draft.sections.map((item) => item.body && item.body.fieldKey),
    'the published version carries the same keys'
  );
  // Change the draft (reorder), then discard it: the keys come back from the published version.
  await saveDraft(editor, id, { sections: [entry(draft.sections[1]), entry(draft.sections[0])] });
  const discarded = await call('POST', `${CM}/${id}/actions/discard?locale=en`, { token: admin, body: {} });
  assert.equal(discarded.status, 200, json(discarded.body));
  const restored = await readDraft(admin, id);
  assert.notEqual(restored.sections[1].id, draft.sections[1].id, 'discarding clones the component rows');
  assert.equal(restored.sections[1].body.fieldKey, keys.B);
  const b = await versions(editor, target(id, 'sections.1.body'));
  assert.equal(b.body.meta.fieldKey, keys.B);
  assert.equal(b.body.data.length, 1, 'versions still follow the entry');
});

test('Document Service writes without keys keep them by component row; other locales and clones are separate', async () => {
  const admin = await tokenFor('admin');
  const editor = await tokenFor('editor');
  const { id, keys } = state;
  // A Content API client that drops unknown keys (REST update through the Document Service).
  const tokenResponse = await call('POST', '/admin/api-tokens', {
    token: admin,
    body: { name: `mex-ids-${RUN}`, type: 'full-access', lifespan: null, description: 'integration' },
  });
  assert.equal(tokenResponse.status, 201, json(tokenResponse.body));
  const apiKey = tokenResponse.body.data.accessKey;
  const before = await readDraft(admin, id);
  const strip = (value) => {
    const copy = { ...value };
    delete copy.fieldKey;
    return copy;
  };
  const put = await call('PUT', `/api/articles/${id}?status=draft&locale=en`, {
    token: apiKey,
    body: {
      data: {
        sections: [...before.sections].reverse().map((item) => ({
          id: item.id,
          heading: item.heading,
          body: item.body && strip(item.body),
        })),
      },
    },
  });
  assert.equal(put.status, 200, json(put.body));
  const after = await readDraft(admin, id);
  assert.deepEqual(
    after.sections.map((item) => item.body && item.body.fieldKey),
    [...before.sections].reverse().map((item) => item.body && item.body.fieldKey),
    'every entry keeps its key'
  );
  // Content API output keeps the key as an additive top-level key of the value.
  const output = await call('GET', `/api/articles/${id}?status=draft&locale=en&populate=sections`, {
    token: apiKey,
  });
  assert.equal(output.status, 200, json(output.body));
  assert.ok(output.body.data.sections.some((item) => item.body && item.body.fieldKey === keys.B));

  // "Fill in from another locale" copies the values with their keys into a new locale.
  const de = await call('PUT', `${CM}/${id}?locale=de`, {
    token: admin,
    body: {
      title: `Identität ${RUN}`,
      sections: after.sections.map((item) => ({ heading: item.heading, body: item.body })),
    },
  });
  assert.equal(de.status, 200, json(de.body));
  const deDraft = await readDraft(admin, id, 'de');
  const deKey = deDraft.sections.find((item) => item.body && item.body.fieldKey === keys.B);
  assert.ok(deKey, 'the locale copy keeps the key');
  // The admin reads `de` (the seeded editor role was created before the locale existed).
  const deVersions = await versions(admin, target(id, 'sections.0.body', keys.B, 'de'));
  assert.equal(deVersions.status, 200);
  assert.equal(deVersions.body.data.length, 0, 'versions of another locale are not shown');

  // Duplicating the document keeps the keys, but rows belong to the original document.
  const clone = await call('POST', `${CM}/clone/${id}?locale=en`, {
    token: admin,
    body: { title: `Identity copy ${RUN}` },
  });
  assert.equal(clone.status, 200, json(clone.body));
  const cloneId = clone.body.data.documentId;
  const cloneVersions = await versions(editor, target(cloneId, 'sections.0.body', keys.B));
  assert.equal(cloneVersions.status, 200);
  assert.equal(cloneVersions.body.data.length, 0);
});

test('live rooms are keyed by the entry; unsaved keys only for editors; validation', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const { id, keys } = state;
  const draft = await readDraft(editor, id);
  const indexOfB = draft.sections.findIndex((item) => item.body && item.body.fieldKey === keys.B);
  const byKey = await openSession(editor, target(id, 'sections.0.body', keys.B));
  const byIndex = await openSession(editor, target(id, `sections.${indexOfB}.body`));
  const one = await connect(byKey);
  const two = await connect(byIndex);
  try {
    assert.deepEqual(one.errors, []);
    assert.deepEqual(two.errors, []);
    const text = (client) => JSON.stringify(client.ydoc.getMap('blocks').toJSON());
    assert.equal(text(one), text(two), 'the same room by key and by index');
    assert.match(text(one), /Entry B/);
  } finally {
    one.socket.close();
    two.socket.close();
  }
  // A key that is not saved yet: editors get a private room seeded from their value; readers 404.
  const fresh = 'UnsavedKeyUnsavedKey01';
  const session = await call('POST', '/magic-editor-x/collaboration/session', {
    token: editor,
    body: { ...target(id, 'sections.0.body', fresh), initialValue: doc([p('unsaved001', 'Draft')]) },
  });
  assert.equal(session.status, 200, json(session.body));
  const denied = await call('POST', '/magic-editor-x/collaboration/session', {
    token: reviewer,
    body: target(id, 'sections.0.body', fresh),
  });
  assert.equal(denied.status, 404);
  // History and comments never accept an unsaved key.
  assert.equal((await versions(editor, target(id, 'sections.0.body', fresh))).status, 404);
  // Validation: invalid keys 400, keys on top-level fields 404.
  assert.equal((await versions(editor, target(id, 'sections.0.body', 'bad key'))).status, 400);
  assert.equal((await versions(editor, target(id, 'body', keys.B))).status, 404);
  const report = await call(
    'GET',
    `/magic-editor-x/quality/link-report?${qs(target(id, 'sections.0.body', keys.B))}`,
    {
      token: editor,
    }
  );
  assert.equal(report.status, 200);
});
