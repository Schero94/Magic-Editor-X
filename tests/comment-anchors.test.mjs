/**
 * Range comments (2.4): anchor mapping between the HTML source of a field
 * (the Y.Text content) and the text a reader sees, the text-quote fallback,
 * Yjs relative positions through edits and the anchor validation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { parseDocument } from 'htmlparser2';
import {
  MAX_QUOTE_LENGTH,
  MAX_RELPOS_BASE64,
  buildQuote,
  cleanAnchor,
  findQuote,
  htmlTextMap,
  isRelPos,
  sourceRangeToText,
  textLeaves,
  textRangeToSource,
  anchorStatus,
} from '../shared/comment-anchor.mjs';
import { encodeRange, resolveRange, sharedTextAt, sharedTextLeaves } from '../shared/comment-relpos.mjs';
import { applyEditorDataToDoc, applyTextDiff, getTypes } from '../shared/ydoc.mjs';

/**
 * Text of HTML as a browser DOM shows it (text nodes, `<br>` as a line feed),
 * computed with a real HTML parser (entities decoded by htmlparser2) - the
 * reference htmlTextMap must agree with.
 * @param {string} html - Inline HTML.
 * @returns {string} Text.
 */
const parserText = (html) => {
  let out = '';
  const walk = (node) => {
    for (const child of node.children || []) {
      if (child.type === 'text') out += child.data;
      else if (child.type === 'tag' && child.name === 'br') out += '\n';
      else if (child.type === 'tag') walk(child);
    }
  };
  walk(parseDocument(html, { decodeEntities: true }));
  return out;
};

const CORPUS = [
  'Plain text',
  'Hello <b>bold</b> and <i>italic <u>under</u></i> end',
  'Tom &amp; Jerry &lt;3 &gt; &quot;quoted&quot; &#39;single&#39;',
  'A&nbsp;B&nbsp;&nbsp;C',
  'line one<br>line two<br/>line three<br />four',
  '<a href="https://example.test/?a=1&amp;b=2" target="_blank">link &amp; text</a> after',
  'Emoji &#128512; and &#x1F600; and 😀 raw',
  'Caf&eacute; is not decoded by us &hellip; but &mdash; is',
  '<mark class="cdx-marker">marked</mark><code class="inline-code">x &lt; y</code>',
  'Comment <!-- hidden --> after',
  'Unclosed < bracket and a & lone ampersand',
  'a < b > c and 1<2',
  '<span data-tooltip="Tip &amp; more">tip</span>',
  '',
];

test('htmlTextMap: the text equals what an HTML parser shows', () => {
  for (const html of CORPUS) {
    if (html.includes('&eacute;')) continue; // named entity outside the small table (see next test)
    assert.equal(htmlTextMap(html).text, parserText(html), html);
  }
});

test('htmlTextMap: unknown named entities stay literal (the editor never writes them)', () => {
  const map = htmlTextMap('Caf&eacute; &hellip;');
  assert.equal(map.text, 'Caf&eacute; …');
});

test('htmlTextMap: every text unit maps to the source characters that make it', () => {
  for (const html of CORPUS) {
    const map = htmlTextMap(html);
    assert.equal(map.starts.length, map.text.length);
    assert.equal(map.ends.length, map.text.length);
    for (let index = 0; index < map.text.length; index += 1) {
      const source = html.slice(map.starts[index], map.ends[index]);
      if (source.startsWith('<') && source.length > 1)
        assert.equal(map.text[index], '\n', `${html} @${index}`);
      else if (source.startsWith('&'))
        assert.ok(parserText(source).includes(map.text[index]), `${html} @${index}`);
      else assert.equal(source, map.text[index], `${html} @${index}`);
      if (index > 0) assert.ok(map.starts[index] >= map.starts[index - 1]);
    }
  }
});

test('text <-> source ranges round-trip for every range of the corpus', () => {
  for (const html of CORPUS) {
    const map = htmlTextMap(html);
    for (let start = 0; start < map.text.length; start += 1) {
      // A selection never splits a character made of two UTF-16 units (one source entity).
      if (start > 0 && map.starts[start] === map.starts[start - 1]) continue;
      for (let end = start + 1; end <= map.text.length; end += 1) {
        if (end < map.text.length && map.starts[end] === map.starts[end - 1]) continue;
        const source = textRangeToSource(map, start, end);
        assert.ok(source && source.end > source.start, `${html} ${start}-${end}`);
        assert.deepEqual(
          sourceRangeToText(map, source.start, source.end),
          { start, end },
          `${html} ${start}-${end}`
        );
      }
    }
    assert.equal(textRangeToSource(map, 0, 0), null);
    assert.equal(textRangeToSource(map, -1, 1), null);
    assert.equal(textRangeToSource(map, 0, map.text.length + 1), null);
  }
  // A source range inside a tag or entity holds no whole text unit.
  const map = htmlTextMap('a &amp; <b>b</b>');
  assert.equal(sourceRangeToText(map, 3, 5), null);
  assert.equal(sourceRangeToText(map, 8, 11), null);
});

test('htmlTextMap is linear in the source length', () => {
  const time = (size) => {
    const html = '<b>x</b>&amp;'.repeat(size) + '<'.repeat(size);
    let best = Infinity;
    for (let run = 0; run < 3; run += 1) {
      const started = process.hrtime.bigint();
      htmlTextMap(html);
      best = Math.min(best, Number(process.hrtime.bigint() - started));
    }
    return best;
  };
  const small = time(2000);
  const large = time(32000);
  assert.ok(large / Math.max(small, 1) < 80, `growth ${large / small}`);
});

test('quotes: built with bounded context and found again after edits', () => {
  const text = 'The cat sat on the mat. The cat ran away. The cat slept.';
  const start = text.indexOf('cat ran');
  const quote = buildQuote(text, start, start + 3);
  assert.deepEqual(quote, {
    exact: 'cat',
    prefix: 'The cat sat on the mat. The '.slice(-32),
    suffix: ' ran away. The cat slept.',
  });
  // Text typed before the range moves it; prefix and suffix pick the right occurrence.
  const edited = `Intro. ${text}`;
  const found = findQuote(edited, quote);
  assert.equal(edited.slice(found.start, found.end), 'cat');
  assert.equal(found.start, edited.indexOf('cat ran'));
  // Gone text is not found.
  assert.equal(findQuote('The dog ran away.', quote), null);
  assert.equal(buildQuote(text, 3, 4), null, 'whitespace only');
  assert.equal(buildQuote(text, 5, 5), null);
  const long = buildQuote('x'.repeat(2000), 0, 2000);
  assert.equal(long.exact.length, MAX_QUOTE_LENGTH);
  assert.equal(long.suffix.length, 32);
});

test('quote search is bounded on repetitive text', () => {
  const text = 'a'.repeat(200000);
  const started = Date.now();
  const found = findQuote(text, { exact: 'aaaa', prefix: 'b', suffix: 'c' });
  assert.ok(found);
  assert.ok(Date.now() - started < 1000);
});

test('cleanAnchor: shape, bounds, forbidden paths, relative positions only with a path', () => {
  const quote = { exact: 'hello', prefix: 'say ', suffix: ' world' };
  assert.deepEqual(cleanAnchor({ path: 'text', start: null, end: null, quote }), {
    path: 'text',
    start: null,
    end: null,
    quote,
  });
  assert.equal(cleanAnchor({ path: 'text', quote: { exact: '   ', prefix: '', suffix: '' } }), null);
  assert.equal(cleanAnchor(null), null);
  assert.equal(cleanAnchor([]), null);
  assert.equal(cleanAnchor({ path: '__proto__.x', quote }).path, null);
  assert.equal(cleanAnchor({ path: 'a.b.c.d.e.f.g.h.i', quote }).path, null);
  assert.equal(cleanAnchor({ path: 'items.0.content', quote }).path, 'items.0.content');
  // Control characters go (line feeds from <br> stay).
  assert.equal(
    cleanAnchor({ path: null, quote: { exact: 'a\u0000b\nc', prefix: '', suffix: '' } }).quote.exact,
    'ab\nc'
  );
  const doc = new Y.Doc();
  const ytext = doc.getText('t');
  ytext.insert(0, 'hello world');
  const range = encodeRange(ytext, 0, 5);
  assert.ok(isRelPos(range.start) && isRelPos(range.end));
  assert.equal(cleanAnchor({ path: null, ...range, quote }).start, null, 'positions need a path');
  assert.equal(cleanAnchor({ path: 'text', ...range, quote }).start, range.start);
  assert.equal(isRelPos('not base64!'), false);
  assert.equal(isRelPos('A'.repeat(MAX_RELPOS_BASE64 + 4)), false);
  assert.equal(isRelPos(''), false);
});

/**
 * Room document with one paragraph and one list, like the editor's room.
 * @returns {Y.Doc} Document.
 */
const roomDoc = () => {
  const doc = new Y.Doc();
  applyEditorDataToDoc(doc, {
    time: 1,
    version: '2.31.0',
    blocks: [
      { id: 'p1', type: 'paragraph', data: { text: 'Hello <b>brave</b> new &amp; world' } },
      {
        id: 'l1',
        type: 'list',
        data: {
          style: 'unordered',
          items: [
            { content: 'first item', meta: {}, items: [] },
            { content: 'second <i>item</i>', meta: {}, items: [{ content: 'nested', meta: {}, items: [] }] },
          ],
        },
      },
    ],
  });
  return doc;
};

test('shared text leaves and paths of a room block', () => {
  const doc = roomDoc();
  const leaves = sharedTextLeaves(getTypes(doc).blocks.get('l1').get('data')).map((leaf) => leaf.path);
  assert.ok(leaves.includes('items.0.content'));
  assert.ok(leaves.includes('items.1.items.0.content'));
  assert.equal(sharedTextAt(doc, 'l1', 'items.1.content').toString(), 'second <i>item</i>');
  assert.equal(sharedTextAt(doc, 'l1', 'items.9.content'), null);
  assert.equal(sharedTextAt(doc, 'missing', 'text'), null);
  assert.equal(sharedTextAt(doc, 'p1', '__proto__'), null);
  assert.deepEqual(
    textLeaves({ text: 'a', items: [{ content: 'b' }], n: 1 }).map((leaf) => leaf.path),
    ['text', 'items.0.content']
  );
});

test('relative positions follow edits before the range and across clients', () => {
  const doc = roomDoc();
  const ytext = sharedTextAt(doc, 'p1', 'text');
  const html = ytext.toString();
  const map = htmlTextMap(html);
  const start = map.text.indexOf('brave new');
  const source = textRangeToSource(map, start, start + 'brave new'.length);
  const range = encodeRange(ytext, source.start, source.end);
  // A second client gets the state and the anchor.
  const other = new Y.Doc();
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc));
  // Edits before and after the range on the first client, one save each (the editor diffs every save
  // against the shared text with one changed region per text).
  applyTextDiff(ytext, `Oh! ${html}`);
  applyTextDiff(ytext, `Oh! ${html.replace('world', 'wide world')}`);
  Y.applyUpdate(other, Y.encodeStateAsUpdate(doc, Y.encodeStateVector(other)));
  for (const target of [doc, other]) {
    const text = sharedTextAt(target, 'p1', 'text');
    const found = resolveRange(target, text, range.start, range.end);
    const now = htmlTextMap(text.toString());
    const slice = sourceRangeToText(now, found.start, found.end);
    assert.equal(now.text.slice(slice.start, slice.end), 'brave new');
  }
  // Typing right at the edges does not join the range.
  const edge = sharedTextAt(doc, 'p1', 'text');
  const at = resolveRange(doc, edge, range.start, range.end);
  edge.insert(at.end, 'X');
  edge.insert(at.start, 'Y');
  const after = resolveRange(doc, edge, range.start, range.end);
  assert.equal(edge.toString().slice(after.start, after.end), 'brave</b> new');
});

test('one save that rewrites text across the range drops the positions (the quote is the fallback)', () => {
  const doc = roomDoc();
  const ytext = sharedTextAt(doc, 'p1', 'text');
  const html = ytext.toString();
  const map = htmlTextMap(html);
  const start = map.text.indexOf('brave');
  const source = textRangeToSource(map, start, start + 5);
  const range = encodeRange(ytext, source.start, source.end);
  const quote = buildQuote(map.text, start, start + 5);
  applyTextDiff(ytext, `Oh! ${html.replace('world', 'wide world')}`);
  assert.equal(resolveRange(doc, ytext, range.start, range.end), null);
  const now = htmlTextMap(ytext.toString()).text;
  const found = findQuote(now, quote);
  assert.equal(now.slice(found.start, found.end), 'brave');
});

test('deleting the anchored text, another text or an unknown doc does not resolve', () => {
  const doc = roomDoc();
  const ytext = sharedTextAt(doc, 'p1', 'text');
  const source = { start: ytext.toString().indexOf('new'), end: ytext.toString().indexOf('new') + 3 };
  const range = encodeRange(ytext, source.start, source.end);
  // Another text of the same doc is refused.
  assert.equal(resolveRange(doc, sharedTextAt(doc, 'l1', 'items.0.content'), range.start, range.end), null);
  // A doc without these items (compacted or another room) is refused.
  assert.equal(resolveRange(new Y.Doc(), new Y.Doc().getText('x'), range.start, range.end), null);
  // Garbage is refused.
  assert.equal(resolveRange(doc, ytext, 'AAAA', 'AAAA'), null);
  ytext.delete(source.start, 3);
  assert.equal(resolveRange(doc, ytext, range.start, range.end), null, 'collapsed range');
  assert.equal(encodeRange(ytext, 3, 3), null);
  assert.equal(encodeRange('text', 0, 1), null);
});

test('anchor status', () => {
  assert.equal(anchorStatus({ found: true, blockPresent: true }), 'anchored');
  assert.equal(anchorStatus({ found: false, blockPresent: true }), 'changed');
  assert.equal(anchorStatus({ found: false, blockPresent: false }), 'detached');
});
