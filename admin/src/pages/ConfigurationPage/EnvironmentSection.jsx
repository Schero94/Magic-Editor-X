import { Badge } from '@strapi/design-system';
import { useIntl } from 'react-intl';
import { useT, SectionCard, PropertyList } from '../../components/ui';

/**
 * Formats a byte count in megabytes with the admin locale.
 * @param {Function} t - Translate.
 * @param {Function} formatNumber - react-intl formatNumber.
 * @param {number} bytes - Bytes.
 * @returns {string} Text.
 */
const megabytes = (t, formatNumber, bytes) =>
  t('settings.environment.megabytes', '{size} MB', {
    size: formatNumber(Number(bytes || 0) / (1024 * 1024), { maximumFractionDigits: 1 }),
  });

/**
 * Read-only view of the options set in config/plugins.js.
 * @param {{ environment: object }} props - environment from GET /settings.
 * @returns {JSX.Element} Section.
 */
export const EnvironmentSection = ({ environment }) => {
  const t = useT();
  const { formatNumber, formatDate } = useIntl();
  const on = (value) =>
    value ? (
      <Badge backgroundColor="success100" textColor="success700">
        {t('settings.environment.on', 'On')}
      </Badge>
    ) : (
      <Badge backgroundColor="neutral150" textColor="neutral700">
        {t('settings.environment.off', 'Off')}
      </Badge>
    );
  const rawHtml =
    {
      sanitize: t(
        'settings.environment.rawHtml.sanitize',
        'Cleaned on save (scripts and event handlers removed)'
      ),
      allow: t('settings.environment.rawHtml.allow', 'Stored as typed (the frontend must sanitise it)'),
      disable: t('settings.environment.rawHtml.disable', 'Emptied on save'),
    }[environment.rawHtml] || environment.rawHtml;
  const collaboration = environment.collaboration || {};
  const linkSchedule = environment.linkSchedule || null;
  const lastRun = linkSchedule && linkSchedule.lastRun;
  let linkScheduleHint;
  if (linkSchedule && linkSchedule.enabled) {
    const parts = [
      t(
        'settings.environment.linkScheduleHint',
        'Rule {rule}, at most {max} links per run (qualityChecks.externalLinks.schedule).',
        { rule: linkSchedule.rule || '', max: linkSchedule.maxUrlsPerRun ?? 0 }
      ),
      lastRun
        ? t(
            'settings.environment.linkScheduleLastRun',
            'Last run {date}: {checked, number} links checked, {problems, number} with problems.',
            {
              date: formatDate(new Date(lastRun.finishedAt), { dateStyle: 'medium', timeStyle: 'short' }),
              checked: lastRun.checked ?? 0,
              problems: lastRun.problems ?? 0,
            }
          )
        : t('settings.environment.linkScheduleNever', 'No run yet.'),
    ];
    if (lastRun && !lastRun.complete)
      parts.push(
        t(
          'settings.environment.linkScheduleIncomplete',
          'The last run did not finish; results of earlier runs were kept.'
        )
      );
    linkScheduleHint = parts.join(' ');
  }

  return (
    <SectionCard
      title={t('settings.environment.title', 'Server configuration')}
      subtitle={t(
        'settings.environment.subtitle',
        'These options are set in config/plugins.js and apply after a restart. They cannot be changed here.'
      )}
    >
      <PropertyList
        items={[
          {
            key: 'collaboration',
            label: t('settings.environment.collaboration', 'Live collaboration'),
            value: on(collaboration.enabled),
            hint: collaboration.enabled
              ? t(
                  'settings.environment.collaborationHint',
                  'Socket path {path}. Other servers are checked every {interval} ms.',
                  {
                    path: collaboration.path || '',
                    interval: collaboration.pollIntervalMs ?? 0,
                  }
                )
              : undefined,
          },
          {
            key: 'snapshots',
            label: t('settings.environment.snapshots', 'Automatic snapshots'),
            value: collaboration.snapshotIntervalMinutes
              ? t('settings.environment.snapshotsEvery', 'Every {minutes} minutes during live editing', {
                  minutes: collaboration.snapshotIntervalMinutes,
                })
              : t('settings.environment.snapshotsOff', 'Off'),
          },
          { key: 'rawHtml', label: t('settings.environment.rawHtml', 'Raw HTML block'), value: rawHtml },
          {
            key: 'images',
            label: t('settings.environment.maxImage', 'Largest image upload'),
            value: megabytes(t, formatNumber, environment.uploads && environment.uploads.maxImageBytes),
          },
          {
            key: 'files',
            label: t('settings.environment.maxFile', 'Largest file upload'),
            value: megabytes(t, formatNumber, environment.uploads && environment.uploads.maxFileBytes),
          },
          {
            key: 'linkSchedule',
            label: t('settings.environment.linkSchedule', 'Scheduled link check'),
            value: on(Boolean(linkSchedule && linkSchedule.enabled)),
            hint: linkScheduleHint,
          },
          {
            key: 'privateAi',
            label: t('settings.environment.privateAi', 'Private AI hosts allowed'),
            value: on(environment.allowPrivateBaseUrl),
            hint: t(
              'settings.environment.privateAiHint',
              'Needed for local models on localhost or a private network (ai.allowPrivateBaseUrl).'
            ),
          },
        ]}
      />
    </SectionCard>
  );
};

export default EnvironmentSection;
