import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { renderHtml, renderText, renderMarkdown, renderTree, inlineToHtml } from '../shared/render/index.mjs';
import { BLOCK_POLICIES, cleanInternalLinkAttributes, isMentionLink } from '../shared/sanitize-policy.mjs';
import {
  buildTocTree,
  createAnchorAllocator,
  createSlugAllocator,
  githubSlug,
  tocRange,
} from '../shared/toc.mjs';
import {
  CODE_LANGUAGES,
  CODE_LANGUAGE_LABELS,
  CODE_LANGUAGE_ALIASES,
  normalizeCodeLanguage,
} from '../shared/code-languages.mjs';
import { collectReferences, applyReferences, entryKey } from '../shared/resolve-references.mjs';
import { resolveFieldPreset, checkPreset, checkBlockStructure, isBlockAllowed } from '../shared/presets.mjs';
import { lintDocument, extractLinks } from '../shared/quality.mjs';
import { blockText, diffDocuments } from '../shared/diff.mjs';
import { findMatches, replaceMatches } from '../shared/find-replace.mjs';
import { mentionAttributes, mentionText, normalizeToc } from '../admin/src/editor/tools/logic.mjs';

const require = createRequire(import.meta.url);
const { cleanEditorValue, sanitizeInlineHtml } = require('../server/src/utils/sanitizer.js');
const createReferences = require('../server/src/services/references.js');

/**
 * Magic Editor X 2.3 structure blocks: table of contents (`toc`), mentions
 * (inline entry references) and the shared code language list.
 */

const ARTICLE = 'api::article.article';
const CATEGORY = 'api::category.category';
const doc = (...blocks) => ({
  time: 1,
  version: '2.31.7',
  blocks: blocks.map((block, index) => ({ id: block.id || `b${index}`, ...block })),
});
const mention = (uid, id, text, locale = 'en', href = `/x/${id}`) =>
  `<a href="${href}" data-mex-uid="${uid}" data-mex-document-id="${id}" data-mex-locale="${locale}" data-mex-mention="true">${text}</a>`;

/* ------------------------------------------------------------------ toc */

test('toc policy clamps levels, orders the range and keeps a plain title', () => {
  const clean = (data) => BLOCK_POLICIES.toc(data, (s) => s, { rawHtml: 'sanitize' });
  assert.deepEqual(clean({}), { title: '', minLevel: 2, maxLevel: 4, style: 'unordered' });
  assert.deepEqual(clean({ title: 'x'.repeat(300), minLevel: 5, maxLevel: 3, style: 'ordered', extra: 1 }), {
    title: 'x'.repeat(200),
    minLevel: 3,
    maxLevel: 5,
    style: 'ordered',
  });
  assert.deepEqual(clean({ minLevel: 0, maxLevel: 9, style: 'checklist', title: 7 }), {
    title: '',
    minLevel: 2,
    maxLevel: 4,
    style: 'unordered',
  });
  // Stored through the server sanitiser: the title stays text, the block keeps its shape.
  const stored = cleanEditorValue(
    doc({ type: 'toc', data: { title: '<img src=x onerror=alert(1)>Inhalt', minLevel: '2', maxLevel: 3 } })
  );
  assert.deepEqual(stored.blocks[0].data, {
    title: '<img src=x onerror=alert(1)>Inhalt',
    minLevel: 2,
    maxLevel: 3,
    style: 'unordered',
  });
  assert.equal(tocRange({ minLevel: 6, maxLevel: 1 }).minLevel, 1);
});

const ARTICLE_DOC = () =>
  doc(
    { id: 'toc1', type: 'toc', data: { title: 'Contents', minLevel: 2, maxLevel: 3, style: 'ordered' } },
    { id: 'h1', type: 'header', data: { text: 'Title', level: 1 } },
    { id: 'hA', type: 'header', data: { text: 'Intro <b>bold</b>', level: 2 } },
    { id: 'hB', type: 'header', data: { text: 'Details & more', level: 3 } },
    { id: 'hC', type: 'header', data: { text: 'Too deep', level: 4 } },
    { id: 'hD', type: 'header', data: { text: '', level: 2 } },
    { id: 'tg', type: 'toggle', data: { text: 'More', status: 'closed', items: 1 } },
    { id: 'hE', type: 'header', data: { text: 'Inside a toggle', level: 2 } },
    { id: 'p1', type: 'paragraph', data: { text: 'Text' } }
  );

test('toc renders a nested list of links to stable heading ids (HTML, tree)', () => {
  const html = renderHtml(ARTICLE_DOC());
  assert.ok(
    html.startsWith(
      '<nav class="mex-toc mex-toc-ordered" aria-label="Contents"><p class="mex-toc-title">Contents</p><ol class="mex-toc-list"><li class="mex-toc-item"><a href="#mex-h-hA">Intro bold</a><ol class="mex-toc-list"><li class="mex-toc-item"><a href="#mex-h-hB">Details &amp; more</a></li></ol></li><li class="mex-toc-item"><a href="#mex-h-hE">Inside a toggle</a></li></ol></nav>'
    ),
    html
  );
  assert.match(html, /<h1 id="mex-h-h1" class="mex-header">Title<\/h1>/);
  assert.match(html, /<h2 id="mex-h-hA" class="mex-header">Intro <b>bold<\/b><\/h2>/);
  assert.match(html, /<h4 id="mex-h-hC" class="mex-header">/);
  assert.match(html, /<h2 id="mex-h-hE" class="mex-header">Inside a toggle<\/h2>/);
  // Ids do not depend on the text: editing a heading keeps its anchor.
  const edited = ARTICLE_DOC();
  edited.blocks[2].data.text = 'Introduction, rewritten';
  assert.match(renderHtml(edited), /<a href="#mex-h-hA">Introduction, rewritten<\/a>/);
  // The tree carries the same nodes.
  const nav = renderTree(ARTICLE_DOC())[0];
  assert.equal(nav.tag, 'nav');
  assert.equal(nav.attrs['aria-label'], 'Contents');
});

test('heading ids: off without a toc, on with headingIds, off with headingIds false', () => {
  const plain = doc({ id: 'h', type: 'header', data: { text: 'A', level: 2 } });
  assert.equal(renderHtml(plain), '<h2 class="mex-header">A</h2>', '2.2 output unchanged');
  assert.equal(renderHtml(plain, { headingIds: true }), '<h2 id="mex-h-h" class="mex-header">A</h2>');
  const off = renderHtml(ARTICLE_DOC(), { headingIds: false });
  assert.doesNotMatch(off, /id="mex-h-|href="#/);
  assert.match(off, /<li class="mex-toc-item">Intro bold<ol/);
  // Without a title the nav gets the label option (or the default).
  const untitled = doc({ type: 'toc', data: {} }, { id: 'x', type: 'header', data: { text: 'A', level: 2 } });
  assert.match(
    renderHtml(untitled),
    /<nav class="mex-toc mex-toc-unordered" aria-label="Table of contents"><ul/
  );
  assert.match(renderHtml(untitled, { toc: { label: 'Inhalt' } }), /aria-label="Inhalt"/);
  assert.match(renderHtml(untitled, { toc: { label: '' } }), /aria-label="Table of contents"/);
  // A toc without matching headings renders nothing.
  assert.equal(renderHtml(doc({ type: 'toc', data: { minLevel: 5, maxLevel: 6 } })), '');
});

test('anchor ids are unique and safe for any block id', () => {
  const allocate = createAnchorAllocator();
  assert.equal(allocate('abc'), 'mex-h-abc');
  assert.equal(allocate('abc'), 'mex-h-abc-2');
  assert.equal(allocate('a b"><script>'), 'mex-h-3');
  assert.equal(allocate(undefined), 'mex-h-4');
  const html = renderHtml(
    doc(
      { type: 'toc', data: {} },
      { id: 'same', type: 'header', data: { text: 'One', level: 2 } },
      { id: 'same', type: 'header', data: { text: 'Two', level: 2 } }
    )
  );
  const ids = [...html.matchAll(/ id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  for (const id of ids) assert.match(id, /^mex-h-[A-Za-z0-9_-]+$/);
  for (const href of [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]))
    assert.ok(ids.includes(href), href);
});

test('toc in text and Markdown', () => {
  assert.equal(
    renderText(ARTICLE_DOC()).split('\n\n')[0],
    'Contents\n1. Intro bold\n  1. Details & more\n2. Inside a toggle'
  );
  const md = renderMarkdown(ARTICLE_DOC());
  assert.ok(
    md.startsWith(
      '**Contents**\n\n1. [Intro bold](#intro-bold)\n   1. [Details \\& more](#details--more)\n2. [Inside a toggle](#inside-a-toggle)\n\n'
    ),
    md
  );
  // Headings stay plain Markdown (no HTML anchors).
  assert.match(md, /\n## Intro \*\*bold\*\*\n/);
  assert.doesNotMatch(md, /<a /);
  assert.equal(githubSlug('Über uns: Café (2026)!'), 'über-uns-café-2026');
  const slug = createSlugAllocator();
  assert.deepEqual(['A', 'A', 'A-1', 'A'].map(slug), ['a', 'a-1', 'a-1-1', 'a-2']);
});

test('buildTocTree nests by level and skips empty headings', () => {
  const tree = buildTocTree(
    [
      { id: 'a', level: 3, text: 'Starts deep' },
      { id: 'b', level: 2, text: 'Two' },
      { id: 'c', level: 4, text: 'Four' },
      { id: 'd', level: 3, text: ' Three  spaced ' },
      { id: 'e', level: 2, text: '   ' },
    ],
    { minLevel: 2, maxLevel: 4 }
  );
  assert.deepEqual(
    tree.map((node) => [node.text, node.children.map((child) => [child.text, child.children.length])]),
    [
      ['Starts deep', []],
      [
        'Two',
        [
          ['Four', 0],
          ['Three spaced', 0],
        ],
      ],
    ]
  );
});

test('toc presets, structure check, quality lint, diff and find', () => {
  assert.equal(isBlockAllowed(resolveFieldPreset({}), 'toc'), true);
  assert.equal(isBlockAllowed(resolveFieldPreset({ preset: 'article' }), 'toc'), true);
  const basic = resolveFieldPreset({ preset: 'basic' });
  assert.equal(isBlockAllowed(basic, 'toc'), false);
  assert.equal(checkBlockStructure(basic, { id: 't', type: 'toc', data: {} }).code, 'BLOCK_NOT_ALLOWED');
  assert.equal(checkPreset(doc({ type: 'toc', data: {} }), basic)[0].code, 'BLOCK_NOT_ALLOWED');

  const lonely = lintDocument(
    doc(
      { id: 't', type: 'toc', data: { minLevel: 3, maxLevel: 4 } },
      { id: 'h', type: 'header', data: { text: 'Only level 2', level: 2 } }
    )
  );
  assert.deepEqual(
    lonely.issues.map((issue) => [issue.rule, issue.blockId, issue.params]),
    [['toc-no-headings', 't', { minLevel: 3, maxLevel: 4 }]]
  );
  assert.equal(lintDocument(ARTICLE_DOC()).issues.filter((i) => i.rule === 'toc-no-headings').length, 0);
  // Issues stay in document order when a toc issue is added after the walk.
  const ordered = lintDocument(
    doc({ id: 't', type: 'toc', data: {} }, { id: 'e', type: 'header', data: { text: '', level: 2 } })
  ).issues.map((issue) => issue.rule);
  assert.deepEqual(ordered, ['toc-no-headings', 'empty-heading']);

  const before = doc({ id: 't', type: 'toc', data: { title: 'Contents', minLevel: 2, maxLevel: 3 } });
  const after = doc({
    id: 't',
    type: 'toc',
    data: { title: 'Contents <b>new</b>', minLevel: 2, maxLevel: 4 },
  });
  assert.equal(blockText(after.blocks[0]), 'Contents <b>new</b>');
  const diff = diffDocuments(before, after);
  const changed = diff.find((entry) => entry.op === 'changed');
  assert.ok(changed);
  // The title is plain text: the diff shows the markup as typed, never as HTML.
  assert.ok(changed.fields.some((field) => field.path === 'title' && field.kind === 'text'));

  const found = findMatches(before, 'Contents');
  assert.equal(found.matches.length, 1);
  const replaced = replaceMatches(before, 'Contents', 'Inhalt');
  assert.equal(replaced.data.blocks[0].data.title, 'Inhalt');
});

/* ------------------------------------------------------------- mentions */

test('mention attributes are internal-link attributes with a normalised flag', () => {
  assert.deepEqual(
    cleanInternalLinkAttributes({
      'data-mex-uid': ARTICLE,
      'data-mex-document-id': 'abc',
      'data-mex-mention': '',
    }),
    { 'data-mex-uid': ARTICLE, 'data-mex-document-id': 'abc', 'data-mex-mention': 'true' }
  );
  assert.deepEqual(cleanInternalLinkAttributes({ 'data-mex-mention': 'true' }), {});
  assert.deepEqual(
    cleanInternalLinkAttributes({
      'data-mex-uid': ARTICLE,
      'data-mex-document-id': 'abc',
      'data-mex-mention': 'yes',
    }),
    { 'data-mex-uid': ARTICLE, 'data-mex-document-id': 'abc' }
  );
  assert.equal(isMentionLink({ 'data-mex-mention': 'true', 'data-mex-uid': ARTICLE }), false);

  const server = sanitizeInlineHtml(
    `${mention(ARTICLE, 'abc', 'Alpha')} <a href="/y" data-mex-mention="true">no ref</a> <span data-mex-mention="true">s</span> <a href="/z" data-mex-uid="${ARTICLE}" data-mex-document-id="abc" data-mex-mention onclick="x()" class="c">Beta</a>`
  );
  assert.match(server, /data-mex-mention="true">Alpha<\/a>/);
  assert.match(server, /<a href="\/y">no ref<\/a>/);
  assert.match(server, /<span>s<\/span>|\bs\b/);
  assert.doesNotMatch(server, /<span[^>]*data-mex/);
  assert.match(
    server,
    /<a href="\/z" data-mex-uid="api::article.article" data-mex-document-id="abc" data-mex-mention="true">Beta<\/a>/
  );
  assert.doesNotMatch(server, /onclick|class="c"/);
  // Field presets: mentions are internal links.
  const value = doc({ type: 'paragraph', data: { text: mention(ARTICLE, 'abc', 'Alpha') } });
  const external = resolveFieldPreset({ linkTargets: 'external' });
  assert.equal(checkPreset(cleanEditorValue(value), external)[0].code, 'LINK_NOT_ALLOWED');
  assert.equal(
    checkPreset(cleanEditorValue(value), resolveFieldPreset({ linkTargets: 'internal' })).length,
    0
  );
  assert.deepEqual(
    extractLinks(value).internal.map((link) => [link.uid, link.documentId, link.locale]),
    [[ARTICLE, 'abc', 'en']]
  );
});

test('renderers mark mentions; the links resolver sees them; stored HTML is unchanged', () => {
  const value = doc({ type: 'paragraph', data: { text: `See ${mention(ARTICLE, 'abc', 'Alpha')}.` } });
  assert.equal(
    renderHtml(value),
    '<p class="mex-paragraph">See <a href="/x/abc" class="mex-mention" data-mex-uid="api::article.article" data-mex-document-id="abc" data-mex-locale="en" data-mex-mention="true">Alpha</a>.</p>'
  );
  const refs = [];
  renderHtml(value, { links: (ref) => refs.push(ref) && undefined });
  assert.deepEqual(refs, [{ uid: ARTICLE, documentId: 'abc', locale: 'en', href: '/x/abc', mention: true }]);
  assert.equal(
    renderHtml(value, { links: () => false }),
    '<p class="mex-paragraph">See Alpha.</p>',
    'an unresolved mention is its text'
  );
  assert.equal(renderMarkdown(value), 'See [Alpha](/x/abc).');
  assert.equal(renderText(value), 'See Alpha.');
  // inlineToHtml (renderer helper) marks too; a plain internal link does not get the class.
  assert.match(inlineToHtml(mention(ARTICLE, 'abc', 'A')), /class="mex-mention"/);
  assert.doesNotMatch(
    renderHtml(
      doc({
        type: 'paragraph',
        data: { text: `<a href="/a" data-mex-uid="${ARTICLE}" data-mex-document-id="abc">x</a>` },
      })
    ),
    /mex-mention/
  );
});

test('applyReferences replaces mention text with the resolved title only', () => {
  const value = doc({
    id: 'p',
    type: 'paragraph',
    data: {
      text: `${mention(ARTICLE, 'pub1', 'Old title')} ${mention(ARTICLE, 'draft1', 'Stored draft title')} <a href="/l" data-mex-uid="${ARTICLE}" data-mex-document-id="pub1" data-mex-locale="en">authored link text</a>`,
    },
  });
  const { data } = collectReferences(value, { locale: 'en' });
  const resolved = new Map([
    [entryKey('link', ARTICLE, 'en', 'pub1'), { href: '/en/articles/alpha', title: 'Alpha <live>' }],
  ]);
  const out = applyReferences(data, resolved, { locale: 'en' }).blocks[0].data.text;
  assert.match(
    out,
    /<a href="\/en\/articles\/alpha" data-mex-uid="api::article.article" data-mex-document-id="pub1" data-mex-locale="en" data-mex-mention="true">Alpha &lt;live&gt;<\/a>/
  );
  assert.match(out, / Stored draft title /, 'unresolved mention keeps its stored text, no link');
  assert.doesNotMatch(out, /draft1|\/x\/draft1/);
  assert.match(out, />authored link text<\/a>/, 'plain links keep their text');
  assert.doesNotMatch(out, /class=/, 'JSON output keeps the stored markup (no render classes)');
});

/**
 * Minimal fake Strapi for the references service (see tests/output.test.mjs).
 * @param {Set<string>} allowed - Allowed scopes.
 * @returns {object} Strapi.
 */
const fakeStrapi = (allowed) => {
  const types = {
    [ARTICLE]: {
      uid: ARTICLE,
      info: { pluralName: 'articles', singularName: 'article' },
      options: { draftAndPublish: true },
      pluginOptions: { i18n: { localized: true } },
      attributes: {
        title: { type: 'string' },
        slug: { type: 'uid' },
        secret: { type: 'string', private: true },
      },
    },
    [CATEGORY]: {
      uid: CATEGORY,
      info: { pluralName: 'categories', singularName: 'category' },
      options: { draftAndPublish: true },
      attributes: { name: { type: 'string' }, slug: { type: 'uid' } },
    },
  };
  const rows = {
    [ARTICLE]: [
      { documentId: 'pub1', locale: 'en', title: 'Alpha Live', slug: 'alpha', publishedAt: '2026' },
      { documentId: 'draft1', locale: 'en', title: 'Draft Live Title', slug: 'draft', publishedAt: null },
    ],
    [CATEGORY]: [{ documentId: 'cat1', name: 'Hidden Category', slug: 'hidden', publishedAt: '2026' }],
  };
  return {
    config: {
      get: (key) =>
        key === 'plugin::magic-editor-x.links.urlPattern' ? '/{locale}/{collection}/{slug}' : undefined,
    },
    log: { debug() {}, warn() {}, error() {}, info() {} },
    contentType: (uid) => types[uid],
    getModel: (uid) => types[uid],
    auth: {
      verify: async (_auth, { scope }) => {
        if (!allowed.has(scope[0])) throw new Error('Forbidden');
      },
    },
    contentAPI: { sanitize: { output: async (row) => ({ ...row }) } },
    documents: (uid) => ({
      findMany: async (params) =>
        (rows[uid] || []).filter(
          (row) =>
            params.filters.documentId.$in.includes(row.documentId) &&
            (params.status !== 'published' || row.publishedAt)
        ),
    }),
    db: { query: () => ({ findMany: async () => [] }) },
  };
};

test('API output: mentions show the current title only for readable, published targets', async () => {
  const strapi = fakeStrapi(new Set([`${ARTICLE}.find`]));
  const value = doc({
    type: 'paragraph',
    data: {
      text: `${mention(ARTICLE, 'pub1', 'Stale')} | ${mention(ARTICLE, 'draft1', 'Stored D')} | ${mention(CATEGORY, 'cat1', 'Stored C')}`,
    },
  });
  const auth = { strategy: { name: 'api-token' }, credentials: {} };
  const service = createReferences({ strapi });
  const [html, json, md, text] = await service.transform(
    ['html', 'json', 'markdown', 'text'].map((format) => ({ value, locale: 'en', format })),
    { auth }
  );
  assert.equal(
    html,
    '<p class="mex-paragraph"><a href="/en/articles/alpha" class="mex-mention" data-mex-uid="api::article.article" data-mex-document-id="pub1" data-mex-locale="en" data-mex-mention="true">Alpha Live</a> | Stored D | Stored C</p>'
  );
  assert.match(json.blocks[0].data.text, /data-mex-mention="true">Alpha Live<\/a> \| Stored D \| Stored C$/);
  assert.equal(md, '[Alpha Live](/en/articles/alpha) \\| Stored D \\| Stored C');
  assert.equal(text, 'Alpha Live | Stored D | Stored C');
  for (const secret of ['Draft Live Title', 'Hidden Category', '/hidden', 'draft'])
    assert.ok(!html.includes(secret), secret);
  // Drafts requested: the draft target resolves too.
  const [drafts] = await service.transform([{ value, locale: 'en' }], {
    format: 'html',
    auth,
    status: 'draft',
  });
  assert.match(drafts, />Draft Live Title<\/a>/);
  assert.doesNotMatch(drafts, /Hidden Category/);
});

test('editor helpers: mention attributes, text and toc defaults', () => {
  assert.deepEqual(mentionAttributes({ href: '/a', uid: ARTICLE, documentId: 'abc', locale: 'de' }), {
    href: '/a',
    'data-mex-uid': ARTICLE,
    'data-mex-document-id': 'abc',
    'data-mex-locale': 'de',
    'data-mex-mention': 'true',
  });
  assert.equal(mentionAttributes({ uid: ARTICLE, documentId: 'abc' }), null);
  assert.equal(mentionText({ title: '  A \n B ' }, 'sel', 'fallback'), 'A B');
  assert.equal(mentionText({ title: '' }, ' sel ', 'fallback'), 'sel');
  assert.equal(mentionText(null, '', 'Untitled'), 'Untitled');
  assert.deepEqual(normalizeToc(undefined), { title: '', minLevel: 2, maxLevel: 4, style: 'unordered' });
  assert.deepEqual(normalizeToc({}, [2, 3]), { title: '', minLevel: 2, maxLevel: 3, style: 'unordered' });
  assert.deepEqual(normalizeToc({ minLevel: 4, maxLevel: 2, style: 'ordered', title: 'T' }), {
    title: 'T',
    minLevel: 2,
    maxLevel: 4,
    style: 'ordered',
  });
});

/* -------------------------------------------------------------- code */

test('one code language list: labels, Prism grammars, policy and renderer class agree', () => {
  for (const id of CODE_LANGUAGES) {
    assert.ok(CODE_LANGUAGE_LABELS[id], `label for ${id}`);
    assert.equal(normalizeCodeLanguage(id), id);
    const clean = BLOCK_POLICIES.codeFlask({ code: 'x', language: id }, (s) => s, {});
    assert.equal(clean.language, id, 'the policy stores the id unchanged');
    assert.match(
      renderHtml(doc({ type: 'codeFlask', data: { code: 'x', language: id } })),
      new RegExp(`<code class="language-${id.replace(/[+#]/g, '\\$&')}">`)
    );
  }
  for (const [alias, id] of Object.entries(CODE_LANGUAGE_ALIASES)) {
    assert.equal(normalizeCodeLanguage(alias.toUpperCase()), id);
    assert.ok(CODE_LANGUAGES.includes(id));
  }
  // Every id has a Prism grammar among the components the admin loads.
  const source = readFileSync(
    fileURLToPath(new URL('../admin/src/editor/tools/prism/index.js', import.meta.url)),
    'utf8'
  );
  const Prism = require('prismjs');
  for (const [, component] of source.matchAll(/import 'prismjs\/components\/(prism-[a-z-]+)';/g))
    require(`prismjs/components/${component}`);
  for (const id of CODE_LANGUAGES) {
    if (id === 'plaintext') continue;
    assert.ok(Prism.languages[id], `Prism grammar for ${id}`);
  }
});

test('line numbers: "block" follows the editor default (on unless switched off)', () => {
  const flask = (data) => doc({ type: 'codeFlask', data: { code: 'a', language: 'go', ...data } });
  const numbered = (value) => /mex-code-lines/.test(renderHtml(value, { code: { lineNumbers: 'block' } }));
  assert.equal(numbered(flask({})), true, 'missing flag = editor default (shown)');
  assert.equal(numbered(flask({ showlinenumbers: true })), true);
  assert.equal(numbered(flask({ showlinenumbers: false })), false);
  assert.equal(numbered(doc({ type: 'code', data: { code: 'a' } })), false);
});
