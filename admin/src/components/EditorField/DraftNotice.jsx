import { Box, Button, Flex, Typography } from '@strapi/design-system';
import { useIntl } from 'react-intl';
import styled from 'styled-components';
import { relativeTimeOf } from '../../editor/drafts-logic.mjs';

/**
 * In-field notice (2.5): a local draft buffer of this field was found (see
 * useDraftBuffer). One sentence, the primary action Restore and the
 * secondary Discard. When the saved content changed after the buffer was
 * taken, a second sentence says so with the number of blocks that differ,
 * so restoring is always an explicit choice.
 */

const Bar = styled(Box)`
  min-width: 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {{ savedAt: number, foundAt: number, conflict: boolean, counts: object|null }} props.notice - Found buffer (`foundAt`: when it was found).
 * @param {() => void} props.onRestore - Restores the content into the editor.
 * @param {() => void} props.onDiscard - Removes the buffer.
 * @param {boolean} props.busy - An action runs.
 * @param {boolean} props.disabled - The editor is not ready yet.
 * @returns {JSX.Element} Notice.
 */
export const DraftNotice = ({ t, notice, onRestore, onDiscard, busy, disabled }) => {
  const { formatRelativeTime, formatDate } = useIntl();
  const { value, unit } = relativeTimeOf(notice.savedAt, notice.foundAt);
  const time = formatRelativeTime(value, unit, { numeric: 'always' });
  const counts = notice.counts;
  const differ = counts ? counts.added + counts.removed + counts.changed + counts.moved : null;
  return (
    <Bar
      background="primary100"
      paddingTop={2}
      paddingBottom={2}
      paddingLeft={3}
      paddingRight={3}
      data-testid="mex-draft-notice"
      data-conflict={notice.conflict ? 'true' : 'false'}
    >
      <Flex gap={2} wrap="wrap" alignItems="center" justifyContent="space-between">
        <Box minWidth={0} flex="1 1 24rem" aria-live="polite">
          <Typography
            variant="omega"
            textColor="neutral800"
            title={formatDate(notice.savedAt, { dateStyle: 'medium', timeStyle: 'short' })}
          >
            {t('editor.drafts.found', 'Unsaved changes from {time} were found.', { time })}
          </Typography>
          {notice.conflict ? (
            <Typography variant="pi" textColor="neutral800" tag="p">
              {differ === null
                ? t(
                    'editor.drafts.conflictPlain',
                    'The saved content changed since then. Restoring replaces it in the editor.'
                  )
                : t(
                    'editor.drafts.conflict',
                    'The saved content changed since then. Restoring replaces it in the editor ({count, plural, one {# block differs} other {# blocks differ}}).',
                    { count: differ }
                  )}
            </Typography>
          ) : null}
        </Box>
        <Flex gap={2} wrap="wrap">
          <Button
            variant="tertiary"
            size="S"
            onClick={onDiscard}
            disabled={busy}
            data-testid="mex-draft-discard"
          >
            {t('editor.drafts.discard', 'Discard')}
          </Button>
          <Button
            size="S"
            onClick={onRestore}
            loading={busy}
            disabled={disabled}
            data-testid="mex-draft-restore"
          >
            {t('editor.drafts.restore', 'Restore')}
          </Button>
        </Flex>
      </Flex>
    </Bar>
  );
};

export default DraftNotice;
