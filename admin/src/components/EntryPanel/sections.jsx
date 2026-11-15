import { useId, useState } from 'react';
import { useIntl } from 'react-intl';
import { Box, Button, Flex, TextButton, Typography } from '@strapi/design-system';
import styled from 'styled-components';
import { requestFieldPanel } from '../../editor/entry-panel-events.mjs';
import { fieldProblems, fieldsWith } from './logic.mjs';

/**
 * Sections of the Magic Editor X side panel (2.5). Each section is a component that receives
 * `{ t, target, presence, summary }` and returns null when it has nothing to show for this admin.
 * A later feature appends one entry to ENTRY_PANEL_SECTIONS (AGENTS.md "Entry panel, presence and
 * widgets (2.5)"); it never adds its own Content Manager side panel.
 */

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  gap: ${({ theme }) => theme.spaces[2]};
  min-width: 0;
`;

const Row = styled.li`
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: ${({ theme }) => theme.spaces[2]};
  min-width: 0;
`;

const Dot = styled.span`
  flex: 0 0 auto;
  width: 0.8rem;
  height: 0.8rem;
  border-radius: 50%;
  background: ${({ theme, $color, $idle }) =>
    $idle ? theme.colors.neutral300 : theme.colors[`${$color}600`] || theme.colors.primary600};
`;

const Wrap = styled(Typography)`
  display: block;
  min-width: 0;
  overflow-wrap: anywhere;
`;

/**
 * Section frame: an h3 and the content.
 * @param {{ title: string, children: React.ReactNode, testId: string }} props - Props.
 * @returns {JSX.Element} Section.
 */
export const EntryPanelSection = ({ title, children, testId }) => {
  const id = useId();
  return (
    <Flex
      tag="section"
      aria-labelledby={id}
      direction="column"
      alignItems="stretch"
      gap={2}
      width="100%"
      data-testid={testId}
      data-mex-panel-section=""
    >
      <Typography id={id} tag="h3" variant="omega" fontWeight="bold" textColor="neutral800">
        {title}
      </Typography>
      {children}
    </Flex>
  );
};

/**
 * "Editing now": other admins who edit this entry (names only).
 * @param {{ t: Function, presence: object }} props - Props.
 * @returns {JSX.Element|null} Section.
 */
const PresenceSection = ({ t, presence }) => {
  if (presence.status === 'unavailable' || (presence.status === 'ready' && !presence.enabled)) return null;
  return (
    <EntryPanelSection title={t('entryPanel.presence.title', 'Editing now')} testId="mex-panel-presence">
      <div aria-live="polite">
        {presence.status === 'loading' ? (
          <Typography variant="pi" textColor="neutral600">
            {t('entryPanel.loading', 'Loading')}
          </Typography>
        ) : presence.editors.length ? (
          <List>
            {presence.editors.map((editor) => (
              <Row key={editor.id} data-testid="mex-panel-editor">
                <Flex gap={2} alignItems="center" minWidth={0}>
                  <Dot $color={editor.color} $idle={editor.idle} aria-hidden="true" />
                  <Wrap variant="omega" textColor="neutral800">
                    {editor.idle
                      ? t('entryPanel.presence.idle', '{name} has this entry open (idle)', {
                          name: editor.name,
                        })
                      : t('entryPanel.presence.editing', '{name} is editing this entry', {
                          name: editor.name,
                        })}
                  </Wrap>
                </Flex>
              </Row>
            ))}
          </List>
        ) : (
          <Typography variant="pi" textColor="neutral600">
            {t('entryPanel.presence.empty', 'Nobody else is editing this entry right now.')}
          </Typography>
        )}
      </div>
    </EntryPanelSection>
  );
};

/**
 * One field row with a count and a button that opens the field's panel. When the field is not on
 * screen (inside a collapsed component entry of the form), the row says what to do instead.
 * @param {{ t: Function, field: object, text: string, action: string, actionLabel: string, panel: 'comments'|'quality' }} props - Props.
 * @returns {JSX.Element} Row.
 */
const FieldRow = ({ t, field, text, action, actionLabel, panel }) => {
  const [hint, setHint] = useState(false);
  const group = field.label.includes(' › ')
    ? field.label.slice(0, field.label.lastIndexOf(' › '))
    : field.label;
  return (
    <Row>
      <Box minWidth={0}>
        <Wrap variant="pi" fontWeight="bold" textColor="neutral800">
          {field.label}
        </Wrap>
        <Wrap variant="pi" textColor="neutral600">
          {text}
        </Wrap>
        <div aria-live="polite">
          {hint ? (
            <Wrap variant="pi" textColor="neutral700" data-testid="mex-panel-hint">
              {t('entryPanel.openGroup', 'Open “{group}” in the form first, then choose {action} again.', {
                group,
                action,
              })}
            </Wrap>
          ) : null}
        </div>
      </Box>
      <Box flex="0 0 auto">
        <TextButton
          aria-label={actionLabel}
          onClick={() => setHint(!requestFieldPanel({ field: field.field, path: field.path, panel }))}
        >
          {action}
        </TextButton>
      </Box>
    </Row>
  );
};

/**
 * "Comments": open threads per field, with a button that opens the field's comments.
 * @param {{ t: Function, summary: object }} props - Props.
 * @returns {JSX.Element|null} Section.
 */
const CommentsSection = ({ t, summary }) => {
  if (!summary.data || !summary.data.comments.enabled) return null;
  const fields = fieldsWith(summary.data.fields, (field) => field.openThreads || 0);
  return (
    <EntryPanelSection title={t('entryPanel.comments.title', 'Comments')} testId="mex-panel-comments">
      {fields.length ? (
        <>
          <Typography variant="pi" textColor="neutral600">
            {t('entryPanel.comments.count', '{count, plural, one {# open thread} other {# open threads}}', {
              count: summary.data.comments.open,
            })}
          </Typography>
          <List>
            {fields.map((field) => (
              <FieldRow
                t={t}
                key={field.path}
                field={field}
                panel="comments"
                text={t('entryPanel.comments.field', '{count, plural, one {# open} other {# open}}', {
                  count: field.openThreads,
                })}
                action={t('entryPanel.comments.show', 'Show')}
                actionLabel={t('entryPanel.comments.showLabel', 'Show comments in {field}', {
                  field: field.label,
                })}
              />
            ))}
          </List>
        </>
      ) : (
        <Typography variant="pi" textColor="neutral600">
          {t(
            'entryPanel.comments.empty',
            'No open comments. To start one, select text in a field and choose Comment.'
          )}
        </Typography>
      )}
    </EntryPanelSection>
  );
};

/**
 * "Quality": lint issues and broken links of the saved draft, per field.
 * @param {{ t: Function, summary: object }} props - Props.
 * @returns {JSX.Element|null} Section.
 */
const QualitySection = ({ t, summary }) => {
  const { formatDate } = useIntl();
  if (!summary.data) return null;
  const { quality, links } = summary.data;
  const fields = fieldsWith(summary.data.fields, fieldProblems);
  return (
    <EntryPanelSection title={t('entryPanel.quality.title', 'Quality')} testId="mex-panel-quality">
      {fields.length ? (
        <List>
          {fields.map((field) => {
            const issues = field.issues.errors + field.issues.warnings;
            const broken = (field.brokenLinks && field.brokenLinks.draft) || 0;
            return (
              <FieldRow
                t={t}
                key={field.path}
                field={field}
                panel="quality"
                text={[
                  issues
                    ? t('entryPanel.quality.issues', '{count, plural, one {# issue} other {# issues}}', {
                        count: issues,
                      })
                    : null,
                  broken
                    ? t(
                        'entryPanel.quality.broken',
                        '{count, plural, one {# broken link} other {# broken links}}',
                        {
                          count: broken,
                        }
                      )
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                action={t('entryPanel.quality.check', 'Check')}
                actionLabel={t('entryPanel.quality.checkLabel', 'Check {field}', { field: field.label })}
              />
            );
          })}
        </List>
      ) : (
        <Typography variant="pi" textColor="neutral600">
          {t('entryPanel.quality.empty', 'No problems found in the saved draft.')}
        </Typography>
      )}
      {quality.errors + quality.warnings || (links.enabled && links.draft) ? (
        <Typography variant="pi" textColor="neutral600">
          {t('entryPanel.quality.savedDraft', 'Counts are for the saved draft. Save to update them.')}
        </Typography>
      ) : null}
      {links.enabled && links.published ? (
        <Typography variant="pi" textColor="neutral600">
          {t(
            'entryPanel.quality.published',
            '{count, plural, one {The published version has # broken link.} other {The published version has # broken links.}}',
            { count: links.published }
          )}
        </Typography>
      ) : null}
      {links.enabled ? (
        <Typography variant="pi" textColor="neutral600">
          {links.lastRun && links.lastRun.finishedAt
            ? t('entryPanel.quality.lastRun', 'Links last checked {date}', {
                date: formatDate(links.lastRun.finishedAt, { dateStyle: 'medium', timeStyle: 'short' }),
              })
            : t('entryPanel.quality.noRun', 'The scheduled link check has not run yet.')}
        </Typography>
      ) : null}
    </EntryPanelSection>
  );
};

/**
 * Loading and error state shared by the summary sections.
 * @param {{ t: Function, summary: object }} props - Props.
 * @returns {JSX.Element|null} Status.
 */
const SummaryStatus = ({ t, summary }) => {
  if (summary.status === 'loading' && !summary.data)
    return (
      <Typography variant="pi" textColor="neutral600">
        {t('entryPanel.loading', 'Loading')}
      </Typography>
    );
  if (summary.status === 'error' && !summary.data)
    return (
      <Flex direction="column" alignItems="flex-start" gap={2}>
        <Typography variant="pi" textColor="neutral600">
          {t('entryPanel.error', 'Comments and quality could not be loaded.')}
        </Typography>
        <Button size="S" variant="tertiary" onClick={summary.reload}>
          {t('entryPanel.retry', 'Try again')}
        </Button>
      </Flex>
    );
  return null;
};

/** The panel's sections in display order. Append new sections at the end. */
export const ENTRY_PANEL_SECTIONS = [
  { id: 'presence', Component: PresenceSection },
  { id: 'summary-status', Component: SummaryStatus },
  { id: 'comments', Component: CommentsSection },
  { id: 'quality', Component: QualitySection },
];
