import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { call, tokenFor, createArticle } from './helpers.mjs';
import { REUSE_LIMITS } from '../../shared/reuse.mjs';

/**
 * "Use existing content" (2.5) against a real host: `GET /reuse/types` and
 * `GET /reuse/source` with Content Manager read on the type, the document
 * locale and each field. Roles of the acceptance seed (CONTRIBUTING.md):
 * `editor` (Editor role; Content Manager actions on articles for the locales
 * that existed when Strapi created the role, `en`), `reviewer` (reads
 * articles in `en` and `de`, fields title, body, sections.heading,
 * sections.body; plugin access), `outsider` (reads only the homepage),
 * `author` (no plugin action), `reader` (reads articles; used for the rate
 * limit at the end because it spends the minute's budget).
 */

const UID = 'api::article.article';
const CM = `/content-manager/collection-types/${UID}`;
const RUN = randomBytes(4).toString('hex');
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text, extra = {}) => ({ id, type: 'paragraph', data: { text }, ...extra });
const qs = (params) => new URLSearchParams(params).toString();
const json = (value) => JSON.stringify(value).slice(0, 400);
const source = (token, params) =>
  call('GET', `/magic-editor-x/reuse/source?${qs({ uid: UID, ...params })}`, { token });
const state = {};

test('setup: an article in en and de with a hidden field, a section and unsafe markup', async () => {
  const admin = await tokenFor('admin');
  const article = await createArticle(
    admin,
    {
      title: `Reuse source ${RUN}`,
      body: doc([
        p('rs1', 'Hello <b>bold</b><img src=x onerror=alert(1)><script>alert(1)</script>', {
          tunes: { alignmentTune: { alignment: 'center' } },
        }),
        { id: 'rs2', type: 'header', data: { text: 'Heading', level: 2 } },
        { id: 'rs3', type: 'calloutCard', data: { title: 'Callout', body: 'Text', tone: 'info' } },
      ]),
      summary: doc([p('sum1', 'Hidden summary for reviewers')]),
      sections: [{ heading: 'One', body: doc([p('sec1', 'Section text')]) }],
    },
    'en'
  );
  state.id = article.documentId;
  const german = await call('PUT', `${CM}/${state.id}?locale=de`, {
    token: admin,
    body: { title: `Reuse Quelle ${RUN}`, body: doc([p('de1', 'Hallo')]) },
  });
  assert.equal(german.status, 200, json(german.body));
  const roles = (await call('GET', '/admin/roles', { token: admin })).body.data;
  const editorRole = roles.find((role) => role.code === 'strapi-editor');
  const permissions = (await call('GET', `/admin/roles/${editorRole.id}/permissions`, { token: admin })).body
    .data;
  const read = permissions.find(
    (entry) => entry.action === 'plugin::content-manager.explorer.read' && entry.subject === UID
  );
  state.editorLocales = read && read.properties ? read.properties.locales : null;
  // Precondition of the locale deny case: Strapi created the Editor role before the seed added `de`.
  assert.ok(
    Array.isArray(state.editorLocales) &&
      state.editorLocales.includes('en') &&
      !state.editorLocales.includes('de'),
    `Editor role locales: ${json(state.editorLocales)}`
  );
});

test('GET /reuse/types: types with readable editor fields and the readable locales', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const outsider = await tokenFor('outsider');
  const ofEditor = await call('GET', '/magic-editor-x/reuse/types', { token: editor });
  assert.equal(ofEditor.status, 200, json(ofEditor.body));
  const article = ofEditor.body.data.find((type) => type.uid === UID);
  assert.ok(article, 'articles listed for the editor');
  assert.equal(article.localized, true);
  assert.ok(article.locales.some((locale) => locale.code === 'en'));
  assert.ok(
    !article.locales.some((locale) => locale.code === 'de'),
    'no German without the locale permission'
  );
  const ofReviewer = (await call('GET', '/magic-editor-x/reuse/types', { token: reviewer })).body.data;
  assert.deepEqual(
    ofReviewer
      .find((type) => type.uid === UID)
      .locales.map((locale) => locale.code)
      .sort(),
    ['de', 'en']
  );
  const ofOutsider = (await call('GET', '/magic-editor-x/reuse/types', { token: outsider })).body.data;
  assert.ok(!ofOutsider.some((type) => type.uid === UID), 'the outsider cannot read articles');
  assert.ok(ofOutsider.every((type) => type.uid.startsWith('api::')));
  assert.equal((await call('GET', '/magic-editor-x/reuse/types?x=1', { token: editor })).status, 400);
  assert.equal((await call('GET', '/magic-editor-x/reuse/types')).status, 401);
  assert.equal(
    (await call('GET', '/magic-editor-x/reuse/types', { token: await tokenFor('author') })).status,
    403
  );
});

test('GET /reuse/source: fields with blocks cleaned like a save, ids, tunes, positional identity', async () => {
  const editor = await tokenFor('editor');
  const response = await source(editor, { documentId: state.id, locale: 'en' });
  assert.equal(response.status, 200, json(response.body));
  const data = response.body.data;
  assert.equal(data.title, `Reuse source ${RUN}`);
  assert.equal(data.status, 'draft');
  assert.equal(data.hasPublished, false);
  assert.equal(data.locale, 'en');
  assert.equal(data.limited, false);
  const fields = Object.fromEntries(data.fields.map((field) => [field.field, field]));
  assert.deepEqual(Object.keys(fields), ['body', 'summary', 'sections.0.body']);
  const body = fields.body;
  assert.equal(body.preset, 'full');
  assert.equal(body.blockCount, 3);
  assert.deepEqual(
    body.blocks.map((block) => block.id),
    ['rs1', 'rs2', 'rs3']
  );
  assert.doesNotMatch(body.blocks[0].data.text, /script|onerror/);
  assert.match(body.blocks[0].data.text, /<b>bold<\/b>/);
  assert.deepEqual(body.blocks[0].tunes, { alignmentTune: { alignment: 'center' } });
  // Cleaned with the code block's schema, exactly as a save stores it.
  assert.deepEqual(body.blocks[2].data, { title: 'Callout', body: 'Text', link: '', tone: 'info' });
  assert.equal(fields.summary.preset, 'basic');
  assert.match(fields['sections.0.body'].fieldKey, /^[A-Za-z0-9_-]{16,32}$/);
  const one = await source(editor, { documentId: state.id, locale: 'en', field: 'sections.0.body' });
  assert.equal(one.status, 200);
  assert.deepEqual(
    one.body.data.fields.map((field) => field.field),
    ['sections.0.body']
  );
});

test('GET /reuse/source: deny cases answer 404 (type, document, locale, field, outsider) and 400 for bad input', async () => {
  const editor = await tokenFor('editor');
  const reviewer = await tokenFor('reviewer');
  const outsider = await tokenFor('outsider');
  // Field-level permission: the reviewer cannot read `summary`.
  const ofReviewer = await source(reviewer, { documentId: state.id, locale: 'en' });
  assert.equal(ofReviewer.status, 200);
  assert.deepEqual(
    ofReviewer.body.data.fields.map((field) => field.field),
    ['body', 'sections.0.body']
  );
  assert.doesNotMatch(JSON.stringify(ofReviewer.body), /Hidden summary/);
  assert.equal(
    (await source(reviewer, { documentId: state.id, locale: 'en', field: 'summary' })).status,
    404
  );
  // Other locale: readable for the reviewer.
  const german = await source(reviewer, { documentId: state.id, locale: 'de' });
  assert.equal(german.status, 200);
  assert.equal(german.body.data.fields[0].blocks[0].data.text, 'Hallo');
  // Other locale without the locale permission (the Editor role was made before `de` existed).
  assert.equal((await source(editor, { documentId: state.id, locale: 'de' })).status, 404);
  // No Content Manager read on the type.
  assert.equal((await source(outsider, { documentId: state.id, locale: 'en' })).status, 404);
  // No plugin access at all.
  assert.equal((await source(await tokenFor('author'), { documentId: state.id, locale: 'en' })).status, 403);
  // Missing document, missing locale version, field that is not an editor field, empty positional entry.
  assert.equal((await source(editor, { documentId: 'doesnotexist0000', locale: 'en' })).status, 404);
  assert.equal((await source(editor, { documentId: state.id, locale: 'fr' })).status, 404);
  assert.equal((await source(editor, { documentId: state.id, locale: 'en', field: 'title' })).status, 404);
  assert.equal(
    (await source(editor, { documentId: state.id, locale: 'en', field: 'sections.5.body' })).status,
    404
  );
  // Strict input.
  for (const params of [
    { documentId: state.id, extra: '1' },
    { documentId: 'Not Valid' },
    { documentId: state.id, field: '../body' },
    { documentId: state.id, locale: 'en_US!' },
  ])
    assert.equal((await source(editor, params)).status, 400, JSON.stringify(params));
  assert.equal(
    (
      await call(
        'GET',
        `/magic-editor-x/reuse/source?${qs({ uid: 'plugin::users-permissions.user', documentId: state.id })}`,
        { token: editor }
      )
    ).status,
    400
  );
  assert.equal(
    (await call('GET', `/magic-editor-x/reuse/source?${qs({ uid: UID, documentId: state.id })}`)).status,
    401
  );
});

test('GET /reuse/source: the draft is the source; the published version is only reported', async () => {
  const admin = await tokenFor('admin');
  const published = await call('POST', `${CM}/${state.id}/actions/publish?locale=en`, {
    token: admin,
    body: {},
  });
  assert.equal(published.status, 200, json(published.body));
  const changed = await call('PUT', `${CM}/${state.id}?locale=en`, {
    token: admin,
    body: { body: doc([p('rs9', 'Changed after publishing')]) },
  });
  assert.equal(changed.status, 200, json(changed.body));
  const response = await source(await tokenFor('editor'), {
    documentId: state.id,
    locale: 'en',
    field: 'body',
  });
  assert.equal(response.body.data.hasPublished, true);
  assert.equal(response.body.data.fields[0].blocks[0].data.text, 'Changed after publishing');
});

test('GET /reuse/source: long fields are cut to the preview limit', async () => {
  const admin = await tokenFor('admin');
  const many = Array.from({ length: REUSE_LIMITS.blocksPerField + 30 }, (_, i) =>
    p(`many${i}`, `Block ${i}`)
  );
  const article = await createArticle(admin, { title: `Reuse long ${RUN}`, body: doc(many) }, 'en');
  const response = await source(admin, { documentId: article.documentId, locale: 'en', field: 'body' });
  assert.equal(response.status, 200);
  const [field] = response.body.data.fields;
  assert.equal(field.blocks.length, REUSE_LIMITS.blocksPerField);
  assert.equal(field.blockCount, REUSE_LIMITS.blocksPerField + 30);
  assert.equal(field.truncated, true);
});

test('GET /config reports the switch; the routes are rate limited per admin', async () => {
  const reader = await tokenFor('reader');
  const config = await call('GET', '/magic-editor-x/config', { token: reader });
  assert.deepEqual(config.body.data.reuse, { enabled: true });
  const limit = Number(process.env.MEX_REUSE_PER_MINUTE || 60);
  let status = 200;
  for (let i = 0; i <= 2 * limit + 2 && status !== 429; i += 1)
    status = (await call('GET', '/magic-editor-x/reuse/types', { token: reader })).status;
  assert.equal(status, 429);
});
