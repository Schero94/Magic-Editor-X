import { useId } from 'react';
import { Box, Button, Flex, Loader, Switch, Typography } from '@strapi/design-system';
import { useIntl } from 'react-intl';
import styled from 'styled-components';

/**
 * One line under the field toolbar while "Changes since last publish" is on
 * (2.12): the switch that turns the marks off again, what the marks mean and
 * how many blocks changed. The colours are explained in words next to them,
 * so they never carry the meaning alone.
 */

const Bar = styled(Box)`
  min-width: 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
`;

const Swatch = styled.span`
  flex: none;
  display: inline-block;
  width: 0.4rem;
  height: 1.4rem;
  border-radius: 0.2rem;
  background: ${({ theme, $tone }) => theme.colors[$tone]};
`;

const DashedSwatch = styled.span`
  flex: none;
  display: inline-block;
  width: 1.4rem;
  height: 1.2rem;
  border: 1px dashed ${({ theme }) => theme.colors.neutral500};
  border-radius: 0.2rem;
`;

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {(on: boolean) => void} props.onToggle - Turns the marks on or off.
 * @param {string} props.status - 'idle' | 'loading' | 'ready' | 'error'.
 * @param {string|null} props.publishedAt - When the compared version was published (ISO).
 * @param {{ counts: { added: number, changed: number, removed: number } }|null} props.changes - Classification.
 * @param {() => void} props.onRetry - Loads the published version again.
 * @returns {JSX.Element} Bar.
 */
export const PublishedChangesBar = ({ t, onToggle, status, publishedAt, changes, onRetry }) => {
  const labelId = useId();
  const switchId = useId();
  const { formatDate } = useIntl();
  const counts = changes ? changes.counts : null;
  const none = counts && counts.added + counts.changed + counts.removed === 0;
  let summary;
  if (status === 'error') {
    summary = (
      <Flex gap={2} wrap="wrap" alignItems="center">
        <Typography variant="pi" textColor="danger600">
          {t('editor.publishedChanges.error', 'The published version could not be loaded.')}
        </Typography>
        <Button variant="tertiary" size="S" onClick={onRetry}>
          {t('editor.config.retry', 'Try again')}
        </Button>
      </Flex>
    );
  } else if (!counts) {
    summary = (
      <Loader small>{t('editor.publishedChanges.loading', 'Comparing with the published version')}</Loader>
    );
  } else {
    summary = (
      <Typography variant="pi" textColor="neutral800" data-testid="mex-published-summary">
        {none
          ? t('editor.publishedChanges.none', 'No changes since the last publish.')
          : t(
              'editor.publishedChanges.summary',
              '{changed} changed · {added} added · {removed} removed',
              counts
            )}
      </Typography>
    );
  }
  return (
    <Bar
      background="neutral100"
      paddingTop={2}
      paddingBottom={2}
      paddingLeft={3}
      paddingRight={3}
      data-testid="mex-published-bar"
    >
      <Flex gap={3} wrap="wrap" alignItems="center" justifyContent="space-between">
        <Flex gap={2} alignItems="center" minWidth={0}>
          <Switch
            checked
            onCheckedChange={(next) => onToggle(Boolean(next))}
            id={switchId}
            aria-labelledby={labelId}
            onLabel={t('editor.publishedChanges.on', 'On')}
            offLabel={t('editor.publishedChanges.off', 'Off')}
            data-testid="mex-published-switch"
          />
          <Flex direction="column" alignItems="flex-start" minWidth={0}>
            {/* A label, so the title is part of the switch's click target (touch). */}
            <Typography
              id={labelId}
              tag="label"
              htmlFor={switchId}
              variant="omega"
              fontWeight="bold"
              textColor="neutral800"
              style={{ cursor: 'pointer' }}
            >
              {t('editor.publishedChanges.title', 'Changes since last publish')}
            </Typography>
            {publishedAt ? (
              <Typography variant="pi" textColor="neutral600">
                {t('editor.publishedChanges.publishedAt', 'Published version of {date}', {
                  date: formatDate(publishedAt, { dateStyle: 'medium', timeStyle: 'short' }),
                })}
              </Typography>
            ) : null}
          </Flex>
        </Flex>
        <Box role="status" aria-live="polite" minWidth={0}>
          {summary}
        </Box>
        <Flex
          tag="ul"
          gap={3}
          wrap="wrap"
          alignItems="center"
          aria-label={t('editor.publishedChanges.legend', 'Legend')}
        >
          <Flex tag="li" gap={1} alignItems="center">
            <Swatch $tone="success600" aria-hidden="true" />
            <Typography variant="pi" textColor="neutral600">
              {t('editor.publishedChanges.added', 'Added')}
            </Typography>
          </Flex>
          <Flex tag="li" gap={1} alignItems="center">
            <Swatch $tone="warning700" aria-hidden="true" />
            <Typography variant="pi" textColor="neutral600">
              {t('editor.publishedChanges.changed', 'Changed')}
            </Typography>
          </Flex>
          <Flex tag="li" gap={1} alignItems="center">
            <DashedSwatch aria-hidden="true" />
            <Typography variant="pi" textColor="neutral600">
              {t('editor.publishedChanges.removed', 'Removed')}
            </Typography>
          </Flex>
        </Flex>
      </Flex>
    </Bar>
  );
};

export default PublishedChangesBar;
