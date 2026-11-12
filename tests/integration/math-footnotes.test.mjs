import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as Y from 'yjs';
import { call, tokenFor, createArticle, openSession, connect, waitFor } from './helpers.mjs';
import { applyEditorDataToDoc, docToEditorData } from '../../shared/ydoc.mjs';

/**
 * Math blocks, inline math and footnotes (2.4) against a running host:
 * hostile input is stored inert in the canonical form, presets strip what
 * they do not allow, a pre-2.4 custom block named `math` keeps its data,
 * `?mex=html|text|markdown` renders MathML and footnotes, and the live
 * collaboration guard accepts the new markup. Synthetic data only.
 *
 * Host requirement: start it with `MEX_LEGACY_BLOCKS=true` (like
 * reserved-names.test.mjs); the acceptance host then also writes a Settings
 * custom block named `math` the way a 2.3 site could have it.
 */

const RUN = crypto.randomBytes(3).toString('hex');
const ARTICLE = 'api::article.article';
const CM = `/content-manager/collection-types/${ARTICLE}`;
const doc = (blocks) => ({ time: Date.now(), version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const attr = (html) =>
  html.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const note = (id, html) => `<sup data-mex-footnote="${id}" data-mex-note="${attr(html)}">1</sup>`;

const HOSTILE = doc([
  {
    id: 'm1',
    type: 'math',
    data: {
      tex: '\\frac{a}{b} \\href{javascript:alert(1)}{x}</div><script>alert(1)</script>',
      display: true,
    },
  },
  {
    id: 'm2',
    type: 'math',
    data: { tex: '\\rule{100000em}{100000em}', display: false, _mex: 1, onclick: 'x' },
  },
  p(
    'p1',
    `E=<span data-mex-math="" onclick="alert(1)" class="cdx-tooltip">mc^2<img src=x onerror=alert(1)></span>` +
      note(
        'fn1',
        'See <b>this</b><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a> <a href="https://e.example.test/a" data-mex-uid="api::article.article" data-mex-document-id="abc">ok</a>'
      ) +
      ` and${note('fn2', 'Second <span data-mex-math>x^2</span>')}.`
  ),
  { id: 'h1', type: 'header', data: { text: `Heading${note('fn3', 'In a heading')}`, level: 2 } },
]);

const STORED_P1 =
  'E=<span data-mex-math="true">mc^2</span><sup data-mex-footnote="fn1" data-mex-note="See &lt;b&gt;this&lt;/b&gt;x &lt;a href=&quot;https://e.example.test/a&quot;&gt;ok&lt;/a&gt;">1</sup> and<sup data-mex-footnote="fn2" data-mex-note="Second &lt;span data-mex-math=&quot;true&quot;&gt;x^2&lt;/span&gt;">1</sup>.';

const state = {};

/** Read-only API token for the Content API checks. */
const readToken = async () => {
  if (state.apiToken) return state.apiToken;
  const response = await call('POST', '/admin/api-tokens', {
    token: await tokenFor('admin'),
    body: { name: `mex-math-${RUN}`, type: 'read-only', lifespan: null, description: 'integration' },
  });
  assert.equal(response.status, 201, JSON.stringify(response.body).slice(0, 300));
  state.apiToken = response.body.data.accessKey;
  return state.apiToken;
};

test('hostile math and footnotes are stored inert in the canonical form', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, {
    title: `Math ${RUN}`,
    body: HOSTILE,
    summary: doc([p('s1', `Summary <span data-mex-math>x</span>${note('sf', 'gone')} end`)]),
    teaser: doc([p('t1', `Teaser${note('tf', 'gone')}`)]),
  });
  state.documentId = article.documentId;
  const stored = await call('GET', `${CM}/${article.documentId}?locale=en`, { token: editor });
  assert.equal(stored.status, 200);
  const body = stored.body.data.body;
  assert.deepEqual(body.blocks[0].data, {
    tex: '\\frac{a}{b} \\href{javascript:alert(1)}{x}</div><script>alert(1)</script>',
    display: true,
    _mex: 1,
  });
  assert.deepEqual(body.blocks[1].data, { tex: '\\rule{100000em}{100000em}', display: false, _mex: 1 });
  assert.equal(body.blocks[2].data.text, STORED_P1);
  assert.match(
    body.blocks[3].data.text,
    /^Heading<sup data-mex-footnote="fn3" data-mex-note="In a heading">1<\/sup>$/
  );
  // basic preset (summary): math unwrapped, footnotes removed; minimal (teaser) too.
  assert.equal(stored.body.data.summary.blocks[0].data.text, 'Summary x end');
  assert.equal(stored.body.data.teaser.blocks[0].data.text, 'Teaser');
});

test('a math block is refused where the preset does not allow it', async () => {
  const editor = await tokenFor('editor');
  const response = await call('POST', CM, {
    token: editor,
    body: { title: `Math preset ${RUN}`, summary: doc([{ id: 'x', type: 'math', data: { tex: 'x' } }]) },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error.details.code, 'PRESET_VIOLATION');
  assert.equal(response.body.error.details.violations[0].code, 'BLOCK_NOT_ALLOWED');
});

test('a custom block named math from before 2.4 keeps its data; new ones cannot take the name', async () => {
  const admin = await tokenFor('admin');
  const editor = await tokenFor('editor');
  const created = await call('POST', '/magic-editor-x/custom-blocks', {
    token: admin,
    body: {
      name: 'math',
      label: 'Math',
      blockType: 'simple',
      fields: [{ name: 'formula', label: 'Formula', type: 'text' }],
    },
  });
  assert.equal(created.status, 400, 'new custom blocks cannot be named math');
  // Data a Settings block named math wrote before 2.4 (no marker, custom shape).
  const legacy = { content: { formula: 'E=mc^2 <b>x</b>' }, blockType: 'simple', blockName: 'math' };
  const article = await createArticle(editor, {
    title: `Legacy math ${RUN}`,
    body: doc([{ id: 'lm', type: 'math', data: legacy }]),
  });
  const stored = await call('GET', `${CM}/${article.documentId}?locale=en`, { token: editor });
  assert.deepEqual(stored.body.data.body.blocks[0].data, legacy);
  // The Settings block named math from before 2.4 (host started with MEX_LEGACY_BLOCKS=true)
  // keeps its name on update.
  const list = await call('GET', '/magic-editor-x/custom-blocks?all=true', { token: admin });
  const block = list.body.data.find((item) => item.name === 'math');
  assert.ok(block, 'the host must be started with MEX_LEGACY_BLOCKS=true (Settings custom block "math")');
  const { id, createdAt: _c, updatedAt: _u, ...definition } = block;
  const updated = await call('PUT', `/magic-editor-x/custom-blocks/${id}`, {
    token: admin,
    body: { ...definition, label: `Legacy formula box ${RUN}` },
  });
  assert.equal(updated.status, 200, JSON.stringify(updated.body).slice(0, 300));
  assert.equal(updated.body.data.name, 'math');
  // Its stored data renders as custom block data in ?mex=html (not as a formula).
  const token = await readToken();
  const publish = await call('POST', `${CM}/${article.documentId}/actions/publish?locale=en`, {
    token: admin,
    body: {},
  });
  assert.equal(publish.status, 200);
  const html = await call('GET', `/api/articles/${article.documentId}?mex=html`, { token });
  // Neutral custom block output (`mex-block mex-<type>`), never the formula renderer.
  assert.doesNotMatch(html.body.data.body, /data-mex-math|<math/);
  assert.match(html.body.data.body, /^<div class="mex-block mex-math" data-mex-block="math">/);
});

test('?mex=html|text|markdown render MathML and footnotes; nothing unsafe leaks', async () => {
  const publish = await call('POST', `${CM}/${state.documentId}/actions/publish?locale=en`, {
    token: await tokenFor('admin'),
    body: {},
  });
  assert.equal(publish.status, 200, JSON.stringify(publish.body).slice(0, 300));
  const token = await readToken();
  const html = await call('GET', `/api/articles/${state.documentId}?mex=html`, { token });
  assert.equal(html.status, 200);
  const out = html.body.data.body;
  // Block 1 uses \href, which Temml does not know: the delimited TeX source (escaped) instead.
  assert.ok(
    out.startsWith(
      '<div class="mex-math mex-math-display" data-mex-math="display">\\[\\frac{a}{b} \\href{javascript:alert(1)}{x}&lt;/div&gt;&lt;script&gt;'
    ),
    out.slice(0, 200)
  );
  // Inline math in the paragraph is MathML.
  assert.match(
    out,
    /E=<span class="mex-math" data-mex-math="inline"><math><semantics><mrow><mi>m<\/mi><msup>/
  );
  assert.doesNotMatch(out, /<script|onerror=|onclick=|javascript:alert\(1\)"|style=|<img/);
  assert.match(out, /<mspace mathbackground="black" width="20em" height="20em"><\/mspace>/);
  const prefix = /id="(mex-[0-9a-f]{8}-)fnref-fn1"/.exec(out);
  assert.ok(prefix, 'footnote ids carry a per-value prefix');
  assert.match(
    out,
    new RegExp(`<section class="mex-footnotes" aria-labelledby="${prefix[1]}footnotes-label">`)
  );
  assert.match(
    out,
    /<li id="mex-[0-9a-f]{8}-fn-fn1" class="mex-footnote">See <b>this<\/b>x <a href="https:\/\/e\.example\.test\/a">ok<\/a> /
  );
  // Numbering follows the reading order: fn1, fn2 (paragraph), fn3 (heading after it).
  assert.match(out, /fnref-fn1"[^>]*>1<\/a>[\s\S]*fnref-fn2"[^>]*>2<\/a>[\s\S]*fnref-fn3"[^>]*>3<\/a>/);
  const text = await call('GET', `/api/articles/${state.documentId}?mex=text`, { token });
  assert.equal(
    text.body.data.body,
    [
      '\\frac{a}{b} \\href{javascript:alert(1)}{x}</div><script>alert(1)</script>',
      '\\rule{100000em}{100000em}',
      'E=mc^2[1] and[2].',
      'Heading[3]',
      'Footnotes\n[1] See thisx ok\n[2] Second x^2\n[3] In a heading',
    ].join('\n\n')
  );
  const markdown = await call('GET', `/api/articles/${state.documentId}?mex=markdown`, { token });
  assert.equal(
    markdown.body.data.body,
    [
      '$$\n\\frac{a}{b} \\href{javascript:alert(1)}{x}< /div>< script>alert(1)< /script>\n$$',
      '$\\rule{100000em}{100000em}$',
      'E=$mc^2$[^1] and[^2].',
      '## Heading[^3]',
      '[^1]: See **this**x [ok](https://e.example.test/a)\n[^2]: Second $x^2$\n[^3]: In a heading',
    ].join('\n\n')
  );
  // Without ?mex the stored value is returned unchanged.
  const plain = await call('GET', `/api/articles/${state.documentId}`, { token });
  assert.equal(plain.body.data.body.blocks[2].data.text, STORED_P1);
});

test('live collaboration accepts math blocks, inline math and footnotes', async () => {
  const editor = await tokenFor('editor');
  const article = await createArticle(editor, { title: `Live math ${RUN}`, body: doc([p('l1', 'start')]) });
  const target = { uid: ARTICLE, documentId: article.documentId, locale: 'en', field: 'body' };
  const a = await connect(await openSession(editor, target));
  const b = await connect(await openSession(editor, target));
  const next = doc([
    p(
      'l1',
      `start <span data-mex-math="true">x^2</span><sup data-mex-footnote="lf1" data-mex-note="A note">1</sup>`
    ),
    { id: 'lm', type: 'math', data: { tex: '\\sqrt{2}', display: true, _mex: 1 } },
  ]);
  const before = Y.encodeStateVector(a.ydoc);
  applyEditorDataToDoc(a.ydoc, next);
  const reply = await new Promise((resolve) =>
    a.socket
      .timeout(5000)
      .emit('mx:update', Y.encodeStateAsUpdate(a.ydoc, before), (error, value) =>
        resolve(error ? { timeout: true } : value)
      )
  );
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.notEqual(
    await waitFor(() => docToEditorData(b.ydoc).blocks.length === 2),
    -1,
    'the second client receives the update'
  );
  assert.deepEqual(docToEditorData(b.ydoc).blocks, next.blocks);
  for (const client of [a, b]) client.socket.disconnect();
});
