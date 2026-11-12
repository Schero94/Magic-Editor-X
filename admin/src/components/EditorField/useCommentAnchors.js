import { useCallback, useEffect, useRef, useState } from 'react';
import {
  clearCommentHighlights,
  locateAnchor,
  threadAtPoint,
  updateCommentHighlights,
} from '../../editor/comment-anchor-dom';

/**
 * Range comments (2.4): finds the text of every range thread in the editor,
 * paints the open ones with the CSS Custom Highlight API and reports where
 * each thread's text is (`anchored`, `changed`, `detached`).
 *
 * Positions are found again after every content change (`version`), after the
 * thread list changed (polling) and when the field becomes ready. Live ranges
 * follow typing between two passes on their own. Clicking into a highlight
 * calls `onOpen(threadId)`; moving the caret into one marks it as active.
 * @param {object} options - Options.
 * @param {string} options.owner - Unique key of the field (highlights of several fields share the page).
 * @param {{ current: HTMLElement|null }} options.holderRef - Editor.js holder.
 * @param {Array<object>} options.threads - Threads (`useComments`).
 * @param {boolean} options.enabled - Comments are shown and the editor is ready.
 * @param {number} options.version - Changes when the content changed.
 * @param {() => import('yjs').Doc|null} options.getDoc - Live room document, if any.
 * @param {(threadId: string) => void} options.onOpen - Opens a thread (click on its text).
 * @returns {{ statuses: Map<string, string>, ranges: { current: Map<string, Range> }, activeId: string|null, setActiveId: (id: string|null) => void }} State.
 */
export const useCommentAnchors = ({ owner, holderRef, threads, enabled, version, getDoc, onOpen }) => {
  const [statuses, setStatuses] = useState(() => new Map());
  const [activeId, setActiveId] = useState(null);
  const rangesRef = useRef(new Map());
  const statusKeyRef = useRef('');
  const onOpenRef = useRef(onOpen);
  const activeRef = useRef(activeId);
  useEffect(() => {
    onOpenRef.current = onOpen;
  }, [onOpen]);

  // The active highlight only changes the paint, not the positions.
  useEffect(() => {
    activeRef.current = activeId;
    if (enabled) updateCommentHighlights(owner, rangesRef.current, activeId);
  }, [owner, enabled, activeId]);

  // Locate every anchored thread; paint the open ones.
  useEffect(() => {
    const holder = holderRef.current;
    if (!enabled || !holder) {
      rangesRef.current = new Map();
      clearCommentHighlights(owner);
      return undefined;
    }
    const frame = window.requestAnimationFrame(() => {
      const doc = getDoc ? getDoc() : null;
      const ranges = new Map();
      const next = new Map();
      for (const thread of threads) {
        if (!thread || !thread.anchor) continue;
        const escaped = window.CSS && window.CSS.escape ? window.CSS.escape(thread.blockId) : thread.blockId;
        const block = holder.querySelector(`.ce-block[data-id="${escaped}"]`);
        const found = locateAnchor({ block, blockId: thread.blockId, anchor: thread.anchor, doc });
        next.set(thread.id, found.status);
        if (found.range && thread.status === 'open') ranges.set(thread.id, found.range);
      }
      rangesRef.current = ranges;
      updateCommentHighlights(owner, ranges, activeRef.current);
      const key = Array.from(next, ([id, status]) => `${id}:${status}`).join(',');
      if (key !== statusKeyRef.current) {
        statusKeyRef.current = key;
        setStatuses(next);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, [owner, holderRef, threads, enabled, version, getDoc]);

  // Removed with the field.
  useEffect(() => () => clearCommentHighlights(owner), [owner]);

  // Click into a highlight opens its thread; the caret inside one marks it as active.
  useEffect(() => {
    const holder = holderRef.current;
    if (!enabled || !holder) return undefined;
    const caretThread = () => {
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0 || !holder.contains(selection.anchorNode)) return null;
      return threadAtPoint(rangesRef.current, selection.anchorNode, selection.anchorOffset);
    };
    const onClick = () => {
      const selection = window.getSelection();
      if (selection && !selection.isCollapsed) return;
      const id = caretThread();
      if (id) onOpenRef.current(id);
    };
    const onSelectionChange = () => {
      const selection = window.getSelection();
      if (!selection || !holder.contains(selection.anchorNode)) return;
      const id = caretThread();
      setActiveId((current) => (current === id ? current : id));
    };
    holder.addEventListener('click', onClick);
    document.addEventListener('selectionchange', onSelectionChange);
    return () => {
      holder.removeEventListener('click', onClick);
      document.removeEventListener('selectionchange', onSelectionChange);
    };
  }, [enabled, holderRef]);

  /**
   * Selects a thread's text in the editor and scrolls it into view.
   * @param {string} threadId - Thread.
   * @returns {boolean} True when the text was found.
   */
  const selectRange = useCallback((threadId) => {
    const range = rangesRef.current.get(threadId);
    if (!range) return false;
    const element =
      range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
    if (element && element.scrollIntoView) element.scrollIntoView({ block: 'center' });
    // The caret goes to the start of the text (without focusing the editor), so the next
    // Ctrl/Cmd+Alt+N continues from here and the selection listener keeps this thread active.
    const selection = window.getSelection();
    if (selection) {
      const caret = range.cloneRange();
      caret.collapse(true);
      selection.removeAllRanges();
      selection.addRange(caret);
    }
    setActiveId(threadId);
    return true;
  }, []);

  return { statuses, ranges: rangesRef, activeId, setActiveId, selectRange };
};

export default useCommentAnchors;
