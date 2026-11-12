import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { call, tokenFor, createArticle } from './helpers.mjs';
import { blockHash } from '../../shared/suggestions.mjs';

/**
 * Block suggestions (2.4) against a real host. Roles (see CONTRIBUTING.md and
 * the 2.4 suggest seed): `editor` (Editor role: reads and updates articles;
 * suggestions.create + suggestions.review), `reviewer` (reads articles, no
 * update right; suggestions.create), `reader` (reads articles; suggestions.review
 * but no update right), `author` (no plugin action), `admin` (Super Admin).
 */

const UID = 'api::article.article';
const CM = `/content-manager/collection-types/${UID}`;
const RUN = randomBytes(4).toString('hex');
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const qs = (params) => new URLSearchParams(params).toString();
const json = (value) => JSON.stringify(value).slice(0, 400);
const target = (documentId, field = 'body', extra = {}) => ({
  uid: UID,
  documentId,
  locale: 'en',
  field,
  ...extra,
});
const list = (token, t, status) =>
  call('GET', `/magic-editor-x/suggestions?${qs({ ...t, ...(status ? { status } : {}) })}`, { token });
const send = (token, t, suggestions, note) =>
  call('POST', '/magic-editor-x/suggestions', {
    token,
    body: { ...t, suggestions, ...(note ? { note } : {}) },
  });
const decide = (token, id, verb, body = {}) =>
  call('POST', `/magic-editor-x/suggestions/${id}/${verb}`, { token, body });

const BASE = [p('blk1', 'First paragraph'), p('blk2', 'Second paragraph'), p('blk3', 'Third paragraph')];

const state = {};

test('a reviewer without update rights suggests an edit, an insert and a delete', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const article = await createArticle(editor, { title: `Suggest ${RUN}`, body: doc(BASE) });
  state.id = article.documentId;
  const t = target(state.id);

  const created = await send(
    reviewer,
    t,
    [
      {
        op: 'update',
        blockId: 'blk1',
        baseHash: blockHash(BASE[0]),
        proposed: p('blk1', 'First paragraph, improved'),
      },
      {
        op: 'insert',
        blockId: 'newblk0001',
        afterBlockId: 'blk2',
        proposed: p('newblk0001', 'A new paragraph'),
      },
      { op: 'delete', blockId: 'blk3', baseHash: blockHash(BASE[2]) },
    ],
    'Three small changes'
  );
  assert.equal(created.status, 201, json(created.body));
  assert.deepEqual(created.body.meta, { created: 3, updated: 0 });
  assert.doesNotMatch(JSON.stringify(created.body), /authorId|decidedById/);
  state.ids = Object.fromEntries(created.body.data.map((item) => [item.op, item.id]));

  const reviewerView = await list(reviewer, t);
  assert.equal(reviewerView.status, 200);
  assert.equal(reviewerView.body.data.length, 3);
  assert.equal(reviewerView.body.meta.canCreate, true);
  assert.equal(reviewerView.body.meta.canReview, false);
  assert.ok(reviewerView.body.data.every((item) => item.author.own && item.author.name === 'Cora Prüfer'));
  assert.equal(reviewerView.body.data[0].note, 'Three small changes');

  const editorView = await list(editor, t);
  assert.equal(editorView.body.meta.canReview, true);
  assert.deepEqual(editorView.body.meta.counts, { open: 3, accepted: 0, rejected: 0 });
  assert.ok(editorView.body.data.every((item) => !item.author.own));

  // The entry itself did not change.
  const stored = await call('GET', `${CM}/${state.id}?locale=en`, { token: editor });
  assert.deepEqual(
    stored.body.data.body.blocks.map((block) => block.data.text),
    BASE.map((block) => block.data.text)
  );
  const config = await call('GET', '/magic-editor-x/config', { token: reviewer });
  assert.equal(config.body.data.suggestions.enabled, true);
  assert.equal(config.body.data.permissions.suggestionsCreate, true);
  assert.equal(config.body.data.permissions.suggestionsReview, false);
});

test('RBAC matrix: the reviewer cannot decide, a reader with review but no update cannot either', async () => {
  const reviewer = await tokenFor('reviewer');
  const reader = await tokenFor('reader');
  const author = await tokenFor('author');
  const t = target(state.id);
  assert.equal((await decide(reviewer, state.ids.update, 'accept')).status, 403, 'no suggestions.review');
  assert.equal((await decide(reviewer, state.ids.update, 'reject')).status, 403);
  const readerView = await list(reader, t);
  assert.equal(readerView.status, 200, 'review action lists');
  assert.equal(readerView.body.meta.canReview, false, 'no update right');
  assert.equal(readerView.body.meta.canCreate, false);
  assert.equal((await decide(reader, state.ids.update, 'accept')).status, 403, 'CM update missing');
  assert.equal(
    (await send(reader, t, [{ op: 'delete', blockId: 'blk1', baseHash: blockHash(BASE[0]) }])).status,
    403
  );
  assert.equal((await list(author, t)).status, 403);
  assert.equal((await call('GET', `/magic-editor-x/suggestions?${qs(t)}`)).status, 401);
  // Unknown document and unknown suggestion ids: 404.
  assert.equal((await list(reviewer, target('zzzzzzzzzzzzzzzzzzzzzzzz'))).status, 404);
  assert.equal((await decide(await tokenFor('editor'), 'zzzzzzzzzzzzzzzzzzzzzzzz', 'accept')).status, 404);
  // A field the reviewer cannot read (field permissions: title, body, sections only).
  assert.equal((await list(reviewer, target(state.id, 'summary'))).status, 404);
});

test('hostile proposed data is stored inert; preset rules are enforced; strict input', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const t = target(state.id);
  const hostile = await send(reviewer, t, [
    {
      op: 'insert',
      blockId: 'xssblk0001',
      afterBlockId: null,
      proposed: {
        type: 'paragraph',
        data: {
          text: 'ok <img src=x onerror="alert(1)"><a href="javascript:alert(2)">x</a><script>alert(3)</script>',
        },
      },
    },
    {
      op: 'insert',
      blockId: 'xssblk0002',
      afterBlockId: 'xssblk0001',
      proposed: { type: 'raw', data: { html: '<div onclick="steal()">raw</div><script>alert(4)</script>' } },
    },
  ]);
  assert.equal(hostile.status, 201, json(hostile.body));
  const all = JSON.stringify((await list(editor, t)).body);
  assert.doesNotMatch(all, /onerror|javascript:|<script|onclick/i);
  assert.match(all, /ok /);

  const summary = target(state.id, 'summary');
  const preset = await send(editor, summary, [
    {
      op: 'insert',
      blockId: 'codeblk001',
      afterBlockId: null,
      proposed: { type: 'code', data: { code: 'x' } },
    },
  ]);
  assert.equal(preset.status, 400, json(preset.body));
  assert.equal(preset.body.error.details.code, 'PRESET_VIOLATION');
  for (const body of [
    { ...t, suggestions: [{ op: 'update', blockId: 'blk1', proposed: p('blk1', 'x') }] },
    { ...t, suggestions: [{ op: 'delete', blockId: 'blk1', baseHash: 'zz' }] },
    { ...t, suggestions: [{ op: 'delete', blockId: 'blk1', baseHash: blockHash(BASE[0]), x: 1 }] },
    { ...t, extra: 1, suggestions: [{ op: 'delete', blockId: 'blk1', baseHash: blockHash(BASE[0]) }] },
  ]) {
    const response = await call('POST', '/magic-editor-x/suggestions', { token: reviewer, body });
    assert.equal(response.status, 400, json(body));
  }
  // Clean up the two inert inserts (withdraw own).
  for (const item of hostile.body.data)
    assert.equal(
      (await call('DELETE', `/magic-editor-x/suggestions/${item.id}`, { token: reviewer })).status,
      200
    );
});

test('the editor accepts one, rejects one; decisions happen once; only authors withdraw', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const accepted = await decide(editor, state.ids.update, 'accept');
  assert.equal(accepted.status, 200, json(accepted.body));
  assert.equal(accepted.body.data.status, 'accepted');
  assert.equal(accepted.body.data.decidedBy.name, 'Anna Beispiel');
  assert.equal(accepted.body.data.proposed.data.text, 'First paragraph, improved');
  const again = await decide(editor, state.ids.update, 'reject');
  assert.equal(again.status, 409);
  assert.equal(again.body.error.details.code, 'ALREADY_DECIDED');
  assert.equal((await decide(editor, state.ids.delete, 'reject')).body.data.status, 'rejected');
  assert.equal(
    (await call('DELETE', `/magic-editor-x/suggestions/${state.ids.insert}`, { token: editor })).status,
    403
  );
  assert.equal(
    (await call('DELETE', `/magic-editor-x/suggestions/${state.ids.update}`, { token: reviewer })).status,
    409
  );
  const counts = (await list(editor, target(state.id), 'all')).body.meta.counts;
  assert.deepEqual(counts, { open: 1, accepted: 1, rejected: 1 });
  // Accepting does not write the entry: the editor applies the block and saves as usual.
  const stored = await call('GET', `${CM}/${state.id}?locale=en`, { token: editor });
  assert.equal(stored.body.data.body.blocks[0].data.text, 'First paragraph');
});

test('an outdated suggestion can still be accepted; the audit trail has ids and counts only', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const admin = await tokenFor('admin');
  const t = target(state.id);
  const made = await send(reviewer, t, [
    { op: 'update', blockId: 'blk2', baseHash: blockHash(BASE[1]), proposed: p('blk2', 'Second, suggested') },
  ]);
  assert.equal(made.status, 201);
  // Meanwhile the editor changes the block and saves.
  const saved = await call('PUT', `${CM}/${state.id}?locale=en`, {
    token: editor,
    body: { body: doc([BASE[0], p('blk2', 'Second paragraph, edited by Anna'), BASE[2]]) },
  });
  assert.equal(saved.status, 200, json(saved.body));
  const current = saved.body.data.body.blocks[1];
  assert.notEqual(blockHash(current), made.body.data[0].baseHash, 'the block changed since: outdated');
  const accepted = await decide(editor, made.body.data[0].id, 'accept', { outdated: true });
  assert.equal(accepted.status, 200);
  const audit = await call(
    'GET',
    `/magic-editor-x/audit?${qs({ uid: UID, documentId: state.id, locale: 'en', field: 'body', pageSize: 50 })}`,
    { token: admin }
  );
  assert.equal(audit.status, 200, json(audit.body));
  const events = audit.body.data.filter((event) => event.event.startsWith('suggestion.'));
  const names = events.map((event) => event.event);
  for (const name of ['suggestion.create', 'suggestion.accept', 'suggestion.reject', 'suggestion.withdraw'])
    assert.ok(names.includes(name), `${name} recorded`);
  const outdated = events.find(
    (event) => event.event === 'suggestion.accept' && event.counts && event.counts.outdated === 1
  );
  assert.ok(outdated, 'outdated accept counted');
  assert.deepEqual(outdated.blockIds, ['blk2']);
  assert.doesNotMatch(JSON.stringify(events), /suggested|improved|Three small/);
});

test('fields in repeatable components are keyed by their identity, not by position', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const article = await createArticle(editor, {
    title: `Suggest sections ${RUN}`,
    sections: [
      { heading: 'A', body: doc([p('secaaaaaaa', 'Entry A')]) },
      { heading: 'B', body: doc([p('secbbbbbbb', 'Entry B')]) },
    ],
  });
  const draft = (await call('GET', `${CM}/${article.documentId}?locale=en`, { token: editor })).body.data;
  const keyA = draft.sections[0].body.fieldKey;
  const keyB = draft.sections[1].body.fieldKey;
  const onA = target(article.documentId, 'sections.0.body', { fieldKey: keyA });
  const made = await send(reviewer, onA, [
    {
      op: 'update',
      blockId: 'secaaaaaaa',
      baseHash: blockHash(p('secaaaaaaa', 'Entry A')),
      proposed: p('secaaaaaaa', 'Entry A+'),
    },
  ]);
  assert.equal(made.status, 201, json(made.body));
  // Reorder: A is now at index 1.
  const reordered = await call('PUT', `${CM}/${article.documentId}?locale=en`, {
    token: editor,
    body: {
      sections: [
        { id: draft.sections[1].id, heading: 'B', body: draft.sections[1].body },
        { id: draft.sections[0].id, heading: 'A', body: draft.sections[0].body },
      ],
    },
  });
  assert.equal(reordered.status, 200, json(reordered.body));
  const atOne = await list(editor, target(article.documentId, 'sections.1.body', { fieldKey: keyA }));
  assert.equal(atOne.status, 200);
  assert.equal(atOne.body.data.length, 1, 'follows entry A');
  assert.equal(atOne.body.meta.fieldKey, keyA);
  const byPosition = await list(editor, target(article.documentId, 'sections.1.body'));
  assert.equal(byPosition.body.data.length, 1, 'index 1 resolves to A by its stored key');
  const onB = await list(editor, target(article.documentId, 'sections.0.body', { fieldKey: keyB }));
  assert.equal(onB.body.data.length, 0, 'B has none');
  assert.equal((await decide(editor, made.body.data[0].id, 'accept')).status, 200);
  // A key of another document answers 404.
  assert.equal((await list(editor, target(state.id, 'sections.0.body', { fieldKey: keyA }))).status, 404);
});

test('deleting one locale keeps the suggestions of the other locale', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const article = await createArticle(editor, { title: `Suggest delete ${RUN}`, body: doc(BASE) });
  const de = await call('PUT', `${CM}/${article.documentId}?locale=de`, {
    token: editor,
    body: { title: `Vorschlag ${RUN}`, body: doc(BASE) },
  });
  assert.equal(de.status, 200, json(de.body));
  const item = [{ op: 'delete', blockId: 'blk1', baseHash: blockHash(BASE[0]) }];
  assert.equal((await send(reviewer, target(article.documentId), item)).status, 201);
  const madeDe = await send(reviewer, target(article.documentId, 'body', { locale: 'de' }), item);
  assert.equal(madeDe.status, 201);
  state.deleted = { documentId: article.documentId, id: madeDe.body.data[0].id };
  // The Editor role of the host has no delete permission; the Super Admin deletes.
  const removed = await call('DELETE', `${CM}/${article.documentId}?locale=de`, {
    token: await tokenFor('admin'),
  });
  assert.equal(removed.status, 200, json(removed.body));
  assert.equal(
    (await list(editor, target(article.documentId))).body.data.length,
    1,
    'en keeps its suggestion'
  );
  // The de row is gone (verified on the database by the acceptance script); the id answers 404.
  assert.equal((await decide(editor, madeDe.body.data[0].id, 'accept')).status, 404);
});

test('rate limit per admin: suggestions.perMinute requests', async () => {
  const admin = await tokenFor('admin');
  const article = await createArticle(admin, { title: `Suggest rate ${RUN}`, body: doc(BASE) });
  const t = target(article.documentId);
  // The counter is shared and per minute: a run started within a minute of the last one starts higher.
  let limited = 0;
  let stored = 0;
  for (let i = 0; i < 22; i += 1) {
    const response = await send(admin, t, [
      { op: 'update', blockId: 'blk1', baseHash: blockHash(BASE[0]), proposed: p('blk1', `Try ${i}`) },
    ]);
    if (response.status === 429) limited += 1;
    else {
      assert.equal(response.status, 201, json(response.body));
      stored += 1;
    }
  }
  assert.ok(limited >= 2 && stored <= 20, `at most 20 requests a minute (${stored} stored)`);
  // Sending again replaced the admin's own open suggestion each time.
  assert.equal((await list(admin, t)).body.data.length, stored ? 1 : 0);
});
