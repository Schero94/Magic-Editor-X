import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Flex, Loader, Status, Typography } from '@strapi/design-system';
import { extractLinks } from '../../../../shared/quality.mjs';
import { API, readApiError } from '../../utils/api';
import { refocusIfLost } from './usePanelFocus';
import { List, RowButton, Wrap } from './quality-ui';

/**
 * "Links and media" part of the Quality panel (2.9: split out of QualityPanel.jsx): the
 * on-demand link check and the result of the scheduled check.
 */

const LINK_STATUS = {
  ok: { key: 'editor.quality.link.ok', text: 'Works', variant: 'success' },
  missing: { key: 'editor.quality.link.missing', text: 'Not found', variant: 'danger' },
  draft: { key: 'editor.quality.link.draft', text: 'Not published', variant: 'warning' },
  unknown: { key: 'editor.quality.link.unknown', text: 'Not checked (no access)', variant: 'neutral' },
  broken: { key: 'editor.quality.link.broken', text: 'Broken', variant: 'danger' },
  timeout: { key: 'editor.quality.link.timeout', text: 'No answer in time', variant: 'warning' },
  blocked: { key: 'editor.quality.link.blocked', text: 'Address not allowed', variant: 'neutral' },
  error: { key: 'editor.quality.link.error', text: 'Unreachable', variant: 'danger' },
  skipped: { key: 'editor.quality.link.skipped', text: 'Not checked', variant: 'neutral' },
};

const PROBLEMS = new Set(['missing', 'draft', 'broken', 'timeout', 'error']);

/**
 * Loads the last scheduled link check of the field (GET /quality/link-report).
 * @param {{ get?: Function }} fetchClient - Admin fetch client.
 * @param {{ uid: string|null, documentId: string|null, locale: string|null, field: string, fieldKey?: string }|null} target - Field
 *   (`fieldKey` for fields inside a repeatable component or dynamic zone, 2.4), or null when the schedule is off.
 * @returns {{ state: 'off'|'loading'|'error'|'done', report: object|null }} Result.
 */
const useScheduledReport = (fetchClient, target) => {
  const get = fetchClient && fetchClient.get;
  const uid = target && target.uid;
  const documentId = target && target.documentId;
  const locale = (target && target.locale) || null;
  const field = target && target.field;
  const fieldKey = (target && target.fieldKey) || null;
  const key =
    get && uid && documentId && field
      ? `${uid}|${documentId}|${locale || ''}|${fieldKey ? `#${fieldKey}` : field}`
      : null;
  const [result, setResult] = useState({ key: null, state: 'loading', report: null });
  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    get(API.qualityLinkReport, {
      params: { uid, documentId, locale: locale || undefined, field, ...(fieldKey ? { fieldKey } : {}) },
      signal: controller.signal,
    }).then(
      (response) => {
        if (controller.signal.aborted) return;
        const report = response && response.data && response.data.data;
        setResult(
          report && report.enabled ? { key, state: 'done', report } : { key, state: 'off', report: null }
        );
      },
      () => {
        if (!controller.signal.aborted) setResult({ key, state: 'error', report: null });
      }
    );
    return () => controller.abort();
  }, [key, get, uid, documentId, locale, field, fieldKey]);
  if (!key) return { state: 'off', report: null };
  if (result.key !== key) return { state: 'loading', report: null };
  return result;
};

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {object|null} props.data - Current editor data.
 * @param {{ get?: Function, post: Function }} props.fetchClient - Admin fetch client.
 * @param {boolean} [props.externalEnabled] - External link checks are enabled on the server.
 * @param {boolean} [props.scheduledEnabled] - The scheduled link check is enabled on the server.
 * @param {object|null} [props.target] - Field target (for the scheduled result).
 * @param {(blockId: string) => void} [props.onSelectBlock] - Focuses a block.
 * @param {(message: string) => void} props.onAnnounce - Writes the panel's polite live region.
 * @returns {JSX.Element} Links and media part.
 */
export const QualityLinks = ({
  t,
  data,
  fetchClient,
  externalEnabled,
  scheduledEnabled = false,
  target = null,
  onSelectBlock,
  onAnnounce,
}) => {
  const { formatDate } = useIntl();
  const scheduled = useScheduledReport(fetchClient, scheduledEnabled ? target : null);
  const [check, setCheck] = useState({ state: 'idle', result: null, message: '' });
  const requestRef = useRef(0);
  const checkButtonRef = useRef(null);
  const links = useMemo(() => extractLinks(data), [data]);
  const linkCount = links.internal.length + links.external.length + links.media.length;

  const runCheck = useCallback(async () => {
    const id = requestRef.current + 1;
    requestRef.current = id;
    setCheck({ state: 'loading', result: null, message: '' });
    onAnnounce(t('editor.quality.links.checking', 'Checking links'));
    try {
      const body = {
        internal: links.internal.slice(0, 100).map(({ uid, documentId, locale }) => ({
          uid,
          documentId,
          ...(locale ? { locale } : {}),
        })),
        media: links.media.slice(0, 100).map((item) => item.id),
        external: externalEnabled ? links.external.slice(0, 20).map((item) => item.url) : [],
      };
      const response = await fetchClient.post(API.qualityLinks, body);
      if (requestRef.current !== id) return;
      const result = (response && response.data && response.data.data) || {
        internal: [],
        media: [],
        external: [],
      };
      if (!externalEnabled) result.external = links.external.map(({ url }) => ({ url, status: 'skipped' }));
      const all = [...result.internal, ...result.media, ...result.external];
      const problems = all.filter((item) => PROBLEMS.has(item.status)).length;
      // 2.7.8: "no problems" only when something was checked (external links may all be skipped).
      const checked = all.filter((item) => item.status !== 'skipped').length;
      setCheck({ state: 'done', result, message: '' });
      onAnnounce(
        checked === 0
          ? t('editor.quality.links.noneChecked', 'No links were checked.')
          : t(
              'editor.quality.links.done',
              'Link check finished: {count, plural, =0 {no problems} one {# problem} other {# problems}}',
              {
                count: problems,
              }
            )
      );
    } catch (error) {
      if (requestRef.current !== id) return;
      const info = readApiError(error);
      const message =
        info.status === 429
          ? t('editor.quality.links.rateLimited', 'Too many link checks. Try again in a minute.')
          : t('editor.quality.links.failed', 'The links could not be checked.');
      setCheck({ state: 'error', result: null, message });
      onAnnounce(message);
    } finally {
      // 2.7.8: the button is disabled while it loads, which dropped focus to the page body.
      if (requestRef.current === id) refocusIfLost(checkButtonRef);
    }
  }, [externalEnabled, fetchClient, links, onAnnounce, t]);

  const linkLabel = (kind, item) => {
    if (kind === 'internal')
      return t('editor.quality.link.entry', 'Entry {documentId} ({type})', {
        documentId: item.documentId,
        type: item.uid.split('.').pop(),
      });
    if (kind === 'media') return t('editor.quality.link.media', 'Media file {id}', { id: String(item.id) });
    return item.url;
  };

  const renderResults = (result) => {
    const rows = [
      ...result.internal.map((item) => ['internal', item]),
      ...result.media.map((item) => ['media', item]),
      ...result.external.map((item) => ['external', item]),
    ];
    if (!rows.length)
      return (
        <Typography variant="omega" textColor="neutral600">
          {t('editor.quality.links.none', 'This content has no links to check.')}
        </Typography>
      );
    return (
      <List aria-label={t('editor.quality.links.results', 'Link check results')}>
        {rows.map(([kind, item], index) => {
          const status = LINK_STATUS[item.status] || LINK_STATUS.unknown;
          return (
            <Box tag="li" key={`${kind}-${index}`} paddingTop={1} paddingBottom={1}>
              <Flex gap={2} alignItems="flex-start" wrap="wrap">
                <Status variant={status.variant} size="S">
                  <Typography variant="pi" fontWeight="bold" textColor={`${status.variant}700`}>
                    {t(status.key, status.text)}
                    {item.code ? ` (${item.code})` : ''}
                  </Typography>
                </Status>
                <Wrap variant="pi" textColor="neutral800">
                  {linkLabel(kind, item)}
                </Wrap>
              </Flex>
            </Box>
          );
        })}
      </List>
    );
  };

  const brokenText = (count) =>
    t(
      'editor.quality.schedule.count',
      '{count, plural, =0 {no broken links} one {# broken link} other {# broken links}}',
      { count }
    );

  const renderScheduled = () => {
    const { report } = scheduled;
    let body;
    if (scheduled.state === 'loading')
      body = <Loader small>{t('editor.quality.schedule.loading', 'Loading the scheduled result')}</Loader>;
    else if (scheduled.state === 'error')
      body = (
        <Typography variant="omega" textColor="danger600">
          {t('editor.quality.schedule.failed', 'The scheduled result could not be loaded.')}
        </Typography>
      );
    else if (!report.lastRun)
      body = (
        <Typography variant="pi" textColor="neutral600">
          {t('editor.quality.schedule.never', 'No scheduled check has run yet.')}
        </Typography>
      );
    else {
      const date = formatDate(new Date(report.lastRun.finishedAt), {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const version = report.draft || report.published;
      if (!version)
        body = (
          <Typography variant="pi" textColor="neutral600">
            {t(
              'editor.quality.schedule.noLinks',
              'Last scheduled check {date}: no external links in the saved content.',
              { date }
            )}
          </Typography>
        );
      else {
        const problems = version.links.filter((link) => PROBLEMS.has(link.status));
        const pending = version.links.filter((link) => link.status === 'skipped').length;
        body = (
          <Flex direction="column" alignItems="stretch" gap={2}>
            <Typography variant="omega" textColor={problems.length ? 'danger700' : 'neutral800'}>
              {t('editor.quality.schedule.summary', 'Last scheduled check {date}: {result}', {
                date,
                result: brokenText(version.problems),
              })}
            </Typography>
            {report.draft && report.published ? (
              <Typography variant="pi" textColor="neutral600">
                {t('editor.quality.schedule.published', 'Published version: {result}', {
                  result: brokenText(report.published.problems),
                })}
              </Typography>
            ) : null}
            {pending ? (
              <Typography variant="pi" textColor="neutral600">
                {t(
                  'editor.quality.schedule.pending',
                  '{count, plural, one {# link was} other {# links were}} not checked yet.',
                  { count: pending }
                )}
              </Typography>
            ) : null}
            {problems.length ? (
              <List
                aria-label={t('editor.quality.schedule.results', 'Broken links found by the scheduled check')}
              >
                {problems.map((link, index) => {
                  const status = LINK_STATUS[link.status] || LINK_STATUS.error;
                  return (
                    <Box tag="li" key={`scheduled-${index}`} paddingTop={1} paddingBottom={1}>
                      <Flex gap={2} alignItems="flex-start" wrap="wrap">
                        <Status variant={status.variant} size="S">
                          <Typography variant="pi" fontWeight="bold" textColor={`${status.variant}700`}>
                            {t(status.key, status.text)}
                            {link.code ? ` (${link.code})` : ''}
                          </Typography>
                        </Status>
                        {link.blockId && onSelectBlock ? (
                          <RowButton type="button" onClick={() => onSelectBlock(link.blockId)}>
                            <Wrap variant="pi" textColor="neutral800">
                              {link.url}
                            </Wrap>
                          </RowButton>
                        ) : (
                          <Wrap variant="pi" textColor="neutral800">
                            {link.url}
                          </Wrap>
                        )}
                      </Flex>
                    </Box>
                  );
                })}
              </List>
            ) : null}
          </Flex>
        );
      }
    }
    return (
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Typography variant="sigma" tag="h4" textColor="neutral600">
          {t('editor.quality.schedule.title', 'Scheduled check')}
        </Typography>
        {body}
      </Flex>
    );
  };

  return (
    <>
      <Flex direction="column" alignItems="stretch" gap={2}>
        <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
          <Typography variant="sigma" tag="h4" textColor="neutral600">
            {t('editor.quality.links.title', 'Links and media')}
          </Typography>
          <Button
            ref={checkButtonRef}
            variant="secondary"
            size="S"
            onClick={runCheck}
            loading={check.state === 'loading'}
            disabled={linkCount === 0}
          >
            {t('editor.quality.links.check', 'Check links')}
          </Button>
        </Flex>
        {!externalEnabled && links.external.length ? (
          <Typography variant="pi" textColor="neutral600">
            {t(
              'editor.quality.links.externalOff',
              'External links are not checked. An administrator can turn this on in the plugin configuration.'
            )}
          </Typography>
        ) : null}
        {check.state === 'loading' ? (
          <Loader small>{t('editor.quality.links.checking', 'Checking links')}</Loader>
        ) : null}
        {check.state === 'error' ? (
          <Typography variant="omega" textColor="danger600" role="alert">
            {check.message}
          </Typography>
        ) : null}
        {check.state === 'done' && check.result ? renderResults(check.result) : null}
        {check.state === 'idle' && linkCount === 0 ? (
          <Typography variant="pi" textColor="neutral600">
            {t('editor.quality.links.none', 'This content has no links to check.')}
          </Typography>
        ) : null}
      </Flex>

      {scheduled.state !== 'off' ? renderScheduled() : null}
    </>
  );
};

export default QualityLinks;
