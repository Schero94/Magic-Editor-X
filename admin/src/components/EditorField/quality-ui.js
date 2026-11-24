import { Typography } from '@strapi/design-system';
import styled from 'styled-components';

/** Shared building blocks of the Quality panel and its link check (2.9). */

/** A full-width, left-aligned row button that wraps long text. */
export const RowButton = styled.button`
  display: block;
  width: 100%;
  min-width: 0;
  text-align: start;
  background: transparent;
  border: 0;
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => `${theme.spaces[2]} ${theme.spaces[2]}`};
  color: ${({ theme }) => theme.colors.neutral800};
  cursor: pointer;
  overflow-wrap: anywhere;
  &:hover {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

export const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 0;
`;

export const Wrap = styled(Typography)`
  overflow-wrap: anywhere;
  min-width: 0;
`;
