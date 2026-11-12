import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('an open Editor.js popover lifts its editor area above the following fields', () => {
  const field = read('admin/src/components/EditorField/index.jsx');
  const area = field.slice(
    field.indexOf('const EditorArea = styled.div`'),
    field.indexOf('const Holder = styled.div`')
  );
  assert.match(
    area,
    /&:has\(\.ce-popover--opened, \.ce-inline-toolbar--showed\) \{\s*z-index: \$\{\(\{ theme \}\) => theme\.zIndices\.popover\};/
  );
});

test('plugin dialogs with icon buttons close with one Escape while a tooltip is open', () => {
  const hook = read('admin/src/hooks/useTooltipSafeEscape.js');
  assert.match(hook, /window\.addEventListener\('keydown', onKeyDown, true\)/);
  assert.match(hook, /document\.querySelector\('\[role="tooltip"\]'\)/);
  assert.match(hook, /closest\('\[role="dialog"\], \[role="alertdialog"\]'\)/);
  // Every dialog that renders an IconButton or Tooltip uses the hook on its Modal.Content.
  const dir = new URL('../admin/src/', import.meta.url);
  const files = fs.readdirSync(dir, { recursive: true }).filter((file) => /\.jsx$/.test(file));
  for (const file of files) {
    const source = fs.readFileSync(new URL(file, dir), 'utf8');
    if (!/<Modal\.Content/.test(source) || !/<(IconButton|Tooltip)\b/.test(source)) continue;
    assert.match(source, /useTooltipSafeEscape\(/, file);
    assert.match(source, /<Modal\.Content\s+\{\.\.\.escapeProps\}/, file);
  }
});

test('the environment row shows the last link run reported by "Run now"', () => {
  const page = read('admin/src/pages/ConfigurationPage/index.jsx');
  assert.match(page, /onStatus=\{setLiveSchedule\}/);
  assert.match(page, /linkSchedule: \{ \.\.\.form\.dto\.environment\.linkSchedule, \.\.\.liveSchedule \}/);
  const section = read('admin/src/pages/ConfigurationPage/LinkScheduleSection.jsx');
  assert.match(section, /if \(onStatus && status && status !== initial\) onStatus\(status\);/);
});
