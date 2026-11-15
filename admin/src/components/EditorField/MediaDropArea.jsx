import { useEffect, useRef } from 'react';
import { styled } from 'styled-components';

/**
 * Files dropped onto a field (2.5). Strapi 5.61 registers the Media Library's
 * editor drop zone as the admin component `media-library-file-drop-zone` (the
 * Blocks editor uses it): it shows "Drop to upload and insert", uploads the
 * files into the Media Library through the upload progress dialog and hands
 * each uploaded asset to `onDropFiles(event)`'s callback.
 *
 * Editor.js handles file drops itself (capture phase on its holder: the image
 * tool would upload the file a second time). While the drop zone is there,
 * this wrapper takes file drops before Editor.js does (capture phase on an
 * ancestor), remembers the block under the pointer and hands the same
 * `DataTransfer` to the drop zone in a new `drop` event dispatched on the
 * drop zone's own element (`DragEventInit.dataTransfer`). File drags over a
 * field that cannot take them are refused without the drop zone's "no
 * permission" frame. Drags without files (moving blocks) are never touched.
 *
 * Without the component (Strapi before 5.61, or the legacy Media Library)
 * the wrapper renders its children only and Editor.js keeps its own drop
 * handling, as in 2.4.
 */

const Root = styled.div`
  min-width: 0;
  ${({ $fullscreen }) => ($fullscreen ? 'flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0;' : '')}
  /*
   * The drop zone centres "Drop to upload and insert" in a frame as tall as the
   * content, often below the screen in a long field. Keep the text in view
   * (sticky); without this rule (another upload plugin version) the frame
   * looks as in the Blocks editor.
   */
  & [data-testid='editor-file-drop-zone'] {
    align-items: flex-start;
  }
  & [data-testid='editor-file-drop-zone'] > * {
    position: sticky;
    top: 35vh;
    margin-block: ${({ theme }) => theme.spaces[6]};
    padding-inline: ${({ theme }) => theme.spaces[4]};
    text-align: center;
  }
`;

/**
 * @param {DragEvent} event - Drag event.
 * @returns {boolean} True when the drag carries files.
 */
const hasFiles = (event) =>
  Boolean(event.dataTransfer) && Array.from(event.dataTransfer.types || []).includes('Files');

/**
 * @param {{
 *   FileDropZone?: import('react').ComponentType<any>|null,
 *   enabled: boolean,
 *   allowedTypes: string[],
 *   fullscreen?: boolean,
 *   holderRef: import('react').RefObject<HTMLElement>,
 *   onAsset: (asset: object, drop: { target: { index: number, empty: boolean }|null, next: number|null, replace: boolean }) => void,
 *   children: import('react').ReactNode,
 * }} props - Props (`onAsset` receives each uploaded asset and the state of its drop: the block the files were
 *   dropped on, then where the next block goes; one state object per drop).
 * @returns {JSX.Element} Wrapper.
 */
export const MediaDropArea = ({
  FileDropZone,
  enabled,
  allowedTypes,
  fullscreen,
  holderRef,
  onAsset,
  children,
}) => {
  const rootRef = useRef(null);
  const enabledRef = useRef(enabled);
  const targetRef = useRef(null);
  const onAssetRef = useRef(onAsset);
  useEffect(() => {
    enabledRef.current = enabled;
    onAssetRef.current = onAsset;
  });

  useEffect(() => {
    const root = rootRef.current;
    if (!FileDropZone || !root) return undefined;
    const forwarded = new WeakSet();
    const refuse = (event) => {
      if (!hasFiles(event) || enabledRef.current) return;
      event.stopPropagation();
      if (event.type !== 'dragleave') {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'none';
      }
    };
    const onDrop = (event) => {
      if (!hasFiles(event) || forwarded.has(event)) return;
      event.stopPropagation();
      event.preventDefault();
      if (!enabledRef.current) return;
      const holder = holderRef.current;
      const block = event.target && event.target.closest ? event.target.closest('.ce-block') : null;
      const blocks = holder ? Array.from(holder.querySelectorAll('.ce-block')) : [];
      const index = block ? blocks.indexOf(block) : -1;
      const paragraph = block && block.querySelector('.ce-paragraph');
      targetRef.current =
        index >= 0
          ? {
              index,
              empty: Boolean(paragraph) && !paragraph.textContent.trim() && !block.querySelector('img'),
            }
          : null;
      const zone = root.firstElementChild;
      if (!zone) return;
      const copy = new DragEvent('drop', {
        bubbles: true,
        cancelable: true,
        composed: true,
        clientX: event.clientX,
        clientY: event.clientY,
        dataTransfer: event.dataTransfer,
      });
      forwarded.add(copy);
      zone.dispatchEvent(copy);
    };
    root.addEventListener('dragenter', refuse, true);
    root.addEventListener('dragover', refuse, true);
    root.addEventListener('dragleave', refuse, true);
    root.addEventListener('drop', onDrop, true);
    return () => {
      root.removeEventListener('dragenter', refuse, true);
      root.removeEventListener('dragover', refuse, true);
      root.removeEventListener('dragleave', refuse, true);
      root.removeEventListener('drop', onDrop, true);
    };
  }, [FileDropZone, holderRef]);

  const onDropFiles = () => {
    const drop = { target: targetRef.current, next: null, replace: false };
    targetRef.current = null;
    return (asset) => onAssetRef.current(asset, drop);
  };

  return (
    <Root ref={rootRef} $fullscreen={fullscreen}>
      {FileDropZone ? (
        <FileDropZone disabled={!enabled} allowedTypes={allowedTypes} onDropFiles={onDropFiles}>
          {children}
        </FileDropZone>
      ) : (
        children
      )}
    </Root>
  );
};
