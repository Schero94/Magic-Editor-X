import { useRef } from 'react';
import { Alert, Box, Button, Flex, LinkButton, Typography } from '@strapi/design-system';
import { ArrowClockwise, Download, Play } from '@strapi/icons';
import { Link as RouterLink } from 'react-router-dom';
import { ConfirmAction, PropertyList, SectionCard } from '../../components/ui';
import { contentManagerPath, failureMessage, isRunning, progressOf } from './migrationFlow.mjs';

/**
 * Message of a run or backup error.
 * @param {Function} t - Translate.
 * @param {{ status: number|null, code: string|null }|null} error - API error.
 * @returns {string} Message.
 */
const errorText = (t, error) => {
  if (error && error.code === 'MIGRATION_RUNNING')
    return t(
      'settings.migration.error.running',
      'A migration into this field is already running. Resume it from the list above or wait until it ends.'
    );
  if (error && error.code === 'BATCH_RUNNING')
    return t('settings.migration.error.batch', 'This migration is running in another tab or window.');
  if (error && error.status === 403)
    return t(
      'settings.migration.error.forbidden',
      'You cannot read the source field or change the target field of this content type.'
    );
  if (error && error.status === 413)
    return t(
      'settings.migration.error.backupTooLarge',
      'There are too many entries for a download. Make a database backup instead.'
    );
  return t(
    'settings.migration.error.paused',
    'The migration paused because a request failed. What was migrated stays; resume to continue.'
  );
};

/**
 * Step 3: backup, migrate with progress, and the summary.
 * @param {{ t: Function, wizard: object }} props - Translate and wizard state.
 * @returns {JSX.Element|null} Section, or nothing before a preview or a run.
 */
export const RunSection = ({ t, wizard }) => {
  const { job, preview, selection, type } = wizard;
  const fallbackRef = useRef(null);
  if (!job && preview.status !== 'ready') return null;
  const total = job ? job.total : preview.data ? preview.data.total : 0;
  const running = isRunning(job);
  const done = job && job.status === 'done';
  const cancelled = job && job.status === 'cancelled';
  const percent = progressOf(job);
  return (
    <SectionCard
      title={
        done || cancelled
          ? t('settings.migration.summary.title', '4. Summary')
          : t('settings.migration.run.title', '3. Migrate')
      }
      subtitle={
        job
          ? t('settings.migration.run.target', '{from} into {to}', { from: job.from, to: job.to })
          : t(
              'settings.migration.run.subtitle',
              'Download a backup first. Leaving this page pauses the migration; you can resume it here.'
            )
      }
    >
      {!job ? (
        <Flex gap={2} wrap="wrap" justifyContent="flex-end" ref={fallbackRef}>
          <Button
            variant="secondary"
            startIcon={<Download />}
            onClick={wizard.downloadBackup}
            loading={wizard.backupState.status === 'loading'}
          >
            {t('settings.migration.backup.button', 'Download backup (JSON)')}
          </Button>
          <ConfirmAction
            variant="default"
            fallbackFocusRef={fallbackRef}
            disabled={!total}
            trigger={
              <Button startIcon={<Play />} disabled={!total}>
                {t(
                  'settings.migration.run.button',
                  'Migrate {total, plural, one {# entry} other {# entries}}',
                  { total }
                )}
              </Button>
            }
            title={t(
              'settings.migration.run.confirmTitle',
              'Migrate {total, plural, one {# entry} other {# entries}}?',
              {
                total,
              }
            )}
            body={`${t(
              'settings.migration.run.confirmBody',
              'The content of {from} is converted and written into {to}. {from} itself is not changed.',
              { from: selection.from, to: selection.to }
            )} ${
              wizard.backupState.status === 'done'
                ? t('settings.migration.run.confirmBackupDone', 'You downloaded a backup.')
                : t('settings.migration.run.confirmBackup', 'You have not downloaded a backup yet.')
            }`}
            confirmLabel={t('settings.migration.run.confirm', 'Migrate')}
            onConfirm={wizard.start}
          />
        </Flex>
      ) : null}
      {wizard.backupState.status === 'error' ? (
        <Alert variant="danger" closeLabel={t('settings.close', 'Close')}>
          {wizard.backupState.error && wizard.backupState.error.status === 413
            ? errorText(t, wizard.backupState.error)
            : t('settings.migration.backup.error', 'The backup could not be downloaded. Try again.')}
        </Alert>
      ) : null}
      {wizard.runError ? (
        <Alert
          variant={wizard.runError.code ? 'warning' : 'danger'}
          closeLabel={t('settings.close', 'Close')}
          action={
            job && running ? (
              <Button variant="tertiary" startIcon={<ArrowClockwise />} onClick={() => wizard.resume(job)}>
                {t('settings.migration.resume', 'Resume')}
              </Button>
            ) : null
          }
        >
          {errorText(t, wizard.runError)}
        </Alert>
      ) : null}
      {job ? (
        <Flex direction="column" alignItems="stretch" gap={3}>
          <Flex justifyContent="space-between" gap={4} wrap="wrap" alignItems="center">
            <Typography variant="omega" textColor="neutral800" aria-live="polite">
              {t('settings.migration.progress', '{processed, number} of {total, number} entries checked', {
                processed: Math.min(job.processed, job.total),
                total: job.total,
              })}
            </Typography>
            {running ? (
              <ConfirmAction
                trigger={
                  <Button variant="danger-light">{t('settings.migration.stop', 'Stop migration')}</Button>
                }
                title={t('settings.migration.stop.title', 'Stop the migration?')}
                body={t(
                  'settings.migration.stop.body',
                  'Entries that were migrated keep their new content. The rest is not migrated.'
                )}
                confirmLabel={t('settings.migration.stop.confirm', 'Stop migration')}
                onConfirm={() => wizard.stop(job)}
              />
            ) : null}
          </Flex>
          {/* DS 2.3.1 ProgressBar has a fixed 10.2rem width and is styled for dark surfaces; this is a
              full-width bar with the same ARIA (role progressbar, value 0-100) and theme tokens. */}
          <Box
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
            aria-label={t('settings.migration.progress.label', 'Migration progress')}
            background="neutral150"
            hasRadius
            height="0.8rem"
            overflow="hidden"
          >
            <Box background="primary600" height="100%" style={{ width: `${percent}%` }} />
          </Box>
          {done || cancelled ? (
            <Flex direction="column" alignItems="stretch" gap={4}>
              <PropertyList
                items={[
                  {
                    key: 'converted',
                    label: t('settings.migration.summary.converted', 'Migrated'),
                    value: job.counts.converted,
                  },
                  {
                    key: 'existing',
                    label: t('settings.migration.summary.existing', 'Skipped: target had content'),
                    value: job.counts.skippedExisting,
                  },
                  {
                    key: 'empty',
                    label: t('settings.migration.summary.empty', 'Skipped: nothing to migrate'),
                    value: job.counts.skippedEmpty,
                  },
                  {
                    key: 'lossy',
                    label: t('settings.migration.summary.lossy', 'Migrated with warnings'),
                    value: job.counts.lossy,
                  },
                  {
                    key: 'failed',
                    label: t('settings.migration.summary.failed', 'Failed'),
                    value: job.counts.failed,
                    hint: job.failures.length
                      ? job.failures
                          .slice(0, 10)
                          .map((failure) => {
                            const reason = failureMessage(failure.code);
                            return t('settings.migration.summary.failure', '{id} ({locale}): {reason}', {
                              id: failure.documentId,
                              locale: failure.locale || '—',
                              reason: t(reason.key, reason.text),
                            });
                          })
                          .join('; ')
                      : undefined,
                  },
                  {
                    key: 'versions',
                    label: t('settings.migration.summary.versions', 'Versions saved before replacing'),
                    value: job.counts.versions,
                  },
                ]}
              />
              <Typography variant="omega" textColor="neutral800">
                {t(
                  'settings.migration.summary.undo',
                  'To undo: replaced content is in each entry\'s version history as "Before migration"; empty targets can be cleared again; the backup file holds every value from before the run.'
                )}
              </Typography>
              {type && type.draftAndPublish ? (
                <Typography variant="omega" textColor="neutral800">
                  {t(
                    'settings.migration.summary.publish',
                    'Migrated drafts go live when you publish them in the Content Manager.'
                  )}
                </Typography>
              ) : null}
              <Flex gap={2} wrap="wrap" justifyContent="flex-end">
                <Button variant="tertiary" onClick={wizard.reset}>
                  {t('settings.migration.summary.again', 'Migrate another field')}
                </Button>
                {type ? (
                  <LinkButton tag={RouterLink} to={contentManagerPath(type)} variant="secondary">
                    {t('settings.migration.summary.open', 'Open in the Content Manager')}
                  </LinkButton>
                ) : null}
              </Flex>
            </Flex>
          ) : null}
        </Flex>
      ) : null}
    </SectionCard>
  );
};
