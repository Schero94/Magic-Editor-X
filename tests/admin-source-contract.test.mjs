/**
 * Source contract for the admin bundle: Design System tokens only, no native
 * dialogs, no debug logging, DS v2 props and no emoji.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../admin/src/', import.meta.url));
const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return walk(path);
    return /\.(jsx?|mjs)$/.test(entry) ? [path] : [];
  });
const strip = (source) => source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/[^\n]*/g, '$1');
const sources = walk(root).map((file) => [file.slice(root.length), strip(readFileSync(file, 'utf8'))]);
const offenders = (pattern) => sources.filter(([, source]) => pattern.test(source)).map(([file]) => file);

test('no colour literals and no var(--colors-*)', () => {
  assert.deepEqual(
    offenders(
      /(?<=['"`:\s(,])#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3,4})\b|\brgba?\s*\(|\bhsla?\s*\(/
    ),
    []
  );
  assert.deepEqual(offenders(/var\(--colors-/), []);
});

test('no native confirm, alert or prompt', () => {
  assert.deepEqual(
    offenders(/\bwindow\.(confirm|alert|prompt)\s*\(|(?<![.\w])(confirm|alert|prompt)\s*\(/),
    []
  );
});

test('no console.log or console.info', () => {
  assert.deepEqual(offenders(/\bconsole\.(log|info|debug)\s*\(/), []);
});

test('no v1 `as` prop on JSX elements', () => {
  assert.deepEqual(offenders(/<[A-Z][\w.]*\b[^>]*\sas=\{/), []);
});

test('no emoji', () => {
  assert.deepEqual(offenders(/(?![©®™])\p{Extended_Pictographic}/u), []);
});

test('no px font sizes and no custom media widths', () => {
  assert.deepEqual(offenders(/font-?size\s*[:=]\s*[{'"`]*\s*\d+(?:\.\d+)?px/i), []);
  assert.deepEqual(
    offenders(
      /@media[^{`]*\(\s*(?:max|min)-width\s*:\s*\d+(?:\.\d+)?(?:px|em|rem)|matchMedia\(\s*['"`][^'"`]*\d+px/
    ),
    []
  );
});

test('no admin token read from browser storage', () => {
  assert.deepEqual(offenders(/(localStorage|sessionStorage)\.getItem\(\s*['"]jwtToken/), []);
});

test('remote collaboration content is sanitised before the editor renders it (MEX-21-01)', () => {
  const field = readFileSync(join(root, 'components/EditorField/index.jsx'), 'utf8');
  const handler = field.slice(
    field.indexOf('onRemoteData: async'),
    field.indexOf('onRemoteData: async') + 1600
  );
  assert.match(handler, /client\.snapshot\(\)/);
  assert.match(handler, /prepareRemoteData\(data,/);
  assert.ok(handler.indexOf('prepareRemoteData(data,') < handler.indexOf('applyExternal('));
  const sanitize = readFileSync(join(root, 'editor/sanitize.js'), 'utf8');
  assert.match(sanitize, /export const prepareRemoteData[\s\S]*prepareEditorValue\(/);
});

test('internal-link attributes survive the admin sanitiser (DOMPurify treats them as URI-safe)', () => {
  const source = sources.find(([file]) => file === 'editor/sanitize.js')[1];
  assert.match(source, /ADD_URI_SAFE_ATTR:\s*\[\s*\.\.\.INTERNAL_LINK_ATTRIBUTES[,\]]/);
  // 2.4: math and footnote attributes too (a note such as "See: …" looks like a URI scheme).
  assert.match(source, /ADD_URI_SAFE_ATTR:[^\]]*MATH_ATTRIBUTE,\s*\.\.\.FOOTNOTE_ATTRIBUTES[,\]]/);
  // 2.5: colour, highlight and annotation attributes; annotation values are kept by a hook.
  assert.match(
    source,
    /ADD_URI_SAFE_ATTR:[^\]]*COLOR_ATTRIBUTE,\s*HIGHLIGHT_ATTRIBUTE,\s*ANNOTATION_ATTRIBUTE/
  );
  assert.match(source, /data\.forceKeepAttr = true/);
});

test('the gallery offers the AI alternative text suggestion per image like the image block', () => {
  const read = (file) => sources.find(([name]) => name === file)[1];
  const tools = read('editor/tools/index.js');
  const gallery = tools.slice(tools.indexOf('gallery: {'), tools.indexOf('video: {'));
  assert.match(gallery, /suggestAltText:\s*ctx\.suggestAltText/);
  const media = read('editor/tools/media.js');
  const item = media.slice(media.indexOf('const alt = createAltControl({'), media.indexOf('const caption ='));
  assert.match(item, /suggest:\s*typeof this\.config\.suggestAltText === 'function'/);
  assert.match(item, /getFileId:\s*\(\)\s*=>\s*mediaFileId\(image\.file\)/);
  assert.match(media, /import \{ mediaFileId \} from '\.\.\/ai-alt-text'/);
});

test('block selects are styled native selects with the DS caret, not the browser default', () => {
  const read = (file) => sources.find(([name]) => name === file)[1];
  const styles = read('editor/tools/styles.js');
  const dom = read('editor/tools/dom.js');
  // Every block select (gallery layout/columns, track kind, TOC levels/style, code language, custom block fields) comes from one helper.
  assert.match(dom, /el\('select', \{ className: 'mex-tool__select' \}\)/);
  // Enter on a closed select must not submit (save) the Content Manager form.
  assert.match(dom, /event\.key === 'Enter'\) event\.preventDefault\(\)/);
  assert.doesNotMatch(styles, /appearance:\s*auto/);
  const start = styles.indexOf('.mex-tool__select {\n      appearance: none;');
  assert.ok(start > 0, 'the select rule removes the native appearance');
  const rule = styles.slice(start);
  assert.match(rule.slice(0, 1200), /\$\{selectCaret\}/);
  assert.match(rule.slice(0, 1200), /&:disabled \{[\s\S]*?\$\{selectCaret\}/);
  assert.match(styles, /const selectCaret = css`[\s\S]*?c\('neutral500'\)/);
  // A padding shorthand on a select would hide the caret room on the inline end.
  const code = styles.slice(styles.indexOf('.mex-code__header {'), styles.indexOf('.mex-code__language {'));
  assert.doesNotMatch(code, /\.mex-tool__select \{[^}]*\bpadding:/);
});

test('code block colours every Prism token itself, so host themes cannot lower the contrast', () => {
  const styles = sources.find(([name]) => name === 'editor/tools/styles.js')[1];
  // Strapi's Blocks field loads prism-solarizedlight globally: `.token.builtin` (and url, entity)
  // turned cyan #2aa198 in Magic Editor X code blocks, 2.93:1 on the light code background.
  const base = styles.search(/\.mex-code__pre \.mex-code__code \.token \{\s*color: \$\{c\('neutral800'\)\};/);
  assert.ok(base > 0, 'a base colour for every token with more specificity than a global Prism theme');
  assert.ok(
    base < styles.indexOf('.mex-code__code .token.comment'),
    'the base rule comes before the token rules'
  );
  for (const token of ['builtin', 'url', 'entity', 'namespace']) {
    assert.match(styles, new RegExp(`\\.mex-code__pre \\.mex-code__code \\.token\\.${token}\\b`), token);
  }
});

test('every plugin Modal opts out of the Radix description (no console warning on Strapi 5.62)', () => {
  // Radix Dialog 1.1.5 (Design System 2.3.1) warns when DialogContent keeps its default
  // aria-describedby without a Description element; aria-describedby={undefined} is the opt-out.
  const missing = [];
  for (const [file, source] of sources)
    for (const match of source.matchAll(/<Modal\.Content\b[^>]*>/g))
      if (!match[0].includes('aria-describedby')) missing.push(file);
  assert.deepEqual(missing, []);
});

test('a CSP notice in a link preview card takes its own row and never squeezes the text (M2)', () => {
  const styles = sources.find(([name]) => name === 'editor/tools/styles.js')[1];
  const block = (selector) => styles.split(`${selector} {`)[1].split('\n    }')[0];
  const card = block('.mex-link__card');
  assert.match(card, /flex-wrap: wrap/);
  assert.ok(styles.includes('.mex-link__card > .mex-csp-blocked {'), 'card-scoped notice rule');
  assert.match(block('.mex-link__card > .mex-csp-blocked'), /flex: 1 1 100%/);
  assert.match(block('.mex-link__text'), /min-width: 0/);
});

test('2.7.4 contrast and target sizes in editor blocks (m7, m8)', () => {
  const styles = sources.find(([name]) => name === 'editor/tools/styles.js')[1];
  const block = (selector) => styles.split(`${selector} {`)[1].split('\n    }')[0];
  // Prism numbers: warning700 is 4.09:1 on the light code background.
  assert.doesNotMatch(block('    .mex-code__code .token.symbol'), /warning700/);
  // @editorjs/attaches texts use its variables (the package rule wins a specificity tie).
  assert.match(
    styles,
    /\.cdx-attaches \{\s*--color-line[\s\S]{0,200}--color-text-secondary: \$\{c\('neutral600'\)\}/
  );
  // Checkbox labels, code header controls, the photo button and the CSP link are at least 24 px.
  assert.match(block('    .mex-tool__check,\n    .mex-inline-check'), /min-height: \$\{s\(6\)\}/);
  assert.match(block('      .mex-code__filename'), /min-height: \$\{s\(8\)\}/);
  assert.match(block('.mex-person__photo-button'), /min-height: \$\{s\(8\)\}/);
  assert.match(block('.mex-csp-blocked__link'), /min-height: \$\{s\(6\)\}/);
});
