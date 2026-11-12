import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lintDocument,
  extractLinks,
  isAmbiguousLinkText,
  parseColor,
  contrastRatio,
  MAX_EXTRACTED_LINKS,
} from '../shared/quality.mjs';

const doc = (blocks) => ({
  time: 1,
  version: '2.31.7',
  blocks: blocks.map(([type, data], index) => ({ id: `b${index}`, type, data })),
});
const rules = (result) => result.issues.map((issue) => `${issue.rule}@${issue.blockId}:${issue.severity}`);

test('empty and invalid values have no issues', () => {
  for (const value of [null, undefined, '', 42, { blocks: [] }]) {
    const result = lintDocument(value);
    assert.deepEqual(result.issues, []);
    assert.equal(result.stats.blocks, 0);
  }
  assert.deepEqual(extractLinks(null), { internal: [], external: [], media: [] });
});

test('image alt: warning by default, error with requireAlt, decorative images are fine', () => {
  const value = doc([
    ['image', { file: { url: 'https://example.com/a.png', alt: '' }, caption: 'Caption is not alt' }],
    ['image', { file: { url: 'https://example.com/b.png', alt: '  ' } }],
    ['image', { file: { url: 'https://example.com/c.png', alt: '' }, decorative: true }],
    ['image', { file: { url: 'https://example.com/d.png', alt: 'A synthetic chart' } }],
    ['simpleImage', { url: 'https://example.com/e.png', caption: 'x' }],
  ]);
  assert.deepEqual(rules(lintDocument(value)), [
    'image-alt-missing@b0:warning',
    'image-alt-missing@b1:warning',
    'image-alt-missing@b4:warning',
  ]);
  const strict = lintDocument(value, { requireAlt: true });
  assert.deepEqual(rules(strict), [
    'image-alt-missing@b0:error',
    'image-alt-missing@b1:error',
    'image-alt-missing@b4:error',
  ]);
  assert.equal(strict.stats.errors, 3);
  assert.equal(strict.stats.images, 5);
  assert.equal(strict.issues[0].path, 'file.alt');
});

test('custom block image fields need an alt text', () => {
  const value = doc([
    ['hero', { title: 'Hi', picture: { url: 'https://example.com/h.png', alt: '', id: 4 } }],
    ['hero', { title: 'Hi', picture: { url: 'https://example.com/h.png', alt: 'Team photo', id: 4 } }],
  ]);
  const result = lintDocument(value, { requireAlt: true });
  assert.deepEqual(rules(result), ['image-alt-missing@b0:error']);
  assert.equal(result.issues[0].path, 'picture.alt');
});

test('heading order, multiple h1 and empty headings', () => {
  const value = doc([
    ['header', { text: 'Title', level: 1 }],
    ['header', { text: 'Skips to three', level: 3 }],
    ['header', { text: 'Back to two', level: 2 }],
    ['header', { text: '<b> </b>&nbsp;', level: 2 }],
    ['header', { text: 'Second title', level: 1 }],
    ['header', { text: 'Five', level: 5 }],
  ]);
  assert.deepEqual(rules(lintDocument(value)), [
    'heading-order@b1:warning',
    'empty-heading@b3:warning',
    'multiple-h1@b4:warning',
    'heading-order@b5:warning',
  ]);
  const first = lintDocument(doc([['header', { text: 'Starts deep', level: 4 }]]));
  assert.deepEqual(rules(first), ['heading-order@b0:warning']);
  assert.deepEqual(first.issues[0].params, { level: 4, previous: 0 });
  assert.deepEqual(rules(lintDocument(doc([['header', { text: 'Fine', level: 2 }]]))), []);
});

test('empty links and links with unsafe hrefs are errors', () => {
  const value = doc([
    [
      'paragraph',
      { text: 'See <a href="https://example.com/x"></a> and <a href="https://example.com"> </a>' },
    ],
    ['paragraph', { text: 'Bad <a href="javascript:alert(1)">target</a>' }],
    ['paragraph', { text: 'Good <a href="https://example.com/guide">the setup guide</a>' }],
  ]);
  assert.deepEqual(rules(lintDocument(value)), [
    'empty-link@b0:error',
    'empty-link@b0:error',
    'empty-link@b1:error',
  ]);
});

test('ambiguous link text in five languages, whole text only', () => {
  for (const text of [
    'Click here',
    ' HERE ',
    'read more…',
    'Mehr erfahren',
    'hier',
    'cliquez ici',
    'En savoir plus',
    'Haga clic aquí',
    'leer más',
    'Clique aqui',
    'Saiba mais',
    '«this link»',
  ])
    assert.equal(isAmbiguousLinkText(text), true, text);
  for (const text of ['Read more about pricing', 'here is the guide', 'Hierarchy', 'moreover'])
    assert.equal(isAmbiguousLinkText(text), false, text);

  const value = doc([
    ['list', { style: 'unordered', items: [{ content: '<a href="/a">mehr</a>', items: [] }] }],
    ['table', { withHeadings: true, content: [['h'], ['<a href="/b">click here</a>']] }],
  ]);
  const result = lintDocument(value);
  assert.deepEqual(rules(result), ['ambiguous-link-text@b0:warning', 'ambiguous-link-text@b1:warning']);
  assert.equal(result.issues[0].path, 'items.0.content');
  assert.equal(result.issues[1].path, 'content.1.0');
  assert.equal(result.stats.links, 2);
});

test('tables without a header row', () => {
  const value = doc([
    [
      'table',
      {
        withHeadings: false,
        content: [
          ['a', 'b'],
          ['c', 'd'],
        ],
      },
    ],
    ['table', { withHeadings: true, content: [['a'], ['b']] }],
    ['table', { withHeadings: false, content: [['only one row']] }],
  ]);
  assert.deepEqual(rules(lintDocument(value)), ['table-no-header@b0:warning']);
});

test('colour parsing and WCAG contrast', () => {
  assert.deepEqual(parseColor('#fff'), [255, 255, 255]);
  assert.deepEqual(parseColor('#000000'), [0, 0, 0]);
  assert.deepEqual(parseColor('rgb(255, 0, 0)'), [255, 0, 0]);
  assert.deepEqual(parseColor('rgb(100% 0% 0%)'), [255, 0, 0]);
  assert.equal(parseColor('#ffffff80'), null);
  assert.equal(parseColor('rgba(0,0,0,0.5)'), null);
  assert.equal(parseColor('red'), null);
  assert.equal(parseColor('url(javascript:x)'), null);
  assert.equal(Math.round(contrastRatio([0, 0, 0], [255, 255, 255])), 21);
  assert.equal(contrastRatio([119, 119, 119], [255, 255, 255]).toFixed(2), '4.48');
});

test('low contrast in custom blocks', () => {
  const value = doc([
    ['banner', { text: 'x', color: '#777777', background: '#ffffff' }],
    ['banner', { text: 'x', textColor: '#000', backgroundColor: '#fff' }],
    ['banner', { text: 'x', color: '#777' }],
    ['paragraph', { text: 'x', color: '#777', background: '#fff' }],
  ]);
  const result = lintDocument(value);
  assert.deepEqual(rules(result), ['low-contrast@b0:warning']);
  assert.deepEqual(result.issues[0].params, { ratio: 4.47 });
});

test('lint is deterministic and accepts 1.x JSON strings', () => {
  const value = JSON.stringify(
    doc([
      ['header', { text: '', level: 3 }],
      ['image', { file: { url: 'https://example.com/x.png' } }],
    ])
  );
  const a = lintDocument(value, { requireAlt: true });
  const b = lintDocument(value, { requireAlt: true });
  assert.deepEqual(a, b);
  assert.deepEqual(rules(a), [
    'empty-heading@b0:warning',
    'heading-order@b0:warning',
    'image-alt-missing@b1:error',
  ]);
});

test('extractLinks finds internal, external and media references once', () => {
  const internal =
    '<a href="/articles/abc" data-mex-uid="api::article.article" data-mex-document-id="abc123" data-mex-locale="en">A</a>';
  const value = doc([
    ['paragraph', { text: `${internal} and ${internal} and <a href="https://example.com/x?q=1">x</a>` }],
    ['paragraph', { text: '<a href="mailto:a@example.test">mail</a> <a href="/relative">rel</a>' }],
    ['linkTool', { link: 'https://example.com/x?q=1', meta: {} }],
    ['button', { text: 'Go', link: 'https://example.org/' }],
    [
      'embed',
      {
        service: 'youtube',
        source: 'https://www.youtube.com/watch?v=x',
        embed: 'https://www.youtube.com/embed/x',
      },
    ],
    ['attaches', { file: { url: 'https://example.com/file.pdf' } }],
    ['image', { file: { url: 'https://example.com/a.png', id: 7 } }],
    ['image', { file: { url: 'https://example.com/a.png', id: 7 } }],
    ['image', { file: { url: 'https://example.com/b.png', id: '../x' } }],
    ['hero', { picture: { url: 'https://example.com/h.png', id: 9 } }],
    ['personality', { name: 'x', link: 'javascript:alert(1)' }],
  ]);
  const links = extractLinks(value);
  assert.deepEqual(links.internal, [
    { uid: 'api::article.article', documentId: 'abc123', locale: 'en', blockId: 'b0' },
  ]);
  assert.deepEqual(
    links.external.map((link) => link.url),
    [
      'https://example.com/x?q=1',
      'https://example.org/',
      'https://www.youtube.com/watch?v=x',
      'https://example.com/file.pdf',
    ]
  );
  assert.deepEqual(links.media, [
    { id: 7, blockId: 'b6' },
    { id: 9, blockId: 'b9' },
  ]);
});

test('extractLinks caps every kind', () => {
  const blocks = [];
  for (let i = 0; i < MAX_EXTRACTED_LINKS + 20; i += 1)
    blocks.push(['paragraph', { text: `<a href="https://example.com/p${i}">page ${i}</a>` }]);
  assert.equal(extractLinks(doc(blocks)).external.length, MAX_EXTRACTED_LINKS);
});
