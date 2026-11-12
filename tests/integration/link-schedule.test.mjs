import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { call, tokenFor, createArticle } from './helpers.mjs';

/**
 * Scheduled external link check against a real host.
 *
 * Host configuration (see CONTRIBUTING.md):
 *   qualityChecks.externalLinks = {
 *     enabled: true,
 *     allowPrivateOrigins: ['http://127.0.0.1:<MEX_LINK_PORT, default 1578>'],
 *     schedule: { enabled: true, ... },
 *   }
 * The test starts two local HTTP servers: the listed origin (link targets)
 * and a second loopback server on MEX_LINK_DENIED_PORT (default 1579) that is
 * NOT listed and must never receive a request. The run is triggered through
 * POST /quality/link-schedule/run (settings.update), not by waiting for the
 * cron rule, so the test is deterministic.
 */

const ARTICLE = 'api::article.article';
const LINK_PORT = Number(process.env.MEX_LINK_PORT || 1578);
const DENIED_PORT = Number(process.env.MEX_LINK_DENIED_PORT || 1579);
const ORIGIN = `http://127.0.0.1:${LINK_PORT}`;
/** Unique per test run, so results cached in the host process (10 minutes) do not hide requests. */
const RUN = Date.now().toString(36);
const DENIED = `http://127.0.0.1:${DENIED_PORT}`;
const doc = (...urls) => ({
  time: Date.now(),
  version: '2.31.7',
  blocks: urls.map((url, index) => ({
    id: `ls${index}`,
    type: 'paragraph',
    data: { text: `Link <a href="${url}">number ${index}</a>` },
  })),
});

const requests = { allowed: [], denied: 0 };
let allowedServer;
let deniedServer;

const listen = (server, port) =>
  new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', resolve);
  });

before(async () => {
  allowedServer = http.createServer((req, res) => {
    requests.allowed.push(`${req.method} ${req.url}`);
    if (req.url.startsWith('/gone')) res.writeHead(404).end();
    else if (req.url.startsWith('/moved')) res.writeHead(301, { location: `${DENIED}/after-redirect` }).end();
    else res.writeHead(200, { 'content-type': 'text/html' }).end('<p>ok</p>');
  });
  deniedServer = http.createServer((req, res) => {
    requests.denied += 1;
    res.writeHead(200).end();
  });
  await listen(allowedServer, LINK_PORT);
  await listen(deniedServer, DENIED_PORT);
});

after(() => {
  allowedServer?.close();
  deniedServer?.close();
});

/**
 * Starts a run and waits until it finished.
 * @param {string} admin - Super admin token.
 * @returns {Promise<object>} lastRun record.
 */
const runAndWait = async (admin) => {
  const before = await call('GET', '/magic-editor-x/quality/link-schedule', { token: admin });
  const previous = before.body.data.lastRun?.finishedAt || '';
  let started = await call('POST', '/magic-editor-x/quality/link-schedule/run', { token: admin });
  for (let i = 0; started.status === 409 && i < 100; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    started = await call('POST', '/magic-editor-x/quality/link-schedule/run', { token: admin });
  }
  assert.equal(started.status, 202, JSON.stringify(started.body).slice(0, 200));
  assert.deepEqual(started.body, { data: { started: true } });
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    const status = await call('GET', '/magic-editor-x/quality/link-schedule', { token: admin });
    const lastRun = status.body.data.lastRun;
    if (!status.body.data.running && lastRun && lastRun.finishedAt !== previous) return lastRun;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('the scheduled link check did not finish within 60 s');
};

test('scheduled link check: results per field, SSRF rules kept, permissions and pruning', async () => {
  const admin = await tokenFor('admin');
  const editor = await tokenFor('editor');
  const author = await tokenFor('author');
  const reviewer = await tokenFor('reviewer');

  const config = await call('GET', '/magic-editor-x/config', { token: editor });
  assert.equal(
    config.body.data.quality.scheduledLinks,
    true,
    'the host must enable qualityChecks.externalLinks.schedule (CONTRIBUTING.md)'
  );

  const article = await createArticle(editor, {
    title: 'Scheduled links',
    body: doc(
      `${ORIGIN}/ok?r=${RUN}`,
      `${ORIGIN}/gone?r=${RUN}`,
      `${ORIGIN}/moved?r=${RUN}`,
      `${DENIED}/secret?r=${RUN}`,
      'http://10.0.0.1/internal',
      'http://169.254.169.254/latest/meta-data'
    ),
    sections: [{ heading: 'Part', body: doc(`${ORIGIN}/section?r=${RUN}`) }],
  });
  const target = (field, extra = {}) =>
    new URLSearchParams({ uid: ARTICLE, documentId: article.documentId, locale: 'en', field, ...extra });

  // Who may start a run and read the schedule.
  const denied = await call('POST', '/magic-editor-x/quality/link-schedule/run', { token: editor });
  assert.equal(denied.status, 403);
  assert.equal((await call('GET', '/magic-editor-x/quality/link-schedule', { token: editor })).status, 403);
  const extra = await call('POST', '/magic-editor-x/quality/link-schedule/run', {
    token: admin,
    body: { force: true },
  });
  assert.equal(extra.status, 400);

  const lastRun = await runAndWait(admin);
  assert.equal(lastRun.complete, true);
  assert.ok(lastRun.documents >= 1 && lastRun.checked >= 1);
  assert.doesNotMatch(JSON.stringify(lastRun), /127\.0\.0\.1|10\.0\.0\.1|secret/);

  const report = await call('GET', `/magic-editor-x/quality/link-report?${target('body')}`, {
    token: editor,
  });
  assert.equal(report.status, 200);
  assert.equal(report.body.data.enabled, true);
  const byUrl = Object.fromEntries(report.body.data.draft.links.map((link) => [link.url, link]));
  assert.equal(byUrl[`${ORIGIN}/ok?r=${RUN}`].status, 'ok');
  assert.equal(byUrl[`${ORIGIN}/gone?r=${RUN}`].status, 'broken');
  assert.equal(byUrl[`${ORIGIN}/gone?r=${RUN}`].code, 404);
  assert.equal(byUrl[`${ORIGIN}/moved?r=${RUN}`].status, 'ok', 'the redirect is reported, not followed');
  assert.equal(byUrl[`${ORIGIN}/moved?r=${RUN}`].code, 301);
  assert.equal(byUrl[`${DENIED}/secret?r=${RUN}`].status, 'blocked');
  assert.equal(byUrl['http://10.0.0.1/internal'].status, 'blocked');
  assert.equal(byUrl['http://169.254.169.254/latest/meta-data'].status, 'blocked');
  assert.equal(report.body.data.draft.problems, 1);
  assert.equal(report.body.data.draft.links[0].blockId, 'ls0');
  assert.equal(report.body.data.published, null, 'a draft-only article has no published version');
  assert.equal(requests.denied, 0, 'no request reached the unlisted loopback server');
  assert.ok(requests.allowed.some((line) => line.startsWith('HEAD /gone')));

  const section = await call('GET', `/magic-editor-x/quality/link-report?${target('sections.0.body')}`, {
    token: editor,
  });
  assert.equal(section.status, 200);
  assert.equal(section.body.data.draft.links[0].url, `${ORIGIN}/section?r=${RUN}`);
  assert.equal(section.body.data.draft.links[0].status, 'ok');

  // Access: Content Manager read on the document and field, 404 otherwise.
  const viewer = await call('GET', `/magic-editor-x/quality/link-report?${target('body')}`, {
    token: reviewer,
  });
  assert.equal(viewer.status, 200);
  const hiddenField = await call('GET', `/magic-editor-x/quality/link-report?${target('summary')}`, {
    token: reviewer,
  });
  assert.equal(hiddenField.status, 404);
  const noPlugin = await call('GET', `/magic-editor-x/quality/link-report?${target('body')}`, {
    token: author,
  });
  assert.equal(noPlugin.status, 403);
  const missing = await call(
    'GET',
    `/magic-editor-x/quality/link-report?${target('body', { documentId: 'doesnotexist00000000000' })}`,
    { token: editor }
  );
  assert.equal(missing.status, 404);
  const invalid = await call('GET', `/magic-editor-x/quality/link-report?${target('body', { extra: '1' })}`, {
    token: editor,
  });
  assert.equal(invalid.status, 400);
  assert.equal((await call('GET', `/magic-editor-x/quality/link-report?${target('body')}`)).status, 401);

  // Settings show the schedule state without URLs.
  const settings = await call('GET', '/magic-editor-x/settings', { token: admin });
  assert.equal(settings.body.data.environment.linkSchedule.enabled, true);
  assert.ok(settings.body.data.environment.linkSchedule.lastRun.checked >= 1);
  assert.doesNotMatch(JSON.stringify(settings.body.data.environment.linkSchedule), /127\.0\.0\.1/);

  // Pruning: a deleted entry's rows are removed by the next complete run.
  const removed = await call(
    'DELETE',
    `/content-manager/collection-types/${ARTICLE}/${article.documentId}?locale=en`,
    { token: admin }
  );
  assert.equal(removed.status, 200);
  const second = await runAndWait(admin);
  assert.equal(second.complete, true);
  assert.ok(second.pruned >= 2, `pruned ${second.pruned}`);
  const afterDelete = await call('GET', `/magic-editor-x/quality/link-report?${target('body')}`, {
    token: admin,
  });
  assert.equal(afterDelete.status, 404);
  assert.equal(requests.denied, 0);
});
