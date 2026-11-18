/**
 * StrictMode checks of the Content Manager side panel (`addEditViewSidePanel`): presence
 * heartbeat, entry summary and clean leave. The panel is a description component that Strapi
 * calls like a hook inside its own component; `PanelHost` does the same. The Content Manager
 * context is the real `unstable_useContentManagerContext` under the edit view route.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkStrictEntry } from './harness/index.jsx';
import {
  ALL,
  ARTICLE,
  DOCUMENT_ID,
  EDIT_PATH,
  EDIT_ROUTE,
  UPDATED_AT,
  contentManagerRoutes,
  entryPanelRoutes,
  waitFor,
} from './fixtures.mjs';
import { EntryPanel } from '../../admin/src/components/EntryPanel';

/**
 * Renders the panel description the way the Content Manager edit view does.
 * @param {object} props - Edit view context (model, documentId, document).
 * @returns {JSX.Element|null} Panel.
 */
const PanelHost = (props) => {
  const panel = EntryPanel(props);
  if (!panel) return null;
  return (
    <aside>
      <h2>{panel.title}</h2>
      {panel.content}
    </aside>
  );
};

test('side panel: StrictMode mount sends one heartbeat, unmount sends one leave', async () => {
  contentManagerRoutes();
  // Every presence request that reached the server (answered, also after unmount).
  const presence = [];
  entryPanelRoutes({ record: presence });
  const result = await checkStrictEntry(
    <PanelHost model={ARTICLE} documentId={DOCUMENT_ID} document={{ updatedAt: UPDATED_AT }} />,
    {
      path: EDIT_PATH,
      routePath: EDIT_ROUTE,
      permissions: ALL,
      // The panel body is a lazy chunk (React.lazy), so its StrictMode mount happens after it loads.
      whileMounted: (handle) =>
        waitFor(() => /open thread/.test(handle.container.textContent), 'the panel body'),
    }
  );
  assert.match(result.html, /Magic Editor X/);
  assert.deepEqual(
    presence.map((body) => (body.leave ? 'leave' : 'heartbeat')),
    ['heartbeat', 'leave'],
    'one heartbeat for the StrictMode double mount, one leave on the real unmount'
  );
  const summaries = result.calls.filter(
    (call) => call.pathname === '/magic-editor-x/entry-summary' && !call.aborted
  );
  assert.equal(summaries.length, 1, 'the summary is read once');
});

test('side panel: hidden for an entry that is being created (no requests)', async () => {
  contentManagerRoutes();
  entryPanelRoutes();
  const result = await checkStrictEntry(<PanelHost model={ARTICLE} />, {
    path: `/content-manager/collection-types/${ARTICLE}/create`,
    routePath: EDIT_ROUTE,
    permissions: ALL,
  });
  assert.equal(
    result.calls.filter((call) => call.fromPlugin).length,
    0,
    'no plugin request without a document'
  );
});
