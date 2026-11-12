/**
 * 2.3 structure blocks against a real host: table of contents (`toc`) with
 * heading anchors, mentions (inline entry references) and the code block.
 * Save round trip through the Content Manager (sanitising, field presets)
 * and the Content API output `?mex=html|json|markdown|text` with mentions
 * to a readable entry, a draft-only entry and an entry of a type the token
 * may not read.
 *
 * Host requirements: see CONTRIBUTING.md and tests/integration/content-api.test.mjs
 * (`api::category.category`, `links.urlPattern` `/{locale}/{collection}/{slug}`).
 */
import test, { before } from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, createArticle } from './helpers.mjs';

const RUN = `s${Date.now().toString(36)}`;
const ARTICLE = 'api::article.article';
const CATEGORY = 'api::category.category';
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const mention = (uid, documentId, text, locale) =>
  `<a href="/stale/${documentId}" data-mex-uid="${uid}" data-mex-document-id="${documentId}"${
    locale ? ` data-mex-locale="${locale}"` : ''
  } data-mex-mention>${text}</a>`;

const LIVE_TITLE = `Mentioned Alpha ${RUN}`;
const LIVE_SLUG = `mentioned-alpha-${RUN}`;
const DRAFT_TITLE = `Draft Only ${RUN}`;
const DRAFT_SLUG = `draft-only-${RUN}`;
const CATEGORY_NAME = `Locked Cat ${RUN}`;
const CATEGORY_SLUG = `locked-cat-${RUN}`;

const state = { ids: {}, tokens: {} };

const publish = async (path) => {
  const response = await call('POST', `${path}/actions/publish`, {
    token: await tokenFor('admin'),
    body: {},
  });
  assert.equal(response.status, 200, `publish ${path}: ${JSON.stringify(response.body).slice(0, 300)}`);
};

const apiToken = async (name, type, permissions) => {
  const response = await call('POST', '/admin/api-tokens', {
    token: await tokenFor('admin'),
    body: {
      name: `mex-struct-${name}-${RUN}`,
      type,
      lifespan: null,
      description: 'integration',
      ...(permissions ? { permissions } : {}),
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body).slice(0, 300));
  return response.body.data.accessKey;
};

const BODY = () =>
  doc([
    { id: 'toc1', type: 'toc', data: { title: 'On this page', minLevel: 2, maxLevel: 3, style: 'ordered' } },
    { id: 'hIntro', type: 'header', data: { text: 'Introduction', level: 2 } },
    {
      id: 'p1',
      type: 'paragraph',
      data: {
        text:
          `Read ${mention(ARTICLE, state.ids.live, 'stored alpha', 'en')}, ` +
          `${mention(ARTICLE, state.ids.draft, 'stored draft', 'en')} and ` +
          `${mention(CATEGORY, state.ids.category, 'stored category')}.` +
          `<a href="/x" data-mex-mention onclick="alert(1)">fake</a>`,
      },
    },
    { id: 'hDetails', type: 'header', data: { text: 'Details & notes', level: 3 } },
    { id: 'hDeep', type: 'header', data: { text: 'Too deep', level: 4 } },
    {
      id: 'c1',
      type: 'codeFlask',
      data: { code: 'const a = 1;\nconst b = 2;', language: 'typescript', showlinenumbers: true },
    },
  ]);

before(async () => {
  const admin = await tokenFor('admin');
  const live = await createArticle(admin, { title: LIVE_TITLE, slug: LIVE_SLUG });
  await publish(`/content-manager/collection-types/${ARTICLE}/${live.documentId}`);
  const draft = await createArticle(admin, { title: DRAFT_TITLE, slug: DRAFT_SLUG });
  const category = await call('POST', `/content-manager/collection-types/${CATEGORY}`, {
    token: admin,
    body: { name: CATEGORY_NAME, slug: CATEGORY_SLUG },
  });
  assert.equal(category.status, 201, JSON.stringify(category.body).slice(0, 300));
  await publish(`/content-manager/collection-types/${CATEGORY}/${category.body.data.documentId}`);
  state.ids = { live: live.documentId, draft: draft.documentId, category: category.body.data.documentId };

  const source = await createArticle(admin, {
    title: `Structure ${RUN}`,
    slug: `structure-${RUN}`,
    body: BODY(),
  });
  state.ids.source = source.documentId;
  state.stored = source.body;
  await publish(`/content-manager/collection-types/${ARTICLE}/${source.documentId}`);
  state.tokens = {
    full: await apiToken('full', 'full-access'),
    articlesOnly: await apiToken('articles', 'custom', [`${ARTICLE}.find`, `${ARTICLE}.findOne`]),
  };
});

test('save round trip: toc, mentions and code are stored sanitised', async () => {
  const stored = state.stored;
  assert.deepEqual(stored.blocks[0], {
    id: 'toc1',
    type: 'toc',
    data: { title: 'On this page', minLevel: 2, maxLevel: 3, style: 'ordered', _mex: 1 },
  });
  const text = stored.blocks[2].data.text;
  assert.match(
    text,
    new RegExp(
      `<a href="/stale/${state.ids.live}" data-mex-uid="${ARTICLE}" data-mex-document-id="${state.ids.live}" data-mex-locale="en" data-mex-mention="true">stored alpha</a>`
    )
  );
  assert.match(text, /<a href="\/x">fake<\/a>/, 'a mention flag without a reference is dropped');
  assert.doesNotMatch(text, /onclick/);
  assert.deepEqual(stored.blocks[5].data, {
    code: 'const a = 1;\nconst b = 2;',
    language: 'typescript',
    showlinenumbers: true,
  });
  // Reading it back through the Content Manager gives the same value.
  const read = await call('GET', `/content-manager/collection-types/${ARTICLE}/${state.ids.source}`, {
    token: await tokenFor('admin'),
  });
  assert.equal(read.status, 200);
  assert.deepEqual(read.body.data.body.blocks, stored.blocks);
});

test('field presets refuse a toc where it is not allowed and treat mentions as internal links', async () => {
  const admin = await tokenFor('admin');
  const toc = { id: 't', type: 'toc', data: {} };
  for (const field of ['summary', 'teaser']) {
    const response = await call('POST', `/content-manager/collection-types/${ARTICLE}`, {
      token: admin,
      body: { title: `Preset ${field} ${RUN}`, [field]: doc([toc]) },
    });
    assert.equal(response.status, 400, field);
    assert.equal(response.body.error.details.code, 'PRESET_VIOLATION');
    assert.equal(response.body.error.details.violations[0].code, 'BLOCK_NOT_ALLOWED');
  }
  // `summary` allows internal links only: a mention passes.
  const ok = await call('POST', `/content-manager/collection-types/${ARTICLE}`, {
    token: admin,
    body: {
      title: `Preset mention ${RUN}`,
      summary: doc([
        { id: 'm', type: 'paragraph', data: { text: `See ${mention(ARTICLE, state.ids.live, 'x', 'en')}` } },
      ]),
    },
  });
  assert.equal(ok.status, 201, JSON.stringify(ok.body).slice(0, 300));
});

/**
 * Checks the mention output for a caller that may read articles but not categories.
 * @param {string} text - Output.
 * @param {string} where - Label.
 */
const noLeaks = (text, where) => {
  for (const secret of [
    DRAFT_TITLE,
    DRAFT_SLUG,
    state.ids.draft,
    CATEGORY_NAME,
    CATEGORY_SLUG,
    state.ids.category,
  ])
    assert.ok(!text.includes(secret), `${where}: leaks ${secret}`);
  assert.ok(!text.includes('/stale/'), `${where}: keeps a stale href`);
};

test('?mex=html: toc with heading anchors, mentions resolved per permission', async () => {
  const response = await call('GET', `/api/articles/${state.ids.source}?mex=html`, {
    token: state.tokens.articlesOnly,
  });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  const html = response.body.data.body;
  assert.ok(
    html.startsWith(
      '<nav class="mex-toc mex-toc-ordered" aria-label="On this page"><p class="mex-toc-title">On this page</p><ol class="mex-toc-list"><li class="mex-toc-item"><a href="#mex-h-hIntro">Introduction</a><ol class="mex-toc-list"><li class="mex-toc-item"><a href="#mex-h-hDetails">Details &amp; notes</a></li></ol></li></ol></nav>'
    ),
    html.slice(0, 400)
  );
  assert.match(html, /<h2 id="mex-h-hIntro" class="mex-header">Introduction<\/h2>/);
  assert.match(html, /<h3 id="mex-h-hDetails" class="mex-header">/);
  assert.match(html, /<h4 id="mex-h-hDeep" class="mex-header">/);
  assert.match(
    html,
    new RegExp(
      `<a href="/en/articles/${LIVE_SLUG}" class="mex-mention" data-mex-uid="${ARTICLE}" data-mex-document-id="${state.ids.live}" data-mex-locale="en" data-mex-mention="true">${LIVE_TITLE}</a>`
    )
  );
  assert.match(html, /, stored draft and stored category\./, 'unresolved mentions become their stored text');
  assert.match(html, /<code class="language-typescript">/);
  noLeaks(html, 'html');
});

test('?mex=json and ?mex=markdown|text: same resolution, stored markup without render classes', async () => {
  const json = await call('GET', `/api/articles/${state.ids.source}?mex=json`, {
    token: state.tokens.articlesOnly,
  });
  assert.equal(json.status, 200);
  const text = json.body.data.body.blocks[2].data.text;
  assert.match(
    text,
    new RegExp(`data-mex-mention="true">${LIVE_TITLE}</a>, stored draft and stored category`)
  );
  assert.doesNotMatch(text, /class=/);
  noLeaks(JSON.stringify(json.body.data.body), 'json');

  const md = await call('GET', `/api/articles/${state.ids.source}?mex=markdown`, {
    token: state.tokens.articlesOnly,
  });
  assert.equal(md.status, 200);
  assert.ok(
    md.body.data.body.startsWith(
      '**On this page**\n\n1. [Introduction](#introduction)\n   1. [Details \\& notes](#details--notes)\n\n## Introduction'
    ),
    md.body.data.body.slice(0, 200)
  );
  assert.match(md.body.data.body, new RegExp(`\\[${LIVE_TITLE}\\]\\(/en/articles/${LIVE_SLUG}\\)`));
  assert.match(md.body.data.body, /```typescript\nconst a = 1;/);
  noLeaks(md.body.data.body, 'markdown');

  const plain = await call('GET', `/api/articles/${state.ids.source}?mex=text`, {
    token: state.tokens.articlesOnly,
  });
  assert.equal(plain.status, 200);
  assert.ok(plain.body.data.body.startsWith('On this page\n1. Introduction\n  1. Details & notes'));
  assert.match(plain.body.data.body, new RegExp(`Read ${LIVE_TITLE}, stored draft and stored category\\.`));
});

test('a full-access token sees the category title; drafts resolve only with status=draft', async () => {
  const published = await call('GET', `/api/articles/${state.ids.source}?mex=html`, {
    token: state.tokens.full,
  });
  assert.equal(published.status, 200);
  assert.match(published.body.data.body, new RegExp(`>${CATEGORY_NAME}</a>`));
  assert.match(published.body.data.body, /, stored draft and /);
  assert.ok(!published.body.data.body.includes(DRAFT_TITLE));
  const drafts = await call('GET', `/api/articles/${state.ids.source}?mex=html&status=draft`, {
    token: state.tokens.full,
  });
  assert.equal(drafts.status, 200);
  assert.match(drafts.body.data.body, new RegExp(`/en/articles/${DRAFT_SLUG}"[^>]*>${DRAFT_TITLE}</a>`));
  // Without a token (public role without article access) nothing is served.
  const anonymous = await call('GET', `/api/categories/${state.ids.category}?mex=html`);
  assert.ok([401, 403].includes(anonymous.status));
});
