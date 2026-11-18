/**
 * StrictMode checks of the settings pages (Configuration, Custom blocks, Templates, Audit), the
 * three homepage widgets and the Content-Type Builder input "Component blocks". See
 * harness/index.jsx for what each assertion counts.
 */
import './editor-layout.mjs';
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkStrictEntry } from './harness/index.jsx';
import { ALL, pluginRoutes, waitFor } from './fixtures.mjs';
import { editorCounts, liveEditors } from './fakes/editorjs.mjs';
import { resetEditorConfigCache } from '../../admin/src/hooks/useEditorConfig';
import ConfigurationPage from '../../admin/src/pages/ConfigurationPage';
import CustomBlocksPage from '../../admin/src/pages/CustomBlocksPage';
import TemplatesPage from '../../admin/src/pages/TemplatesPage';
import AuditPage from '../../admin/src/pages/AuditPage';
import { MentionsWidget } from '../../admin/src/components/MentionsWidget';
import { OpenThreadsWidget, BrokenLinksWidget } from '../../admin/src/components/EntryWidgets';
import { AllowedComponentsInput } from '../../admin/src/components/AllowedComponentsInput';

/**
 * Requests of a path that were not aborted by the StrictMode cleanup.
 * @param {object[]} calls - Recorded calls.
 * @param {string} pathname - Path without query.
 * @returns {object[]} Live calls.
 */
const live = (calls, pathname) => calls.filter((call) => call.pathname === pathname && !call.aborted);

const ENTRIES = [
  {
    name: 'settings page Configuration',
    ui: <ConfigurationPage />,
    path: '/settings/magic-editor-x/configuration',
    expect: /Server configuration/,
    reads: ['/magic-editor-x/settings'],
  },
  {
    name: 'settings page Custom blocks',
    ui: <CustomBlocksPage />,
    path: '/settings/magic-editor-x/custom-blocks',
    expect: /Callout/,
    reads: ['/magic-editor-x/custom-blocks', '/magic-editor-x/content-types'],
  },
  {
    name: 'settings page Templates',
    ui: <TemplatesPage />,
    path: '/settings/magic-editor-x/templates',
    expect: /Release note/,
    reads: ['/magic-editor-x/templates', '/magic-editor-x/templates/targets'],
  },
  {
    name: 'settings page Audit',
    ui: <AuditPage />,
    path: '/settings/magic-editor-x/audit',
    expect: /Ada Example/,
    reads: ['/magic-editor-x/audit', '/magic-editor-x/audit/actors'],
  },
  {
    name: 'homepage widget Mentions and replies',
    ui: <MentionsWidget />,
    expect: /Please check the intro/,
    reads: ['/magic-editor-x/notifications'],
  },
  {
    name: 'homepage widget My open threads',
    ui: <OpenThreadsWidget />,
    expect: /Intro needs a source/,
    reads: ['/magic-editor-x/widgets/open-threads'],
  },
  {
    name: 'homepage widget Broken links',
    ui: <BrokenLinksWidget />,
    expect: /Harness article/,
    reads: ['/magic-editor-x/widgets/broken-links'],
  },
  {
    name: 'Content-Type Builder input Component blocks',
    ui: (
      <AllowedComponentsInput
        name="options.allowedComponents"
        value=""
        onChange={() => {}}
        intlLabel={{ id: 'allowedComponents', defaultMessage: 'Component blocks' }}
      />
    ),
    expect: /Component blocks/,
    reads: ['/content-type-builder/components'],
  },
];

for (const entry of ENTRIES) {
  test(`${entry.name}: StrictMode mount, one live read each, clean unmount`, async () => {
    pluginRoutes();
    const result = await checkStrictEntry(entry.ui, { path: entry.path || '/', permissions: ALL });
    assert.match(result.html, entry.expect);
    for (const pathname of entry.reads)
      assert.equal(live(result.mountCalls, pathname).length, 1, `${pathname} is read once`);
    assert.equal(
      result.calls.filter((call) => call.fromPlugin && call.method !== 'GET').length,
      0,
      'mounting sends no mutation'
    );
  });
}

test('settings page Templates: the template editor (deep link) starts one Editor.js and releases it', async () => {
  resetEditorConfigCache();
  pluginRoutes();
  const created = editorCounts.created;
  const result = await checkStrictEntry(<TemplatesPage />, {
    path: '/settings/magic-editor-x/templates?edit=tpl-1',
    permissions: ALL,
    whileMounted: (handle) =>
      waitFor(() => /2 blocks/.test(handle.container.textContent), 'the template content in Editor.js'),
  });
  assert.match(result.html, /Synthetic paragraph for the harness/);
  assert.equal(editorCounts.created - created, 1, 'one Editor.js instance for the template');
  assert.equal(liveEditors.size, 0, 'the editor is destroyed with the page');
  assert.equal(
    result.calls.filter((call) => call.fromPlugin && call.method !== 'GET').length,
    0,
    'opening the editor sends no mutation'
  );
});
