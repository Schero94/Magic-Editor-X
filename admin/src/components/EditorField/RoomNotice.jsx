import { Box, Button, Flex, Typography } from '@strapi/design-system';
import styled from 'styled-components';

/**
 * In-field notice (2.7.4): the live collaboration room still held changes nobody saved (a room
 * keeps them for `roomTtlMinutes`). The field shows them and marks the form as changed, so the
 * Save button stores what is shown; this notice says so in one sentence. Discard brings the stored
 * value back in the editor, the form and the room. Same placement and look as the draft notice.
 */

const Bar = styled(Box)`
  min-width: 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {() => void} props.onDiscard - Restores the stored value.
 * @param {boolean} props.disabled - The editor is read-only.
 * @returns {JSX.Element} Notice.
 */
export const RoomNotice = ({ t, onDiscard, disabled }) => (
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
      <Button
        variant="tertiary"
        size="S"
        onClick={onDiscard}
        disabled={disabled}
        data-testid="mex-room-discard"
      >
        {t('editor.room.discard', 'Discard changes')}
      </Button>
    </Flex>
  </Bar>
);

export default RoomNotice;
