import { dropIndex } from './logic.mjs';

/**
 * Drag and drop of blocks (replaces editorjs-drag-drop, maintenance ended).
 *
 * The Editor.js block-settings button (`.ce-toolbar__settings-btn`, the
 * "⋮⋮" handle next to a hovered block) is made draggable. Dropping moves the
 * block with `editor.blocks.move(to, from)`. Our listeners run in the capture
 * phase on the holder's parent, before the Editor.js core drop handler (which
 * would treat the drop as a paste), and stop the event for block drags only;
 * file and text drops keep the core behaviour. Keyboard users move blocks with
 * the core "Move up"/"Move down" menu items.
 *
 * @param {object} editor - Editor.js instance (ready).
 * @param {HTMLElement} holder - Element passed to Editor.js as `holder`.
 * @returns {{ destroy: Function }} Handle.
 */
export const createDragDrop = (editor, holder) => {
  const root = holder.parentElement || holder;
  const MIME = 'application/x-mex-block';
  let fromIndex = -1;
  let indicator = null;

  const blocks = () => Array.from(holder.querySelectorAll('.ce-block'));
  const rects = () => blocks().map((node) => node.getBoundingClientRect());

  const blockIndexAt = (y) => {
    const list = rects();
    for (let i = 0; i < list.length; i += 1) if (y >= list[i].top && y <= list[i].bottom) return i;
    return -1;
  };

  const clearIndicator = () => {
    if (indicator) indicator.classList.remove('mex-drop-before', 'mex-drop-after');
    indicator = null;
  };

  const prepareHandle = (event) => {
    const handle = event.target && event.target.closest && event.target.closest('.ce-toolbar__settings-btn');
    if (handle && holder.contains(handle) && !handle.hasAttribute('draggable'))
      handle.setAttribute('draggable', 'true');
  };

  const onDragStart = (event) => {
    const handle = event.target && event.target.closest && event.target.closest('.ce-toolbar__settings-btn');
    if (!handle || !holder.contains(handle)) return;
    const handleRect = handle.getBoundingClientRect();
    fromIndex = blockIndexAt(handleRect.top + handleRect.height / 2);
    if (fromIndex < 0) fromIndex = editor.blocks.getCurrentBlockIndex();
    if (fromIndex < 0) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(MIME, String(fromIndex));
    const node = blocks()[fromIndex];
    if (node) {
      node.classList.add('mex-dragging');
      try {
        event.dataTransfer.setDragImage(node, 16, 16);
      } catch {
        // some browsers refuse custom drag images; the default is fine
      }
    }
    event.stopPropagation();
  };

  const isBlockDrag = (event) =>
    fromIndex >= 0 && event.dataTransfer && Array.from(event.dataTransfer.types || []).includes(MIME);

  const onDragOver = (event) => {
    if (!isBlockDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const list = blocks();
    const to = dropIndex(rects(), event.clientY, fromIndex);
    clearIndicator();
    indicator = list[to] || null;
    if (indicator) indicator.classList.add(to > fromIndex ? 'mex-drop-after' : 'mex-drop-before');
  };

  const finish = () => {
    clearIndicator();
    blocks().forEach((node) => node.classList.remove('mex-dragging'));
    fromIndex = -1;
  };

  const onDrop = (event) => {
    if (!isBlockDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const to = dropIndex(rects(), event.clientY, fromIndex);
    const from = fromIndex;
    finish();
    if (to !== from && from >= 0) editor.blocks.move(to, from);
  };

  const onDragEnd = () => finish();

  root.addEventListener('pointerdown', prepareHandle, true);
  root.addEventListener('mouseover', prepareHandle, true);
  root.addEventListener('dragstart', onDragStart, true);
  root.addEventListener('dragover', onDragOver, true);
  root.addEventListener('drop', onDrop, true);
  root.addEventListener('dragend', onDragEnd, true);

  return {
    destroy() {
      root.removeEventListener('pointerdown', prepareHandle, true);
      root.removeEventListener('mouseover', prepareHandle, true);
      root.removeEventListener('dragstart', onDragStart, true);
      root.removeEventListener('dragover', onDragOver, true);
      root.removeEventListener('drop', onDrop, true);
      root.removeEventListener('dragend', onDragEnd, true);
      finish();
    },
  };
};
