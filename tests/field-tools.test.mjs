import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TOOL_GROUPS,
  ariaShortcut,
  badgeText,
  exitTools,
  formatShortcut,
  groupFieldTools,
  modKeyName,
} from '../admin/src/editor/field-tools.mjs';

const noop = () => {};
const entry = (id, group, extra = {}) => ({ id, group, label: id, onSelect: noop, ...extra });

test('groups follow Review, Write, View and drop empty groups', () => {
  assert.deepEqual(TOOL_GROUPS, ['review', 'write', 'view']);
  const sections = groupFieldTools([
    entry('preview', 'view'),
    entry('find', 'write'),
    entry('history', 'review'),
    entry('quality', 'review'),
  ]);
  assert.deepEqual(
    sections.map((section) => [section.group, section.items.map((item) => item.id)]),
    [
      ['review', ['history', 'quality']],
      ['write', ['find']],
      ['view', ['preview']],
    ]
  );
  assert.deepEqual(
    groupFieldTools([entry('find', 'write')]).map((section) => section.group),
    ['write']
  );
  assert.deepEqual(groupFieldTools([]), []);
  assert.deepEqual(groupFieldTools(undefined), []);
});

test('hidden entries are left out; order sorts inside a group and keeps insertion order otherwise', () => {
  const sections = groupFieldTools([
    entry('a', 'write'),
    entry('b', 'write', { visible: false }),
    entry('c', 'write', { order: 1 }),
    entry('d', 'write'),
  ]);
  assert.deepEqual(
    sections[0].items.map((item) => item.id),
    ['c', 'a', 'd']
  );
  assert.deepEqual(groupFieldTools([entry('x', 'view', { visible: false })]), []);
});

test('invalid registries fail loudly (one entry per tool, known groups, an action)', () => {
  assert.throws(() => groupFieldTools([entry('a', 'write'), entry('a', 'view')]), /duplicate field tool a/);
  assert.throws(() => groupFieldTools([entry('a', 'settings')]), /unknown group/);
  assert.throws(() => groupFieldTools([{ id: 'a', group: 'write' }]), /without onSelect/);
  assert.throws(() => groupFieldTools([{ group: 'write', onSelect: noop }]), /without id/);
  // A hidden entry is still validated, so a typo does not stay unnoticed until the tool is enabled.
  assert.throws(() => groupFieldTools([entry('a', 'sidebar', { visible: false })]), /unknown group/);
});

test('exit buttons only for visible toggles that are on and name a way back', () => {
  const tools = [
    entry('preview', 'view', { pressed: true, exitLabel: 'Back to editing' }),
    entry('focus', 'view', { pressed: false, exitLabel: 'Leave focus mode' }),
    entry('find', 'write', { pressed: true }),
    entry('hidden', 'view', { pressed: true, exitLabel: 'x', visible: false }),
  ];
  assert.deepEqual(
    exitTools(tools).map((item) => item.id),
    ['preview']
  );
  assert.deepEqual(exitTools(null), []);
});

test('shortcuts render per platform, with WAI-ARIA names for aria-keyshortcuts', () => {
  assert.equal(modKeyName(true), 'Cmd');
  assert.equal(modKeyName(false), 'Ctrl');
  assert.equal(formatShortcut('CMD+SHIFT+F', false), 'Ctrl+Shift+F');
  assert.equal(formatShortcut('CMD+SHIFT+F', true), 'Cmd+Shift+F');
  assert.equal(formatShortcut('CMD+ALT+P', false), 'Ctrl+Alt+P');
  assert.equal(formatShortcut('CMD+/', true), 'Cmd+/');
  assert.equal(formatShortcut('', true), '');
  assert.equal(formatShortcut(undefined, true), '');
  assert.equal(ariaShortcut('CMD+SHIFT+F', false), 'Control+Shift+F');
  assert.equal(ariaShortcut('CMD+ALT+P', true), 'Meta+Alt+P');
  assert.equal(ariaShortcut(undefined), undefined);
});

test('badges cap at 99+', () => {
  assert.equal(badgeText(3), '3');
  assert.equal(badgeText(99), '99');
  assert.equal(badgeText(100), '99+');
});

test('the field toolbar stays short: secondary tools come from the registry, not from own buttons', () => {
  const toolbar = fs.readFileSync(
    new URL('../admin/src/components/EditorField/EditorToolbar.jsx', import.meta.url),
    'utf8'
  );
  // Undo, redo and full screen are the only icon buttons of the bar.
  assert.equal((toolbar.match(/<IconButton\b/g) || []).length, 3);
  assert.match(toolbar, /<FieldToolsMenu ref=\{moreButtonRef\}/);
  // Read-only fields have nothing to undo: no disabled undo/redo pair.
  assert.match(toolbar, /\{readOnly \? null : \(/);
  const field = fs.readFileSync(
    new URL('../admin/src/components/EditorField/index.jsx', import.meta.url),
    'utf8'
  );
  const registry = field.slice(field.indexOf('const fieldTools = ['), field.indexOf('const fieldHint ='));
  for (const id of [
    'comments',
    'history',
    'quality',
    'fieldAi',
    'grammar',
    'find',
    'templates',
    'preview',
    'focus',
    'shortcuts',
  ])
    assert.match(registry, new RegExp(`id: '${id}',`), id);
  // Contextual: no comments without permission/config, no AI or grammar when off, no templates when read-only.
  assert.match(registry, /visible: commentsEnabled,/);
  assert.match(registry, /visible: fieldAiAllowed,/);
  assert.match(registry, /visible: grammarAllowed,/);
  assert.match(registry, /visible: Boolean\(target\.uid\) && !readOnly,/);
});
