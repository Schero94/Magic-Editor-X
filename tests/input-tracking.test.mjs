/**
 * Input tracking of the editor holder: edits made before the field's React
 * effects ran (create -> edit redirect) must still mark the field as edited,
 * and the readiness attribute is set and cleared.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  READY_ATTRIBUTE,
  USER_INPUT_EVENTS,
  markInputReady,
  trackUserInput,
} from '../admin/src/editor/input-tracking.mjs';

const holder = () => {
  const target = new EventTarget();
  const attributes = new Map();
  target.setAttribute = (name, value) => attributes.set(name, String(value));
  target.removeAttribute = (name) => attributes.delete(name);
  target.getAttribute = (name) => (attributes.has(name) ? attributes.get(name) : null);
  return target;
};

test('every user input event inside the holder is reported', () => {
  const element = holder();
  const seen = [];
  const stop = trackUserInput(element, (event) => seen.push(event.type));
  USER_INPUT_EVENTS.forEach((type) => element.dispatchEvent(new Event(type)));
  element.dispatchEvent(new Event('focus'));
  assert.deepEqual(seen, [...USER_INPUT_EVENTS]);
  stop();
  element.dispatchEvent(new Event('keydown'));
  assert.equal(seen.length, USER_INPUT_EVENTS.length, 'no reports after stop');
});

test('tracking a missing holder is a no-op', () => {
  assert.doesNotThrow(() => trackUserInput(null, () => {})());
  assert.doesNotThrow(() => markInputReady(null)());
});

test('readiness attribute is set and removed', () => {
  const element = holder();
  const clear = markInputReady(element);
  assert.equal(element.getAttribute(READY_ATTRIBUTE), 'true');
  clear();
  assert.equal(element.getAttribute(READY_ATTRIBUTE), null);
});

test('the field tracks input before Editor.js renders and saves early edits on ready', () => {
  const source = readFileSync(
    new URL('../admin/src/components/EditorField/index.jsx', import.meta.url),
    'utf8'
  );
  const tracking = source.indexOf('trackUserInput(holderRef.current');
  const creation = source.indexOf('new EditorJS(');
  assert.ok(tracking > 0 && tracking < creation, 'input tracking starts before the editor is created');
  assert.match(
    source,
    /setReady\(true\);\s*\/\/[^\n]*\n\s*if \(userTouchedRef\.current\) scheduleSave\(0\);/
  );
  assert.match(source, /markInputReady\(holder\)/);
});
