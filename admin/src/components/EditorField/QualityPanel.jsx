import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import {
  Accordion,
  Badge,
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Loader,
  Status,
  TextButton,
  TextInput,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import styled from 'styled-components';
import { insightLanguage, normalizeContentChecks } from '../../../../shared/content-insights.mjs';
import { useQualityIssues } from './useQualityIssues';
import { useContentInsights } from './useContentInsights';
import { fixActionOf } from './quality-fixes.mjs';
import { closeOnEscape, usePanelAutoFocus } from './usePanelFocus';
import { HINTS, PRESET_RULES, RULES } from './quality-messages';
import { List, RowButton, Wrap } from './quality-ui';
import { QualityLinks } from './QualityLinks';

/**
 * Quality panel of one editor field: accessibility issues of the current
 * content (from the shared lint), readability and SEO-structure hints (2.9,
 * computed only while the panel is open) and an on-demand link check. The
 * findings are grouped in three collapsed sections; findings with a safe,
 * deterministic fix carry a "Fix" button. It never blocks editing; with the
 * field option `publishGuard` it explains that publishing stops while errors
 * remain (the server enforces it).
 */

const FIXABLE = new Set(['BLOCK_NOT_ALLOWED', 'HEADING_LEVEL', 'LINK_NOT_ALLOWED']);

/**
 * Stable key of a finding (rule, block, path) for the busy state and focus return of its "Fix".
 * @param {{ rule: string, blockId: string|null, path?: string }} issue - Finding.
 * @returns {string} Key.
 */
const findingKey = (issue) => `${issue.rule}|${issue.blockId || ''}|${issue.path || ''}`;

/** Findings listed per section before "Show all". */
const VISIBLE_FINDINGS = 50;

/** The "Fix" button keeps a 32 px touch target (WCAG 2.5.8 and the workbench rule below 768 px). */
const FixButton = styled(TextButton)`
  min-height: 3.2rem;
  padding-inline: ${({ theme }) => theme.spaces[2]};
  flex-shrink: 0;
`;

/**
 * Storage key of the focus keyphrase (per entry, locale and field; browser only).
 * @param {{ uid?: string|null, documentId?: string|null, locale?: string|null, field?: string, fieldKey?: string }|null} target - Field.
 * @returns {string|null} Key, or null for an unsaved entry.
 */
export const keyphraseStorageKey = (target) =>
  target && target.uid && target.documentId && target.field
    ? `magic-editor-x:keyphrase:${target.uid}|${target.documentId}|${target.locale || ''}|${target.fieldKey ? `#${target.fieldKey}` : target.field}`
    : null;

const readKeyphrase = (key) => {
  if (!key) return '';
  try {
    return window.localStorage.getItem(key) || '';
  } catch {
    return '';
  }
};

const writeKeyphrase = (key, value) => {
  if (!key) return;
  try {
    if (value.trim()) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // Private windows and blocked storage: the keyphrase lasts as long as the panel.
  }
};

/**
 * Count badge of a section (decorative; the trigger carries the count as text for screen readers).
 * @param {{ count: number, tone: 'danger'|'warning'|'neutral'|'success' }} props - Props.
 * @returns {JSX.Element} Badge.
 */
const CountBadge = ({ count, tone }) => {
  const colors = {
    danger: { backgroundColor: 'danger100', textColor: 'danger700' },
    warning: { backgroundColor: 'warning200', textColor: 'neutral800' },
    neutral: { backgroundColor: 'neutral150', textColor: 'neutral800' },
    success: { backgroundColor: 'success100', textColor: 'success700' },
  }[tone];
  return (
    <Badge size="S" {...colors} aria-hidden>
      {count}
    </Badge>
  );
};

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator `(id, defaultMessage, values) => string`.
 * @param {object|null} props.data - Current editor data.
 * @param {object} [props.options] - Field options (`requireAlt`, `publishGuard`, 2.9 `disableContentChecks`).
 * @param {{ get?: Function, post: Function }} props.fetchClient - Admin fetch client.
 * @param {boolean} [props.externalEnabled] - External link checks are enabled on the server.
 * @param {boolean} [props.scheduledEnabled] - The scheduled link check is enabled on the server.
 * @param {{ uid: string|null, documentId: string|null, locale: string|null, field: string }} [props.target] - Field target (for the scheduled result and the content language).
 * @param {(blockId: string) => void} props.onSelectBlock - Focuses a block.
 * @param {() => void} [props.onClose] - Closes the panel.
 * @param {Array<{ code: string, blockId: string|null, index: number|null, params?: object }>} [props.violations] - Field preset violations (saving fails while any remain).
 * @param {(() => void)|null} [props.onFixViolations] - Applies the automatic fixes (structure only).
 * @param {object|null} [props.palette] - 2.5: normalised colour palette (enables the colour contrast rule).
 * @param {object|null} [props.contentChecks] - 2.9: content check settings from the server (`GET /config`), null when off.
 * @param {number[]} [props.headingLevels] - 2.9: heading levels the field allows (heading fixes stay inside them).
 * @param {((issue: object, action: object, language: string|null) => Promise<boolean>)|null} [props.onFix] - 2.9: applies a one-click fix; null hides the buttons (read-only).
 * @returns {JSX.Element} Panel.
 */
export const QualityPanel = ({
  autoFocus = false,
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
  palette = null,
  contentChecks = undefined,
  headingLevels = [],
  onFix = null,
}) => {
  const { locale: adminLocale } = useIntl();
  const { issues, stats } = useQualityIssues(data, options, palette);
  const [announcement, setAnnouncement] = useState('');
  const headingRef = useRef(null);
  const sectionsRef = useRef(null);
  const pendingFocusRef = useRef(null);
  usePanelAutoFocus(autoFocus, headingRef);
  const errors = issues.filter((issue) => issue.severity === 'error');
  const warnings = issues.filter((issue) => issue.severity === 'warning');

  // 2.9: readability and SEO hints. Off when the server turned them off (contentChecks === null)
  // or the field opted out; an older server without settings uses the defaults.
  const settings = useMemo(
    () => (contentChecks === null ? null : normalizeContentChecks(contentChecks)),
    [contentChecks]
  );
  const insightsOn = Boolean(settings && settings.enabled && !(options && options.disableContentChecks));
  // The content locale decides the language; without i18n the admin language is the best guess.
  const language = insightLanguage((target && target.locale) || adminLocale);
  const storageKey = keyphraseStorageKey(target);
  const [keyphrase, setKeyphrase] = useState(() => readKeyphrase(storageKey));
  const [keyphraseKey, setKeyphraseKey] = useState(storageKey);
  if (keyphraseKey !== storageKey) {
    setKeyphraseKey(storageKey);
    setKeyphrase(readKeyphrase(storageKey));
  }
  const insights = useContentInsights(data, { enabled: insightsOn, language, settings, keyphrase });
  const hints = useMemo(() => (insights.result && insights.result.issues) || [], [insights.result]);
  const readabilityHints = hints.filter((hint) => hint.section === 'readability');
  const seoHints = hints.filter((hint) => hint.section === 'seo');
  const score = insights.result ? insights.result.score : null;

  const [open, setOpen] = useState(() => (errors.length ? 'accessibility' : ''));
  const [expanded, setExpanded] = useState({});
  const [fixing, setFixing] = useState(null);

  const issueText = (issue) => {
    const rule = RULES[issue.rule] ||
      HINTS[issue.rule] || { key: 'editor.quality.rule.unknown', text: 'Problem' };
    return t(rule.key, rule.text, { ...(issue.params || {}) });
  };

  /**
   * Runs a one-click fix. A fixed finding disappears from the list, so focus moves to the next
   * "Fix" button of the section, else the section's trigger (never the page body).
   * @param {object} issue - Finding.
   * @param {object} action - Fix (`fixActionOf`).
   * @param {string} section - Section id.
   */
  const runFix = useCallback(
    async (issue, action, section) => {
      if (!onFix) return;
      const key = findingKey(issue);
      setFixing(key);
      const ok = await Promise.resolve()
        .then(() => onFix(issue, action, language))
        .catch(() => false);
      setFixing(null);
      if (action.kind !== 'heading' && action.kind !== 'typography') return;
      setAnnouncement(
        ok
          ? t('editor.quality.fix.done', 'Fixed. Undo brings the previous text back.')
          : t('editor.quality.fix.stale', 'Nothing to fix any more. The content changed meanwhile.')
      );
      pendingFocusRef.current = { section, key };
    },
    [language, onFix, t]
  );

  // 2.9: a fixed finding leaves the list once the content is checked again (a moment later, for
  // hints after the idle-time run). When its button is gone and focus fell to the page body, the
  // next "Fix" of the same section takes it, else the section's trigger, else the panel heading.
  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const pending = pendingFocusRef.current;
      if (!pending) return;
      const root = sectionsRef.current;
      const item = root && root.querySelector(`[data-mex-section="${pending.section}"]`);
      const still = item && item.querySelector(`[data-mex-fix="${CSS.escape(pending.key)}"]`);
      if (still) return;
      pendingFocusRef.current = null;
      const active = document.activeElement;
      if (active && active !== document.body && active.isConnected) return;
      const target =
        (item && item.querySelector('[data-mex-fix]')) ||
        (item && item.querySelector('button')) ||
        headingRef.current;
      if (target && target.isConnected) target.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [issues, hints, fixing]);

  const blockLabel = (issue) =>
    issue.blockIndex >= 0 ? t('editor.quality.block', 'Block {index}', { index: issue.blockIndex + 1 }) : '';

  const fixLabel = (issue, action, text) => {
    switch (action.kind) {
      case 'heading':
        return t('editor.quality.fix.heading', 'Fix: change to heading level {level} ({finding})', {
          level: action.level,
          finding: text,
        });
      case 'typography':
        return t('editor.quality.fix.typography', 'Fix: remove the extra spaces ({finding})', {
          finding: text,
        });
      case 'linkText':
        return t('editor.quality.fix.linkText', 'Fix: select the link text to rewrite it ({finding})', {
          finding: text,
        });
      default:
        return t('editor.quality.fix.alt', 'Fix: go to the alternative text field ({finding})', {
          finding: text,
        });
    }
  };

  const renderRows = (items, section) => {
    const all = expanded[section] ? items : items.slice(0, VISIBLE_FINDINGS);
    return (
      <>
        <List>
          {all.map((issue, index) => {
            const text = issueText(issue);
            const action = onFix ? fixActionOf(issue, { headingLevels }) : null;
            const label = blockLabel(issue);
            const key = findingKey(issue);
            return (
              <li key={`${issue.rule}-${issue.blockId || 'doc'}-${issue.path || ''}-${index}`}>
                <Flex alignItems="flex-start" gap={1} minWidth={0}>
                  <Box flex="1 1 auto" minWidth={0}>
                    {issue.blockId ? (
                      <RowButton type="button" onClick={() => onSelectBlock && onSelectBlock(issue.blockId)}>
                        <Typography variant="omega">{text}</Typography>{' '}
                        <Typography variant="pi" textColor="neutral600">
                          {label}
                        </Typography>
                      </RowButton>
                    ) : (
                      <Box paddingTop={2} paddingBottom={2} paddingLeft={2} paddingRight={2}>
                        <Wrap variant="omega">{text}</Wrap>
                      </Box>
                    )}
                  </Box>
                  {action ? (
                    <FixButton
                      data-mex-fix={key}
                      onClick={() => runFix(issue, action, section)}
                      loading={fixing === key}
                      aria-label={fixLabel(issue, action, label ? `${text}, ${label}` : text)}
                    >
                      {t('editor.quality.fix', 'Fix')}
                    </FixButton>
                  ) : null}
                </Flex>
              </li>
            );
          })}
        </List>
        {items.length > all.length ? (
          <TextButton onClick={() => setExpanded((current) => ({ ...current, [section]: true }))}>
            {t('editor.quality.showAll', 'Show all {count}', { count: items.length })}
          </TextButton>
        ) : null}
      </>
    );
  };

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
      {renderRows(items, 'accessibility')}
    </Flex>
  );

  /**
   * One collapsible section with its count in the trigger (visible badge plus text for screen readers).
   * @param {{ id: string, title: string, count: number|null, tone: string, srCount: string, children: import('react').ReactNode }} props - Section.
   * @returns {JSX.Element} Accordion item.
   */
  const renderSection = ({ id, title, count, tone, srCount, children }) => (
    <Accordion.Item value={id} data-mex-section={id}>
      <Accordion.Header>
        <Accordion.Trigger>
          {title} {count === null ? null : <CountBadge count={count} tone={tone} />}
          <VisuallyHidden>{srCount}</VisuallyHidden>
        </Accordion.Trigger>
      </Accordion.Header>
      <Accordion.Content>
        <Box padding={3} minWidth={0}>
          <Flex direction="column" alignItems="stretch" gap={3} minWidth={0}>
            {children}
          </Flex>
        </Box>
      </Accordion.Content>
    </Accordion.Item>
  );

  const hintNote = (
    <Typography variant="pi" textColor="neutral600">
      {t(
        'editor.quality.hints.note',
        'Hints, not errors: they never block saving. Your administrator can turn rules off in the plugin configuration.'
      )}
    </Typography>
  );
  const loadingHints = insights.pending && !insights.result;
  const hintCount = (list) => (loadingHints ? null : list.length);
  const hintsLabel = (list) =>
    loadingHints
      ? t('editor.quality.hints.loading', 'Checking the text')
      : t('editor.quality.hints.count', '{count, plural, =0 {no hints} one {# hint} other {# hints}}', {
          count: list.length,
        });

  const a11yCount = errors.length + warnings.length;

  return (
    <Box
      tag="section"
      aria-label={t('editor.quality.title', 'Quality checks')}
      padding={4}
      background="neutral0"
      borderColor="neutral200"
      hasRadius
      minWidth={0}
      onKeyDown={onClose ? (event) => closeOnEscape(event, onClose) : undefined}
    >
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={2}>
          <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
            <Typography variant="delta" tag="h3" ref={headingRef} tabIndex={-1}>
              {t('editor.quality.title', 'Quality checks')}
            </Typography>
            <Typography variant="pi" textColor="neutral600">
              {insightsOn
                ? t(
                    'editor.quality.summaryHints',
                    '{errors, plural, one {# error} other {# errors}} · {warnings, plural, one {# warning} other {# warnings}} · {hints, plural, one {# hint} other {# hints}}',
                    { errors: stats.errors, warnings: stats.warnings, hints: hints.length }
                  )
                : t(
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

        <Box ref={sectionsRef} minWidth={0}>
          <Accordion.Root value={open} onValueChange={setOpen}>
            {renderSection({
              id: 'accessibility',
              title: t('editor.quality.section.accessibility', 'Accessibility'),
              count: a11yCount,
              tone: errors.length ? 'danger' : a11yCount ? 'warning' : 'success',
              srCount: t(
                'editor.quality.section.problems',
                '{count, plural, =0 {no problems} one {# problem} other {# problems}}',
                { count: a11yCount }
              ),
              children:
                a11yCount === 0 ? (
                  <Typography variant="omega" textColor="neutral600">
                    {t('editor.quality.empty', 'No problems found.')}
                  </Typography>
                ) : (
                  <>
                    {errors.length ? renderIssues(errors, 'error') : null}
                    {warnings.length ? renderIssues(warnings, 'warning') : null}
                  </>
                ),
            })}
            {insightsOn
              ? renderSection({
                  id: 'readability',
                  title: t('editor.quality.section.readability', 'Readability'),
                  count: hintCount(readabilityHints),
                  tone: 'neutral',
                  srCount: hintsLabel(readabilityHints),
                  children: (
                    <>
                      {score ? (
                        <Typography variant="omega" textColor="neutral800" data-testid="mex-reading-score">
                          {t(
                            'editor.quality.score',
                            '{formula, select, flesch {Flesch Reading Ease} amstad {Reading ease (Amstad)} other {Readability (Szigriszt-Pazos)}}: {score}, {band, select, veryEasy {very easy} easy {easy} fairlyEasy {fairly easy} standard {standard} fairlyDifficult {fairly difficult} difficult {difficult} other {very difficult}}',
                            score && { formula: score.formula, score: score.value, band: score.band }
                          )}
                        </Typography>
                      ) : (
                        <Typography variant="pi" textColor="neutral600">
                          {language && ['en', 'de', 'es'].includes(language)
                            ? t(
                                'editor.quality.score.short',
                                'The reading score needs at least 100 words of running text.'
                              )
                            : t(
                                'editor.quality.score.none',
                                'No reading score for this language. The other hints still apply.'
                              )}
                        </Typography>
                      )}
                      {loadingHints ? (
                        <Loader small>{t('editor.quality.hints.loading', 'Checking the text')}</Loader>
                      ) : readabilityHints.length ? (
                        renderRows(readabilityHints, 'readability')
                      ) : (
                        <Typography variant="omega" textColor="neutral600">
                          {t('editor.quality.hints.none', 'No hints.')}
                        </Typography>
                      )}
                      {hintNote}
                    </>
                  ),
                })
              : null}
            {insightsOn
              ? renderSection({
                  id: 'seo',
                  title: t('editor.quality.section.seo', 'SEO structure'),
                  count: hintCount(seoHints),
                  tone: 'neutral',
                  srCount: hintsLabel(seoHints),
                  children: (
                    <>
                      {settings.disabled.includes('keyphrase') ? null : (
                        <Field.Root
                          name="mex-keyphrase"
                          hint={t(
                            'editor.quality.keyphrase.hint',
                            'Optional. Checked in the first paragraph, the subheadings and how often it appears. Kept in this browser only.'
                          )}
                        >
                          <Field.Label>{t('editor.quality.keyphrase.label', 'Focus keyphrase')}</Field.Label>
                          <TextInput
                            value={keyphrase}
                            maxLength={100}
                            onChange={(event) => {
                              const value = event.target.value.slice(0, 100);
                              setKeyphrase(value);
                              writeKeyphrase(storageKey, value);
                            }}
                          />
                          <Field.Hint />
                        </Field.Root>
                      )}
                      {loadingHints ? (
                        <Loader small>{t('editor.quality.hints.loading', 'Checking the text')}</Loader>
                      ) : seoHints.length ? (
                        renderRows(seoHints, 'seo')
                      ) : (
                        <Typography variant="omega" textColor="neutral600">
                          {t('editor.quality.hints.none', 'No hints.')}
                        </Typography>
                      )}
                      {hintNote}
                    </>
                  ),
                })
              : null}
          </Accordion.Root>
        </Box>

        <QualityLinks
          t={t}
          data={data}
          fetchClient={fetchClient}
          externalEnabled={externalEnabled}
          scheduledEnabled={scheduledEnabled}
          target={target}
          onSelectBlock={onSelectBlock}
          onAnnounce={setAnnouncement}
        />
      </Flex>
      <VisuallyHidden aria-live="polite" aria-atomic="true">
        {announcement}
      </VisuallyHidden>
    </Box>
  );
};

export default QualityPanel;
