/**
 * Content API and GraphQL output (`?mex=`, `<field>Rendered`/`<field>Resolved`):
 * references resolve with the caller's permissions (API tokens of every type,
 * the users-permissions public role), draft-only entries never resolve in
 * published output, private fields never leak, admin routes are untouched.
 *
 * Host requirements on top of CONTRIBUTING.md: `api::category.category`
 * (Draft & Publish, `name`, `slug` uid, private `secretNote`, Magic Editor X
 * `body`), `api::article.article` with a `category` relation and a dynamic
 * zone `zone` of `blocks.text-section`, `links.urlPattern` set to
 * `/{locale}/{collection}/{slug}`, `api.rest.strictParams: true` and
 * `@strapi/plugin-graphql` 5.61.x.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, createArticle, makePng } from './helpers.mjs';

const RUN = Date.now().toString(36);
const ARTICLE = 'api::article.article';
const CATEGORY = 'api::category.category';
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const link = (uid, documentId, href, text, locale) =>
  `<a href="${href}" data-mex-uid="${uid}" data-mex-document-id="${documentId}"${
    locale ? ` data-mex-locale="${locale}"` : ''
  }>${text}</a>`;

const READABLE_SLUG = `readable-alpha-${RUN}`;
const DRAFT_TITLE = `Draft Secret ${RUN}`;
const DRAFT_SLUG = `draft-secret-${RUN}`;
const CATEGORY_NAME = `Hidden Cat ${RUN}`;
const CATEGORY_SLUG = `hidden-cat-${RUN}`;
const CATEGORY_NOTE = `Cat private note ${RUN}`;
const STORED_ENTRY_TITLE = `Stored Cat Title ${RUN}`;
const STALE_URL = 'https://cdn.example.test/stale.png';
const BLOCK_NAME = `entryCard${RUN}`;

/** Strings that must never appear in the output of a caller who may not see them. */
const DRAFT_SECRETS = [DRAFT_TITLE, DRAFT_SLUG];
const CATEGORY_SECRETS = [CATEGORY_NAME, CATEGORY_SLUG, STORED_ENTRY_TITLE];

const state = { tokens: {}, ids: {} };
let publicRole = null;

/**
 * @param {string} path - Content Manager path.
 * @returns {Promise<object>} Response body.
 */
const publish = async (path) => {
  const response = await call('POST', `${path}/actions/publish`, {
    token: await tokenFor('admin'),
    body: {},
  });
  assert.equal(response.status, 200, `publish ${path}: ${JSON.stringify(response.body).slice(0, 300)}`);
  return response.body;
};

/**
 * @param {string} name - Token name suffix.
 * @param {'read-only'|'full-access'|'custom'} type - Token type.
 * @param {string[]} [permissions] - Custom permissions.
 * @returns {Promise<string>} Access key.
 */
const apiToken = async (name, type, permissions) => {
  const response = await call('POST', '/admin/api-tokens', {
    token: await tokenFor('admin'),
    body: {
      name: `mex-out-${name}-${RUN}`,
      type,
      lifespan: null,
      description: 'integration',
      ...(permissions ? { permissions } : {}),
    },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body).slice(0, 300));
  return response.body.data.accessKey;
};

/**
 * Sets the users-permissions public role's actions for the given controllers.
 * @param {Record<string, Record<string, string[]>>} grants - `{ 'api::article': { article: ['find'] } }`.
 * @returns {Promise<object>} The role before the change.
 */
const setPublic = async (grants) => {
  const admin = await tokenFor('admin');
  const roles = await call('GET', '/users-permissions/roles', { token: admin });
  assert.equal(roles.status, 200);
  const role = roles.body.roles.find((item) => item.type === 'public');
  const detail = await call('GET', `/users-permissions/roles/${role.id}`, { token: admin });
  assert.equal(detail.status, 200);
  const before = JSON.parse(JSON.stringify(detail.body.role));
  const permissions = detail.body.role.permissions;
  for (const [api, controllers] of Object.entries(grants)) {
    for (const [controller, actions] of Object.entries(controllers)) {
      for (const action of actions) permissions[api].controllers[controller][action].enabled = true;
    }
  }
  const response = await call('PUT', `/users-permissions/roles/${role.id}`, {
    token: admin,
    body: { name: detail.body.role.name, description: detail.body.role.description, permissions },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  return before;
};

before(async () => {
  const admin = await tokenFor('admin');

  // Target entries: a published article, a draft-only article, a published category.
  const readable = await createArticle(admin, { title: `Readable Alpha ${RUN}`, slug: READABLE_SLUG });
  await publish(`/content-manager/collection-types/${ARTICLE}/${readable.documentId}`);
  const draft = await createArticle(admin, { title: DRAFT_TITLE, slug: DRAFT_SLUG });
  const created = await call('POST', `/content-manager/collection-types/${CATEGORY}`, {
    token: admin,
    body: {
      name: CATEGORY_NAME,
      slug: CATEGORY_SLUG,
      secretNote: CATEGORY_NOTE,
      body: doc([
        p('c1', `Back to ${link(ARTICLE, readable.documentId, '/stale-a', 'the article', 'en')}`),
        p('c2', `and ${link(ARTICLE, draft.documentId, '/stale-d', 'the draft', 'en')}`),
      ]),
    },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 300));
  const category = created.body.data;
  await publish(`/content-manager/collection-types/${CATEGORY}/${category.documentId}`);

  const block = await call('POST', '/magic-editor-x/custom-blocks', {
    token: admin,
    body: {
      name: BLOCK_NAME,
      label: 'Entry card',
      blockType: 'embedded-entry',
      contentType: CATEGORY,
      titleField: 'name',
      displayFields: ['name', 'secretNote'],
    },
  });
  assert.equal(block.status, 201, JSON.stringify(block.body).slice(0, 300));

  const image = new FormData();
  image.append('image', new Blob([makePng(8)], { type: 'image/png' }), 'pixel.png');
  const upload = await call('POST', '/magic-editor-x/image/byFile', { token: admin, body: image });
  assert.equal(upload.status, 200, JSON.stringify(upload.body));

  const links = (prefix) =>
    `${prefix} ${link(ARTICLE, readable.documentId, '/stale-readable', 'readable link', 'en')}, ` +
    `${link(ARTICLE, draft.documentId, `/articles/${DRAFT_SLUG}`, 'drafted link', 'en')} and ` +
    `${link(CATEGORY, category.documentId, `/categories/${CATEGORY_SLUG}`, 'category link')}`;
  const body = doc([
    p('s1', links('Body')),
    {
      id: 's2',
      type: BLOCK_NAME,
      data: {
        entry: {
          id: category.id,
          documentId: category.documentId,
          title: STORED_ENTRY_TITLE,
          secretNote: CATEGORY_NOTE,
        },
        contentType: CATEGORY,
        displayMode: 'card',
      },
    },
    {
      id: 's3',
      type: 'image',
      data: {
        file: { url: STALE_URL, id: upload.body.file.id, alt: 'stale alt' },
        caption: 'Picture',
      },
    },
  ]);
  const source = await createArticle(admin, {
    title: `Source ${RUN}`,
    slug: `source-${RUN}`,
    body,
    sections: [{ heading: 'One', body: doc([p('k1', links('Section'))]) }],
    zone: [{ __component: 'blocks.text-section', heading: 'Zone', body: doc([p('z1', links('Zone'))]) }],
    category: { connect: [{ documentId: category.documentId }] },
  });
  await publish(`/content-manager/collection-types/${ARTICLE}/${source.documentId}`);

  const home = await call('PUT', '/content-manager/single-types/api::homepage.homepage', {
    token: admin,
    body: { headline: `Home ${RUN}`, intro: doc([p('h1', links('Home'))]) },
  });
  assert.equal(home.status, 200, JSON.stringify(home.body).slice(0, 300));
  await publish('/content-manager/single-types/api::homepage.homepage');

  state.ids = {
    readable: readable.documentId,
    draft: draft.documentId,
    category: category.documentId,
    source: source.documentId,
  };
  state.tokens = {
    full: await apiToken('full', 'full-access'),
    readOnly: await apiToken('ro', 'read-only'),
    noCategory: await apiToken('nocat', 'custom', [
      `${ARTICLE}.find`,
      `${ARTICLE}.findOne`,
      'api::homepage.homepage.find',
    ]),
    noArticle: await apiToken('noart', 'custom', [
      `${CATEGORY}.find`,
      `${CATEGORY}.findOne`,
      'api::homepage.homepage.find',
    ]),
  };
  publicRole = await setPublic({
    'api::article': { article: ['find', 'findOne'] },
    'api::homepage': { homepage: ['find'] },
  });
});

after(async () => {
  if (!publicRole) return;
  const admin = await tokenFor('admin');
  await call('PUT', `/users-permissions/roles/${publicRole.id}`, {
    token: admin,
    body: { name: publicRole.name, description: publicRole.description, permissions: publicRole.permissions },
  });
});

/**
 * Expectations per caller.
 * @returns {Array<{ name: string, token: string|undefined, article: boolean, category: boolean, media: boolean }>} Callers.
 */
const callers = () => [
  { name: 'full-access token', token: state.tokens.full, article: true, category: true, media: true },
  { name: 'read-only token', token: state.tokens.readOnly, article: true, category: true, media: true },
  {
    name: 'custom token without category',
    token: state.tokens.noCategory,
    article: true,
    category: false,
    media: false,
  },
  { name: 'public role', token: undefined, article: true, category: false, media: false },
];

const readableHref = () => `/en/articles/${READABLE_SLUG}`;
const categoryHref = () => `/categories/${CATEGORY_SLUG}`;

/**
 * Checks one serialised output against a caller's rights.
 * @param {string} text - JSON or rendered output.
 * @param {{ name: string, article: boolean, category: boolean }} who - Caller.
 * @param {string} where - Label.
 */
const checkLeaks = (text, who, where) => {
  for (const secret of [...DRAFT_SECRETS, CATEGORY_NOTE, 'secretNote'])
    assert.ok(!text.includes(secret), `${who.name} ${where}: leaks ${secret}`);
  assert.ok(!text.includes(state.ids.draft), `${who.name} ${where}: leaks the draft documentId`);
  assert.ok(!text.includes('/stale-readable'), `${who.name} ${where}: keeps a stale href`);
  if (who.article) assert.ok(text.includes(readableHref()), `${who.name} ${where}: readable link resolved`);
  else assert.ok(!text.includes(READABLE_SLUG), `${who.name} ${where}: readable link removed`);
  if (who.category) assert.ok(text.includes(categoryHref()), `${who.name} ${where}: category link resolved`);
  else {
    for (const secret of CATEGORY_SECRETS)
      assert.ok(!text.includes(secret), `${who.name} ${where}: leaks ${secret}`);
    assert.ok(!text.includes(state.ids.category), `${who.name} ${where}: leaks the category documentId`);
  }
};

test('without mex the Content API response is unchanged', async () => {
  const response = await call('GET', `/api/articles/${state.ids.source}`, { token: state.tokens.full });
  assert.equal(response.status, 200);
  const body = response.body.data.body;
  assert.equal(typeof body, 'object');
  assert.match(body.blocks[0].data.text, /\/stale-readable/, 'stored hrefs are returned as stored');
  assert.equal(body.blocks[1].data.entry.title, STORED_ENTRY_TITLE);
});

test('mex=json resolves references per caller: tokens of every type and the public role', async () => {
  for (const who of callers()) {
    const populate = who.category
      ? 'populate[sections]=true&populate[zone]=true&populate[category]=true'
      : 'populate[sections]=true&populate[zone]=true';
    const response = await call('GET', `/api/articles/${state.ids.source}?mex=json&${populate}`, {
      token: who.token,
    });
    assert.equal(response.status, 200, `${who.name}: ${JSON.stringify(response.body).slice(0, 300)}`);
    const data = response.body.data;
    const text = JSON.stringify(data);
    checkLeaks(text, who, 'json');
    assert.match(data.body.blocks[0].data.text, /drafted link/, 'unresolved links keep their text');
    assert.doesNotMatch(data.body.blocks[0].data.text, /<a [^>]*>drafted link/, 'and lose the link');
    const entry = data.body.blocks[1].data.entry;
    if (who.category) {
      assert.equal(entry.title, CATEGORY_NAME);
      assert.equal(entry.documentId, state.ids.category);
      assert.equal(entry.href, categoryHref());
      assert.equal(entry.name, CATEGORY_NAME);
      assert.equal(entry.secretNote, undefined, 'private display fields are dropped');
      assert.ok(data.category, 'populated relation');
      assert.match(data.category.body.blocks[0].data.text, new RegExp(readableHref()));
    } else {
      assert.equal(entry, null, `${who.name}: unreadable entry`);
    }
    const file = data.body.blocks[2].data.file;
    if (who.media) {
      assert.match(file.url, /^\/uploads\/.+\.png$/);
      assert.equal(file.alt, 'stale alt', 'the alt text of the block wins');
    } else {
      assert.equal(file.url, STALE_URL, `${who.name}: stored file kept`);
    }
    assert.match(data.sections[0].body.blocks[0].data.text, /Section/);
    assert.match(data.zone[0].body.blocks[0].data.text, /Zone/);
    if (who.article) {
      assert.match(data.sections[0].body.blocks[0].data.text, new RegExp(readableHref()));
      assert.match(data.zone[0].body.blocks[0].data.text, new RegExp(readableHref()));
    }
  }
});

test('mex=html|text|markdown render strings without leaks, also for find and single types', async () => {
  for (const who of callers()) {
    for (const format of ['html', 'text', 'markdown']) {
      const one = await call(
        'GET',
        `/api/articles/${state.ids.source}?mex=${format}&populate[sections]=true`,
        {
          token: who.token,
        }
      );
      assert.equal(one.status, 200, `${who.name} ${format}`);
      assert.equal(typeof one.body.data.body, 'string');
      assert.equal(typeof one.body.data.sections[0].body, 'string');
      assert.equal(typeof one.body.data.summary, 'object', 'empty fields stay null');
      // Text output has no hrefs; check leaks on every format, link resolution on html and markdown.
      const text = JSON.stringify(one.body.data);
      if (format === 'text') {
        for (const secret of [...DRAFT_SECRETS, CATEGORY_NOTE, ...(who.category ? [] : CATEGORY_SECRETS)])
          assert.ok(!text.includes(secret), `${who.name} text leaks ${secret}`);
        if (who.category) assert.match(one.body.data.body, new RegExp(CATEGORY_NAME));
      } else checkLeaks(text, who, format);

      const list = await call(
        'GET',
        `/api/articles?mex=${format}&filters[documentId][$eq]=${state.ids.source}`,
        { token: who.token }
      );
      assert.equal(list.status, 200);
      assert.equal(list.body.data.length, 1);
      assert.equal(typeof list.body.data[0].body, 'string');
      assert.equal(list.body.data[0].body, one.body.data.body);

      const home = await call('GET', `/api/homepage?mex=${format}`, { token: who.token });
      assert.equal(home.status, 200, `${who.name} homepage ${format}`);
      assert.equal(typeof home.body.data.intro, 'string');
      if (format !== 'text') checkLeaks(JSON.stringify(home.body.data), who, `homepage ${format}`);
    }
  }
  const html = await call('GET', `/api/articles/${state.ids.source}?mex=html`, { token: state.tokens.full });
  assert.match(html.body.data.body, new RegExp(`<a class="mex-entry-link" href="${categoryHref()}">`));
  assert.match(html.body.data.body, /<img src="\/uploads\//);
});

test('a token without the article type gets no article links, only what it may read', async () => {
  const who = { name: 'custom token without article', article: false, category: true };
  const home = await call('GET', '/api/homepage?mex=json', { token: state.tokens.noArticle });
  assert.equal(home.status, 200);
  checkLeaks(JSON.stringify(home.body.data), who, 'homepage json');
  assert.match(home.body.data.intro.blocks[0].data.text, /readable link/);
  const category = await call('GET', `/api/categories/${state.ids.category}?mex=html`, {
    token: state.tokens.noArticle,
  });
  assert.equal(category.status, 200);
  assert.doesNotMatch(category.body.data.body, /<a /);
  assert.equal(category.body.data.secretNote, undefined);
  const denied = await call('GET', `/api/articles/${state.ids.source}?mex=json`, {
    token: state.tokens.noArticle,
  });
  assert.equal(denied.status, 403);
});

test('status=draft resolves drafts for callers who may read drafts; admin routes are untouched', async () => {
  const draft = await call('GET', `/api/articles/${state.ids.source}?mex=html&status=draft`, {
    token: state.tokens.full,
  });
  assert.equal(draft.status, 200);
  assert.match(draft.body.data.body, new RegExp(`/en/articles/${DRAFT_SLUG}`));

  const admin = await call(
    'GET',
    `/content-manager/collection-types/${ARTICLE}/${state.ids.source}?mex=html`,
    {
      token: await tokenFor('admin'),
    }
  );
  assert.equal(admin.status, 200);
  assert.equal(typeof admin.body.data.body, 'object', 'the Content Manager gets the stored value');

  const invalid = await call('GET', `/api/articles/${state.ids.source}?mex=xml`, {
    token: state.tokens.full,
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.name, 'ValidationError');
  const strict = await call('GET', `/api/articles/${state.ids.source}?unknownParam=1`, {
    token: state.tokens.full,
  });
  assert.equal(strict.status, 400, 'the host runs with strictParams, and mex is a registered parameter');
});

test('GraphQL: Rendered and Resolved fields with the same permission rules', async () => {
  const query = `query ($id: ID!) {
    article(documentId: $id) {
      bodyRendered(format: HTML)
      bodyText: bodyRendered(format: TEXT)
      bodyResolved
      sections { bodyRendered(format: MARKDOWN) }
    }
    articles(filters: { slug: { startsWith: "source-${RUN}" } }) { bodyRendered }
    homepage { introRendered }
  }`;
  for (const who of callers()) {
    const response = await call('POST', '/graphql', {
      token: who.token,
      body: { query, variables: { id: state.ids.source } },
    });
    assert.equal(response.status, 200, `${who.name}: ${JSON.stringify(response.body).slice(0, 400)}`);
    assert.equal(response.body.errors, undefined, `${who.name}: ${JSON.stringify(response.body.errors)}`);
    const data = response.body.data;
    assert.equal(typeof data.article.bodyRendered, 'string');
    assert.equal(typeof data.article.bodyResolved, 'object');
    assert.equal(data.articles[0].bodyRendered, data.article.bodyRendered);
    const html = JSON.stringify({ ...data, article: { ...data.article, bodyText: '' } });
    checkLeaks(html, who, 'graphql');
    assert.match(data.article.sections[0].bodyRendered, /Section/);
    assert.equal(typeof data.homepage.introRendered, 'string');
    for (const secret of [...DRAFT_SECRETS, CATEGORY_NOTE])
      assert.ok(!data.article.bodyText.includes(secret), `${who.name} graphql text leaks ${secret}`);
  }
});
