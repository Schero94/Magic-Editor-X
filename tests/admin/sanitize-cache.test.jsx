/**
 * 2.7.8 re-audit (major 3): typing at 2,000 blocks cost ~155 ms per keystroke because every change
 * sanitised the whole document with DOMPurify. `sanitizeInline` is memoised by input; the output
 * must stay identical to an uncached run (same security guarantees) and a 2,000-block document
 * must be prepared again cheaply when only one block changed.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inlineCacheSize, prepareEditorValue, sanitizeInline } from '../../admin/src/editor/sanitize.js';
import { STRICT_TIMING } from '../helpers/perf-strict.mjs';

const doc = (n, changed = -1) => ({
  time: 1,
  version: '2.31.7',
  blocks: Array.from({ length: n }, (_, i) => ({
    id: 'p' + i,
    type: 'paragraph',
    data: {
      text:
        'Paragraph ' +
        i +
        (i === changed ? ' edited' : '') +
        ' with <b>bold</b>, <i>italic</i> and a <a href="https://www.example.test/' +
        i +
        '">link</a> <img src=x onerror="alert(1)">.',
    },
  })),
});

test('cached output equals the first (uncached) output and stays safe', () => {
  const dirty =
    '<b onclick="x()">a</b><a href="javascript:alert(1)">b</a><script>c()</script><span data-x="1">d</span>';
  const first = sanitizeInline(dirty);
  const second = sanitizeInline(dirty);
  assert.equal(second, first);
  assert.doesNotMatch(first, /onclick|javascript:|<script|data-x/);
  assert.match(first, /<b>a<\/b>/);
  assert.equal(sanitizeInline(''), '');
  assert.equal(sanitizeInline(null), '');
});

test('target=_blank gets rel on a cache hit too', () => {
  const html = '<a href="https://www.example.test" target="_blank">x</a>';
  assert.match(sanitizeInline(html), /rel="noopener noreferrer"/);
  assert.match(sanitizeInline(html), /rel="noopener noreferrer"/);
});

test('2,000 blocks: preparing again after a one-block change is fast and equal', () => {
  const full = prepareEditorValue(doc(2000)).data;
  assert.equal(full.blocks.length, 2000);
  assert.doesNotMatch(JSON.stringify(full), /onerror/);
  const t0 = performance.now();
  const again = prepareEditorValue(doc(2000, 1000)).data;
  const ms = performance.now() - t0;
  assert.match(again.blocks[1000].data.text, /edited/);
  assert.deepEqual(again.blocks[999], full.blocks[999]);
  assert.ok(inlineCacheSize() >= 2000);
  // jsdom is far slower than a browser; the uncached run takes several hundred ms here.
  if (STRICT_TIMING) assert.ok(ms < 150, `re-prepare took ${Math.round(ms)} ms`);
});
