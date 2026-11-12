import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Alert, Badge, Box, Button, Typography } from '@strapi/design-system';
import { Play } from '@strapi/icons';
import { useFetchClient } from '@strapi/strapi/admin';
import { API, readApiError } from '../../utils/api';
import { useT, SectionCard, PropertyList } from '../../components/ui';

/** Poll interval and cap while a run is in progress (about 15 minutes in total). */
const POLL_MS = 3000;
const MAX_POLLS = 300;

/**
 * Settings > Configuration: the scheduled link check with a "Run now"
 * button (2.4). Starting a run needs `settings.update` (the route checks
 * it); the button is hidden for read-only admins with an explanation. While
 * a run is in progress anywhere in the cluster, the section polls
 * `GET /quality/link-schedule` (bounded) and shows the new last run when it
 * finishes. 409 `RUNNING` and 400 `DISABLED` are shown inline.
 * @param {{ initial: object|null, canRun: boolean, onStatus?: (status: object) => void }} props - `environment.linkSchedule` from GET /settings, the update right, and a callback that receives every newer status (the environment row shows the same last run).
 * @returns {JSX.Element|null} Section, or null when the schedule is not configured.
 */
export const LinkScheduleSection = ({ initial, canRun, onStatus }) => {
  const t = useT();
  const { formatDate } = useIntl();
  const { get, post } = useFetchClient();
  const [status, setStatus] = useState(initial);
  const [starting, setStarting] = useState(false);
  const [notice, setNotice] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const polls = useRef(0);
  const timer = useRef(null);
  const wasRunning = useRef(Boolean(initial && initial.running));

  const refresh = useCallback(async () => {
    try {
      const { data } = await get(API.linkSchedule);
      const next = data.data;
      setStatus(next);
      if (wasRunning.current && !next.running) {
        setAnnouncement(t('settings.linkRun.finished', 'The link check finished.'));
        setNotice(null);
      }
      wasRunning.current = Boolean(next.running);
      return next;
    } catch {
      return null;
    }
  }, [get, t]);

  const running = Boolean(status && status.running);

  useEffect(() => {
    if (onStatus && status && status !== initial) onStatus(status);
  }, [status, initial, onStatus]);

  useEffect(() => {
    if (!running) {
      polls.current = 0;
      return undefined;
    }
    timer.current = window.setTimeout(async () => {
      polls.current += 1;
      if (polls.current > MAX_POLLS) {
        setNotice({
          variant: 'default',
          text: t(
            'settings.linkRun.stillRunning',
            'The check is still running. Reload the page later to see the result.'
          ),
        });
        return;
      }
      await refresh();
    }, POLL_MS);
    return () => window.clearTimeout(timer.current);
  }, [running, status, refresh, t]);

  if (!status || !status.enabled) return null;

  const runNow = async () => {
    setStarting(true);
    setNotice(null);
    setAnnouncement('');
    try {
      await post(API.linkScheduleRun, {});
      setAnnouncement(t('settings.linkRun.started', 'The link check started.'));
      wasRunning.current = true;
      setStatus((current) => ({ ...current, running: true }));
    } catch (error) {
      const info = readApiError(error);
      if (info.status === 409) {
        setNotice({
          variant: 'default',
          text: t(
            'settings.linkRun.conflict',
            'A link check is already running. The result appears here when it finishes.'
          ),
        });
        wasRunning.current = true;
        setStatus((current) => ({ ...current, running: true }));
      } else if (info.status === 400 && info.code === 'DISABLED') {
        setNotice({
          variant: 'warning',
          text: t(
            'settings.linkRun.disabled',
            'Scheduled link checks are turned off in config/plugins.js (qualityChecks.externalLinks.schedule).'
          ),
        });
      } else {
        setNotice({
          variant: 'danger',
          text: t('settings.linkRun.failed', 'The link check could not be started. Try again.'),
        });
      }
    } finally {
      setStarting(false);
    }
  };

  const date = (value) =>
    value ? formatDate(new Date(value), { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const lastRun = status.lastRun;
  const zone = status.tz || t('settings.linkRun.serverZone', 'Server time zone');

  return (
    <SectionCard
      title={t('settings.linkRun.title', 'Scheduled link check')}
      subtitle={t(
        'settings.linkRun.subtitle',
        'Checks every external link in all editor fields on a schedule. You can also start a check now.'
      )}
      action={
        canRun ? (
          <Button
            startIcon={<Play />}
            variant="secondary"
            onClick={runNow}
            loading={starting}
            disabled={starting || running}
          >
            {running ? t('settings.linkRun.running', 'Check running') : t('settings.linkRun.run', 'Run now')}
          </Button>
        ) : null
      }
    >
      {!canRun ? (
        <Typography variant="pi" textColor="neutral600">
          {t('settings.linkRun.noPermission', 'Starting a check needs the "Update settings" permission.')}
        </Typography>
      ) : null}
      {notice ? (
        <Alert
          variant={notice.variant}
          closeLabel={t('settings.close', 'Close')}
          onClose={() => setNotice(null)}
        >
          {notice.text}
        </Alert>
      ) : null}
      <PropertyList
        items={[
          {
            key: 'state',
            label: t('settings.linkRun.state', 'State'),
            value: running ? (
              <Badge backgroundColor="primary100" textColor="primary700">
                {t('settings.linkRun.running', 'Check running')}
              </Badge>
            ) : (
              <Badge backgroundColor="neutral150" textColor="neutral700">
                {t('settings.linkRun.idle', 'Idle')}
              </Badge>
            ),
          },
          {
            key: 'rule',
            label: t('settings.linkRun.rule', 'Schedule'),
            value: t('settings.linkRun.ruleValue', '{rule} ({zone})', { rule: status.rule || '', zone }),
            hint: status.nextRunAt
              ? t('settings.linkRun.next', 'Next run {date}', { date: date(status.nextRunAt) })
              : undefined,
          },
          {
            key: 'last',
            label: t('settings.linkRun.last', 'Last run'),
            value: lastRun
              ? t(
                  'settings.linkRun.lastValue',
                  '{date}: {checked, number} links checked, {problems, number} with problems.',
                  {
                    date: date(lastRun.finishedAt),
                    checked: lastRun.checked ?? 0,
                    problems: lastRun.problems ?? 0,
                  }
                )
              : t('settings.environment.linkScheduleNever', 'No run yet.'),
            hint:
              lastRun && !lastRun.complete
                ? t(
                    'settings.environment.linkScheduleIncomplete',
                    'The last run did not finish; results of earlier runs were kept.'
                  )
                : undefined,
          },
        ]}
      />
      <Box aria-live="polite" role="status">
        <Typography variant="pi" textColor="neutral600">
          {announcement}
        </Typography>
      </Box>
    </SectionCard>
  );
};

export default LinkScheduleSection;
