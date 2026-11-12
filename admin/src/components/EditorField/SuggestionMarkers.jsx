import { useLayoutEffect, useRef, useState } from 'react';
import { Lightbulb } from '@strapi/icons';
import styled from 'styled-components';

/**
 * Per-block suggestion indicators (2.4), pattern of the comment markers: a
 * small button with the number of open suggestions at the inline end of every
 * block that has some (inserts count on the block they go after). On a block
 * that also has a comment marker it sits below that one. The layer is next to
 * the Editor.js holder, never inside it.
 */

/** Distance below a comment marker on the same block (marker height 3.2rem plus a gap). */
const STACK_OFFSET_PX = 36;

const Layer = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 2;
`;

const Marker = styled.button`
  position: absolute;
  inset-inline-end: ${({ theme }) => theme.spaces[1]};
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: ${({ theme }) => theme.spaces[1]};
  min-width: 3.2rem;
  height: 3.2rem;
  padding: 0 ${({ theme }) => theme.spaces[1]};
  border: 1px solid ${({ theme }) => theme.colors.secondary200};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.secondary100};
  color: ${({ theme }) => theme.colors.secondary700};
  font-size: ${({ theme }) => theme.fontSizes[1]};
  font-weight: 600;
  line-height: 1;
  cursor: pointer;
  ${({ theme }) => theme.breakpoints.medium} {
    min-width: 2.8rem;
    height: 2.8rem;
  }
  svg {
    width: 1.4rem;
    height: 1.4rem;
    fill: currentColor;
  }
  &:hover {
    background: ${({ theme }) => theme.colors.secondary200};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

/**
 * @param {object} props - Props.
 * @param {{ current: HTMLElement|null }} props.containerRef - Positioned element around the holder.
 * @param {{ current: HTMLElement|null }} props.holderRef - Editor.js holder.
 * @param {Map<string, number>} props.counts - Open suggestions per block id.
 * @param {Map<string, number>} [props.stackBelow] - Blocks with a comment marker (this marker goes below it).
 * @param {string[]} props.blockIds - Block ids in document order.
 * @param {number} props.version - Changes when the content changed.
 * @param {(blockId: string) => void} props.onOpen - Opens the block's suggestions.
 * @param {Function} props.t - Translator.
 * @returns {JSX.Element|null} Layer.
 */
export const SuggestionMarkers = ({
  containerRef,
  holderRef,
  counts,
  stackBelow = new Map(),
  blockIds,
  version,
  onOpen,
  t,
}) => {
  const [positions, setPositions] = useState([]);
  const frame = useRef(0);
  const key = Array.from(counts.entries())
    .map(([id, count]) => `${id}:${count}:${stackBelow.has(id) ? 1 : 0}`)
    .join(',');

  useLayoutEffect(() => {
    const container = containerRef.current;
    const holder = holderRef.current;
    if (!container || !holder || counts.size === 0) {
      setPositions([]);
      return undefined;
    }
    const update = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const origin = container.getBoundingClientRect();
        const next = [];
        for (const [blockId, count] of counts) {
          const escaped = window.CSS && window.CSS.escape ? window.CSS.escape(blockId) : blockId;
          const block = holder.querySelector(`.ce-block[data-id="${escaped}"]`);
          if (!block) continue;
          const rect = block.getBoundingClientRect();
          next.push({
            blockId,
            count,
            top: rect.top - origin.top + (stackBelow.has(blockId) ? STACK_OFFSET_PX : 0),
            index: blockIds.indexOf(blockId),
          });
        }
        next.sort((a, b) => a.top - b.top);
        setPositions(next);
      });
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    if (observer) observer.observe(holder);
    window.addEventListener('resize', update);
    holder.addEventListener('scroll', update, true);
    return () => {
      cancelAnimationFrame(frame.current);
      if (observer) observer.disconnect();
      window.removeEventListener('resize', update);
      holder.removeEventListener('scroll', update, true);
    };
    // counts and stackBelow are compared through `key`
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` stands for counts
  }, [containerRef, holderRef, key, version, blockIds]);

  if (positions.length === 0) return null;
  return (
    <Layer data-testid="mex-suggestion-markers">
      {positions.map(({ blockId, count, top, index }) => (
        <Marker
          key={blockId}
          type="button"
          style={{ top }}
          data-block-id={blockId}
          aria-label={t(
            'editor.suggestions.marker',
            'Block {index}: {count, plural, one {# open suggestion} other {# open suggestions}}',
            { index: index + 1, count }
          )}
          title={t(
            'editor.suggestions.marker',
            'Block {index}: {count, plural, one {# open suggestion} other {# open suggestions}}',
            { index: index + 1, count }
          )}
          onClick={() => onOpen(blockId)}
        >
          <Lightbulb aria-hidden="true" focusable="false" />
          <span aria-hidden="true">{count > 99 ? '99+' : count}</span>
        </Marker>
      ))}
    </Layer>
  );
};

export default SuggestionMarkers;
