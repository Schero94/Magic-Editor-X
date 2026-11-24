import { Modal } from '@strapi/design-system';
import styled, { css } from 'styled-components';

/**
 * 2.10.1: touch targets of the editor field's own UI. On touch screens (coarse pointer) buttons,
 * tabs and button-like controls get at least the DS large control size (theme.sizes.button.M,
 * 44 px; WCAG 2.5.5 Target Size). Checkboxes, switches and radios keep their look; their label is
 * the larger target. Mouse and trackpad layouts do not change.
 */
export const touchTargets = css`
  @media (pointer: coarse) {
    & :is(button, [role='button'], [role='tab']):not([role='checkbox'], [role='switch'], [role='radio']) {
      min-width: ${({ theme }) => theme.sizes.button.M.initial};
      min-height: ${({ theme }) => theme.sizes.button.M.initial};
    }
  }
`;

/** DS `Modal.Content` with the touch targets above, for the field's dialogs. */
export const TouchModalContent = styled(Modal.Content)`
  ${touchTargets}
`;
