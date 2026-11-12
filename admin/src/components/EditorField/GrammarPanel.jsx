import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Loader,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { Cross } from '@strapi/icons';
import styled from 'styled-components';
import { API, readApiError } from '../../utils/api';
import {
  collectSegments,
  readSegment,
  replaceInSegment,
  segmentText,
} from '../../../../shared/ai-fields.mjs';

/**
 * Grammar panel (2.3): checks the text of the field with the LanguageTool
 * server the owner configured and lists the issues. Selecting an issue
 * highlights the text in the editor (CSS Custom Highlight `mex-grammar`).
 * "Apply" replaces the flagged text only when it still holds the same text
 * and lies inside one piece of formatting; otherwise the editor is told to
 * edit it by hand. Nothing is sent until "Check grammar" is pressed.
 */

const ERRORS = {
  DISABLED: ['editor.grammar.error.disabled', 'The grammar check is turned off.'],
  NOT_CONFIGURED: ['editor.grammar.error.notConfigured', 'The grammar check is not configured yet.'],
  AUTH_FAILED: ['editor.grammar.error.auth', 'LanguageTool rejected the credentials.'],
  PROVIDER_RATE_LIMIT: ['editor.grammar.error.busy', 'LanguageTool is busy. Try again later.'],
  TIMEOUT: ['editor.grammar.error.timeout', 'LanguageTool did not answer in time.'],
  TOO_LONG: ['editor.grammar.error.tooLong', 'This field is too long to check at once.'],
};

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
  &[aria-current='true'] {
    background: ${({ theme }) => theme.colors.primary100};
  }
`;

const List = styled.ul`
  list-style: none;
  margin: 0;
  padding: 0;
  min-width: 0;
  & > li + li {
    border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
  }
`;

const Flagged = styled.mark`
  background: ${({ theme }) => theme.colors.danger100};
  color: ${({ theme }) => theme.colors.danger700};
  border-radius: 2px;
  padding: 0 2px;
  white-space: pre-wrap;
`;

/**
 * How many earlier occurrences of the flagged text the block has (for
 * locating it in the rendered block, like find and replace does).
 * @param {Array<{ blockId: string, path: string, text: string }>} parts - Checked strings in document order.
 * @param {{ blockId: string, path: string, offset: number, text: string }} match - Match.
 * @returns {number} Occurrence index.
 */
export const occurrenceOf = (parts, match) => {
  let count = 0;
  const countIn = (text, limit) => {
    let from = 0;
    let index;
    while ((index = text.indexOf(match.text, from)) !== -1 && index < limit) {
      count += 1;
      from = index + Math.max(1, match.text.length);
    }
  };
  for (const part of parts) {
    if (part.blockId !== match.blockId) continue;
    if (part.path === match.path) {
      countIn(part.text, match.offset);
      break;
    }
    countIn(part.text, Infinity);
  }
  return count;
};

/**
 * Updates the other matches of a string after a replacement.
 * @param {Array<object>} matches - Matches.
 * @param {object} applied - Applied match.
 * @param {string} replacement - Replacement text.
 * @returns {Array<object>} Remaining matches with shifted offsets.
 */
export const afterReplacement = (matches, applied, replacement) => {
  const delta = replacement.length - applied.length;
  const end = applied.offset + applied.length;
  return matches
    .filter((item) => item !== applied)
    .filter(
      (item) =>
        item.blockId !== applied.blockId ||
        item.path !== applied.path ||
        item.offset >= end ||
        item.offset + item.length <= applied.offset
    )
    .map((item) =>
      item.blockId === applied.blockId && item.path === applied.path && item.offset >= end
        ? { ...item, offset: item.offset + delta }
        : item
    );
};

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {{ post: Function }} props.fetchClient - Admin fetch client.
 * @param {{ uid: string|null, field: string, locale: string|null }} props.target - Field.
 * @param {() => Promise<object|null>} props.getData - Current normalised editor data.
 * @param {(blockId: string, path: string, html: string) => Promise<boolean>} props.onApply - Writes one string back.
 * @param {(match: object|null, occurrence?: number) => void} props.onSelect - Highlights a match (null clears).
 * @param {() => void} props.onClose - Closes the panel.
 * @param {boolean} [props.readOnly] - No "Apply" buttons.
 * @returns {JSX.Element} Panel.
 */
export const GrammarPanel = ({
  t,
  fetchClient,
  target,
  getData,
  onApply,
  onSelect,
  onClose,
  readOnly = false,
}) => {
  const [state, setState] = useState({ status: 'idle', matches: [], parts: [], truncated: false, error: '' });
  const [current, setCurrent] = useState(null);
  const [announcement, setAnnouncement] = useState('');
  const [notice, setNotice] = useState('');
  const abortRef = useRef(null);

  useEffect(
    () => () => {
      if (abortRef.current) abortRef.current.abort();
      onSelect(null);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- cleanup on unmount only
    []
  );

  const run = useCallback(async () => {
    if (abortRef.current) abortRef.current.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setNotice('');
    setCurrent(null);
    onSelect(null);
    const data = await getData();
    const segments = collectSegments(data);
    if (!segments.length) {
      setState({ status: 'done', matches: [], parts: [], truncated: false, error: '' });
      setAnnouncement(t('editor.grammar.empty', 'This field has no text to check.'));
      return;
    }
    setState((previous) => ({ ...previous, status: 'loading', error: '' }));
    setAnnouncement(t('editor.grammar.checking', 'Checking grammar'));
    try {
      const { data: response } = await fetchClient.post(
        API.grammarCheck,
        {
          target: { uid: target.uid, field: target.field },
          segments,
          ...(target.locale ? { locale: target.locale } : {}),
        },
        { signal: controller.signal }
      );
      const result = response.data;
      const parts = segments.map((segment) => ({ ...segment, text: segmentText(segment.html).text }));
      setState({
        status: 'done',
        matches: result.matches,
        parts,
        truncated: Boolean(result.truncated),
        error: '',
      });
      setAnnouncement(
        t(
          'editor.grammar.found',
          '{count, plural, =0 {No issues found} one {# issue found} other {# issues found}}',
          {
            count: result.matches.length,
          }
        )
      );
    } catch (error) {
      if (controller.signal.aborted) return;
      const info = readApiError(error);
      const [key, text] =
        ERRORS[info.code] ||
        (info.status === 429
          ? ['editor.grammar.error.rateLimit', 'You sent many checks. Try again in a minute.']
          : info.status === 413
            ? ['editor.grammar.error.tooLong', 'This field is too long to check at once.']
            : ['editor.grammar.error.generic', 'The grammar check is not available right now.']);
      setState((previous) => ({ ...previous, status: 'error', error: t(key, text) }));
    }
  }, [fetchClient, getData, onSelect, t, target.field, target.locale, target.uid]);

  const select = (match) => {
    setCurrent(match);
    onSelect(match, occurrenceOf(state.parts, match));
  };

  const apply = async (match, replacement) => {
    setNotice('');
    const data = await getData();
    const block = data && data.blocks.find((item) => item.id === match.blockId);
    const html = block ? readSegment(block.data, match.path) : null;
    const result =
      html === null
        ? { html: null, reason: 'CHANGED' }
        : replaceInSegment(html, {
            offset: match.offset,
            length: match.length,
            expected: match.text,
            replacement,
          });
    if (!result.html) {
      setNotice(
        result.reason === 'CROSSES_FORMATTING'
          ? t(
              'editor.grammar.apply.formatting',
              'This text spans formatting or a line break. Edit it by hand in the editor.'
            )
          : t('editor.grammar.apply.changed', 'The text changed since the check. Run the check again.')
      );
      return;
    }
    const ok = await onApply(match.blockId, match.path, result.html);
    if (!ok) {
      setNotice(t('editor.grammar.apply.changed', 'The text changed since the check. Run the check again.'));
      return;
    }
    onSelect(null);
    setCurrent(null);
    setState((previous) => ({
      ...previous,
      matches: afterReplacement(previous.matches, match, replacement),
      parts: previous.parts.map((part) =>
        part.blockId === match.blockId && part.path === match.path
          ? { ...part, text: segmentText(result.html).text }
          : part
      ),
    }));
    setAnnouncement(t('editor.grammar.applied', 'Replaced with "{text}"', { text: replacement }));
  };

  const contextOf = (match) => {
    const part = state.parts.find((item) => item.blockId === match.blockId && item.path === match.path);
    if (!part) return { before: '', after: '' };
    const before = part.text.slice(Math.max(0, match.offset - 30), match.offset);
    const after = part.text.slice(match.offset + match.length, match.offset + match.length + 30);
    return {
      before: (match.offset > 30 ? '…' : '') + before,
      after: after + (part.text.length > match.offset + match.length + 30 ? '…' : ''),
    };
  };

  return (
    <Box
      tag="section"
      aria-label={t('editor.grammar.title', 'Grammar check')}
      padding={4}
      background="neutral0"
      borderColor="neutral200"
      hasRadius
      minWidth={0}
      data-testid="mex-grammar-panel"
    >
      <Flex direction="column" alignItems="stretch" gap={4}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={2}>
          <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0}>
            <Typography variant="delta" tag="h3">
              {t('editor.grammar.title', 'Grammar check')}
            </Typography>
            <Typography variant="pi" textColor="neutral600">
              {t(
                'editor.grammar.privacy',
                'The text of this field is sent to the LanguageTool server your administrator configured.'
              )}
            </Typography>
          </Flex>
          <IconButton
            label={t('editor.grammar.close', 'Close grammar check')}
            variant="ghost"
            onClick={onClose}
          >
            <Cross />
          </IconButton>
        </Flex>
        <Flex gap={2} wrap="wrap" alignItems="center">
          <Button variant="secondary" size="S" onClick={run} loading={state.status === 'loading'}>
            {state.status === 'idle'
              ? t('editor.grammar.run', 'Check grammar')
              : t('editor.grammar.rerun', 'Check again')}
          </Button>
          {state.status === 'done' ? (
            <Badge
              size="S"
              backgroundColor={state.matches.length ? 'danger100' : 'success100'}
              textColor={state.matches.length ? 'danger700' : 'success700'}
            >
              {t('editor.grammar.count', '{count, plural, =0 {No issues} one {# issue} other {# issues}}', {
                count: state.matches.length,
              })}
            </Badge>
          ) : null}
        </Flex>
        {state.status === 'loading' ? (
          <Loader small>{t('editor.grammar.checking', 'Checking grammar')}</Loader>
        ) : null}
        {state.status === 'error' ? (
          <Typography variant="omega" textColor="danger600" role="alert">
            {state.error}
          </Typography>
        ) : null}
        {notice ? (
          <Typography variant="omega" textColor="danger600" role="alert">
            {notice}
          </Typography>
        ) : null}
        {state.truncated ? (
          <Typography variant="pi" textColor="neutral600">
            {t('editor.grammar.truncated', 'Only the first 500 issues are shown.')}
          </Typography>
        ) : null}
        {state.status === 'done' && state.matches.length ? (
          <List aria-label={t('editor.grammar.results', 'Grammar issues')}>
            {state.matches.map((match) => {
              const context = contextOf(match);
              const key = `${match.blockId}-${match.path}-${match.offset}-${match.length}`;
              return (
                <li key={key}>
                  <RowButton type="button" onClick={() => select(match)} aria-current={current === match}>
                    <Typography variant="omega" fontWeight="bold" tag="span">
                      {match.shortMessage || match.message}
                    </Typography>
                    <Box paddingTop={1}>
                      <Typography variant="pi" textColor="neutral700" tag="span">
                        {context.before}
                        <Flagged>{match.text}</Flagged>
                        {context.after}
                      </Typography>
                    </Box>
                    {match.shortMessage && match.message !== match.shortMessage ? (
                      <Box paddingTop={1}>
                        <Typography variant="pi" textColor="neutral600" tag="span">
                          {match.message}
                        </Typography>
                      </Box>
                    ) : null}
                  </RowButton>
                  {!readOnly && match.replacements.length ? (
                    <Flex gap={2} wrap="wrap" paddingLeft={2} paddingRight={2} paddingBottom={2}>
                      {match.replacements.map((replacement) => (
                        <Button
                          key={replacement}
                          size="S"
                          variant="tertiary"
                          onClick={() => apply(match, replacement)}
                          aria-label={t('editor.grammar.applyLabel', 'Replace "{from}" with "{to}"', {
                            from: match.text,
                            to: replacement,
                          })}
                        >
                          {replacement}
                        </Button>
                      ))}
                    </Flex>
                  ) : null}
                </li>
              );
            })}
          </List>
        ) : null}
        {state.status === 'done' && !state.matches.length ? (
          <Typography variant="omega" textColor="neutral600">
            {t('editor.grammar.none', 'No issues found.')}
          </Typography>
        ) : null}
      </Flex>
      <VisuallyHidden aria-live="polite" aria-atomic="true">
        {announcement}
      </VisuallyHidden>
    </Box>
  );
};

export default GrammarPanel;
