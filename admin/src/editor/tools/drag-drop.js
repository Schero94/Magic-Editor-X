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
 * Touch (2.13): HTML drag and drop does not start from a finger in Chromium and
 * only partly in Safari, so a touch drag is handled with Pointer Events: hold
 * the "⋮⋮" handle for `TOUCH_HOLD_MS`, then move the finger; the same drop line
 * shows the target and lifting the finger calls the same documented
 * `editor.blocks.move(to, from)`. Moving more than `TOUCH_SLOP_PX` before the
 * hold ends, or lifting the finger earlier, leaves the tap to Editor.js (it
 * opens the block menu). After a drag the click that follows is swallowed, so
 * the menu does not open. The handle has `touch-action: none` on touch screens
 * (styles.js) so the browser does not scroll instead.
 *
 * @param {object} editor - Editor.js instance (ready).
 * @param {HTMLElement} holder - Element passed to Editor.js as `holder`.
 * @returns {{ destroy: Function }} Handle.
 */
export const TOUCH_HOLD_MS = 350;
export const TOUCH_SLOP_PX = 8;
/** Distance from the top or bottom of the screen at which a touch drag scrolls the page. */
export const TOUCH_EDGE_PX = 48;

/**
 * Nearest scrolling ancestor of the editor (the admin scrolls its main area, not the document).
 * @param {Element} node - Start.
 * @returns {Element} Scroller.
 */
const scrollerOf = (node) => {
  const view = node.ownerDocument.defaultView;
  for (
    let element = node.parentElement;
    element && element !== node.ownerDocument.body;
    element = element.parentElement
  ) {
    const style = view.getComputedStyle(element);
    if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) return element;
  }
  return node.ownerDocument.scrollingElement || node.ownerDocument.documentElement;
};

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
    // Touch drags use the pointer path below; a draggable handle would start a native drag in Safari too.
    if (event.pointerType === 'touch') return;
    const handle = event.target && event.target.closest && event.target.closest('.ce-toolbar__settings-btn');
    if (handle && holder.contains(handle) && !handle.hasAttribute('draggable'))
      handle.setAttribute('draggable', 'true');
  };

  // 2.13: touch drag (long press on the handle).
  let touch = null;
  let swallowClick = false;
  const view = holder.ownerDocument.defaultView;

  const endTouch = () => {
    if (!touch) return;
    view.clearTimeout(touch.timer);
    if (touch.handle && touch.handle.hasPointerCapture && touch.handle.hasPointerCapture(touch.pointerId))
      try {
        touch.handle.releasePointerCapture(touch.pointerId);
      } catch {
        // the pointer is gone already
      }
    touch = null;
    finish();
  };

  const onTouchDown = (event) => {
    if (event.pointerType !== 'touch' || !event.isPrimary) return;
    const handle = event.target && event.target.closest && event.target.closest('.ce-toolbar__settings-btn');
    if (!handle || !holder.contains(handle)) return;
    handle.removeAttribute('draggable');
    endTouch();
    // On touch the toolbar belongs to the tapped (current) block; in Editor.js' mobile layout it sits
    // below that block, so its position would name the next one.
    let from = editor.blocks.getCurrentBlockIndex();
    if (from < 0) {
      const handleRect = handle.getBoundingClientRect();
      from = blockIndexAt(handleRect.top + handleRect.height / 2);
    }
    if (from < 0) return;
    touch = { pointerId: event.pointerId, handle, x: event.clientX, y: event.clientY, from, active: false };
    touch.timer = view.setTimeout(() => {
      if (!touch) return;
      touch.active = true;
      touch.scroller = scrollerOf(holder);
      fromIndex = touch.from;
      const node = blocks()[fromIndex];
      if (node) node.classList.add('mex-dragging');
      try {
        handle.setPointerCapture(touch.pointerId);
      } catch {
        // synthetic or ended pointer: moves still reach the root listener
      }
    }, TOUCH_HOLD_MS);
  };

  const onTouchMove = (event) => {
    if (!touch || event.pointerId !== touch.pointerId) return;
    if (!touch.active) {
      if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) > TOUCH_SLOP_PX) endTouch();
      return;
    }
    event.preventDefault();
    // Near the top or bottom edge the page scrolls with the finger (one step per move event).
    const height = (view.visualViewport && view.visualViewport.height) || view.innerHeight;
    if (event.clientY < TOUCH_EDGE_PX) touch.scroller.scrollTop -= TOUCH_EDGE_PX / 4;
    else if (event.clientY > height - TOUCH_EDGE_PX) touch.scroller.scrollTop += TOUCH_EDGE_PX / 4;
    const list = blocks();
    const to = dropIndex(rects(), event.clientY, fromIndex);
    clearIndicator();
    indicator = list[to] || null;
    if (indicator) indicator.classList.add(to > fromIndex ? 'mex-drop-after' : 'mex-drop-before');
  };

  const onTouchUp = (event) => {
    if (!touch || event.pointerId !== touch.pointerId) return;
    const { active } = touch;
    const from = fromIndex;
    const to = active ? dropIndex(rects(), event.clientY, from) : -1;
    endTouch();
    if (!active) return;
    event.preventDefault();
    swallowClick = true;
    view.setTimeout(() => {
      swallowClick = false;
    }, 500);
    if (to !== from && from >= 0 && to >= 0) editor.blocks.move(to, from);
  };

  const onTouchCancel = (event) => {
    if (touch && event.pointerId === touch.pointerId) endTouch();
  };

  // Editor.js opens the block menu on mousedown/click of the handle; not after a touch drag.
  const onClickAfterDrag = (event) => {
    if (!swallowClick) return;
    swallowClick = false;
    event.preventDefault();
    event.stopPropagation();
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
  root.addEventListener('pointerdown', onTouchDown, true);
  root.addEventListener('pointermove', onTouchMove, true);
  root.addEventListener('pointerup', onTouchUp, true);
  root.addEventListener('pointercancel', onTouchCancel, true);
  root.addEventListener('mousedown', onClickAfterDrag, true);
  root.addEventListener('click', onClickAfterDrag, true);
  root.addEventListener('dragstart', onDragStart, true);
  root.addEventListener('dragover', onDragOver, true);
  root.addEventListener('drop', onDrop, true);
  root.addEventListener('dragend', onDragEnd, true);

  return {
    destroy() {
      root.removeEventListener('pointerdown', prepareHandle, true);
      root.removeEventListener('mouseover', prepareHandle, true);
      root.removeEventListener('pointerdown', onTouchDown, true);
      root.removeEventListener('pointermove', onTouchMove, true);
      root.removeEventListener('pointerup', onTouchUp, true);
      root.removeEventListener('pointercancel', onTouchCancel, true);
      root.removeEventListener('mousedown', onClickAfterDrag, true);
      root.removeEventListener('click', onClickAfterDrag, true);
      endTouch();
      root.removeEventListener('dragstart', onDragStart, true);
      root.removeEventListener('dragover', onDragOver, true);
      root.removeEventListener('drop', onDrop, true);
      root.removeEventListener('dragend', onDragEnd, true);
      finish();
    },
  };
};
