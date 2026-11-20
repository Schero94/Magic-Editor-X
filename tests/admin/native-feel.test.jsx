/**
 * 2.7.8 native Strapi look (re-audit): DS icons in the Editor.js tools, no `theme.fonts` (the DS
 * theme has none), mirrored DS arrow for undo, underlined DS tabs in the version history, DS
 * tooltips on the gutter markers, DS default button tokens for the annotation Apply button.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { DS_ICONS, dsIcon } from '../../admin/src/editor/tools/ds-icons.js';
import { ICONS } from '../../admin/src/editor/tools/dom.js';
import { Code } from '@strapi/icons';

const root = fileURLToPath(new URL('../../admin/src/', import.meta.url));
const read = (file) => readFileSync(join(root, file), 'utf8');
const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : /\.(jsx?|mjs)$/.test(entry) ? [path] : [];
  });

test('DS icons render to static, decorative SVG in currentColor', () => {
  const svg = dsIcon(Code);
  assert.match(svg, /^<svg /);
  assert.match(svg, /fill="currentColor"/);
  assert.match(svg, /aria-hidden="true"/);
  assert.match(svg, /width="20"/);
  for (const name of ['code', 'image', 'trash', 'link', 'copy', 'component'])
    assert.equal(ICONS[name], DS_ICONS[name], name);
});

test('no theme.fonts (the DS 2.3 theme has no font tokens)', () => {
  const offenders = walk(root)
    .filter((file) => !file.endsWith('code-font.mjs'))
    .filter((file) => /theme\.fonts|theme && theme\.fonts/.test(readFileSync(file, 'utf8')));
  assert.deepEqual(offenders, []);
});

test('undo is the mirrored DS ArrowClockwise; history tabs use the DS simple variant', () => {
  assert.doesNotMatch(read('components/EditorField/EditorToolbar.jsx'), /ArrowsCounterClockwise/);
  assert.match(
    read('components/EditorField/icons.jsx'),
    /styled\(ArrowClockwise\)`\s*transform: scaleX\(-1\);/
  );
  assert.match(read('components/EditorField/HistoryModal.jsx'), /variant="simple"/);
});

test('gutter markers use the DS Tooltip instead of a native title; Apply uses DS button tokens', () => {
  for (const file of ['CommentMarkers.jsx', 'SuggestionMarkers.jsx']) {
    const source = read(`components/EditorField/${file}`);
    assert.match(source, /<Tooltip/);
    assert.doesNotMatch(source, /\btitle=\{/);
  }
  const styles = read('editor/tools/styles.js');
  const apply = styles.split('.mex-annotation-form__apply {')[1].split('\n    }')[0];
  assert.match(apply, /buttonPrimary600/);
  assert.match(apply, /buttonNeutral0/);
});
