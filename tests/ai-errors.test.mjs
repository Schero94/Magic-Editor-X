import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_ERROR_MESSAGES, aiErrorEntry } from '../admin/src/editor/ai-errors.mjs';

test('2.7.8: every AI error code the server answers with has a message in the dialogs', () => {
  const controller = readFileSync(new URL('../server/src/controllers/ai.js', import.meta.url), 'utf8');
  const start = controller.indexOf('const MESSAGES = {');
  const block = controller.slice(start, controller.indexOf('};', start));
  const codes = [...block.matchAll(/^\s+([A-Z_]+): \[\d{3},/gm)].map((match) => match[1]);
  for (const code of ['UNREACHABLE', 'BAD_RESPONSE', 'RESPONSE_TOO_LARGE', 'EMPTY', 'PROVIDER_ERROR'])
    assert.ok(codes.includes(code), `server lists ${code}`);
  // Image alt text (tools) and whole-field actions (FieldAiDialog's own entry) are worded elsewhere.
  for (const code of codes.filter((name) => !['IMAGES_DISABLED', 'FIELD_ACTIONS_DISABLED'].includes(name)))
    assert.ok(aiErrorEntry(code), `message for ${code}`);
});

test('2.7.8: dialog-specific wording wins, unknown codes fall through', () => {
  assert.deepEqual(aiErrorEntry('UNREACHABLE'), AI_ERROR_MESSAGES.UNREACHABLE);
  const own = { BAD_RESPONSE: ['editor.aiField.error.format', 'x'] };
  assert.deepEqual(aiErrorEntry('BAD_RESPONSE', own), own.BAD_RESPONSE);
  assert.equal(aiErrorEntry('SOMETHING_NEW'), null);
  assert.equal(aiErrorEntry(undefined), null);
  assert.equal(aiErrorEntry('toString'), null);
});
