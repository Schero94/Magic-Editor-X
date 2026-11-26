import { Alert, Badge, Box, Flex, Grid, Loader, Typography } from '@strapi/design-system';
import { WarningCircle } from '@strapi/icons';
import { SectionCard } from '../../components/ui';
import { RenderedContent } from '../../components/RenderedContent';
import { noteMessage } from './migrationFlow.mjs';

/** Badge tone and text of an entry status (one mapping for the whole wizard). */
const STATUS = {
  converted: {
    bg: 'success100',
    fg: 'success700',
    key: 'settings.migration.status.converted',
    text: 'Will be migrated',
  },
  existing: {
    bg: 'neutral150',
    fg: 'neutral800',
    key: 'settings.migration.status.existing',
    text: 'Skipped: the target has content',
  },
  empty: {
    bg: 'neutral150',
    fg: 'neutral800',
    key: 'settings.migration.status.empty',
    text: 'Skipped: nothing to migrate',
  },
  failed: {
    bg: 'danger100',
    fg: 'danger700',
    key: 'settings.migration.status.failed',
    text: 'Cannot be converted',
  },
};

const Panel = ({ title, children }) => (
  <Flex direction="column" alignItems="stretch" gap={2} minWidth={0}>
    <Typography variant="sigma" textColor="neutral600" tag="h4">
      {title}
    </Typography>
    <Box background="neutral100" hasRadius padding={3} minWidth={0}>
      {children}
    </Box>
  </Flex>
);

/**
 * One previewed entry: status, warnings and the content before and after.
 * @param {{ t: Function, entry: object }} props - Translate and entry.
 * @returns {JSX.Element} Entry.
 */
const PreviewEntry = ({ t, entry }) => {
  const status = STATUS[entry.status] || STATUS.failed;
  const label = entry.locale
    ? t('settings.migration.entry.localized', 'Entry {id} · {locale}', {
        id: entry.documentId,
        locale: entry.locale,
      })
    : t('settings.migration.entry', 'Entry {id}', { id: entry.documentId });
  return (
    <Box tag="li" borderColor="neutral200" hasRadius padding={4} minWidth={0}>
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
          <Typography variant="omega" fontWeight="bold" tag="h3" style={{ overflowWrap: 'anywhere' }}>
            {label}
          </Typography>
          <Badge backgroundColor={status.bg} textColor={status.fg}>
            {t(status.key, status.text)}
          </Badge>
        </Flex>
        {entry.overwrites ? (
          <Typography variant="pi" textColor="neutral600">
            {t(
              'settings.migration.entry.overwrites',
              'The target already has content. It is saved as the version "Before migration" and then replaced.'
            )}
          </Typography>
        ) : null}
        {entry.notes && entry.notes.length ? (
          <Flex tag="ul" direction="column" alignItems="stretch" gap={1}>
            {entry.notes.map((note) => {
              const message = noteMessage(note);
              return (
                <li key={note}>
                  <Flex gap={2} alignItems="flex-start">
                    <WarningCircle fill="warning600" aria-hidden focusable={false} />
                    <Typography variant="pi" textColor="neutral800">
                      {t(message.key, message.text, message.values)}
                    </Typography>
                  </Flex>
                </li>
              );
            })}
          </Flex>
        ) : null}
        {entry.status === 'converted' ? (
          <Grid.Root gap={4}>
            <Grid.Item col={6} xs={12} direction="column" alignItems="stretch">
              <Panel title={t('settings.migration.before', 'Before (source text)')}>
                <Typography
                  variant="omega"
                  textColor="neutral800"
                  style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
                >
                  {entry.before || '—'}
                </Typography>
              </Panel>
            </Grid.Item>
            <Grid.Item col={6} xs={12} direction="column" alignItems="stretch">
              <Panel title={t('settings.migration.after', 'After (Magic Editor X)')}>
                <RenderedContent value={entry.after} t={t} />
              </Panel>
            </Grid.Item>
          </Grid.Root>
        ) : null}
      </Flex>
    </Box>
  );
};

/**
 * Step 2: the dry run of the first entries.
 * @param {{ t: Function, preview: { status: string, data: object|null, error: object|null } }} props - Translate and preview state.
 * @returns {JSX.Element|null} Section, or nothing before the first preview.
 */
export const PreviewSection = ({ t, preview }) => {
  if (preview.status === 'idle') return null;
  return (
    <SectionCard
      title={t('settings.migration.preview.title', '2. Check the preview')}
      subtitle={
        preview.data
          ? t(
              'settings.migration.preview.subtitle',
              'A dry run of {scanned, number} of {total, plural, one {# entry} other {# entries}}: {converted, number} would be migrated, {skipped, number} skipped, {failed, number} cannot be converted. Examples below; nothing was changed.',
              {
                scanned: preview.data.scanned,
                total: preview.data.total,
                converted: preview.data.counts.converted,
                skipped: preview.data.counts.existing + preview.data.counts.empty,
                failed: preview.data.counts.failed,
              }
            )
          : undefined
      }
    >
      <div aria-live="polite">
        {preview.status === 'loading' ? (
          <Flex justifyContent="center" padding={4}>
            <Loader small>{t('settings.migration.preview.loading', 'Preparing the preview')}</Loader>
          </Flex>
        ) : null}
        {preview.status === 'error' ? (
          <Alert variant="danger" closeLabel={t('settings.close', 'Close')}>
            {preview.error && preview.error.status === 403
              ? t(
                  'settings.migration.error.forbidden',
                  'You cannot read the source field or change the target field of this content type.'
                )
              : t(
                  'settings.migration.preview.error',
                  'The preview could not be created. Check the fields and try again.'
                )}
          </Alert>
        ) : null}
        {preview.status === 'ready' && preview.data && !preview.data.entries.length ? (
          <Typography variant="omega" textColor="neutral600">
            {t(
              'settings.migration.preview.empty',
              'None of the checked entries would change: their source is empty or their target already has content.'
            )}
          </Typography>
        ) : null}
        {preview.status === 'ready' && preview.data && preview.data.entries.length ? (
          <Flex tag="ul" direction="column" alignItems="stretch" gap={4}>
            {preview.data.entries.map((entry) => (
              <PreviewEntry key={`${entry.documentId}-${entry.locale || ''}`} t={t} entry={entry} />
            ))}
          </Flex>
        ) : null}
      </div>
    </SectionCard>
  );
};
