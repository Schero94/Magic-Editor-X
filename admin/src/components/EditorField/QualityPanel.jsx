import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Loader,
  Status,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import styled from 'styled-components';
import { extractLinks } from '../../../../shared/quality.mjs';
import { API, readApiError } from '../../utils/api';
import { useQualityIssues } from './useQualityIssues';

/**
 * Quality panel of one editor field: accessibility issues of the current
 * content (from the shared lint) and an on-demand link check. It never blocks
 * editing; with the field option `publishGuard` it explains that publishing
 * stops while errors remain (the server enforces it).
 */

const RULES = {
  'image-alt-missing': { key: 'editor.quality.rule.imageAlt', text: 'Image without alternative text' },
  'heading-order': { key: 'editor.quality.rule.headingOrder', text: 'Heading level {level} skips a level' },
  'multiple-h1': { key: 'editor.quality.rule.multipleH1', text: 'More than one level 1 heading' },
  'empty-heading': { key: 'editor.quality.rule.emptyHeading', text: 'Empty heading' },
  'empty-link': { key: 'editor.quality.rule.emptyLink', text: 'Link without text or address' },
  'ambiguous-link-text': {
    key: 'editor.quality.rule.ambiguousLink',
    text: 'Link text "{text}" does not say where the link goes',
  },
  'table-no-header': { key: 'editor.quality.rule.tableHeader', text: 'Table without a header row' },
  'low-contrast': {
    key: 'editor.quality.rule.lowContrast',
    text: 'Text colour contrast {ratio}:1 is below 4.5:1',
  },
};

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

/** Field preset violations (shared/presets.mjs `checkPreset`). */
const PRESET_RULES = {
  BLOCK_NOT_ALLOWED: {
    key: 'editor.preset.rule.block',
    text: 'Block type "{type}" is not allowed in this field',
  },
  HEADING_LEVEL: {
    key: 'editor.preset.rule.heading',
    text: 'Heading level {level} is not allowed in this field',
  },
  LINK_NOT_ALLOWED: {
    key: 'editor.preset.rule.link',
    text: '{kind, select, internal {Links to entries are} other {Links to web addresses are}} not allowed in this field',
  },
  ALT_REQUIRED: {
    key: 'editor.preset.rule.alt',
    text: 'Image needs an alternative text or must be marked as decorative',
  },
  TOO_MANY_BLOCKS: { key: 'editor.preset.rule.maxBlocks', text: '{count} blocks, at most {max} are allowed' },
  TOO_MANY_CHARACTERS: {
    key: 'editor.preset.rule.maxCharacters',
    text: '{count} characters, at most {max} are allowed',
  },
};
const FIXABLE = new Set(['BLOCK_NOT_ALLOWED', 'HEADING_LEVEL', 'LINK_NOT_ALLOWED']);

const PROBLEMS = new Set(['missing', 'draft', 'broken', 'timeout', 'error']);

/** A full-width, left-aligned row button that wraps long text. */
const RowButton = styled.button`
  display: block;
  width: 100%;
  min-width: 0;
  text-align: start;
  background: transparent;
  border: 0;
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: ${({ theme }) => `${theme.spaces[2]} ${theme.spaces[2]}`};
  color: ${({ theme }) => theme.colors.neutral800};
  cursor: pointer;
  overflow-wrap: anywhere;
  &:hover {
    background: ${({ theme }) => theme.colors.neutral100};
  }
  &:focus-visible {
    outline: 2px solid ${({ theme }) => theme.colors.primary600};
    outline-offset: 2px;
  }
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 0;
`;

const Wrap = styled(Typography)`
  overflow-wrap: anywhere;
  min-width: 0;
`;

/**
 * Loads the last scheduled link check of the field (GET /quality/link-report).
 * @param {{ get?: Function }} fetchClient - Admin fetch client.
 * @param {{ uid: string|null, documentId: string|null, locale: string|null, field: string }|null} target - Field, or null when the schedule is off.
 * @returns {{ state: 'off'|'loading'|'error'|'done', report: object|null }} Result.
 */
const useScheduledReport = (fetchClient, target) => {
  const get = fetchClient && fetchClient.get;
  const uid = target && target.uid;
  const documentId = target && target.documentId;
  const locale = (target && target.locale) || null;
  const field = target && target.field;
  const key = get && uid && documentId && field ? `${uid}|${documentId}|${locale || ''}|${field}` : null;
  const [result, setResult] = useState({ key: null, state: 'loading', report: null });
  useEffect(() => {
    if (!key) return undefined;
    const controller = new AbortController();
    get(API.qualityLinkReport, {
      params: { uid, documentId, locale: locale || undefined, field },
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
  }, [key, get, uid, documentId, locale, field]);
  if (!key) return { state: 'off', report: null };
  if (result.key !== key) return { state: 'loading', report: null };
  return result;
};

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator `(id, defaultMessage, values) => string`.
 * @param {object|null} props.data - Current editor data.
 * @param {object} [props.options] - Field options (`requireAlt`, `publishGuard`).
 * @param {{ get?: Function, post: Function }} props.fetchClient - Admin fetch client.
 * @param {boolean} [props.externalEnabled] - External link checks are enabled on the server.
 * @param {boolean} [props.scheduledEnabled] - The scheduled link check is enabled on the server.
 * @param {{ uid: string|null, documentId: string|null, locale: string|null, field: string }} [props.target] - Field target (for the scheduled result).
 * @param {(blockId: string) => void} props.onSelectBlock - Focuses a block.
 * @param {() => void} [props.onClose] - Closes the panel.
 * @param {Array<{ code: string, blockId: string|null, index: number|null, params?: object }>} [props.violations] - Field preset violations (saving fails while any remain).
 * @param {(() => void)|null} [props.onFixViolations] - Applies the automatic fixes (structure only).
 * @returns {JSX.Element} Panel.
 */
export const QualityPanel = ({
  t,
  data,
  options,
  fetchClient,
  externalEnabled,
  scheduledEnabled = false,
  target = null,
  onSelectBlock,
  onClose,
  violations = [],
  onFixViolations = null,
}) => {
  const { formatDate } = useIntl();
  const scheduled = useScheduledReport(fetchClient, scheduledEnabled ? target : null);
  const { issues, stats } = useQualityIssues(data, options);
  const [check, setCheck] = useState({ state: 'idle', result: null, message: '' });
  const [announcement, setAnnouncement] = useState('');
  const requestRef = useRef(0);
  const links = useMemo(() => extractLinks(data), [data]);
  const linkCount = links.internal.length + links.external.length + links.media.length;
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  const issueText = (issue) => {
    const rule = RULES[issue.rule] || { key: 'editor.quality.rule.unknown', text: 'Problem' };
    return t(rule.key, rule.text, { ...(issue.params || {}) });
  };

  const runCheck = useCallback(async () => {
    const id = requestRef.current + 1;
    requestRef.current = id;
    setCheck({ state: 'loading', result: null, message: '' });
    setAnnouncement(t('editor.quality.links.checking', 'Checking links'));
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
      const problems = [...result.internal, ...result.media, ...result.external].filter((item) =>
        PROBLEMS.has(item.status)
      ).length;
      setCheck({ state: 'done', result, message: '' });
      setAnnouncement(
        t(
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
      setAnnouncement(message);
    }
  }, [externalEnabled, fetchClient, links, t]);

  const blockLabel = (issue) => t('editor.quality.block', 'Block {index}', { index: issue.blockIndex + 1 });

  const renderIssues = (items, severity) => (
    <Flex direction="column" alignItems="stretch" gap={1}>
      <Flex gap={2} alignItems="center">
        <Typography variant="sigma" tag="h4" textColor="neutral600">
          {severity === 'error'
            ? t('editor.quality.errors', 'Errors')
            : t('editor.quality.warnings', 'Warnings')}
        </Typography>
        <Badge
          size="S"
          backgroundColor={severity === 'error' ? 'danger100' : 'warning100'}
          textColor={severity === 'error' ? 'danger700' : 'neutral800'}
        >
          {items.length}
        </Badge>
      </Flex>
      <List>
        {items.map((issue, index) => (
          <li key={`${issue.rule}-${issue.blockId}-${issue.path || ''}-${index}`}>
            <RowButton type="button" onClick={() => onSelectBlock && onSelectBlock(issue.blockId)}>
              <Typography variant="omega">{issueText(issue)}</Typography>{' '}
              <Typography variant="pi" textColor="neutral600">
                {blockLabel(issue)}
              </Typography>
            </RowButton>
          </li>
        ))}
      </List>
    </Flex>
  );

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
    <Box
      tag="section"
      aria-label={t('editor.quality.title', 'Quality checks')}
      padding={4}
      background="neutral0"
      borderColor="neutral200"
      hasRadius
      minWidth={0}
    >
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={2}>
          <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
            <Typography variant="delta" tag="h3">
              {t('editor.quality.title', 'Quality checks')}
            </Typography>
            <Typography variant="pi" textColor="neutral600">
              {t(
                'editor.quality.summary',
                '{errors, plural, one {# error} other {# errors}} · {warnings, plural, one {# warning} other {# warnings}}',
                { errors: stats.errors, warnings: stats.warnings }
              )}
            </Typography>
          </Flex>
          {onClose ? (
            <IconButton
              label={t('editor.quality.close', 'Close quality checks')}
              variant="ghost"
              onClick={onClose}
            >
              <Cross />
            </IconButton>
          ) : null}
        </Flex>

        {violations.length ? (
          <Flex direction="column" alignItems="stretch" gap={2}>
            <Flex gap={2} alignItems="center" justifyContent="space-between" wrap="wrap">
              <Flex gap={2} alignItems="center">
                <Typography variant="sigma" tag="h4" textColor="neutral600">
                  {t('editor.preset.title', 'Field settings')}
                </Typography>
                <Badge size="S" backgroundColor="danger100" textColor="danger700">
                  {violations.length}
                </Badge>
              </Flex>
              {onFixViolations && violations.some((violation) => FIXABLE.has(violation.code)) ? (
                <Button variant="secondary" size="S" onClick={onFixViolations}>
                  {t('editor.preset.fix', 'Fix automatically')}
                </Button>
              ) : null}
            </Flex>
            <Typography variant="pi" textColor="neutral600">
              {t(
                'editor.preset.hint',
                'Saving fails until this content matches the settings of the field. Automatic fixes change heading levels, turn blocks that are not allowed into paragraphs and remove links that are not allowed.'
              )}
            </Typography>
            <List>
              {violations.map((violation, index) => {
                const rule = PRESET_RULES[violation.code] || PRESET_RULES.BLOCK_NOT_ALLOWED;
                const text = t(rule.key, rule.text, { ...(violation.params || {}) });
                return (
                  <li key={`${violation.code}-${violation.blockId || 'doc'}-${index}`}>
                    {violation.blockId ? (
                      <RowButton
                        type="button"
                        onClick={() => onSelectBlock && onSelectBlock(violation.blockId)}
                      >
                        <Typography variant="omega">{text}</Typography>{' '}
                        <Typography variant="pi" textColor="neutral600">
                          {t('editor.quality.block', 'Block {index}', { index: violation.index + 1 })}
                        </Typography>
                      </RowButton>
                    ) : (
                      <Box paddingTop={1} paddingBottom={1}>
                        <Typography variant="omega">{text}</Typography>
                      </Box>
                    )}
                  </li>
                );
              })}
            </List>
          </Flex>
        ) : null}

        {options && options.publishGuard === true ? (
          <Status variant={errors.length ? 'danger' : 'neutral'} size="S">
            <Typography variant="omega" textColor={errors.length ? 'danger700' : 'neutral700'}>
              {errors.length
                ? t('editor.quality.guard.blocked', 'Publishing is blocked while errors remain.')
                : t('editor.quality.guard.info', 'This field cannot be published while it has errors.')}
            </Typography>
          </Status>
        ) : null}

        {issues.length === 0 && violations.length === 0 ? (
          <Typography variant="omega" textColor="neutral600">
            {t('editor.quality.empty', 'No problems found.')}
          </Typography>
        ) : (
          <Flex direction="column" alignItems="stretch" gap={3}>
            {errors.length ? renderIssues(errors, 'error') : null}
            {warnings.length ? renderIssues(warnings, 'warning') : null}
          </Flex>
        )}

        <Flex direction="column" alignItems="stretch" gap={2}>
          <Flex justifyContent="space-between" alignItems="center" gap={2} wrap="wrap">
            <Typography variant="sigma" tag="h4" textColor="neutral600">
              {t('editor.quality.links.title', 'Links and media')}
            </Typography>
            <Button
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
      </Flex>
      <VisuallyHidden aria-live="polite" aria-atomic="true">
        {announcement}
      </VisuallyHidden>
    </Box>
  );
};

export default QualityPanel;
