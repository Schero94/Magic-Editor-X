/**
 * 2.5 inline formatting against a host: palette tokens and annotations are
 * kept only where the field turns them on (unknown ones are unwrapped on
 * save), and Content API `?mex=` output renders them with the glossary
 * annotation resolved through a permission-aware, batched lookup.
 *
 * Host requirements (CONTRIBUTING.md acceptance host): config `palette`
 * with colours `accent`, `success`, `faint` and highlights `note`, `info`;
 * the glossary annotation of tests/fixtures/glossary.mjs registered in the
 * host's register(); content type `api::glossary-term.glossary-term`
 * (`slug`, `definition`, draft and publish); article fields `body` (options
 * inlineColors, inlineScript, inlineAnnotations "abbreviation, glossary"),
 * `summary` (preset basic, inlineScript) and `teaser` (preset minimal).
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { call, tokenFor, createArticle } from './helpers.mjs';

const RUN = Date.now().toString(36);
const GLOSSARY = '/content-manager/collection-types/api::glossary-term.glossary-term';
const ARTICLES = '/content-manager/collection-types/api::article.article';
const doc = (text) => ({
  time: 1,
  version: '2.31.7',
  blocks: [{ id: `p${RUN}`, type: 'paragraph', data: { text } }],
});
const textOf = (value) => (typeof value === 'string' ? JSON.parse(value) : value).blocks[0].data.text;
const state = {};

const setPublic = async (grants) => {
  const admin = await tokenFor('admin');
  const roles = await call('GET', '/users-permissions/roles', { token: admin });
  const role = roles.body.roles.find((item) => item.type === 'public');
  const detail = await call('GET', `/users-permissions/roles/${role.id}`, { token: admin });
  const permissions = detail.body.role.permissions;
  for (const [api, controllers] of Object.entries(grants))
    for (const [controller, actions] of Object.entries(controllers))
      for (const [action, enabled] of Object.entries(actions))
        permissions[api].controllers[controller][action].enabled = enabled;
  const response = await call('PUT', `/users-permissions/roles/${role.id}`, {
    token: admin,
    body: { name: detail.body.role.name, description: detail.body.role.description, permissions },
  });
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
};

const createTerm = async (slug, definition, publish) => {
  const admin = await tokenFor('admin');
  const created = await call('POST', GLOSSARY, {
    token: admin,
    body: { slug, definition, secretSource: `secret-${RUN}` },
  });
  assert.equal(created.status, 201, JSON.stringify(created.body).slice(0, 300));
  if (publish) {
    const published = await call('POST', `${GLOSSARY}/${created.body.data.documentId}/actions/publish`, {
      token: admin,
      body: {},
    });
    assert.equal(published.status, 200);
  }
  return created.body.data.documentId;
};

before(async () => {
  const admin = await tokenFor('admin');
  await createTerm(`api-${RUN}`, `Application programming interface ${RUN}`, true);
  await createTerm(`draft-${RUN}`, `Draft definition ${RUN}`, false);
  const body = [
    '<span data-mex-color="accent">a</span>',
    '<span data-mex-color="ghost">b</span>',
    '<mark data-mex-highlight="note">c</mark>',
    '<mark data-mex-highlight="ghost">d</mark>',
    '<span data-mex-annotation="abbreviation" data-mex-a-title="HyperText Markup Language" data-mex-a-x="drop">HTML</span>',
    '<span data-mex-annotation="abbreviation">NOTITLE</span>',
    `<span data-mex-annotation="glossary" data-mex-a-term="api-${RUN}">API</span>`,
    `<span data-mex-annotation="glossary" data-mex-a-term="draft-${RUN}">DRAFT</span>`,
    '<span data-mex-annotation="unknown" data-mex-a-y="1">U</span>',
    '<span data-mex-color="accent" style="color:red" onclick="alert(1)">s</span>',
    ' m<sup>2</sup> H<sub>2</sub>O',
  ].join('');
  const article = await createArticle(admin, {
    title: `Inline ${RUN}`,
    slug: `inline-${RUN}`,
    body: doc(body),
    summary: doc('<span data-mex-color="accent">x</span> m<sup>2</sup> H<sub>2</sub>O'),
    teaser: doc('<span data-mex-color="accent">t</span><sup>2</sup>'),
  });
  state.id = article.documentId;
  state.saved = article;
  const published = await call('POST', `${ARTICLES}/${state.id}/actions/publish`, { token: admin, body: {} });
  assert.equal(published.status, 200, JSON.stringify(published.body).slice(0, 300));
});

after(async () => {
  await setPublic({
    'api::article': { article: { find: false } },
    'api::glossary-term': { 'glossary-term': { find: false } },
  });
});

test('GET /config lists the palette and the annotations (no functions)', async () => {
  const response = await call('GET', '/magic-editor-x/config', { token: await tokenFor('editor') });
  assert.equal(response.status, 200);
  const { palette, annotations } = response.body.data;
  assert.deepEqual(
    palette.colors.map((token) => token.name),
    ['accent', 'success', 'faint']
  );
  assert.deepEqual(
    palette.highlights.map((token) => token.name),
    ['note', 'info']
  );
  assert.deepEqual(
    annotations.map((item) => [item.name, item.builtIn, item.resolves]),
    [
      ['abbreviation', true, false],
      ['glossary', false, true],
    ]
  );
  assert.equal(JSON.stringify(response.body).includes('function'), false);
});

test('save: known tokens and annotations stay, unknown ones are unwrapped, per field', async () => {
  const { saved } = state;
  assert.equal(
    textOf(saved.body),
    `<span data-mex-color="accent">a</span>b<mark data-mex-highlight="note">c</mark>d<span data-mex-annotation="abbreviation" data-mex-a-title="HyperText Markup Language">HTML</span>NOTITLE<span data-mex-annotation="glossary" data-mex-a-term="api-${RUN}">API</span><span data-mex-annotation="glossary" data-mex-a-term="draft-${RUN}">DRAFT</span>U<span data-mex-color="accent">s</span> m<sup>2</sup> H<sub>2</sub>O`
  );
  // basic + superscript/subscript: no colours (option off), sup and sub kept.
  assert.equal(textOf(saved.summary), 'x m<sup>2</sup> H<sub>2</sub>O');
  // minimal without options: everything new is unwrapped (as in 2.4).
  assert.equal(textOf(saved.teaser), 't2');
});

test('?mex=html renders classes and abbreviations; glossary resolves only with permission and published', async () => {
  const url = `/api/articles?filters[slug][$eq]=inline-${RUN}&mex=html`;
  await setPublic({
    'api::article': { article: { find: true } },
    'api::glossary-term': { 'glossary-term': { find: false } },
  });
  let response = await call('GET', url);
  assert.equal(response.status, 200, JSON.stringify(response.body).slice(0, 300));
  let html = response.body.data[0].body;
  assert.match(html, /<span class="mex-color-accent" data-mex-color="accent">a<\/span>/);
  assert.match(html, /<mark class="mex-highlight-note" data-mex-highlight="note">c<\/mark>/);
  assert.match(html, /<abbr title="HyperText Markup Language">HTML<\/abbr>/);
  // No glossary permission: rendered without the definition.
  assert.match(html, new RegExp(`<dfn class="glossary-term" data-term="api-${RUN}">API</dfn>`));
  assert.doesNotMatch(html, /Application programming interface/);
  assert.doesNotMatch(html, /style=|onclick/);

  await setPublic({ 'api::glossary-term': { 'glossary-term': { find: true } } });
  response = await call('GET', url);
  html = response.body.data[0].body;
  assert.match(
    html,
    new RegExp(
      `<dfn class="glossary-term" data-term="api-${RUN}" title="Application programming interface ${RUN}">API</dfn>`
    )
  );
  // A draft-only term never resolves in published output; private fields never leak.
  assert.match(html, new RegExp(`<dfn class="glossary-term" data-term="draft-${RUN}">DRAFT</dfn>`));
  assert.doesNotMatch(html, new RegExp(`Draft definition ${RUN}|secret-${RUN}`));

  const text = await call('GET', `/api/articles?filters[slug][$eq]=inline-${RUN}&mex=text`);
  assert.match(text.body.data[0].body, /^abcdHTMLNOTITLEAPIDRAFTUs m2 H2O$/);
  // JSON output keeps the stored form.
  const json = await call('GET', `/api/articles?filters[slug][$eq]=inline-${RUN}&mex=json`);
  assert.match(JSON.stringify(json.body.data[0].body), /data-mex-annotation=\\"glossary\\"/);
});

test('Settings lists the palette with its contrast problems and the site CSS', async () => {
  const response = await call('GET', '/magic-editor-x/settings', { token: await tokenFor('admin') });
  assert.equal(response.status, 200);
  const { palette } = response.body.data.environment;
  assert.ok(palette.issues.some((issue) => issue.color === 'faint'));
  assert.ok(palette.issues.every((issue) => issue.ratio < 4.5));
  assert.match(palette.css, /\.mex-color-accent \{ color: #b3261e; \}/);
  assert.deepEqual(
    palette.annotations.map((item) => item.name),
    ['abbreviation', 'glossary']
  );
});
