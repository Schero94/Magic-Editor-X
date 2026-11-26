/**
 * 2.13 Settings > Magic Editor X > Migrate content in React StrictMode with the real Strapi admin
 * providers: choose (preselected single type), preview, confirm, batches with progress, summary.
 * Each request runs once (no StrictMode doubles), the batch loop stops when the page unmounts,
 * and a role without the action sees Strapi's no-permissions page.
 */
import './editor-layout.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { act } from 'react';
import { checkStrictEntry, network } from './harness/index.jsx';
import { ALL, ARTICLE, pluginRoutes, waitFor } from './fixtures.mjs';
import MigrationPage from '../../admin/src/pages/MigrationPage';

const PATH = '/settings/magic-editor-x/migration';
const TYPES = {
  data: {
    types: [
      {
        uid: ARTICLE,
        displayName: 'Article',
        kind: 'collectionType',
        localized: false,
        draftAndPublish: true,
        sources: [{ name: 'body', type: 'blocks' }],
        targets: [{ name: 'content', preset: 'simple' }],
      },
    ],
    locales: [],
  },
};
const AFTER = {
  time: 1,
  version: '2.31.7',
  blocks: [{ id: 'p1', type: 'paragraph', data: { text: 'Converted synthetic text' } }],
};
const PREVIEW = {
  data: {
    total: 3,
    scanned: 3,
    counts: { converted: 2, existing: 1, empty: 0, failed: 0 },
    entries: [
      {
        documentId: 'doc1',
        locale: null,
        status: 'converted',
        overwrites: false,
        notes: ['unsupported-node:callout'],
        before: 'Source synthetic text',
        after: AFTER,
      },
      {
        documentId: 'doc2',
        locale: null,
        status: 'existing',
        overwrites: false,
        notes: [],
        before: 'x',
        after: null,
      },
    ],
  },
};
const job = (patch) => ({
  id: '00000000-0000-4000-8000-000000000001',
  uid: ARTICLE,
  from: 'body',
  to: 'content',
  locale: null,
  overwrite: false,
  status: 'running',
  total: 3,
  processed: 0,
  counts: { converted: 0, skippedExisting: 0, skippedEmpty: 0, failed: 0, lossy: 0, versions: 0 },
  failures: [],
  startedAt: '2026-11-26T09:00:00.000Z',
  updatedAt: '2026-11-26T09:00:00.000Z',
  finishedAt: null,
  ...patch,
});

const buttonByText = (text) =>
  [...document.querySelectorAll('button')].find((element) => element.textContent.trim() === text);

const click = async (element) => {
  await act(async () => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0 }));
  });
};

test('Migrate content: preselected fields, preview with before/after and warnings, confirmed run, summary', async () => {
  pluginRoutes();
  network.on('GET', '/magic-editor-x/migration/types', TYPES);
  network.on('GET', '/magic-editor-x/migration/jobs', { data: [] });
  network.on('POST', '/magic-editor-x/migration/preview', PREVIEW);
  network.on('POST', '/magic-editor-x/migration/jobs', { status: 201, body: { data: job() } });
  let batch = 0;
  network.on('POST', /\/magic-editor-x\/migration\/jobs\/[^/]+\/next$/, () => {
    batch += 1;
    return batch === 1
      ? { data: job({ processed: 2, counts: { ...job().counts, converted: 1, skippedExisting: 1 } }) }
      : {
          data: job({
            status: 'done',
            processed: 3,
            finishedAt: '2026-11-26T09:00:05.000Z',
            counts: { converted: 2, skippedExisting: 1, skippedEmpty: 0, failed: 0, lossy: 1, versions: 0 },
          }),
        };
  });
  const result = await checkStrictEntry(<MigrationPage />, {
    path: PATH,
    permissions: ALL,
    whileMounted: async () => {
      await waitFor(
        () => buttonByText('Preview') && !buttonByText('Preview').disabled,
        'the preselected fields'
      );
      assert.match(document.body.textContent, /Only drafts are changed/);
      await click(buttonByText('Preview'));
      await waitFor(() => /Converted synthetic text/.test(document.body.textContent), 'the preview');
      const text = document.body.textContent;
      assert.match(
        text,
        /A dry run of 3 of 3 entries: 2 would be migrated, 1 skipped, 0 cannot be converted/
      );
      assert.match(text, /Source synthetic text/);
      assert.match(text, /Will be migrated/);
      assert.match(text, /A block of the type callout has no Magic Editor X equivalent/);
      await click(buttonByText('Migrate 3 entries'));
      await waitFor(() => document.querySelector('[role="alertdialog"]'), 'the confirmation');
      assert.match(document.querySelector('[role="alertdialog"]').textContent, /body itself is not changed/);
      await click(buttonByText('Migrate'));
      await waitFor(() => /4\. Summary/.test(document.body.textContent), 'the summary');
      assert.match(document.body.textContent, /3 of 3 entries checked/);
      assert.match(document.body.textContent, /Migrated drafts go live when you publish them/);
    },
  });
  const plugin = result.calls.filter((call) => call.fromPlugin && !call.aborted);
  const count = (method, pattern) =>
    plugin.filter((call) => call.method === method && pattern.test(call.pathname)).length;
  assert.equal(count('GET', /migration\/types$/), 1, 'types are read once');
  assert.equal(count('POST', /migration\/preview$/), 1);
  assert.equal(count('POST', /migration\/jobs$/), 1, 'one run started');
  assert.equal(count('POST', /\/next$/), 2, 'one request per batch until done');
});

test('Migrate content: unfinished runs can be resumed', async () => {
  pluginRoutes();
  network.on('GET', '/magic-editor-x/migration/types', TYPES);
  network.on('GET', '/magic-editor-x/migration/jobs', { data: [job({ processed: 1 })] });
  network.on('POST', /\/magic-editor-x\/migration\/jobs\/[^/]+\/next$/, {
    data: job({ status: 'done', processed: 3, counts: { ...job().counts, converted: 3 } }),
  });
  await checkStrictEntry(<MigrationPage />, {
    path: PATH,
    permissions: ALL,
    whileMounted: async () => {
      await waitFor(() => /Unfinished migrations/.test(document.body.textContent), 'the resume list');
      assert.match(document.body.textContent, /Article: body into content/);
      assert.match(document.body.textContent, /33% done \(1 of 3 entries\)/);
      await click(buttonByText('Resume'));
      await waitFor(() => /4\. Summary/.test(document.body.textContent), 'the resumed run to finish');
    },
  });
});

test('Migrate content: a load failure shows an error with Try again, never an empty state', async () => {
  pluginRoutes();
  let fail = true;
  network.on('GET', '/magic-editor-x/migration/types', () =>
    fail
      ? {
          status: 500,
          body: { data: null, error: { status: 500, name: 'InternalServerError', message: 'x' } },
        }
      : TYPES
  );
  network.on('GET', '/magic-editor-x/migration/jobs', { data: [] });
  await checkStrictEntry(<MigrationPage />, {
    path: PATH,
    permissions: ALL,
    whileMounted: async () => {
      await waitFor(() => /could not be loaded/.test(document.body.textContent), 'the error');
      assert.doesNotMatch(document.body.textContent, /No content type has/);
      fail = false;
      await click(buttonByText('Try again'));
      await waitFor(() => buttonByText('Preview'), 'the form after retry');
    },
  });
});

test('Migrate content: without plugin::magic-editor-x.migrate.run the page shows no permissions', async () => {
  pluginRoutes();
  const withoutMigrate = ALL.filter(
    (permission) => permission.action !== 'plugin::magic-editor-x.migrate.run'
  );
  const result = await checkStrictEntry(<MigrationPage />, {
    path: PATH,
    permissions: withoutMigrate,
    whileMounted: async () => {
      await waitFor(() => /permission/i.test(document.body.textContent), 'the no-permissions page');
    },
  });
  assert.equal(
    result.calls.filter((call) => call.fromPlugin && /migration/.test(call.pathname)).length,
    0,
    'nothing is requested'
  );
});
