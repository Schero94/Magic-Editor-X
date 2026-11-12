import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Button, Checkbox, Field, Flex, IconButton, TextInput, Typography } from '@strapi/design-system';
import { ChevronDown, ChevronUp, Cross } from '@strapi/icons';
import styled from 'styled-components';
import { findMatches, replaceMatches, MAX_QUERY_LENGTH } from '../../../../shared/find-replace.mjs';

/**
 * Find and replace for one editor field. Works on the document model
 * (shared/find-replace.mjs): every text block, list item, table cell, caption
 * and code block; inline formatting is kept. Regular expressions are off by
 * default. Changes are normal edits (undo, collaboration, form state).
 */

const Grid = styled.div`
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: ${({ theme }) => theme.spaces[3]};
  ${({ theme }) => theme.breakpoints.medium} {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
`;

const ERRORS = {
  INVALID: ['editor.find.error.invalid', 'This regular expression is not valid.'],
  TOO_LONG: ['editor.find.error.tooLong', 'Search for at most {max} characters.'],
};

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {() => Promise<object|null>} props.getData - Reads the current editor content.
 * @param {(data: object, blockIds: string[]) => Promise<void>} props.onApply - Applies changed blocks to the editor.
 * @param {(match: object|null, options: object) => void} props.onSelect - Shows a match in the editor (null clears).
 * @param {() => void} props.onClose - Closes the panel.
 * @param {boolean} props.readOnly - Replacing is not allowed.
 * @param {number} props.contentVersion - Changes whenever the editor content changes.
 * @returns {JSX.Element} Panel.
 */
export const FindReplacePanel = ({ t, getData, onApply, onSelect, onClose, readOnly, contentVersion }) => {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [options, setOptions] = useState({ matchCase: false, wholeWord: false, regex: false });
  const [result, setResult] = useState({ matches: [], error: null, truncated: false });
  const [current, setCurrent] = useState(0);
  const [status, setStatus] = useState('');
  const findRef = useRef(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (findRef.current) findRef.current.focus();
  }, []);

  const search = useCallback(async () => {
    if (!query) {
      setResult({ matches: [], error: null, truncated: false });
      onSelect(null, options);
      return;
    }
    const data = await getData();
    const next = findMatches(data, query, options);
    setResult(next);
    setCurrent((index) => (next.matches.length ? Math.min(index, next.matches.length - 1) : 0));
  }, [getData, onSelect, options, query]);

  useEffect(() => {
    const timer = setTimeout(() => {
      search().catch(() => {});
    }, 150);
    return () => clearTimeout(timer);
  }, [search, contentVersion]);

  useEffect(() => {
    const match = result.matches[current];
    onSelect(match || null, options);
  }, [current, onSelect, options, result.matches]);

  useEffect(() => () => onSelect(null, {}), [onSelect]);

  const count = result.matches.length;
  const step = (delta) => {
    if (!count) return;
    setCurrent((index) => (index + delta + count) % count);
  };

  const replace = async (all) => {
    if (busyRef.current || !count || readOnly) return;
    busyRef.current = true;
    try {
      const data = await getData();
      const scope = all ? {} : { only: result.matches[current] };
      const next = replaceMatches(data, query, replacement, options, scope);
      if (next.count) await onApply(next.data, next.blockIds);
      setStatus(
        t('editor.find.replaced', '{count, plural, one {# match replaced} other {# matches replaced}}', {
          count: next.count,
        })
      );
      await search();
    } finally {
      busyRef.current = false;
    }
  };

  const onFindKey = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  const errorText =
    result.error && ERRORS[result.error]
      ? t(ERRORS[result.error][0], ERRORS[result.error][1], { max: MAX_QUERY_LENGTH })
      : null;
  const position = count
    ? t('editor.find.position', '{current} of {total}', { current: current + 1, total: count })
    : query && !errorText
      ? t('editor.find.none', 'No matches')
      : '';

  return (
    <Box
      tag="section"
      aria-label={t('editor.find.title', 'Find and replace')}
      padding={4}
      background="neutral0"
      borderColor="neutral200"
      hasRadius
      minWidth={0}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <Flex direction="column" alignItems="stretch" gap={3}>
        <Flex justifyContent="space-between" alignItems="flex-start" gap={2}>
          <Typography variant="delta" tag="h3">
            {t('editor.find.title', 'Find and replace')}
          </Typography>
          <IconButton
            label={t('editor.find.close', 'Close find and replace')}
            variant="ghost"
            onClick={onClose}
          >
            <Cross />
          </IconButton>
        </Flex>
        <Grid>
          <Field.Root name="mex-find" error={errorText || undefined} hint={position || undefined}>
            <Field.Label>{t('editor.find.find', 'Find')}</Field.Label>
            <TextInput
              ref={findRef}
              value={query}
              maxLength={MAX_QUERY_LENGTH}
              onChange={(event) => {
                setQuery(event.target.value);
                setCurrent(0);
                setStatus('');
              }}
              onKeyDown={onFindKey}
            />
            <Field.Error />
            <Field.Hint />
          </Field.Root>
          {readOnly ? null : (
            <Field.Root name="mex-replace">
              <Field.Label>{t('editor.find.replaceWith', 'Replace with')}</Field.Label>
              <TextInput
                value={replacement}
                maxLength={10000}
                onChange={(event) => setReplacement(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault();
                    replace(false);
                  }
                }}
              />
            </Field.Root>
          )}
        </Grid>
        <Flex gap={4} wrap="wrap">
          <Checkbox
            checked={options.matchCase}
            onCheckedChange={(checked) => setOptions((value) => ({ ...value, matchCase: checked === true }))}
          >
            {t('editor.find.matchCase', 'Match case')}
          </Checkbox>
          <Checkbox
            checked={options.wholeWord}
            onCheckedChange={(checked) => setOptions((value) => ({ ...value, wholeWord: checked === true }))}
          >
            {t('editor.find.wholeWord', 'Whole words')}
          </Checkbox>
          <Checkbox
            checked={options.regex}
            onCheckedChange={(checked) => setOptions((value) => ({ ...value, regex: checked === true }))}
          >
            {t('editor.find.regex', 'Regular expression')}
          </Checkbox>
        </Flex>
        <Flex gap={2} wrap="wrap">
          <IconButton
            label={t('editor.find.previous', 'Previous match')}
            variant="tertiary"
            onClick={() => step(-1)}
            disabled={!count}
          >
            <ChevronUp />
          </IconButton>
          <IconButton
            label={t('editor.find.next', 'Next match')}
            variant="tertiary"
            onClick={() => step(1)}
            disabled={!count}
          >
            <ChevronDown />
          </IconButton>
          {readOnly ? null : (
            <>
              <Button variant="secondary" onClick={() => replace(false)} disabled={!count}>
                {t('editor.find.replace', 'Replace')}
              </Button>
              <Button variant="secondary" onClick={() => replace(true)} disabled={!count}>
                {t('editor.find.replaceAll', 'Replace all')}
              </Button>
            </>
          )}
        </Flex>
        <Typography variant="pi" textColor="neutral600" aria-live="polite">
          {status || position}
          {result.truncated ? ` ${t('editor.find.truncated', '(only the first matches are shown)')}` : ''}
        </Typography>
      </Flex>
    </Box>
  );
};

export default FindReplacePanel;
