import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Modal,
  Radio,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { useFetchClient } from '../../utils/fetch-client';
import styled from 'styled-components';
import { API, readApiError } from '../../utils/api';
import { sanitizeInline } from '../../editor/sanitize';
import {
  applySegments,
  collectSegments,
  readSegment,
  segmentPlainText,
} from '../../../../shared/ai-fields.mjs';
import { aiErrorEntry } from '../../editor/ai-errors.mjs';
import { aiMenuEntries, entryRequest } from '../../editor/ai-menu.mjs';
import { entryLabel } from './aiLabels';
import { reviewErrorEntry } from './useAiReview';
import { TouchModalContent } from '../ui/touch';

/**
 * Whole-field AI actions (2.3): translate every text of the field or
 * summarize it. The dialog first says what is sent where; nothing is sent
 * before "Send to the AI provider". A translation is shown as a preview and
 * replaces the field only after "Replace field content" (one undo step);
 * blocks keep their ids, types, tunes and all non-text data because only the
 * inline text strings travel. A summary can be copied or inserted as a
 * paragraph.
 *
 * 2.9: AI reviews of the whole field (one suggestion per changed block in the
 * Suggestions panel, also for reviewers who cannot edit the field) and
 * owner-defined whole-field actions (preview and replace, or suggestions).
 */

/** Codes this dialog words differently from the shared AI messages (`editor/ai-errors.mjs`). */
const ERROR_MESSAGES = {
  FIELD_ACTIONS_DISABLED: ['editor.aiField.error.off', 'Whole-field AI actions are turned off.'],
  BAD_RESPONSE: ['editor.aiField.error.format', 'The answer had an unexpected format. Nothing changed.'],
};

const Preview = styled(Box)`
  max-height: 32vh;
  overflow: auto;
  min-width: 0;
`;

const Row = styled.li`
  list-style: none;
  padding: ${({ theme }) => theme.spaces[2]} 0;
  & + & {
    border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
  }
`;

const Text = styled(Typography)`
  white-space: pre-wrap;
  overflow-wrap: anywhere;
`;

/**
 * Plain text of sanitised inline HTML for the preview.
 * @param {string} html - HTML.
 * @returns {string} Text.
 */
const toText = (html) => segmentPlainText(sanitizeInline(html));

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {{ languages: string[], maxInputChars: number }} props.config - `config.ai`.
 * @param {{ uid: string|null, field: string }} props.target - Field.
 * @param {() => Promise<object|null>} props.getData - Current normalised editor data.
 * @param {(data: object) => Promise<void>} props.onReplace - Replaces the field content.
 * @param {(text: string) => void} props.onInsertParagraph - Appends a paragraph.
 * @param {() => void} props.onClose - Closes.
 * @param {boolean} [props.readOnly] - Read-only field (summary only, no replace or insert).
 * @param {() => void} [props.returnFocus] - Focuses the opener (the menu item that opened the dialog is gone).
 * @param {object} [props.preset] - 2.9: field preset (`aiActions` allow-list).
 * @param {boolean} [props.canSuggest] - 2.9: reviews that add suggestions are offered.
 * @param {Function} [props.review] - 2.9: `useAiReview()` runner.
 * @param {(meta: object) => void} [props.onReviewed] - 2.9: after a review stored its suggestions.
 * @returns {JSX.Element} Modal.
 */
export const FieldAiDialog = ({
  t,
  config,
  target,
  getData,
  onReplace,
  onInsertParagraph,
  onClose,
  readOnly,
  returnFocus,
  preset,
  canSuggest = false,
  review,
  onReviewed,
}) => {
  const { post } = useFetchClient();
  const languages = (config && config.languages) || ['English'];
  const entries = useMemo(
    () =>
      aiMenuEntries('field', {
        preset,
        reviews: config && config.reviews,
        custom: config && config.custom,
        canSuggest: Boolean(canSuggest && review),
        canReplace: !readOnly,
      }),
    [config, preset, canSuggest, review, readOnly]
  );
  const [action, setAction] = useState(entries.length ? entries[0].value : '');
  const entry = entries.find((item) => item.value === action) || null;
  const suggests = Boolean(entry && entry.output === 'suggestions');
  const [language, setLanguage] = useState(languages[0]);
  const [segments, setSegments] = useState(null);
  const [state, setState] = useState({ status: 'idle', result: null, error: '' });
  const abort = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getData().then((data) => {
      if (!cancelled) setSegments(collectSegments(data));
    });
    return () => {
      cancelled = true;
      if (abort.current) abort.current.abort();
    };
  }, [getData]);

  const characters = useMemo(
    () => (segments || []).reduce((sum, segment) => sum + segmentPlainText(segment.html).length, 0),
    [segments]
  );
  const tooLong = Boolean(config && characters > config.maxInputChars);

  const send = async () => {
    if (!segments || !segments.length || !entry) return;
    if (abort.current) abort.current.abort();
    abort.current = new AbortController();
    setState({ status: 'loading', result: null, error: '' });
    const request = entryRequest(entry);
    const kind = request.action === 'summarize' ? 'summarize' : 'segments';
    try {
      if (suggests) {
        const meta = await review({
          kind: entry.type === 'custom' ? 'custom' : entry.key,
          actionKey: request.body.actionKey,
          scope: 'field',
          blockIds: null,
          signal: abort.current.signal,
        });
        setState({ status: 'idle', result: null, error: '' });
        if (onReviewed) onReviewed(meta);
        onClose();
        return;
      }
      const { data } = await post(
        API.aiField(request.action),
        {
          target: { uid: target.uid, field: target.field },
          segments,
          ...request.body,
          ...(request.action === 'translate' ? { language } : {}),
        },
        { signal: abort.current.signal }
      );
      const result = data.data;
      // 'translate' renders the segment preview (also for owner-defined whole-field actions).
      const resultAction = kind === 'summarize' ? 'summarize' : 'translate';
      if (kind === 'segments') {
        // The answer must name exactly the strings that were sent.
        const sent = new Map(segments.map((segment) => [`${segment.blockId}|${segment.path}`, segment]));
        const received = Array.isArray(result.segments) ? result.segments : [];
        const valid =
          received.length === sent.size &&
          received.every((item) => sent.has(`${item.blockId}|${item.path}`) && typeof item.html === 'string');
        if (!valid) throw Object.assign(new Error('mismatch'), { mismatch: true });
        const translated = received.map((item) => ({ ...item, html: sanitizeInline(item.html) }));
        setState({
          status: 'done',
          result: { action: resultAction, segments: translated, sent: segments },
          error: '',
        });
      } else {
        setState({
          status: 'done',
          result: { action: resultAction, text: String(result.text || '') },
          error: '',
        });
      }
    } catch (error) {
      if (abort.current && abort.current.signal.aborted) return;
      const info =
        error && error.mismatch
          ? { code: 'BAD_RESPONSE' }
          : error && error.tooManyBlocks
            ? { status: null, code: null }
            : readApiError(error);
      const [key, text] =
        (suggests ? reviewErrorEntry(info, error) : null) ||
        aiErrorEntry(info.code, ERROR_MESSAGES) ||
        (info.status === 429
          ? ['editor.ai.error.rateLimit', 'You sent many requests. Try again in a minute.']
          : info.status === 413
            ? ['editor.aiField.error.tooLong', 'This field is longer than the configured limit.']
            : ['editor.ai.error.generic', 'The AI assistant is not available right now.']);
      setState({ status: 'error', result: null, error: t(key, text) });
    }
  };

  const replace = async () => {
    const { result } = state;
    const data = await getData();
    if (!data) return;
    // The field must still hold what was translated.
    const byId = new Map(data.blocks.map((block) => [block.id, block]));
    const unchanged = result.sent.every((segment) => {
      const block = byId.get(segment.blockId);
      return block && readSegment(block.data, segment.path) === segment.html;
    });
    if (!unchanged) {
      setState({
        status: 'error',
        result: null,
        error: t(
          'editor.aiField.changed',
          'The field changed while the translation was made. Nothing was replaced. Send it again.'
        ),
      });
      return;
    }
    const next = applySegments(data, result.segments);
    await onReplace(next.data);
    onClose();
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.result.text);
      setState((current) => ({ ...current, copied: true }));
    } catch {
      setState((current) => ({ ...current, copied: false }));
    }
  };

  const result = state.result;
  return (
    <Modal.Root open onOpenChange={(open) => !open && onClose()}>
      <TouchModalContent
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return;
          event.preventDefault();
          returnFocus();
        }}
      >
        <Modal.Header closeLabel={t('editor.ai.close', 'Close')}>
          <Modal.Title>{t('editor.aiField.title', 'AI for the whole field')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Field.Root name="mex-field-ai-action">
              <Field.Label>{t('editor.ai.action', 'What should the assistant do?')}</Field.Label>
              <Radio.Group
                value={action}
                onValueChange={(next) => {
                  setAction(String(next));
                  setState({ status: 'idle', result: null, error: '' });
                }}
                aria-label={t('editor.ai.action', 'What should the assistant do?')}
              >
                {entries.map((item) => (
                  <Radio.Item key={item.value} value={item.value}>
                    {entryLabel(t, item, 'field')}
                  </Radio.Item>
                ))}
              </Radio.Group>
            </Field.Root>
            {entry && entry.type === 'builtin' && entry.key === 'translate' ? (
              <Field.Root name="mex-field-ai-language">
                <Field.Label>{t('editor.ai.language', 'Target language')}</Field.Label>
                <SingleSelect
                  value={language}
                  onChange={(next) => {
                    setLanguage(String(next));
                    setState({ status: 'idle', result: null, error: '' });
                  }}
                >
                  {languages.map((name) => (
                    <SingleSelectOption key={name} value={name}>
                      {name}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            ) : null}
            <Box padding={3} background="warning100" hasRadius borderColor="warning200">
              <Typography variant="omega" textColor="neutral800" tag="p">
                {t(
                  'editor.aiField.disclosure',
                  'The text of every block in this field ({count, plural, one {# text} other {# texts}}, {characters} characters) is sent to the AI provider your administrator configured, with its inline formatting and links. Images, files and other block data are not sent.',
                  { count: segments ? segments.length : 0, characters }
                )}
                {suggests
                  ? ` ${t(
                      'editor.ai.review.result',
                      'Each change appears as a suggestion in the Suggestions panel; the field does not change.'
                    )}`
                  : ''}
              </Typography>
            </Box>
            {segments && !segments.length ? (
              <Typography textColor="neutral600">
                {t('editor.aiField.empty', 'This field has no text yet.')}
              </Typography>
            ) : null}
            {tooLong ? (
              <Typography textColor="danger600">
                {t('editor.aiField.error.tooLong', 'This field is longer than the configured limit.')}
              </Typography>
            ) : null}
            {state.status === 'loading' ? (
              <Loader small>{t('editor.aiField.working', 'Waiting for the AI provider')}</Loader>
            ) : null}
            {state.status === 'error' ? (
              <Typography textColor="danger600" role="alert">
                {state.error}
              </Typography>
            ) : null}
            {result && result.action === 'translate' ? (
              <Flex direction="column" alignItems="stretch" gap={2}>
                <Typography variant="sigma" textColor="neutral600" tag="h3">
                  {t('editor.aiField.preview', 'Preview')}
                </Typography>
                <Preview
                  padding={3}
                  background="neutral100"
                  hasRadius
                  tabIndex={0}
                  data-testid="mex-field-ai-preview"
                >
                  <Box tag="ul" margin={0} padding={0}>
                    {result.segments.map((segment, index) => (
                      <Row key={`${segment.blockId}-${segment.path}`}>
                        <Text variant="pi" textColor="neutral600" tag="p">
                          {toText(result.sent[index] ? result.sent[index].html : '')}
                        </Text>
                        <Text variant="omega" textColor="neutral800" tag="p">
                          {toText(segment.html)}
                        </Text>
                      </Row>
                    ))}
                  </Box>
                </Preview>
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'editor.aiField.replaceHint',
                    'Replacing keeps every block, its formatting and settings. Use Undo in the toolbar to go back.'
                  )}
                </Typography>
              </Flex>
            ) : null}
            {result && result.action === 'summarize' ? (
              <Box padding={3} hasRadius borderColor="primary200" background="primary100">
                <Typography variant="sigma" textColor="primary700" tag="h3">
                  {t('editor.aiField.summary', 'Summary')}
                </Typography>
                <Text variant="omega" textColor="neutral800" tag="p" data-testid="mex-field-ai-summary">
                  {result.text}
                </Text>
                {state.copied ? (
                  <Typography variant="pi" textColor="success700" role="status">
                    {t('editor.aiField.copied', 'Copied to the clipboard.')}
                  </Typography>
                ) : null}
              </Box>
            ) : null}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('editor.ai.cancel', 'Cancel')}</Button>
          </Modal.Close>
          <Flex gap={2} wrap="wrap" justifyContent="flex-end">
            <Button
              variant={result ? 'secondary' : 'default'}
              onClick={send}
              loading={state.status === 'loading'}
              disabled={!entry || !segments || !segments.length || tooLong || state.status === 'loading'}
              data-testid={suggests ? 'mex-field-ai-review' : undefined}
            >
              {suggests
                ? t('editor.ai.review.run', 'Add suggestions')
                : result
                  ? t('editor.ai.retry', 'Try again')
                  : t('editor.aiField.send', 'Send to the AI provider')}
            </Button>
            {result && result.action === 'translate' && !readOnly ? (
              <Button onClick={replace}>{t('editor.aiField.replace', 'Replace field content')}</Button>
            ) : null}
            {result && result.action === 'summarize' ? (
              <>
                <Button variant="secondary" onClick={copy}>
                  {t('editor.aiField.copy', 'Copy')}
                </Button>
                {!readOnly ? (
                  <Button
                    onClick={() => {
                      onInsertParagraph(result.text);
                      onClose();
                    }}
                  >
                    {t('editor.aiField.insert', 'Insert as paragraph')}
                  </Button>
                ) : null}
              </>
            ) : null}
          </Flex>
        </Modal.Footer>
      </TouchModalContent>
    </Modal.Root>
  );
};

export default FieldAiDialog;
