// 2.13 touch fixes found on WebKit (Safari's engine) and tablets: the inline toolbar stays on the
// screen, the handles do not cover the text on touch tablets, and the browser benchmark runs its touch checks in WebKit (iPhone 13, iPad).
// Touch drag of blocks: tests/admin/touch-drag.test.jsx. The browser evidence comes from npm run bench:browser -- --suite touch --browsers chromium,webkit.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { inlineToolbarShift, INLINE_TOOLBAR_MARGIN } from '../admin/src/editor/toolbar-a11y.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');

test('inlineToolbarShift: moves a toolbar back from the right edge, keeps its start visible when too wide', () => {
  // Measured on an iPad (gen 7) in WebKit and Chromium: 595 px wide at x 266 on an 810 px screen.
  assert.equal(inlineToolbarShift({ left: 266, right: 861 }, 810), 810 - INLINE_TOOLBAR_MARGIN - 861);
  assert.equal(inlineToolbarShift({ left: 20, right: 300 }, 810), 0, 'a toolbar that fits stays');
  assert.equal(inlineToolbarShift({ left: 2, right: 300 }, 810), INLINE_TOOLBAR_MARGIN - 2);
  assert.equal(
    inlineToolbarShift({ left: 100, right: 1000 }, 810),
    INLINE_TOOLBAR_MARGIN - 100,
    'wider than the screen: the first tools stay visible'
  );
});

test('touch tablets: the text starts after both 44 px handles; the handle takes no scroll or callout', () => {
  const styles = read('admin/src/editor/tools/styles.js');
  assert.match(
    styles,
    /@media \(pointer: coarse\) \{\s*\$\{\(\{ theme \}\) => theme\.breakpoints\.small\} \{\s*\.ce-block__content \{\s*padding-inline-start: calc\(2 \* \$\{\(\{ theme \}\) => theme\.sizes\.button\.M\.initial\} \+ \$\{s\(2\)\}\);/
  );
  assert.match(styles, /\.ce-toolbar__settings-btn \{\s*touch-action: none;/);
});

test('bench: touch checks run per engine, WebKit with iPhone 13 and iPad (gen 7); CI runs them', async () => {
  const { TOUCH_DEVICES } = await import('../scripts/bench-browser/touch.mjs');
  assert.deepEqual(TOUCH_DEVICES.webkit, ['iPhone 13', 'iPad (gen 7)']);
  assert.deepEqual(TOUCH_DEVICES.chromium, ['Pixel 7', 'iPhone 13']);
  const ci = read('.github/workflows/ci.yml');
  assert.match(ci, /--browsers webkit/);
  assert.match(ci, /playwright install --with-deps webkit/);
});
