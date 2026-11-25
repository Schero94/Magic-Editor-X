// 2.12.1 performance and touch contract (source level; the browser numbers come from
// npm run bench:browser, see CONTRIBUTING.md).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { saveDelay, SCALE_FROM_BLOCKS, MAX_DELAY_MS } from '../admin/src/editor/save-timing.mjs';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const walk = (dir) =>
  fs
    .readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap((entry) =>
      entry.isDirectory() ? walk(path.join(dir, entry.name)) : [path.join(dir, entry.name)]
    );

test('save delay: unchanged up to 500 blocks, longer in long documents, never for 0', () => {
  assert.equal(saveDelay(40, 10), 40);
  assert.equal(saveDelay(40, SCALE_FROM_BLOCKS), 40);
  assert.equal(saveDelay(40, 1000), 90);
  assert.equal(saveDelay(40, 2000), 190);
  assert.equal(saveDelay(40, 5000), MAX_DELAY_MS);
  assert.equal(saveDelay(150, 1500), 250);
  assert.equal(saveDelay(0, 5000), 0, 'focus out and Save are never delayed');
  assert.equal(saveDelay(500, 5000), 500, 'a longer requested delay is kept');
  assert.equal(saveDelay(40, Number.NaN), 40);
});

test('no aria-live attribute inside editor tools (a live region in a block makes modal menus hide every block)', () => {
  const offenders = walk('admin/src/editor').filter((file) => /aria-live/.test(read(file)));
  assert.deepEqual(offenders, []);
});

test('blocks outside the viewport use content-visibility, except the active, selected and footnote blocks', () => {
  const styles = read('admin/src/editor/tools/styles.js');
  assert.match(styles, /content-visibility: auto;/);
  assert.match(
    styles,
    /:not\(:focus-within\):not\(\.ce-block--selected\):not\(\.\$\{FOOTNOTE_BLOCK_CLASS\}\)/
  );
  assert.doesNotMatch(styles, /:has\(sup\[data-mex-footnote\]\)/, 'no :has() over every block');
});

test('More tools is a non-modal menu, panels are bottom sheets on phones, dialogs use touch targets', () => {
  assert.match(read('admin/src/components/EditorField/FieldToolsMenu.jsx'), /modal=\{false\}/);
  const field = read('admin/src/components/EditorField/index.jsx');
  assert.match(field, /data-mex-sheet="true"/);
  assert.match(field, /bottom: var\(--mex-keyboard-inset, 0px\)/);
  assert.match(field, /height: var\(--mex-vv-height, 100%\)/);
  for (const file of walk('admin/src/components/EditorField').filter((name) => name.endsWith('.jsx')))
    assert.doesNotMatch(read(file), /<Modal\.Content/, `${file} uses TouchModalContent`);
});
