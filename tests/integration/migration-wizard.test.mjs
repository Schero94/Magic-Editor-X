/**
 * 2.13 migration wizard against a running Strapi host (see CONTRIBUTING.md: `api::article.article`
 * with `legacy` (Blocks), `notes` (Markdown), `htmlBody` (text), `migrated` and `simpleBody`
 * (Magic Editor X), locales en and de; admins `migrator` (only `migrate.run`, `access` and
 * Content Manager rights on German articles) and `writer` (articles in every locale, no
 * `migrate.run`)). Covers RBAC (401/403), the dry run, the backup, a full run over every locale,
 * drafts only (the published version stays), other fields untouched, the one-run-per-field lock,
 * a role limited to one locale, "Before migration" versions and the audit trail.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor } from './helpers.mjs';

const UID = 'api::article.article';
const RUN = Date.now().toString(36);
const CM = `/content-manager/collection-types/${UID}`;
const blocks = (text) => [{ type: 'paragraph', children: [{ type: 'text', text }] }];
const editorValue = (text) => ({
  time: 1,
  version: '2.31.7',
  blocks: [{ id: `k${RUN}`, type: 'paragraph', data: { text } }],
});

/**
 * Creates an article in English and German (one document, two locales).
 * @param {string} token - Admin token.
 * @param {object} en - English fields.
 * @param {object} [de] - German fields.
 * @returns {Promise<string>} documentId.
 */
const article = async (token, en, de) => {
  const created = await call('POST', `${CM}?locale=en`, { token, body: en });
  assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 300));
  const { documentId } = created.body.data;
  if (de) {
    const localized = await call('PUT', `${CM}/${documentId}?locale=de`, { token, body: de });
    assert.equal(localized.status, 200, JSON.stringify(localized.body).slice(0, 300));
  }
  return documentId;
};

const draftOf = async (token, documentId, locale) => {
  const response = await call('GET', `${CM}/${documentId}?locale=${locale}&status=draft`, { token });
  assert.equal(response.status, 200);
  return response.body.data;
};

/**
 * Runs a job to its end, one batch per request.
 * @param {string} token - Admin token.
 * @param {object} job - Started job.
 * @returns {Promise<object>} Finished job.
 */
const finish = async (token, job) => {
  let state = job;
  for (let guard = 0; state.status === 'running' && guard < 500; guard += 1) {
    const response = await call('POST', `/magic-editor-x/migration/jobs/${state.id}/next`, {
      token,
      body: {},
    });
    assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
    state = response.body.data;
  }
  return state;
};

const ids = {};

test('setup: synthetic articles in two locales, one published, one with content in the target', async () => {
  const token = await tokenFor('admin');
  ids.plain = await article(
    token,
    { title: `Plain ${RUN}`, legacy: blocks(`Blocks EN ${RUN}`), notes: `**Markdown** EN ${RUN}` },
    { title: `Schlicht ${RUN}`, legacy: blocks(`Blocks DE ${RUN}`), notes: `**Markdown** DE ${RUN}` }
  );
  ids.published = await article(token, { title: `Published ${RUN}`, legacy: blocks(`Published EN ${RUN}`) });
  const publish = await call('POST', `${CM}/${ids.published}/actions/publish?locale=en`, { token, body: {} });
  assert.equal(publish.status, 200, JSON.stringify(publish.body).slice(0, 300));
  ids.filled = await article(token, {
    title: `Filled ${RUN}`,
    legacy: blocks(`Replacement ${RUN}`),
    migrated: editorValue(`Existing ${RUN}`),
  });
});

test('RBAC: anonymous 401, an admin without migrate.run 403 on every route', async () => {
  const anonymous = await call('GET', '/magic-editor-x/migration/types');
  assert.equal(anonymous.status, 401);
  const writer = await tokenFor('writer');
  const body = { uid: UID, from: 'legacy', to: 'migrated' };
  for (const [method, path, payload] of [
    ['GET', '/magic-editor-x/migration/types'],
    ['POST', '/magic-editor-x/migration/preview', body],
    ['GET', `/magic-editor-x/migration/backup?uid=${UID}&from=legacy&to=migrated`],
    ['GET', '/magic-editor-x/migration/jobs'],
    ['POST', '/magic-editor-x/migration/jobs', body],
  ]) {
    const response = await call(method, path, { token: writer, body: payload });
    assert.equal(response.status, 403, `${method} ${path}`);
  }
});

test('types and preview: the dry run shows source text and the converted value and writes nothing', async () => {
  const token = await tokenFor('admin');
  const types = await call('GET', '/magic-editor-x/migration/types', { token });
  assert.equal(types.status, 200);
  const type = types.body.data.types.find((entry) => entry.uid === UID);
  assert.ok(type.sources.some((source) => source.name === 'legacy' && source.type === 'blocks'));
  assert.ok(type.targets.some((target) => target.name === 'migrated' && typeof target.preset === 'string'));
  assert.deepEqual(types.body.data.locales.map((locale) => locale.code).sort(), ['de', 'en']);

  const preview = await call('POST', '/magic-editor-x/migration/preview', {
    token,
    body: { uid: UID, from: 'legacy', to: 'migrated', locale: '*', size: 10 },
  });
  assert.equal(preview.status, 200, JSON.stringify(preview.body).slice(0, 300));
  assert.ok(preview.body.data.total >= 4);
  assert.ok(preview.body.data.entries.length > 0);
  for (const entry of preview.body.data.entries)
    assert.ok(['converted', 'existing', 'empty', 'failed'].includes(entry.status));
  const draft = await draftOf(token, ids.plain, 'en');
  assert.equal(draft.migrated, null, 'the dry run wrote nothing');
  const invalid = await call('POST', '/magic-editor-x/migration/preview', {
    token,
    body: { uid: UID, from: 'title', to: 'title' },
  });
  assert.equal(invalid.status, 400);
});

test('backup: source and target values of the entries, as JSON', async () => {
  const token = await tokenFor('admin');
  const response = await call(
    'GET',
    `/magic-editor-x/migration/backup?uid=${UID}&from=legacy&to=migrated&locale=*`,
    {
      token,
    }
  );
  assert.equal(response.status, 200);
  const backup = response.body.data;
  assert.equal(backup.kind, 'magic-editor-x/migration-backup');
  const plainEn = backup.entries.find((entry) => entry.documentId === ids.plain && entry.locale === 'en');
  assert.deepEqual(plainEn.legacy, blocks(`Blocks EN ${RUN}`));
  assert.deepEqual(Object.keys(plainEn).sort(), ['documentId', 'legacy', 'locale', 'migrated']);
  assert.ok(backup.entries.some((entry) => entry.documentId === ids.plain && entry.locale === 'de'));
});

test('one run per field: a second start answers 409 MIGRATION_RUNNING until the first is stopped', async () => {
  const token = await tokenFor('admin');
  const body = { uid: UID, from: 'htmlBody', to: 'simpleBody', locale: '*' };
  const first = await call('POST', '/magic-editor-x/migration/jobs', { token, body });
  assert.equal(first.status, 201);
  const second = await call('POST', '/magic-editor-x/migration/jobs', { token, body });
  assert.equal(second.status, 409);
  assert.equal(second.body.error.details.code, 'MIGRATION_RUNNING');
  const listed = await call('GET', '/magic-editor-x/migration/jobs', { token });
  assert.ok(
    listed.body.data.some((job) => job.id === first.body.data.id),
    'resumable'
  );
  const cancel = await call('POST', `/magic-editor-x/migration/jobs/${first.body.data.id}/cancel`, {
    token,
    body: {},
  });
  assert.equal(cancel.body.data.status, 'cancelled');
  const again = await call('POST', '/magic-editor-x/migration/jobs', { token, body });
  assert.equal(again.status, 201);
  await call('POST', `/magic-editor-x/migration/jobs/${again.body.data.id}/cancel`, { token, body: {} });
});

test('a full run: every locale, drafts only, only the target field, existing content skipped', async () => {
  const token = await tokenFor('admin');
  const start = await call('POST', '/magic-editor-x/migration/jobs', {
    token,
    body: { uid: UID, from: 'legacy', to: 'migrated', locale: '*' },
  });
  assert.equal(start.status, 201, JSON.stringify(start.body).slice(0, 300));
  const job = await finish(token, start.body.data);
  assert.equal(job.status, 'done');
  assert.equal(job.processed, job.total);
  assert.ok(job.counts.converted >= 3);
  assert.ok(job.counts.skippedExisting >= 1);

  for (const [locale, text] of [
    ['en', `Blocks EN ${RUN}`],
    ['de', `Blocks DE ${RUN}`],
  ]) {
    const draft = await draftOf(token, ids.plain, locale);
    assert.equal(draft.migrated.blocks[0].data.text, text, `${locale} migrated`);
    assert.deepEqual(draft.legacy, blocks(text), `${locale} source unchanged`);
    assert.equal(
      draft.notes,
      `**Markdown** ${locale.toUpperCase()} ${RUN}`,
      `${locale} other fields unchanged`
    );
  }
  const filled = await draftOf(token, ids.filled, 'en');
  assert.equal(filled.migrated.blocks[0].data.text, `Existing ${RUN}`, 'existing target content skipped');
  // Draft and publish: the published version keeps its old value until the entry is published again.
  const published = await call('GET', `${CM}/${ids.published}?locale=en&status=published`, { token });
  assert.equal(published.body.data.migrated, null, 'the published version is untouched');
  const draft = await draftOf(token, ids.published, 'en');
  assert.equal(draft.migrated.blocks[0].data.text, `Published EN ${RUN}`);
});

test('overwrite: the previous target content is kept as the version "Before migration"', async () => {
  const token = await tokenFor('admin');
  const start = await call('POST', '/magic-editor-x/migration/jobs', {
    token,
    body: { uid: UID, from: 'legacy', to: 'migrated', locale: 'en', overwrite: true },
  });
  assert.equal(start.status, 201);
  const job = await finish(token, start.body.data);
  assert.ok(job.counts.versions >= 1);
  const filled = await draftOf(token, ids.filled, 'en');
  assert.equal(filled.migrated.blocks[0].data.text, `Replacement ${RUN}`);
  const history = await call(
    'GET',
    `/magic-editor-x/history?uid=${UID}&documentId=${ids.filled}&locale=en&field=migrated`,
    { token }
  );
  assert.equal(history.status, 200, JSON.stringify(history.body).slice(0, 300));
  const version = history.body.data.find((entry) => entry.label === 'Before migration');
  assert.ok(version, 'a "Before migration" version exists');
  const content = await call('GET', `/magic-editor-x/history/${version.id || version.documentId}`, { token });
  assert.equal(content.status, 200);
  assert.ok(JSON.stringify(content.body.data).includes(`Existing ${RUN}`));
});

test('a role limited to German migrates German entries only', async () => {
  const token = await tokenFor('migrator');
  const types = await call('GET', '/magic-editor-x/migration/types', { token });
  assert.equal(types.status, 200);
  assert.ok(types.body.data.types.some((entry) => entry.uid === UID));
  const start = await call('POST', '/magic-editor-x/migration/jobs', {
    token,
    body: { uid: UID, from: 'notes', to: 'simpleBody', locale: '*' },
  });
  assert.equal(start.status, 201, JSON.stringify(start.body).slice(0, 300));
  const job = await finish(token, start.body.data);
  assert.equal(job.status, 'done');
  const admin = await tokenFor('admin');
  const de = await draftOf(admin, ids.plain, 'de');
  const en = await draftOf(admin, ids.plain, 'en');
  assert.ok(JSON.stringify(de.simpleBody).includes(`DE ${RUN}`), 'German entry migrated');
  assert.equal(en.simpleBody, null, 'English entry untouched');
  const english = await call('POST', '/magic-editor-x/migration/preview', {
    token,
    body: { uid: UID, from: 'notes', to: 'simpleBody', locale: 'en' },
  });
  assert.equal(english.status, 403, 'no rights on English');
});

test('audit trail: start, finish, cancel and backup are recorded with counts only', async () => {
  const token = await tokenFor('admin');
  for (const event of ['migration.start', 'migration.finish', 'migration.cancel', 'migration.backup']) {
    const response = await call('GET', `/magic-editor-x/audit?event=${event}&pageSize=5`, { token });
    assert.equal(response.status, 200);
    assert.ok(response.body.data.length >= 1, event);
    assert.ok(!JSON.stringify(response.body.data).includes(RUN), `${event} holds no content`);
  }
});
