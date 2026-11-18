/**
 * StrictMode checks of the custom field input (components/EditorField): the real Editor.js 2.31
 * runs in jsdom (editor-layout.mjs gives its blocks a width), live collaboration runs the real
 * Yjs replica against the counting socket.io fake (the test plays the server), the Content
 * Manager context is the real `unstable_useContentManagerContext` under the edit view route.
 * Counted per test: Editor.js instances (fakes/editorjs.mjs), Y.Doc instances (fakes/yjs.mjs),
 * sockets, the collaboration session request, plus the harness checks (no duplicate mutation,
 * nothing left after unmount, no console output).
 */
import './editor-layout.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { Form } from '@strapi/strapi/admin';
import { checkStrictEntry, createdSockets, network } from './harness/index.jsx';
import {
  ALL,
  DOCUMENT_ID,
  EDIT_PATH,
  EDIT_ROUTE,
  FIELD,
  VALUE,
  contentManagerRoutes,
  editorConfig,
  editorRoutes,
  fieldRoutes,
  pluginRoutes,
  waitFor,
} from './fixtures.mjs';
import { editorCounts, liveEditors } from './fakes/editorjs.mjs';
import { docCounts, liveDocs } from './fakes/yjs.mjs';
import { createSeedUpdate } from '../../shared/ydoc.mjs';
import { sessionGuard } from '../../admin/src/editor/session-guard.mjs';
import { resetEditorConfigCache } from '../../admin/src/hooks/useEditorConfig';
import EditorField from '../../admin/src/components/EditorField';

/** Room state the test server sends (created before any counter is read: it builds a Y.Doc). */
const SEED = Array.from(createSeedUpdate(VALUE, 'e1'));
const ATTRIBUTE = { type: 'json', customField: 'plugin::magic-editor-x.richtext', options: {} };
const NO_LAZY = editorConfig({ lazyInit: { enabled: false, marginPx: 800 } });

/**
 * The field inside the Content Manager form, as the edit view renders a custom field input.
 * @returns {JSX.Element} Field.
 */
const Field = () => (
  <Form method="PUT" initialValues={{ documentId: DOCUMENT_ID, title: 'Harness article', [FIELD]: VALUE }}>
    <EditorField name={FIELD} value={VALUE} onChange={() => {}} attribute={ATTRIBUTE} label="Body" />
  </Form>
);

const OPTIONS = { path: EDIT_PATH, routePath: EDIT_ROUTE, permissions: ALL };

/**
 * Counters before a test, to count what the test created.
 * @returns {{ editors: number, docs: number, sockets: number }} Counts.
 */
const counters = () => ({
  editors: editorCounts.created,
  docs: docCounts.created,
  sockets: createdSockets.length,
});

/**
 * Prepares one field test: fresh config cache, routes, counters.
 * @param {{ config?: object }} [options] - Editor configuration.
 * @returns {{ start: object, sessions: object[] }} Counters and the recorded session requests.
 */
const setup = ({ config = NO_LAZY } = {}) => {
  resetEditorConfigCache();
  contentManagerRoutes();
  editorRoutes({ config });
  const sessions = [];
  fieldRoutes({ record: sessions });
  return { start: counters(), sessions };
};

const editorReady = (handle) => /2 blocks/.test(handle.container.textContent);

/**
 * Nothing the field created is alive any more.
 * @param {{ editors: number, docs: number, sockets: number }} start - Counters before the test.
 */
const assertAllReleased = (start) => {
  assert.equal(liveEditors.size, 0, 'every Editor.js instance was destroyed');
  assert.deepEqual([...liveDocs.values()], [], 'every Y.Doc was destroyed');
  const sockets = createdSockets.slice(start.sockets);
  assert.ok(
    sockets.every((socket) => !socket.connected),
    'every collaboration socket was disconnected'
  );
};

/**
 * Plays the collaboration server on a socket: connection, welcome and the first sync.
 * @param {object} socket - Fake socket.
 * @param {object[]} [peers] - Other editors in the room.
 */
const serveRoom = async (socket, peers = []) => {
  await act(async () => {
    socket.receive('connect');
    socket.receive('mx:welcome', { canEdit: true, presenceId: 'me', color: '#4945ff', epoch: 'e1' });
    socket.receive('mx:sync', { update: SEED, epoch: 'e1' });
    socket.receive('mx:presence', [{ id: 'me', name: 'Ada Example', color: '#4945ff' }, ...peers]);
  });
};

test('editor field: StrictMode mount starts one editor, one room and one socket; unmount releases all', async () => {
  const { start, sessions } = setup();
  const result = await checkStrictEntry(<Field />, {
    ...OPTIONS,
    async whileMounted(handle) {
      await waitFor(() => editorReady(handle), 'Editor.js to render the value');
      await waitFor(() => createdSockets.length > start.sockets, 'the collaboration socket');
      const socket = createdSockets[createdSockets.length - 1];
      await serveRoom(socket, [{ id: 'peer-1', name: 'Grace Example', color: '#ee5e52' }]);
      await waitFor(() => /Grace Example/.test(document.body.innerHTML), 'the peer in the toolbar');
      assert.equal(liveEditors.size, 1, 'one live Editor.js instance');
      assert.equal(liveDocs.size, 2, 'one replica: the shared Y.Doc and its shadow');
      assert.ok(
        socket.emitted.every((entry) => entry.event !== 'mx:join'),
        'joining is the socket handshake, not an extra event'
      );
    },
  });
  const now = counters();
  assert.equal(now.editors - start.editors, 1, 'StrictMode created one Editor.js instance');
  assert.equal(now.sockets - start.sockets, 1, 'StrictMode opened one socket');
  assert.equal(now.docs - start.docs, 2, 'StrictMode created one replica (2 documents)');
  assert.equal(sessions.length, 1, 'one collaboration session request');
  assert.equal(
    result.mountCalls.filter((call) => call.pathname === '/magic-editor-x/config' && !call.aborted).length,
    1,
    'the shared configuration is requested once and not aborted'
  );
  assertAllReleased(start);
});

test('editor field: lazy start waits for the viewport and disconnects its observer', async () => {
  const { start } = setup({ config: editorConfig() });
  await checkStrictEntry(<Field />, {
    ...OPTIONS,
    async whileMounted(handle) {
      const observers = () =>
        [...globalThis.__strictHarness.resources.observers].filter(
          (observer) =>
            observer.kind === 'IntersectionObserver' && observer.origin.includes('useLazyActivation')
        );
      await waitFor(() => observers().length > 0, 'the lazy-start observer');
      assert.equal(observers().length, 1, 'one observer after the StrictMode remount');
      assert.equal(liveEditors.size, 0, 'no editor before the field is near the viewport');
      await act(async () => {
        const [observer] = observers();
        observer.callback([{ isIntersecting: true, target: [...observer.targets][0] }], observer);
      });
      await waitFor(() => editorReady(handle), 'Editor.js after the field came into view');
      assert.equal(liveEditors.size, 1);
    },
  });
  assert.equal(editorCounts.created - start.editors, 1);
  assertAllReleased(start);
});

test('editor field: signed out pauses the room, signing in again resumes it, unmount stays clean', async () => {
  const { start, sessions } = setup();
  try {
    await checkStrictEntry(<Field />, {
      ...OPTIONS,
      async whileMounted(handle) {
        await waitFor(() => editorReady(handle), 'Editor.js to render the value');
        await waitFor(() => createdSockets.length > start.sockets, 'the collaboration socket');
        const socket = createdSockets[createdSockets.length - 1];
        await serveRoom(socket);
        await act(async () => {
          sessionGuard.end('request');
        });
        await waitFor(() => /You were signed out/.test(document.body.textContent), 'the signed-out banner');
        assert.equal(socket.connected, false, 'the socket is closed while signed out');
        await act(async () => {
          sessionGuard.resume();
        });
        // The room reconnects 1.5 s after signing in again (RESUME_DELAY_MS).
        await waitFor(() => socket.connected, 'the room to resume', 5000);
      },
    });
  } finally {
    sessionGuard.resume();
  }
  assert.equal(sessions.length, 1, 'resuming reuses the session (no second request while mounted)');
  assertAllReleased(start);
});

/**
 * Opens a field tool from the "More tools" menu (Radix dropdown: pointerdown opens it, the item
 * runs its tool after the menu closed).
 * @param {string} id - Tool id (`data-testid="mex-tool-<id>"`).
 */
const openTool = async (id) => {
  const trigger = document.querySelector('[data-testid="mex-tools-menu"]');
  assert.ok(trigger, 'the More tools menu exists');
  await act(async () => {
    trigger.dispatchEvent(
      new window.PointerEvent('pointerdown', { bubbles: true, button: 0, pointerType: 'mouse' })
    );
  });
  await waitFor(() => document.querySelector(`[data-testid="mex-tool-${id}"]`), `menu item ${id}`);
  await act(async () => {
    document.querySelector(`[data-testid="mex-tool-${id}"]`).click();
  });
};

const DIALOGS = [
  {
    id: 'history',
    name: 'version history',
    shows: /Before review/,
    reads: '/magic-editor-x/history',
  },
  {
    id: 'comments',
    name: 'comments panel',
    shows: /No comments yet/,
    reads: '/magic-editor-x/comments',
  },
  {
    id: 'templates',
    name: 'template dialog',
    shows: /Heading and intro/,
    reads: '/magic-editor-x/templates',
  },
];

for (const dialog of DIALOGS) {
  test(`editor field: the ${dialog.name} opens once and unmounts cleanly with the field`, async () => {
    // Settings routes first (templates list); setup() adds the field's own routes, which win.
    pluginRoutes();
    const { start } = setup();
    const result = await checkStrictEntry(<Field />, {
      ...OPTIONS,
      async whileMounted(handle) {
        await waitFor(() => editorReady(handle), 'Editor.js to render the value');
        await openTool(dialog.id);
        await waitFor(() => dialog.shows.test(document.body.textContent), `the ${dialog.name}`);
      },
    });
    if (dialog.reads) {
      const reads = result.calls.filter(
        (call) => call.pathname === dialog.reads && !call.aborted && call.fromPlugin
      );
      assert.equal(reads.length, 1, `${dialog.reads} is read once`);
    }
    assertAllReleased(start);
  });
}

test('editor field: a synced block loads its source once and shows it after the StrictMode remount', async () => {
  const SOURCE = 'syncedsource1';
  const value = {
    ...VALUE,
    blocks: [...VALUE.blocks, { id: 'blk-synced', type: 'synced', data: { ref: SOURCE } }],
  };
  const { start } = setup();
  network.on('GET', `/magic-editor-x/templates/${SOURCE}`, {
    data: {
      id: SOURCE,
      name: 'Shared disclaimer',
      description: '',
      kind: 'synced',
      blocks: {
        time: 0,
        version: '2.31.7',
        blocks: [{ id: 'src-1', type: 'paragraph', data: { text: 'Shared disclaimer text' } }],
      },
      blockCount: 1,
      scope: { contentTypes: [], fields: [] },
      enabled: true,
      sortOrder: 0,
      createdBy: null,
      createdAt: '2026-11-18T09:30:00.000Z',
      updatedAt: '2026-11-18T09:30:00.000Z',
    },
  });
  const result = await checkStrictEntry(
    <Form method="PUT" initialValues={{ documentId: DOCUMENT_ID, [FIELD]: value }}>
      <EditorField name={FIELD} value={value} onChange={() => {}} attribute={ATTRIBUTE} label="Body" />
    </Form>,
    {
      ...OPTIONS,
      async whileMounted(handle) {
        await waitFor(() => /3 blocks/.test(handle.container.textContent), 'Editor.js');
        await waitFor(
          () => /Shared disclaimer text|could not be loaded/.test(handle.container.textContent),
          'the synced block view'
        );
        assert.doesNotMatch(handle.container.textContent, /The synced block could not be loaded/);
        assert.match(handle.container.textContent, /Shared disclaimer text/);
      },
    }
  );
  const reads = result.calls.filter(
    (call) => call.pathname === `/magic-editor-x/templates/${SOURCE}` && !call.aborted
  );
  assert.equal(reads.length, 1, 'the source is read once and that request is not aborted');
  assertAllReleased(start);
});
