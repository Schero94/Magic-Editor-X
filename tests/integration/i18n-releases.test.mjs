import test from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, createArticle } from './helpers.mjs';

/**
 * 2.4 Releases readiness of the publish guard (`server/src/utils/release-readiness.js`).
 *
 * Content Releases and Strapi AI translations are licensed features; on a CE
 * host neither has routes, so their in-process proofs live in the acceptance
 * harness (see AGENTS.md "Strapi i18n AI translations and Releases (2.4)").
 * Over HTTP this suite checks the shared hook: the entity validator that
 * Releases calls now applies the publish guard to every published version,
 * so a Content API create with `status=published` (which publishes without
 * the `publish` middleware) is refused like a Content Manager publish, and
 * nothing is left behind.
 *
 * Host field `summary`: `{ preset: 'basic', ..., publishGuard: true }` (see CONTRIBUTING.md).
 */

const RUN = Date.now().toString(36);
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const EMPTY_LINK =
  'Read <a href="/articles/x" data-mex-uid="api::article.article" data-mex-document-id="abc123"></a> now';
const ARTICLE = 'api::article.article';
const cm = (path) => `/content-manager/collection-types/${ARTICLE}${path}`;

const state = {};
const apiKey = async () => {
  if (state.key) return state.key;
  const response = await call('POST', '/admin/api-tokens', {
    token: await tokenFor('admin'),
    body: { name: `mex-releases-${RUN}`, type: 'full-access', lifespan: null, description: 'integration' },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body).slice(0, 300));
  state.key = response.body.data.accessKey;
  return state.key;
};

test('Content API create with status=published runs the publish guard and leaves nothing behind', async () => {
  const key = await apiKey();
  const title = `Direct publish ${RUN}`;
  const refused = await call('POST', '/api/articles?status=published&locale=en', {
    token: key,
    body: { data: { title, summary: doc([p('s1', EMPTY_LINK)]) } },
  });
  assert.equal(refused.status, 400, JSON.stringify(refused.body).slice(0, 300));
  assert.equal(refused.body.error.details.code, 'QUALITY_GATE');
  assert.deepEqual(refused.body.error.details.issues, [
    { field: 'summary', rule: 'empty-link', blockId: 's1', locale: 'en' },
  ]);
  assert.ok(!JSON.stringify(refused.body).includes('Read'), 'no content in the error');
  const left = await call(
    'GET',
    `/api/articles?status=draft&locale=en&filters[title][$eq]=${encodeURIComponent(title)}`,
    { token: key }
  );
  assert.equal(left.status, 200);
  assert.equal(left.body.data.length, 0, 'the refused create is rolled back');

  // Warnings (ambiguous link text, image without alt in a field without requireAlt) never block.
  const ok = await call('POST', '/api/articles?status=published&locale=en', {
    token: key,
    body: {
      data: {
        title: `${title} ok`,
        summary: doc([
          p(
            's1',
            'Read <a href="/articles/x" data-mex-uid="api::article.article" data-mex-document-id="abc123">click here</a>'
          ),
        ]),
        body: doc([{ id: 'i1', type: 'image', data: { file: { url: 'https://cdn.example.test/a.png' } } }]),
      },
    },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body).slice(0, 300));
  assert.ok(ok.body.data.publishedAt);
  const removed = await call('DELETE', `/api/articles/${ok.body.data.documentId}?locale=en`, { token: key });
  assert.ok([200, 204].includes(removed.status));
});

test('drafts are never checked; the Content Manager publish answers the same error', async () => {
  const admin = await tokenFor('admin');
  const article = await createArticle(admin, { title: `Draft ${RUN}`, summary: doc([p('g1', EMPTY_LINK)]) });
  const blocked = await call('POST', cm(`/${article.documentId}/actions/publish?plugins[i18n][locale]=en`), {
    token: admin,
    body: {},
  });
  assert.equal(blocked.status, 400);
  assert.equal(blocked.body.error.details.code, 'QUALITY_GATE');
  // A Content API draft update with the error is accepted (drafts are free).
  const key = await apiKey();
  const draft = await call('PUT', `/api/articles/${article.documentId}?status=draft&locale=en`, {
    token: key,
    body: { data: { summary: doc([p('g1', EMPTY_LINK)]) } },
  });
  assert.equal(draft.status, 200, JSON.stringify(draft.body).slice(0, 300));
  // Updating with status=published publishes through the repository: refused.
  const published = await call('PUT', `/api/articles/${article.documentId}?status=published&locale=en`, {
    token: key,
    body: { data: { title: `Draft ${RUN}` } },
  });
  assert.equal(published.status, 400, JSON.stringify(published.body).slice(0, 300));
  assert.equal(published.body.error.details.code, 'QUALITY_GATE');
  const fixed = await call('PUT', `/api/articles/${article.documentId}?status=published&locale=en`, {
    token: key,
    body: { data: { summary: doc([p('g1', 'Read now')]) } },
  });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body).slice(0, 300));
  await call('DELETE', `/api/articles/${article.documentId}?locale=en`, { token: key });
});
