/**
 * 2.4 operations features against a real host (SQLite and PostgreSQL):
 *
 * - audit trail: Content Manager saves, publish and delete recorded per
 *   field with counts and block ids only (marker strings never appear),
 *   version, comment, template, synced source and settings events,
 *   `audit.read` RBAC (403 without it, 404 for documents the caller cannot
 *   read, 403 for global listings without settings.read), a deleted admin
 *   anonymised;
 * - synced source versions: one per save, identical saves skipped, restore
 *   as a normal update, 404 for other kinds and other sources, versions
 *   deleted with the source, `templates.manage` only;
 * - link check: "Run now" (202, then 409 while running), the time zone
 *   and next run in the status, the run recorded in the audit trail.
 *
 * Host (CONTRIBUTING.md) started with `MEX_LINK_TZ=Europe/Berlin` (the
 * ops host config passes it as `qualityChecks.externalLinks.schedule.tz`).
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, createArticle } from './helpers.mjs';

const RUN = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
const MARKER = `AUDITMARKER${RUN}`;
const ARTICLE = 'api::article.article';
const HOMEPAGE = 'api::homepage.homepage';
const doc = (...blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const state = {};

/** Every audit row the caller can see through the global listing for one document. */
const auditOf = async (token, documentId, extra = '') => {
  const response = await call(
    'GET',
    `/magic-editor-x/audit?uid=${encodeURIComponent(ARTICLE)}&documentId=${documentId}&pageSize=100${extra}`,
    { token }
  );
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  return response.body.data;
};

/** Polls until `read()` returns a truthy value (audit rows are written right after the response). */
const eventually = async (read, ms = 5000) => {
  const start = Date.now();
  let value = await read();
  while (!value && Date.now() - start < ms) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await read();
  }
  return value;
};

/**
 * Creates a role with permissions and an admin user in it (registration
 * flow like the seed script). Returns the token and the user id.
 */
const createUserWithRole = async (key, permissions) => {
  const admin = await tokenFor('admin');
  const role = await call('POST', '/admin/roles', {
    token: admin,
    body: { name: `Ops ${key} ${RUN}`, description: 'ops-24 integration' },
  });
  assert.equal(role.status, 201);
  const set = await call('PUT', `/admin/roles/${role.body.data.id}/permissions`, {
    token: admin,
    body: { permissions },
  });
  assert.equal(set.status, 200, JSON.stringify(set.body).slice(0, 300));
  const email = `${key}-${RUN}@example.test`;
  const created = await call('POST', '/admin/users', {
    token: admin,
    body: { firstname: 'Ops', lastname: key, email, roles: [role.body.data.id] },
  });
  assert.equal(created.status, 201);
  const password = `Mx1!${RUN}Aa9`;
  const registered = await call('POST', '/admin/register', {
    body: {
      registrationToken: created.body.data.registrationToken,
      userInfo: { firstname: 'Ops', lastname: key, password },
    },
  });
  assert.equal(registered.status, 200);
  const login = await call('POST', '/admin/login', { body: { email, password } });
  assert.equal(login.status, 200);
  return { token: login.body.data.token, id: created.body.data.id, roleId: role.body.data.id };
};

const P = (action, subject = null, fields = null) => ({
  action,
  subject,
  properties: fields ? { fields, locales: ['en', 'de'] } : {},
  conditions: [],
});
const mex = (uid) => P(`plugin::magic-editor-x.${uid}`);

before(async () => {
  state.admin = await tokenFor('admin');
  state.editor = await tokenFor('editor');
  state.author = await tokenFor('author');
});

test('audit: Content Manager saves, publish and delete are recorded per field without content', async () => {
  const { admin } = state;
  const article = await createArticle(admin, {
    title: `Audit ${MARKER}`,
    body: doc(p('a1', `${MARKER} first`), p('a2', `${MARKER} second`)),
    sections: [{ heading: MARKER, body: doc(p('s1', `${MARKER} section`)) }],
  });
  state.article = article;
  const base = `/content-manager/collection-types/${ARTICLE}/${article.documentId}`;
  let response = await call('PUT', `${base}?locale=en`, {
    token: admin,
    body: { title: `Audit ${MARKER} renamed` },
  });
  assert.equal(response.status, 200);
  response = await call('PUT', `${base}?locale=en`, {
    token: admin,
    body: {
      body: doc(p('a2', `${MARKER} second`), p('a1', `${MARKER} first, edited`), p('a3', `${MARKER} third`)),
    },
  });
  assert.equal(response.status, 200);
  response = await call('POST', `${base}/actions/publish?locale=en`, { token: admin, body: {} });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));

  const rows = await eventually(async () => {
    const list = await auditOf(admin, article.documentId);
    return list.some((row) => row.event === 'entry.publish') ? list : null;
  });
  assert.ok(rows, 'publish event recorded');
  const body = rows.filter((row) => row.target.field === 'body').reverse();
  assert.deepEqual(
    body.map((row) => row.event),
    ['entry.create', 'entry.update', 'entry.publish']
  );
  // The title-only save changed no editor field: no event for it.
  assert.deepEqual(body[0].counts, { added: 2, removed: 0, changed: 0, moved: 0, blocks: 2 });
  assert.equal(body[1].counts.added, 1);
  assert.equal(body[1].counts.changed, 1);
  assert.equal(body[1].counts.moved, 1);
  assert.deepEqual(body[1].blockIds, ['a1', 'a3']);
  assert.equal(body[2].counts.added, 3);
  assert.ok(rows.some((row) => row.event === 'entry.create' && row.target.field === 'sections.0.body'));
  for (const row of rows) {
    assert.equal(row.target.locale, 'en');
    assert.equal(row.actor.kind, 'admin');
    assert.equal(row.actor.own, true);
    assert.equal(typeof row.actor.id, 'number');
  }
  const text = JSON.stringify(rows);
  assert.equal(text.includes(MARKER), false);
  assert.equal(text.includes('example.test'), false);

  // Field scope: same rows for that field, actors without ids.
  const field = await call(
    'GET',
    `/magic-editor-x/audit?uid=${encodeURIComponent(ARTICLE)}&documentId=${article.documentId}&locale=en&field=body`,
    { token: admin }
  );
  assert.equal(field.status, 200);
  assert.equal(field.body.meta.scope, 'field');
  assert.equal(field.body.data.length, 3);
  assert.equal('id' in field.body.data[0].actor, false);

  // Delete through the Content Manager.
  const scratch = await createArticle(admin, { title: 'Audit delete', body: doc(p('d1', MARKER)) });
  response = await call(
    'DELETE',
    `/content-manager/collection-types/${ARTICLE}/${scratch.documentId}?locale=en`,
    {
      token: admin,
    }
  );
  assert.equal(response.status, 200);
  const deleted = await eventually(async () => {
    const list = await auditOf(admin, scratch.documentId, '&event=entry.delete');
    return list.length ? list : null;
  });
  assert.ok(deleted);
  assert.equal(deleted[0].counts.removed, 1);
});

test('audit: RBAC (403 without audit.read, 404 for unreadable documents, global needs settings.read)', async () => {
  const { admin, author, article } = state;
  assert.equal((await call('GET', '/magic-editor-x/audit', { token: author })).status, 403);
  assert.equal((await call('GET', '/magic-editor-x/audit/actors', { token: author })).status, 403);
  const auditor = await createUserWithRole('auditor', [
    P('plugin::content-manager.explorer.read', ARTICLE, ['title', 'body']),
    mex('access'),
    mex('audit.read'),
  ]);
  state.auditor = auditor;
  const q = (extra) =>
    `/magic-editor-x/audit?uid=${encodeURIComponent(ARTICLE)}&documentId=${article.documentId}&locale=en${extra}`;
  const field = await call('GET', q('&field=body'), { token: auditor.token });
  assert.equal(field.status, 200);
  assert.ok(field.body.data.length >= 3);
  assert.equal(field.body.data[0].actor.own, false);
  // No field permission on `sections`: 404, like every other field route.
  assert.equal((await call('GET', q('&field=sections.0.body'), { token: auditor.token })).status, 404);
  // A type the auditor cannot read: 404.
  const home = await call(
    'GET',
    `/magic-editor-x/audit?uid=${encodeURIComponent(HOMEPAGE)}&documentId=${article.documentId}&field=headline`,
    { token: auditor.token }
  );
  assert.equal(home.status, 404);
  // Global listings and the actor list need settings.read too.
  assert.equal((await call('GET', q(''), { token: auditor.token })).status, 403);
  assert.equal((await call('GET', '/magic-editor-x/audit', { token: auditor.token })).status, 403);
  assert.equal((await call('GET', '/magic-editor-x/audit/actors', { token: auditor.token })).status, 403);
  // Strict input.
  for (const extra of ['&pageSize=101', '&field=body&bogus=1', '&event=DROP', '&from=yesterday']) {
    const response = await call('GET', q(extra), { token: admin });
    assert.equal(response.status, 400, extra);
  }
  const config = await call('GET', '/magic-editor-x/config', { token: auditor.token });
  assert.equal(config.body.data.permissions.auditRead, true);
  assert.equal(config.body.data.audit.enabled, true);
});

test('audit: version, comment, settings events; a deleted admin is anonymised', async () => {
  const { admin, article } = state;
  const target = { uid: ARTICLE, documentId: article.documentId, locale: 'en', field: 'body' };
  const version = await call('POST', '/magic-editor-x/history', {
    token: admin,
    body: { ...target, content: doc(p('v1', MARKER)), label: 'Before review' },
  });
  assert.equal(version.status, 201);
  assert.equal(
    (
      await call('PUT', `/magic-editor-x/history/${version.body.data.id}`, {
        token: admin,
        body: { label: 'Named' },
      })
    ).status,
    200
  );
  assert.equal(
    (await call('GET', `/magic-editor-x/history/${version.body.data.id}?intent=restore`, { token: admin }))
      .status,
    200
  );
  const comment = await call('POST', '/magic-editor-x/comments', {
    token: admin,
    body: { ...target, blockId: 'a1', body: `${MARKER} comment`, excerpt: MARKER },
  });
  assert.equal(comment.status, 201);
  assert.equal(
    (await call('POST', `/magic-editor-x/comments/${comment.body.data.id}/resolve`, { token: admin })).status,
    200
  );
  const settings = await call('GET', '/magic-editor-x/settings', { token: admin });
  const ai = settings.body.data.ai;
  const put = await call('PUT', '/magic-editor-x/settings', {
    token: admin,
    body: {
      ai: {
        enabled: ai.enabled,
        provider: ai.provider,
        baseUrl: ai.baseUrl,
        model: ai.model,
        maxInputChars: ai.maxInputChars,
        maxOutputTokens: ai.maxOutputTokens,
      },
    },
  });
  assert.equal(put.status, 200, JSON.stringify(put.body).slice(0, 300));

  const rows = await eventually(async () => {
    const list = await auditOf(admin, article.documentId);
    return list.some((row) => row.event === 'comment.resolve') ? list : null;
  });
  const events = rows.map((row) => row.event);
  for (const event of [
    'version.create',
    'version.rename',
    'version.restore',
    'comment.create',
    'comment.resolve',
  ])
    assert.ok(events.includes(event), event);
  const created = rows.find((row) => row.event === 'comment.create');
  assert.deepEqual(created.blockIds, ['a1']);
  assert.equal(created.meta.threadId, comment.body.data.id);
  assert.equal(JSON.stringify(rows).includes(MARKER), false);
  const settingsRows = await call('GET', '/magic-editor-x/audit?event=settings.update&pageSize=5', {
    token: admin,
  });
  assert.deepEqual(settingsRows.body.data[0].meta, { keys: ['ai'] });
  assert.equal(JSON.stringify(settingsRows.body.data[0]).includes(ai.model || 'no-model-set'), false);

  // A temporary admin changes a field, then is deleted: the event stays, the name goes.
  const temp = await createUserWithRole('temp', [
    P('plugin::content-manager.explorer.read', ARTICLE, ['title', 'body']),
    P('plugin::content-manager.explorer.create', ARTICLE, ['title', 'body']),
    mex('access'),
  ]);
  const own = await createArticle(temp.token, { title: 'Temp', body: doc(p('t1', MARKER)) });
  const before = await eventually(async () => {
    const list = await auditOf(admin, own.documentId);
    return list.length ? list : null;
  });
  assert.equal(before[0].actor.name, 'Ops temp');
  assert.equal(before[0].actor.id, temp.id);
  const removed = await call('DELETE', `/admin/users/${temp.id}`, { token: admin });
  assert.equal(removed.status, 200);
  const after = await eventually(async () => {
    const list = await auditOf(admin, own.documentId);
    return list[0].actor.deleted ? list : null;
  });
  assert.ok(after, 'actor anonymised');
  assert.deepEqual(after[0].actor, { kind: 'deleted', name: null, own: false, deleted: true, id: null });
  const actors = await call('GET', '/magic-editor-x/audit/actors', { token: admin });
  assert.equal(
    actors.body.data.some((actor) => actor.id === temp.id),
    false
  );
});

test('synced source versions: per save, restore, 404s, permissions, deleted with the source', async () => {
  const { admin, editor } = state;
  const body = (text, name = `Footer ${RUN}`) => ({
    name,
    description: 'Ops footer',
    kind: 'synced',
    blocks: doc(p('f1', text)),
    scope: { all: true },
  });
  const created = await call('POST', '/magic-editor-x/templates', { token: admin, body: body('One') });
  assert.equal(created.status, 201);
  const id = created.body.data.id;
  for (const payload of [body('One'), body('Two'), body('Two', `Footer ${RUN} v3`)]) {
    const response = await call('PUT', `/magic-editor-x/templates/${id}`, { token: admin, body: payload });
    assert.equal(response.status, 200);
  }
  let list = await call('GET', `/magic-editor-x/templates/${id}/versions`, { token: admin });
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.data.map((version) => [version.version, version.name, version.trigger]),
    [
      [3, `Footer ${RUN} v3`, 'manual'],
      [2, `Footer ${RUN}`, 'manual'],
      [1, `Footer ${RUN}`, 'manual'],
    ]
  );
  assert.ok(list.body.data[0].createdBy.name);
  assert.equal(JSON.stringify(list.body.data).includes('example.test'), false);
  const first = list.body.data[2];
  const one = await call('GET', `/magic-editor-x/templates/${id}/versions/${first.id}`, { token: admin });
  assert.equal(one.body.data.content.blocks[0].data.text, 'One');
  const renamed = await call('PUT', `/magic-editor-x/templates/${id}/versions/${first.id}`, {
    token: admin,
    body: { label: 'Launch' },
  });
  assert.equal(renamed.body.data.label, 'Launch');
  const restored = await call('POST', `/magic-editor-x/templates/${id}/versions/${first.id}/restore`, {
    token: admin,
  });
  assert.equal(restored.status, 200);
  assert.equal(restored.body.data.blocks.blocks[0].data.text, 'One');
  assert.equal(restored.body.data.name, `Footer ${RUN}`);
  list = await call('GET', `/magic-editor-x/templates/${id}/versions`, { token: admin });
  assert.equal(list.body.data.length, 4);
  assert.equal(list.body.data[0].trigger, 'restore');

  // Permissions and other kinds.
  assert.equal(
    (await call('GET', `/magic-editor-x/templates/${id}/versions`, { token: editor })).status,
    403
  );
  const pattern = await call('POST', '/magic-editor-x/templates', {
    token: admin,
    body: { ...body('Pattern'), kind: 'pattern', name: `Pattern ${RUN}` },
  });
  assert.equal(
    (await call('GET', `/magic-editor-x/templates/${pattern.body.data.id}/versions`, { token: admin }))
      .status,
    404
  );
  const other = await call('POST', '/magic-editor-x/templates', {
    token: admin,
    body: body('Other', `Other ${RUN}`),
  });
  const otherVersions = await call('GET', `/magic-editor-x/templates/${other.body.data.id}/versions`, {
    token: admin,
  });
  assert.equal(
    (
      await call('GET', `/magic-editor-x/templates/${id}/versions/${otherVersions.body.data[0].id}`, {
        token: admin,
      })
    ).status,
    404
  );
  // The field history never serves a source version.
  assert.equal((await call('GET', `/magic-editor-x/history/${first.id}`, { token: admin })).status, 404);

  // Audit events of the source.
  const audit = await call(
    'GET',
    `/magic-editor-x/audit?uid=${encodeURIComponent('plugin::magic-editor-x.template')}&documentId=${id}&pageSize=20`,
    { token: admin }
  );
  assert.deepEqual(audit.body.data.map((row) => row.event).reverse(), [
    'synced.create',
    'synced.update',
    'synced.update',
    'synced.update',
    'synced.restore',
  ]);

  // Deleting the source deletes its versions.
  for (const remove of [id, pattern.body.data.id, other.body.data.id])
    assert.equal((await call('DELETE', `/magic-editor-x/templates/${remove}`, { token: admin })).status, 200);
  assert.equal((await call('GET', `/magic-editor-x/templates/${id}/versions`, { token: admin })).status, 404);
  assert.equal((await call('GET', `/magic-editor-x/history/${first.id}`, { token: admin })).status, 404);
});

test('link check: Run now, 409 while running, time zone and next run, recorded in the audit trail', async () => {
  const { admin, editor } = state;
  const status = await call('GET', '/magic-editor-x/quality/link-schedule', { token: admin });
  assert.equal(status.status, 200);
  assert.equal(status.body.data.tz, 'Europe/Berlin');
  assert.ok(Date.parse(status.body.data.nextRunAt) > Date.now());
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).format(new Date(status.body.data.nextRunAt));
  assert.equal(hour, '03:00');
  const settings = await call('GET', '/magic-editor-x/settings', { token: admin });
  assert.equal(settings.body.data.environment.linkSchedule.tz, 'Europe/Berlin');

  assert.equal(
    (await call('POST', '/magic-editor-x/quality/link-schedule/run', { token: editor })).status,
    403
  );
  const started = await call('POST', '/magic-editor-x/quality/link-schedule/run', { token: admin });
  assert.equal(started.status, 202);
  const again = await call('POST', '/magic-editor-x/quality/link-schedule/run', { token: admin });
  // The run may already be over on an empty host; while it holds the lease the answer is 409.
  assert.ok([202, 409].includes(again.status), String(again.status));
  if (again.status === 409) assert.equal(again.body.error.details.code, 'RUNNING');
  let finished = null;
  for (let i = 0; i < 120 && !finished; i += 1) {
    const current = await call('GET', '/magic-editor-x/quality/link-schedule', { token: admin });
    if (!current.body.data.running) finished = current.body.data;
    else await new Promise((resolve) => setTimeout(resolve, 500));
  }
  assert.ok(finished, 'the run finished within 60 s');
  assert.equal(finished.lastRun.trigger, 'manual');
  const rows = await eventually(async () => {
    const response = await call('GET', '/magic-editor-x/audit?event=linkcheck.run&pageSize=5', {
      token: admin,
    });
    return response.body.data.length ? response.body.data : null;
  });
  assert.equal(rows[0].actor.kind, 'admin');
  assert.equal(rows[0].meta.trigger, 'manual');
  assert.equal(typeof rows[0].counts.checked, 'number');
});
