import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import styled, { css, keyframes } from 'styled-components';

/**
 * Carets, selection highlights and "is editing this block" markers of other
 * people in the room, drawn in a layer above the editor.
 *
 * Positions come from `peer.cursor = { blockId, anchor, focus }` (character
 * offsets in the block's text, as sent by `useCaretSharing`). The layer is
 * decorative (`aria-hidden`); the toolbar announces joins and leaves and
 * lists who is in the field for assistive technology.
 */

/** Colour families the server hands out (Design System palettes). */
export const PEER_FAMILIES = ['primary', 'danger', 'success', 'warning', 'secondary', 'alternative'];

/**
 * Safe colour family for a peer.
 * @param {string} family - Value from the server.
 * @returns {string} Known family.
 */
export const peerFamily = (family) => (PEER_FAMILIES.includes(family) ? family : 'neutral');

const blink = keyframes`
  0%, 49% { opacity: 1; }
  50%, 100% { opacity: 0.2; }
`;

const Layer = styled.div`
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
  z-index: 1;
`;

const Highlight = styled.div`
  position: absolute;
  background: ${({ theme, $family }) => theme.colors[`${$family}200`] || theme.colors.neutral200};
  opacity: 0.55;
  border-radius: 2px;
`;

const Caret = styled.div`
  position: absolute;
  width: 2px;
  background: ${({ theme, $family }) => theme.colors[`${$family}600`] || theme.colors.neutral600};
  opacity: ${({ $idle }) => ($idle ? 0.4 : 1)};
  @media (prefers-reduced-motion: no-preference) {
    ${({ $idle }) =>
      $idle
        ? ''
        : css`
            animation: ${blink} 1.1s step-end infinite;
          `}
  }
`;

const Label = styled.div`
  position: absolute;
  transform: translateY(-100%);
  padding: 0 ${({ theme }) => theme.spaces[1]};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme, $family }) => theme.colors[`${$family}600`] || theme.colors.neutral600};
  color: ${({ theme }) => theme.colors.neutral0};
  font-size: ${({ theme }) => theme.fontSizes[0]};
  line-height: 1.6;
  white-space: nowrap;
  max-width: 16rem;
  overflow: hidden;
  text-overflow: ellipsis;
  opacity: ${({ $idle }) => ($idle ? 0.6 : 1)};
`;

const BlockMarker = styled.div`
  position: absolute;
  width: 3px;
  border-radius: 2px;
  background: ${({ theme, $family }) => theme.colors[`${$family}500`] || theme.colors.neutral500};
  opacity: ${({ $idle }) => ($idle ? 0.4 : 0.9)};
`;

/**
 * DOM point for a character offset inside an element.
 * @param {HTMLElement} root - Element.
 * @param {number} offset - Character offset.
 * @returns {{ node: Node, offset: number } | null} Point.
 */
export const pointAt = (root, offset) => {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let remaining = Math.max(0, offset);
  let node = walker.nextNode();
  let last = null;
  while (node) {
    last = node;
    if (remaining <= node.textContent.length) return { node, offset: remaining };
    remaining -= node.textContent.length;
    node = walker.nextNode();
  }
  if (last) return { node: last, offset: last.textContent.length };
  return null;
};

/**
 * Character offset of a DOM point inside an element.
 * @param {HTMLElement} root - Element.
 * @param {Node} node - Point node.
 * @param {number} offset - Point offset.
 * @returns {number|null} Offset, or null when the point is outside.
 */
export const offsetOf = (root, node, offset) => {
  if (!root.contains(node)) return null;
  const range = document.createRange();
  range.selectNodeContents(root);
  try {
    range.setEnd(node, offset);
  } catch {
    return null;
  }
  return range.toString().length;
};

/**
 * Measures where a peer's caret and selection are.
 * @param {HTMLElement} container - Positioned container of the layer.
 * @param {HTMLElement} holder - Editor holder.
 * @param {object} peer - Peer with cursor.
 * @returns {object|null} Geometry relative to the container.
 */
const measure = (container, holder, peer) => {
  const { blockId, anchor = 0, focus = anchor } = peer.cursor || {};
  if (!blockId) return null;
  const escaped = window.CSS && window.CSS.escape ? window.CSS.escape(blockId) : blockId;
  const block = holder.querySelector(`.ce-block[data-id="${escaped}"]`);
  if (!block) return null;
  const content = block.querySelector('.ce-block__content') || block;
  const origin = container.getBoundingClientRect();
  const blockRect = content.getBoundingClientRect();
  const geometry = {
    marker: {
      left: blockRect.left - origin.left - 8,
      top: blockRect.top - origin.top,
      height: Math.max(8, blockRect.height),
    },
    caret: null,
    highlights: [],
  };
  const start = pointAt(content, Math.min(anchor, focus));
  const end = pointAt(content, Math.max(anchor, focus));
  if (!start || !end) {
    geometry.caret = { left: blockRect.left - origin.left, top: blockRect.top - origin.top, height: 20 };
    return geometry;
  }
  const range = document.createRange();
  try {
    range.setStart(start.node, start.offset);
    range.setEnd(end.node, end.offset);
  } catch {
    return geometry;
  }
  if (anchor !== focus) {
    geometry.highlights = Array.from(range.getClientRects())
      .slice(0, 50)
      .map((rect) => ({
        left: rect.left - origin.left,
        top: rect.top - origin.top,
        width: rect.width,
        height: rect.height,
      }));
  }
  const caretRange = document.createRange();
  const caretPoint = focus >= anchor ? end : start;
  caretRange.setStart(caretPoint.node, caretPoint.offset);
  caretRange.collapse(true);
  const rects = caretRange.getClientRects();
  const rect = rects.length ? rects[0] : caretPoint.node.parentElement?.getBoundingClientRect();
  if (rect) {
    geometry.caret = {
      left: rect.left - origin.left,
      top: rect.top - origin.top,
      height: Math.max(14, rect.height || 18),
    };
  }
  return geometry;
};

/**
 * @param {object} props - Props.
 * @param {{ current: HTMLElement|null }} props.containerRef - Positioned element that contains the holder.
 * @param {{ current: HTMLElement|null }} props.holderRef - Editor holder.
 * @param {Array<object>} props.peers - Peers in the room (without self).
 * @param {number} props.version - Changes when the editor content changed.
 * @param {(id: string, text: string, values?: object) => string} props.t - Translator.
 * @returns {JSX.Element|null} Layer.
 */
export const RemoteCarets = ({ containerRef, holderRef, peers, version, t }) => {
  const [shapes, setShapes] = useState([]);
  const frame = useRef(0);
  const peersRef = useRef(peers);
  useEffect(() => {
    peersRef.current = peers;
  }, [peers]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const holder = holderRef.current;
    if (!container || !holder) return undefined;
    const update = () => {
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => {
        const next = [];
        for (const peer of peersRef.current || []) {
          if (!peer.cursor) continue;
          const geometry = measure(container, holder, peer);
          if (geometry) next.push({ peer, geometry });
        }
        setShapes(next);
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
  }, [containerRef, holderRef, peers, version]);

  if (shapes.length === 0) return null;
  return (
    <Layer aria-hidden="true" data-testid="mex-remote-carets">
      {shapes.map(({ peer, geometry }) => {
        const family = peerFamily(peer.color);
        const label = peer.idle ? t('editor.collab.away', '{name} (away)', { name: peer.name }) : peer.name;
        return (
          <div key={peer.id} data-peer={peer.id}>
            <BlockMarker
              $family={family}
              $idle={peer.idle}
              style={{
                left: geometry.marker.left,
                top: geometry.marker.top,
                height: geometry.marker.height,
              }}
              title={t('editor.collab.editingBlock', '{name} is editing this block', { name: peer.name })}
            />
            {geometry.highlights.map((rect, index) => (
              <Highlight
                key={index}
                $family={family}
                style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
              />
            ))}
            {geometry.caret ? (
              <>
                <Caret
                  $family={family}
                  $idle={peer.idle}
                  data-testid="mex-remote-caret"
                  style={{
                    left: geometry.caret.left,
                    top: geometry.caret.top,
                    height: geometry.caret.height,
                  }}
                />
                <Label
                  $family={family}
                  $idle={peer.idle}
                  style={{ left: geometry.caret.left, top: geometry.caret.top }}
                >
                  {label}
                </Label>
              </>
            ) : null}
          </div>
        );
      })}
    </Layer>
  );
};
