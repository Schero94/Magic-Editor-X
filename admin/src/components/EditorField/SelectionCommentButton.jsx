import { useEffect, useRef, useState } from 'react';
import { Button } from '@strapi/design-system';
import { Discuss } from '@strapi/icons';
import styled from 'styled-components';

/**
 * Range comments (2.4): "Comment" button next to a text selection in a
 * read-only editor (reviewers who may comment but not edit have no inline
 * toolbar). Rendered beside the Editor.js holder like the comment markers,
 * never inside it. Ctrl/Cmd+Alt+M does the same from the keyboard.
 */

const Layer = styled.div`
  position: absolute;
  z-index: 3;
  pointer-events: auto;
`;

/**
 * @param {object} props - Props.
 * @param {{ current: HTMLElement|null }} props.containerRef - Positioned element around the holder.
 * @param {{ current: HTMLElement|null }} props.holderRef - Editor.js holder.
 * @param {(range: Range) => void} props.onComment - Starts a comment on the range.
 * @param {Function} props.t - Translator.
 * @returns {JSX.Element|null} Button.
 */
export const SelectionCommentButton = ({ containerRef, holderRef, onComment, t }) => {
  const [position, setPosition] = useState(null);
  const rangeRef = useRef(null);

  useEffect(() => {
    const onChange = () => {
      const holder = holderRef.current;
      const container = containerRef.current;
      const selection = window.getSelection();
      if (
        !holder ||
        !container ||
        !selection ||
        selection.isCollapsed ||
        selection.rangeCount === 0 ||
        !holder.contains(selection.anchorNode) ||
        !holder.contains(selection.focusNode) ||
        !selection.toString().trim()
      ) {
        // Keep the button while it has focus (keyboard users tab to it).
        if (document.activeElement && document.activeElement.closest('[data-mex-selection-comment]')) return;
        rangeRef.current = null;
        setPosition(null);
        return;
      }
      const range = selection.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      const origin = container.getBoundingClientRect();
      rangeRef.current = range.cloneRange();
      setPosition({
        top: Math.max(0, rect.bottom - origin.top + 4),
        left: Math.max(0, Math.min(rect.left - origin.left, origin.width - 140)),
      });
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, [containerRef, holderRef]);

  if (!position) return null;
  return (
    <Layer style={{ top: position.top, left: position.left }} data-mex-selection-comment="true">
      <Button
        size="S"
        variant="secondary"
        startIcon={<Discuss />}
        // Keep the selection: the button must not take it away on pointer down.
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (rangeRef.current) onComment(rangeRef.current);
          setPosition(null);
        }}
        data-testid="mex-selection-comment"
      >
        {t('editor.comments.range.button', 'Comment')}
      </Button>
    </Layer>
  );
};

export default SelectionCommentButton;
