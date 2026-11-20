/**
 * Settings pages re-audit (2.7.8): pure helpers behind the fixes, plus a source contract for
 * admin/src/pages. Browser behaviour is covered by tests/admin/settings-reaudit.test.jsx.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import {
  PAGE_HEADING,
  firstInvalidField,
  isFocusLost,
  pageHeading,
  restoreFocus,
} from '../admin/src/pages/focusTargets.mjs';
import { fromDateValue, toDateValue } from '../admin/src/pages/AuditPage/auditDates.mjs';
import {
  validateDraft,
  validateLanguageTool,
  visibleFormErrors,
} from '../admin/src/pages/ConfigurationPage/configForm.mjs';

const page = () =>
  new JSDOM(
    `<!doctype html><body><main aria-labelledby="title"><h1 id="title">Custom blocks</h1>
      <button id="create">Create block</button><button id="save" disabled>Save</button>
      <input id="bad" aria-invalid="true"></main></body>`
  ).window.document;

test('restoreFocus: only acts when focus is lost; disabled or removed controls count as lost', () => {
  const doc = page();
  const create = doc.getElementById('create');
  const save = doc.getElementById('save');
  assert.equal(isFocusLost(doc), true, '<body> has focus');
  assert.equal(restoreFocus([create], { doc }), create);

  doc.getElementById('bad').focus();
  assert.equal(restoreFocus([create], { doc }), doc.getElementById('bad'), 'focus elsewhere is kept');
  assert.equal(restoreFocus([create], { doc, force: true }), create, 'force moves it');

  // A focused control that becomes disabled (a button in its loading state) has lost focus.
  save.disabled = false;
  save.focus();
  save.disabled = true;
  assert.equal(isFocusLost(doc), true);
  assert.equal(restoreFocus([save, create], { doc }), create, 'skips the disabled trigger');

  create.remove();
  assert.equal(isFocusLost(doc), true, 'a removed element is lost focus');
});

test('restoreFocus: refs, functions, selectors and the page title as candidates', () => {
  const doc = page();
  const ref = { current: doc.getElementById('create') };
  assert.equal(restoreFocus([{ current: null }, ref], { doc }), ref.current);
  doc.activeElement.blur();
  assert.equal(restoreFocus([firstInvalidField], { doc }), doc.getElementById('bad'));
  doc.activeElement.blur();
  assert.equal(restoreFocus(['#create'], { doc }), ref.current);
  doc.activeElement.blur();
  const heading = restoreFocus([doc.getElementById('save'), PAGE_HEADING], { doc });
  assert.equal(heading, pageHeading(doc));
  assert.equal(heading.tagName, 'H1');
  assert.equal(heading.getAttribute('tabindex'), '-1', 'focusable by script, no tab stop');
  doc.activeElement.blur();
  assert.equal(restoreFocus([null, undefined], { doc }), null, 'nothing to focus');
});

test('Configuration: errors show for touched fields before Save, test errors until the field changes', () => {
  const errors = { maxInputChars: 'range', model: 'required' };
  assert.deepEqual(visibleFormErrors({ errors }), {}, 'nothing before blur or Save');
  assert.deepEqual(visibleFormErrors({ errors, touched: { maxInputChars: true } }), {
    maxInputChars: 'range',
  });
  assert.deepEqual(visibleFormErrors({ errors, showErrors: true }), errors);
  assert.deepEqual(
    visibleFormErrors({ errors: {}, testErrors: { 'languageTool.baseUrl': 'required' } }),
    { 'languageTool.baseUrl': 'required' },
    'the LanguageTool test highlights the empty URL'
  );
  assert.deepEqual(
    visibleFormErrors({
      errors: { 'languageTool.baseUrl': 'url' },
      testErrors: { 'languageTool.baseUrl': 'required' },
      touched: { 'languageTool.baseUrl': true },
    }),
    { 'languageTool.baseUrl': 'url' },
    'a real validation error wins'
  );
  assert.deepEqual(visibleFormErrors({ errors, serverErrors: { model: 'Bad model' } }), {
    model: { server: 'Bad model' },
  });
  // The range rule the inline error shows (same as the server).
  const draft = { provider: 'anthropic', model: 'm', baseUrl: '', maxInputChars: 100, maxOutputTokens: 4096 };
  assert.equal(validateDraft(draft, {}).maxInputChars, 'range');
  assert.equal(validateDraft({ ...draft, maxInputChars: 8000 }, {}).maxInputChars, undefined);
  // An empty URL is fine for saving while the check is off; only the test needs one.
  assert.deepEqual(validateLanguageTool({ enabled: false, baseUrl: '', apiKeyMode: 'keep' }), {});
});

test('Audit dates: DatePicker values map to the calendar days in the URL', () => {
  assert.equal(toDateValue(''), undefined);
  assert.equal(toDateValue('2026-13-99x'), undefined);
  assert.equal(toDateValue('2026-11-20').toISOString(), '2026-11-20T00:00:00.000Z');
  // The picker reports local midnight of the picked day.
  assert.equal(fromDateValue(new Date(2026, 0, 5)), '2026-01-05');
  assert.equal(fromDateValue(new Date(2026, 10, 30, 0, 0, 0)), '2026-11-30');
  assert.equal(fromDateValue(undefined), '');
  assert.equal(fromDateValue(new Date('nope')), '');
});

const pagesRoot = fileURLToPath(new URL('../admin/src/pages/', import.meta.url));
const walk = (dir) =>
  readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : /\.(jsx?|mjs)$/.test(entry) ? [path] : [];
  });
const sources = walk(pagesRoot).map((file) => [file.slice(pagesRoot.length), readFileSync(file, 'utf8')]);

test('settings pages source contract: DS controls only, no native tooltips, no colour literals', () => {
  const offenders = (pattern) => sources.filter(([, source]) => pattern.test(source)).map(([file]) => file);
  assert.deepEqual(offenders(/type="date"|type='date'/), [], 'dates use the DS DatePicker');
  assert.deepEqual(offenders(/<[a-z][a-zA-Z0-9-]*\b[^>]*\stitle=/), [], 'no native title tooltip');
  assert.deepEqual(offenders(/<Swatch\b[^>]*\stitle=/), [], 'no title on styled elements');
  assert.deepEqual(offenders(/#[0-9a-fA-F]{3,8}\b|rgba?\(/), [], 'theme tokens, no colour literals');
  assert.deepEqual(offenders(/window\.confirm|[^.\w]confirm\(/), [], 'ConfirmDialog, never window.confirm');
  // Switches in lists stay enabled while their request runs (disabling dropped focus to <body>).
  assert.deepEqual(offenders(/<Switch\b[^>]*\bdisabled=\{busy\}/), [], 'list switches stay enabled');
  // List loads wait for the permission check (no 403 for people without access).
  for (const [file, hook] of [
    ['TemplatesPage/index.jsx', 'useTemplateList({ enabled:'],
    ['CustomBlocksPage/index.jsx', 'useCustomBlocks({ enabled:'],
  ]) {
    assert.ok(sources.find(([name]) => name === file)[1].includes(hook), `${file}: ${hook}`);
  }
});
