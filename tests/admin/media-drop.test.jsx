/**
 * 2.7.4: a file dropped on the editor clears the Editor.js drop mark (`ce-block--drop-target`, a
 * dotted line with an arrow) that Editor.js would clear in its own drop handler, which never runs
 * for file drops the field uploads itself.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRef } from 'react';
import { renderStrict } from './harness/index.jsx';
import { MediaDropArea } from '../../admin/src/components/EditorField/MediaDropArea.jsx';

const Zone = ({ children }) => <div data-testid="editor-file-drop-zone">{children}</div>;

test('file drop removes the Editor.js drop mark', async () => {
  const holderRef = createRef();
  const handle = await renderStrict(
    <MediaDropArea
      FileDropZone={Zone}
      enabled
      allowedTypes={['images']}
      holderRef={holderRef}
      onAsset={() => {}}
    >
      <div ref={holderRef}>
        <div className="ce-block ce-block--drop-target">
          <div className="ce-paragraph">Drop here</div>
        </div>
      </div>
    </MediaDropArea>
  );
  const block = handle.container.querySelector('.ce-block');
  const data = { types: ['Files'], files: [], items: [], dropEffect: 'none' };
  const drop = new Event('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(drop, 'dataTransfer', { value: data });
  block.querySelector('.ce-paragraph').dispatchEvent(drop);
  assert.equal(block.classList.contains('ce-block--drop-target'), false);
  await handle.unmount();
});
