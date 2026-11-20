import { ArrowClockwise } from '@strapi/icons';
import styled from 'styled-components';

/**
 * Undo and redo icons (2.7.8). @strapi/icons 2.3 has no undo or redo icon. Redo is
 * `ArrowClockwise`; undo is the same icon mirrored, so the pair reads as back and forward (the
 * two-arrow `ArrowsCounterClockwise` used before read as "refresh").
 */
export const UndoIcon = styled(ArrowClockwise)`
  transform: scaleX(-1);
`;

export const RedoIcon = ArrowClockwise;
