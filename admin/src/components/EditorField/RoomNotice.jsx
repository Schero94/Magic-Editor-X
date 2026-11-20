import { useEffect, useRef } from 'react';
import { Box, Button, Flex, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { ConfirmAction } from '../ui/ConfirmAction';

/**
 * In-field notice (2.7.4): the live collaboration room still held changes nobody saved (a room
 * keeps them for `roomTtlMinutes`). The field shows them and marks the form as changed, so the
 * Save button stores what is shown; this notice says so in one sentence. Discard brings the stored
 * value back in the editor, the form and the room. Same placement and look as the draft notice.
 *
 * 2.7.8 (re-audit major 5): Discard affects everyone in the live session, so it asks first (Strapi
 * ConfirmDialog that says so). Afterwards `RoomResetNotice` offers Undo to the person who
 * discarded and tells the others in the room what happened, with a way to put their text back.
 */

const Bar = styled(Box)`
  min-width: 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {() => Promise<void>} props.onDiscard - Restores the stored value (after confirmation).
 * @param {boolean} props.disabled - The editor is read-only.
 * @param {{ current: HTMLElement|null }} [props.fallbackFocusRef] - Focus after Discard (the notice is gone then).
 * @returns {JSX.Element} Notice.
 */
export const RoomNotice = ({ t, onDiscard, disabled, fallbackFocusRef }) => (
  <Bar
    background="primary100"
    paddingTop={2}
    paddingBottom={2}
    paddingLeft={3}
    paddingRight={3}
    data-testid="mex-room-notice"
  >
    <Flex gap={2} wrap="wrap" alignItems="center" justifyContent="space-between">
      <Box minWidth={0} flex="1 1 24rem" role="status">
        <Typography variant="omega" textColor="neutral800">
          {t(
            'editor.room.unsaved',
            'This field shows changes from a live editing session that are not saved yet. Save the entry to keep them.'
          )}
        </Typography>
      </Box>
      <ConfirmAction
        trigger={
          <Button variant="tertiary" size="S" disabled={disabled} data-testid="mex-room-discard">
            {t('editor.room.discard', 'Discard changes')}
          </Button>
        }
        disabled={disabled}
        title={t('editor.room.discardTitle', 'Discard the unsaved changes for everyone?')}
        body={t(
          'editor.room.discardBody',
          'The saved content comes back in this field for everyone editing this entry right now. Their unsaved text in this field is removed too. You can undo this right after.'
        )}
        confirmLabel={t('editor.room.discardConfirm', 'Discard for everyone')}
        onConfirm={onDiscard}
        fallbackFocusRef={fallbackFocusRef}
      />
    </Flex>
  </Bar>
);

/**
 * Notice after the unsaved changes of a live session were discarded (2.7.8).
 * `kind: 'self'`: this person discarded them; Undo puts the previous text back for everyone.
 * `kind: 'remote'`: someone else in the session did; Restore puts the previous text back.
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {'self'|'remote'} props.kind - Who discarded.
 * @param {() => void} props.onUndo - Puts the previous text back.
 * @param {() => void} props.onDismiss - Closes the notice.
 * @param {boolean} [props.autoFocus] - Focus Undo on mount (after the confirmation closed).
 * @param {{ current: HTMLElement|null }} [props.undoRef] - Ref of the Undo button.
 * @param {boolean} [props.disabled] - The editor is read-only.
 * @returns {JSX.Element} Notice.
 */
export const RoomResetNotice = ({
  t,
  kind,
  onUndo,
  onDismiss,
  autoFocus = false,
  undoRef,
  disabled = false,
}) => {
  const ownRef = useRef(null);
  const ref = undoRef || ownRef;
  useEffect(() => {
    if (autoFocus && ref.current) ref.current.focus();
  }, [autoFocus, ref]);
  return (
    <Bar
      background="neutral100"
      paddingTop={2}
      paddingBottom={2}
      paddingLeft={3}
      paddingRight={3}
      data-testid="mex-room-reset-notice"
    >
      <Flex gap={2} wrap="wrap" alignItems="center" justifyContent="space-between">
        <Box minWidth={0} flex="1 1 24rem" role="status">
          <Typography variant="omega" textColor="neutral800">
            {kind === 'self'
              ? t(
                  'editor.room.discarded',
                  'The unsaved changes were discarded for everyone. This field shows the saved content.'
                )
              : t(
                  'editor.room.discardedRemote',
                  'Someone in this live session brought this field back to the saved content. Your unsaved text in this field was removed.'
                )}
          </Typography>
        </Box>
        <Flex gap={2} wrap="wrap">
          <Button variant="secondary" size="S" ref={ref} onClick={onUndo} disabled={disabled}>
            {kind === 'self'
              ? t('editor.room.undoDiscard', 'Undo')
              : t('editor.room.restoreText', 'Restore my text')}
          </Button>
          <Button variant="tertiary" size="S" onClick={onDismiss}>
            {t('editor.room.dismiss', 'Dismiss')}
          </Button>
        </Flex>
      </Flex>
    </Bar>
  );
};

export default RoomNotice;
