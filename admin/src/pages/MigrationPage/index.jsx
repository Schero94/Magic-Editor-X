import { Button, EmptyStateLayout, Flex, Typography } from '@strapi/design-system';
import { ArrowClockwise } from '@strapi/icons';
import { EmptyDocuments } from '@strapi/icons/symbols';
import { Page, useRBAC } from '@strapi/strapi/admin';
import { PERMISSIONS } from '../../permissions';
import { ConfirmAction, PageShell, SectionCard, useT } from '../../components/ui';
import { useMigrationWizard } from './useMigrationWizard';
import { SetupSection } from './SetupSection';
import { PreviewSection } from './PreviewSection';
import { RunSection } from './RunSection';
import { isRunning, progressOf } from './migrationFlow.mjs';

/**
 * Unfinished runs (closed tab, failed request): resume or stop each.
 * @param {{ t: Function, wizard: object }} props - Translate and wizard state.
 * @returns {JSX.Element|null} Section.
 */
const ResumeSection = ({ t, wizard }) => {
  const jobs = wizard.load.jobs.filter((entry) => !wizard.job || entry.id !== wizard.job.id);
  if (!jobs.length) return null;
  const typeName = (uid) => {
    const type = wizard.load.types.find((entry) => entry.uid === uid);
    return type ? type.displayName : uid;
  };
  return (
    <SectionCard
      title={t('settings.migration.resume.title', 'Unfinished migrations')}
      subtitle={t(
        'settings.migration.resume.subtitle',
        'These runs stopped before the end, for example because the page was closed. Resume them or stop them.'
      )}
    >
      <Flex tag="ul" direction="column" alignItems="stretch" gap={3}>
        {jobs.map((job) => (
          <Flex
            tag="li"
            key={job.id}
            justifyContent="space-between"
            alignItems="center"
            gap={4}
            wrap="wrap"
            borderColor="neutral200"
            hasRadius
            padding={4}
          >
            <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
              <Typography variant="omega" fontWeight="bold">
                {t('settings.migration.resume.item', '{type}: {from} into {to}', {
                  type: typeName(job.uid),
                  from: job.from,
                  to: job.to,
                })}
              </Typography>
              <Typography variant="pi" textColor="neutral600">
                {t(
                  'settings.migration.resume.progress',
                  '{percent, number}% done ({processed, number} of {total, number} entries)',
                  {
                    percent: progressOf(job),
                    processed: Math.min(job.processed, job.total),
                    total: job.total,
                  }
                )}
              </Typography>
            </Flex>
            <Flex gap={2} wrap="wrap">
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
              <Button
                startIcon={<ArrowClockwise />}
                onClick={() => wizard.resume(job)}
                disabled={isRunning(wizard.job)}
              >
                {t('settings.migration.resume', 'Resume')}
              </Button>
            </Flex>
          </Flex>
        ))}
      </Flex>
    </SectionCard>
  );
};

/**
 * Settings > Magic Editor X > Migrate content (2.13): move Strapi Blocks, Markdown or text/HTML
 * content into a Magic Editor X field with a preview, a backup and a resumable, batched run.
 * @returns {JSX.Element} Page.
 */
const MigrationPage = () => {
  const t = useT();
  const rbac = useRBAC(PERMISSIONS.migrate);
  const allowed = rbac.allowedActions.canRun;
  const wizard = useMigrationWizard({ enabled: Boolean(allowed) });
  const title = t('settings.migration.title', 'Migrate content');

  if (rbac.isLoading) {
    return (
      <>
        <Page.Title>{title}</Page.Title>
        <Page.Loading />
      </>
    );
  }
  if (!allowed) {
    return (
      <>
        <Page.Title>{title}</Page.Title>
        <Page.NoPermissions />
      </>
    );
  }
  const subtitle = t(
    'settings.migration.subtitle',
    'Move content from a Strapi Blocks, Markdown or text field into a Magic Editor X field: choose, preview, back up, migrate.'
  );
  if (wizard.load.status === 'loading') {
    return (
      <PageShell title={title} subtitle={subtitle}>
        <Page.Loading />
      </PageShell>
    );
  }
  if (wizard.load.status === 'error') {
    return (
      <PageShell title={title} subtitle={subtitle}>
        <Page.Error
          content={t('settings.migration.loadError', 'The content types could not be loaded.')}
          action={
            <Button variant="secondary" startIcon={<ArrowClockwise />} onClick={wizard.reload}>
              {t('settings.retry', 'Try again')}
            </Button>
          }
        />
      </PageShell>
    );
  }
  return (
    <PageShell title={title} subtitle={subtitle}>
      <ResumeSection t={t} wizard={wizard} />
      {wizard.load.types.length ? (
        <>
          <SetupSection t={t} wizard={wizard} disabled={Boolean(wizard.job)} />
          {wizard.job ? null : <PreviewSection t={t} preview={wizard.preview} />}
          <RunSection t={t} wizard={wizard} />
        </>
      ) : (
        <SectionCard>
          <EmptyStateLayout
            icon={<EmptyDocuments width="16rem" />}
            content={t(
              'settings.migration.empty',
              'No content type has both a Blocks, rich text or text field and a Magic Editor X field you may change. Add a Magic Editor X field in the Content-Type Builder first.'
            )}
          />
        </SectionCard>
      )}
    </PageShell>
  );
};

export default MigrationPage;
