/**
 * 2.11 admin entry points in StrictMode: "Changes since last publish" (hook, bar, marks layer)
 * and "Edit in Media Library" (image block control). Requests go through the fake network; the
 * hook must not request anything while the marks are off.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act, createRef, useLayoutEffect, useState } from 'react';
import { network, renderStrict, settle } from './harness/index.jsx';
import { usePublishedChanges } from '../../admin/src/components/EditorField/usePublishedChanges.js';
import { PublishedChangesBar } from '../../admin/src/components/EditorField/PublishedChangesBar.jsx';
import { PublishedChangeMarks } from '../../admin/src/components/EditorField/PublishedChangeMarks.jsx';
import { MediaEditControl } from '../../admin/src/components/EditorField/MediaEditControl.jsx';
import { resetPublishedChangesPreferenceCache } from '../../admin/src/editor/published-preference.js';
import { classifyPublishedChanges } from '../../shared/published-changes.mjs';
import { useFetchClient } from '@strapi/strapi/admin';

const t = (_id, text, values) =>
  values
    ? text
        .replace(/\{(\w+), plural, one \{([^}]*)\} other \{([^}]*)\}\}/g, (_m, key, one, other) =>
          (values[key] === 1 ? one : other).replace('#', String(values[key]))
        )
        .replace(/\{(\w+)\}/g, (_m, key) => String(values[key]))
    : text;

const click = async (element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('pointerup', { bubbles: true, button: 0 }));
    element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    element.click();
  });
  await settle();
};

const doc = (blocks) => ({ time: 1, version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });
const PUBLISHED = doc([p('a', 'Alpha one'), p('b', 'Bravo two'), p('c', 'Charlie')]);
const CURRENT = doc([p('a', 'Alpha one'), p('b', 'Bravo 2 two'), p('n', 'New')]);
const TARGET = { uid: 'api::article.article', documentId: 'doc1', locale: 'en', field: 'body' };
const publishedCalls = () =>
  network.pluginCalls().filter((call) => call.pathname.endsWith('/published-version'));

/** Exposes the hook to the test. */
const HookProbe = ({ probeRef, available = true, data = CURRENT }) => {
  const { get } = useFetchClient();
  const [baseline] = useState(() => ({}));
  const state = usePublishedChanges({ available, target: TARGET, baseline, data, get, owner: 1 });
  useLayoutEffect(() => {
    probeRef.current = state;
  });
  return null;
};

test('changes hook: nothing is requested while off; More tools asks for the status only', async () => {
  resetPublishedChangesPreferenceCache();
  network.on('GET', /\/magic-editor-x\/published-version/, (call) => ({
    data: {
      draftAndPublish: true,
      published: true,
      publishedAt: '2026-11-20T10:00:00.000Z',
      content: call.path.includes('content=false') ? null : PUBLISHED,
    },
  }));
  const probe = createRef();
  const handle = await renderStrict(<HookProbe probeRef={probe} />);
  assert.equal(probe.current.on, false, 'off by default');
  assert.equal(publishedCalls().length, 0, 'no request while off');
  await act(async () => probe.current.ensureStatus());
  await settle();
  const status = publishedCalls().filter((call) => !call.aborted);
  assert.equal(status.length, 1);
  assert.match(status[0].path, /content=false/);
  assert.equal(probe.current.status, 'ready');
  assert.equal(probe.current.published, true);
  assert.equal(probe.current.changes, null, 'no marks while off');
  // On: loads the content once and classifies after the pause.
  await act(async () => probe.current.setOn(true));
  await settle(10, 60);
  const loads = publishedCalls().filter((call) => !call.aborted && !call.path.includes('content=false'));
  assert.equal(loads.length, 1);
  assert.deepEqual(probe.current.changes.counts, { added: 1, changed: 1, removed: 1 });
  assert.equal(
    window.localStorage.getItem('magic-editor-x:published-changes:1'),
    'on',
    'remembered per user'
  );
  await act(async () => probe.current.setOn(false));
  assert.equal(window.localStorage.getItem('magic-editor-x:published-changes:1'), null);
  assert.equal(probe.current.changes, null);
  await handle.unmount();
});

test('changes hook: a never published entry shows nothing and makes no content request loop', async () => {
  resetPublishedChangesPreferenceCache();
  window.localStorage.setItem('magic-editor-x:published-changes:1', 'on');
  network.on('GET', /\/magic-editor-x\/published-version/, {
    data: { draftAndPublish: true, published: false, publishedAt: null, content: null },
  });
  const probe = createRef();
  const handle = await renderStrict(<HookProbe probeRef={probe} />);
  await settle(6, 30);
  assert.equal(probe.current.on, true);
  assert.equal(probe.current.status, 'ready');
  assert.equal(probe.current.published, false);
  assert.equal(probe.current.changes, null);
  assert.equal(publishedCalls().filter((call) => !call.aborted).length, 1, 'asked once');
  await handle.unmount();
  // Unavailable (no Draft & Publish, new entry): never requests, even when on.
  resetPublishedChangesPreferenceCache();
  window.localStorage.setItem('magic-editor-x:published-changes:1', 'on');
  const other = createRef();
  const off = await renderStrict(<HookProbe probeRef={other} available={false} />);
  await settle();
  assert.equal(other.current.on, false);
  assert.equal(publishedCalls().length, 0);
  await off.unmount();
});

test('changes bar: switch with a name turns the marks off; counts and legend in words', async () => {
  const toggles = [];
  const changes = classifyPublishedChanges(PUBLISHED, CURRENT);
  const handle = await renderStrict(
    <PublishedChangesBar
      t={t}
      status="ready"
      publishedAt="2026-11-20T10:00:00.000Z"
      changes={changes}
      onRetry={() => {}}
      onToggle={(next) => toggles.push(next)}
    />
  );
  const bar = document.querySelector('[data-testid="mex-published-bar"]');
  assert.match(bar.textContent, /1 changed · 1 added · 1 removed/);
  assert.match(bar.textContent, /Added.*Changed.*Removed/s);
  const sw = bar.querySelector('[role="switch"]');
  const labelledBy = sw.getAttribute('aria-labelledby');
  assert.equal(document.getElementById(labelledBy).textContent, 'Changes since last publish');
  assert.equal(sw.getAttribute('aria-checked'), 'true');
  await click(sw);
  assert.deepEqual(toggles, [false]);
  await handle.unmount();
});

test('changes marks: scoped bars, a word diff popover for changed blocks, removed blocks read-only', async () => {
  const changes = classifyPublishedChanges(PUBLISHED, CURRENT);
  const containerRef = createRef();
  const holderRef = createRef();
  const handle = await renderStrict(
    <div data-mex-changes="mexbody" ref={containerRef} style={{ position: 'relative' }}>
      <div ref={holderRef}>
        <div className="codex-editor__redactor">
          {CURRENT.blocks.map((block) => (
            <div key={block.id} className="ce-block" data-id={block.id}>
              <div className="ce-block__content">{block.data.text}</div>
            </div>
          ))}
        </div>
      </div>
      <PublishedChangeMarks
        scope="mexbody"
        containerRef={containerRef}
        holderRef={holderRef}
        changes={changes}
        blockIds={CURRENT.blocks.map((block) => block.id)}
        version={1}
        t={t}
      />
    </div>
  );
  await settle(4, 30);
  const style = document.querySelector('style[data-mex-changes-style="mexbody"]');
  assert.match(style.textContent, /\.ce-block\[data-id="n"\]/);
  assert.match(style.textContent, /\.ce-block\[data-id="b"\]/);
  // The Editor.js DOM itself is untouched.
  for (const block of document.querySelectorAll('.ce-block')) assert.equal(block.getAttribute('style'), null);
  const changed = document.querySelector('[data-testid="mex-published-changed"]');
  assert.equal(changed.getAttribute('aria-label'), 'Show what changed in block 2 since the last publish');
  await click(changed);
  const diff = document.querySelector('[data-testid="mex-published-diff"]');
  assert.ok(diff, 'popover opened');
  assert.equal(diff.querySelector('ins').textContent.replace('Added text: ', '').trim(), '2');
  const removed = document.querySelector('[data-testid="mex-published-removed"]');
  assert.match(removed.textContent, /1 removed block/);
  await act(async () => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  });
  await settle();
  await click(removed);
  const list = document.querySelector('[data-testid="mex-published-removed-list"]');
  assert.match(list.textContent, /Charlie/);
  assert.equal(list.querySelector('input, textarea, [contenteditable="true"]'), null, 'read-only');
  await handle.unmount();
});

test('Edit in Media Library: warning popover, new-tab deep link, refresh on return', async () => {
  let file = { id: 5, url: '/uploads/photo_old.png', alt: 'Synthetic', width: 10, height: 10 };
  const listeners = new Set();
  const applied = [];
  const getFile = () => file;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  const applyFile = (fresh) => {
    applied.push(fresh);
    file = { ...file, url: fresh.url };
    return true;
  };
  const Wrapped = () => {
    const { get } = useFetchClient();
    return (
      <MediaEditControl
        t={t}
        uploadPath="/admin/plugins/upload"
        get={get}
        getFile={getFile}
        subscribe={subscribe}
        applyFile={applyFile}
      />
    );
  };
  network.on('GET', '/upload/files/5', {
    id: 5,
    url: '/uploads/photo_new.png',
    width: 8,
    height: 8,
    focalPoint: { x: 40, y: 60 },
  });
  const live = await renderStrict(<Wrapped />);
  const button = document.querySelector('[data-testid="mex-media-edit-button"]');
  // DS IconButton: the label is the button's (visually hidden) text and its tooltip.
  assert.equal(button.tagName, 'BUTTON');
  assert.equal(button.textContent.trim(), 'Edit in Media Library');
  // No refresh before the person opened the Media Library.
  await act(async () => window.dispatchEvent(new Event('focus')));
  await settle();
  assert.equal(network.pluginCalls().filter((call) => call.pathname === '/upload/files/5').length, 0);
  await click(button);
  const popover = document.querySelector('[data-testid="mex-media-edit-popover"]');
  assert.match(popover.textContent, /Every entry that uses this image shows the cropped version/);
  const link = popover.querySelector('[data-testid="mex-media-edit-open"]');
  assert.equal(link.getAttribute('href'), '/admin/plugins/upload?assetId=5');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel'), /noopener/);
  const stop = (event) => event.preventDefault();
  window.addEventListener('click', stop, true);
  await click(link);
  window.removeEventListener('click', stop, true);
  await act(async () => window.dispatchEvent(new Event('focus')));
  await settle(6, 20);
  const reads = network.pluginCalls().filter((call) => call.pathname === '/upload/files/5' && !call.aborted);
  assert.equal(reads.length, 1, 'one read on return');
  assert.equal(applied.length, 1);
  assert.equal(applied[0].url, '/uploads/photo_new.png');
  await live.unmount();
  // Without a Media Library id (pasted URL), there is no button.
  file = { url: 'https://images.example.test/a.png' };
  const none = await renderStrict(<Wrapped />);
  assert.equal(document.querySelector('[data-testid="mex-media-edit"]'), null);
  await none.unmount();
});
