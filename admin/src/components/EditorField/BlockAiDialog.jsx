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
import { segmentPlainText } from '../../../../shared/ai-fields.mjs';
import { applyBlockResult, blockSegments, changeViews } from '../../../../shared/ai-blocks.mjs';
import { MAX_INSTRUCTION_CHARS } from '../../../../shared/ai-actions.mjs';
import { TextOps } from './VersionDiff';
import { aiErrorEntry } from '../../editor/ai-errors.mjs';
import { aiMenuEntries, entryRequest } from '../../editor/ai-menu.mjs';
import { entryLabel } from './aiLabels';
import { AskInstruction } from './AskInstruction';
import { reviewErrorEntry } from './useAiReview';
import { TouchModalContent } from '../ui/touch';

/**
 * Block-aware AI actions (2.4): rewrite, shorten, translate or change the
 * tone of one or more chosen blocks. Only the inline text strings of these
 * blocks travel (with their inline formatting and links); block ids, types,
 * tunes and every other value stay in the browser. The answer is shown as a
 * word diff and applied only after "Apply to blocks", as one undo step and
 * only while the blocks still hold the strings that were sent.
 *
 * 2.9: "Ask AI…" with the admin's own instruction (same preview), AI reviews
 * and owner-defined actions with the output "suggestions" (one suggestion
 * per changed block in the Suggestions panel; nothing changes in the field),
 * and owner-defined block actions after the built-in ones.
 */

const TONE_LABELS = {
  professional: ['editor.ai.tone.professional', 'Professional'],
  friendly: ['editor.ai.tone.friendly', 'Friendly'],
  casual: ['editor.ai.tone.casual', 'Casual'],
  confident: ['editor.ai.tone.confident', 'Confident'],
  formal: ['editor.ai.tone.formal', 'Formal'],
  persuasive: ['editor.ai.tone.persuasive', 'Persuasive'],
};

/** Codes this dialog words differently from the shared AI messages (`editor/ai-errors.mjs`). */
const ERROR_MESSAGES = {
  BAD_RESPONSE: ['editor.aiField.error.format', 'The answer had an unexpected format. Nothing changed.'],
};

const Preview = styled(Box)`
  max-height: 36vh;
  overflow: auto;
  min-width: 0;
`;

const Row = styled.li`
  list-style: none;
  padding: ${({ theme }) => theme.spaces[2]} 0;
  min-width: 0;
  & + & {
    border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
  }
`;

/**
 * Plain text of sanitised inline HTML (for the diff).
 * @param {string} html - HTML.
 * @returns {string} Text.
 */
const toText = (html) => segmentPlainText(sanitizeInline(html));

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {{ languages: string[], tones: string[], maxInputChars: number }} props.config - `config.ai`.
 * @param {{ uid: string, field: string }} props.target - Field.
 * @param {string[]} props.blockIds - Chosen blocks.
 * @param {object} props.preset - Field preset (applied blocks are fixed against it).
 * @param {() => Promise<object|null>} props.getData - Current normalised editor data.
 * @param {(data: object, count: number) => Promise<void>} props.onApply - Replaces the content (one undo step).
 * @param {() => void} props.onClose - Closes.
 * @param {() => void} [props.returnFocus] - Focuses the opener again.
 * @param {boolean} [props.canSuggest] - 2.9: reviews that add suggestions are offered.
 * @param {Function} [props.review] - 2.9: `useAiReview()` runner.
 * @param {(meta: object) => void} [props.onReviewed] - 2.9: after a review stored its suggestions.
 * @param {string[]} [props.recent] - 2.9: recent "Ask AI…" instructions.
 * @param {(instruction: string) => void} [props.onInstructionUsed] - 2.9: remembers an instruction.
 * @returns {JSX.Element} Modal.
 */
export const BlockAiDialog = ({
  t,
  config,
  target,
  blockIds,
  preset,
  getData,
  onApply,
  onClose,
  returnFocus,
  canSuggest = false,
  review,
  onReviewed,
  recent = [],
  onInstructionUsed,
}) => {
  const { post } = useFetchClient();
  const languages = (config && config.languages) || ['English'];
  const tones = (config && config.tones) || ['professional'];
  const entries = useMemo(
    () =>
      aiMenuEntries('blocks', {
        preset,
        reviews: config && config.reviews,
        custom: config && config.custom,
        canSuggest: Boolean(canSuggest && review),
      }),
    [config, preset, canSuggest, review]
  );
  const [action, setAction] = useState(entries.length ? entries[0].value : '');
  const entry = entries.find((item) => item.value === action) || null;
  const suggests = Boolean(entry && entry.output === 'suggestions');
  const needsInstruction = Boolean(entry && entry.type === 'ask');
  const [instruction, setInstruction] = useState('');
  const [missing, setMissing] = useState('');
  const maxInstruction = (config && config.maxInstructionChars) || MAX_INSTRUCTION_CHARS;
  const [language, setLanguage] = useState(languages[0]);
  const [tone, setTone] = useState(tones[0]);
  const [segments, setSegments] = useState(null);
  const [state, setState] = useState({ status: 'idle', result: null, error: '' });
  const abort = useRef(null);

  useEffect(() => {
    let cancelled = false;
    getData().then((data) => {
      if (!cancelled) setSegments(blockSegments(data, blockIds));
    });
    return () => {
      cancelled = true;
      if (abort.current) abort.current.abort();
    };
  }, [getData, blockIds]);

  const characters = useMemo(
    () => (segments || []).reduce((sum, segment) => sum + segmentPlainText(segment.html).length, 0),
    [segments]
  );
  const tooLong = Boolean(config && characters > config.maxInputChars);
  const reset = () => setState({ status: 'idle', result: null, error: '' });

  const fail = (message) => setState({ status: 'error', result: null, error: message });

  const send = async () => {
    if (!segments || !segments.length || !entry) return;
    if (needsInstruction && !instruction.trim()) {
      setMissing(t('editor.ai.ask.required', 'Write an instruction first.'));
      return;
    }
    if (abort.current) abort.current.abort();
    abort.current = new AbortController();
    setState({ status: 'loading', result: null, error: '' });
    const request = entryRequest(entry);
    try {
      if (suggests) {
        const meta = await review({
          kind: entry.type === 'custom' ? 'custom' : entry.key,
          actionKey: request.body.actionKey,
          scope: 'blocks',
          blockIds,
          signal: abort.current.signal,
        });
        reset();
        if (onReviewed) onReviewed(meta);
        onClose();
        return;
      }
      const { data } = await post(
        API.aiBlocks(request.action),
        {
          target: { uid: target.uid, field: target.field },
          segments,
          ...request.body,
          ...(request.action === 'translate' ? { language } : {}),
          ...(request.action === 'tone' ? { tone } : {}),
          ...(needsInstruction ? { instruction: instruction.trim() } : {}),
        },
        { signal: abort.current.signal }
      );
      if (needsInstruction && onInstructionUsed) onInstructionUsed(instruction.trim());
      const received = data && data.data && Array.isArray(data.data.segments) ? data.data.segments : [];
      const sent = new Map(segments.map((segment) => [`${segment.blockId}|${segment.path}`, segment]));
      const valid =
        received.length === sent.size &&
        new Set(received.map((item) => `${item.blockId}|${item.path}`)).size === received.length &&
        received.every((item) => sent.has(`${item.blockId}|${item.path}`) && typeof item.html === 'string');
      if (!valid) throw Object.assign(new Error('mismatch'), { mismatch: true });
      const rows = received.map((item) => {
        const before = sent.get(`${item.blockId}|${item.path}`);
        const html = sanitizeInline(item.html);
        return { ...item, html, views: changeViews(toText(before.html), toText(html)) };
      });
      setState({ status: 'done', result: { segments: rows, sent: segments }, error: '' });
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
            ? ['editor.aiBlocks.error.tooLong', 'The chosen blocks are longer than the configured limit.']
            : info.status === 403
              ? ['editor.ai.error.disabled', 'The AI assistant is turned off.']
              : ['editor.ai.error.generic', 'The AI assistant is not available right now.']);
      fail(t(key, text));
    }
  };

  const apply = async () => {
    const { result } = state;
    const data = await getData();
    const applied = applyBlockResult(
      data,
      result.sent,
      result.segments.map(({ blockId, path, html }) => ({ blockId, path, html })),
      preset
    );
    if (!applied.ok) {
      if (applied.reason === 'MISMATCH')
        fail(t('editor.aiField.error.format', 'The answer had an unexpected format. Nothing changed.'));
      else
        fail(
          t(
            'editor.aiBlocks.changed',
            'These blocks changed while the assistant was working. Nothing was replaced. Send them again.'
          )
        );
      return;
    }
    await onApply(applied.data, new Set(result.sent.map((segment) => segment.blockId)).size);
    onClose();
  };

  const result = state.result;
  const blockCount = segments ? new Set(segments.map((segment) => segment.blockId)).size : 0;
  return (
    <Modal.Root open onOpenChange={(open) => !open && onClose()}>
      <TouchModalContent
        aria-describedby={undefined}
        data-testid="mex-block-ai-dialog"
        onCloseAutoFocus={(event) => {
          if (!returnFocus) return;
          event.preventDefault();
          returnFocus();
        }}
      >
        <Modal.Header closeLabel={t('editor.ai.close', 'Close')}>
          <Modal.Title>{t('editor.aiBlocks.title', 'AI for the chosen blocks')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Field.Root name="mex-block-ai-action">
              <Field.Label>{t('editor.ai.action', 'What should the assistant do?')}</Field.Label>
              <Radio.Group
                value={action}
                onValueChange={(next) => {
                  setAction(String(next));
                  reset();
                }}
                aria-label={t('editor.ai.action', 'What should the assistant do?')}
              >
                {entries.map((item) => (
                  <Radio.Item key={item.value} value={item.value}>
                    {entryLabel(t, item, 'blocks')}
                  </Radio.Item>
                ))}
              </Radio.Group>
            </Field.Root>
            {needsInstruction ? (
              <AskInstruction
                t={t}
                name="mex-block-ai-instruction"
                value={instruction}
                onChange={(next) => {
                  setInstruction(next);
                  setMissing('');
                  reset();
                }}
                max={maxInstruction}
                recent={recent}
                error={missing || undefined}
              />
            ) : null}
            {entry && entry.type === 'builtin' && entry.key === 'translate' ? (
              <Field.Root name="mex-block-ai-language">
                <Field.Label>{t('editor.ai.language', 'Target language')}</Field.Label>
                <SingleSelect
                  value={language}
                  onChange={(next) => {
                    setLanguage(String(next));
                    reset();
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
            {entry && entry.type === 'builtin' && entry.key === 'tone' ? (
              <Field.Root name="mex-block-ai-tone">
                <Field.Label>{t('editor.ai.tone', 'Tone')}</Field.Label>
                <SingleSelect
                  value={tone}
                  onChange={(next) => {
                    setTone(String(next));
                    reset();
                  }}
                >
                  {tones.map((name) => (
                    <SingleSelectOption key={name} value={name}>
                      {TONE_LABELS[name] ? t(TONE_LABELS[name][0], TONE_LABELS[name][1]) : name}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            ) : null}
            <Box padding={3} background="warning100" hasRadius borderColor="warning200">
              <Typography variant="omega" textColor="neutral800" tag="p">
                {t(
                  'editor.aiBlocks.disclosure',
                  'The text of the chosen blocks ({blocks, plural, one {# block} other {# blocks}}, {characters} characters) is sent to the AI provider your administrator configured, with its inline formatting and links. Images, files and other block data are not sent.',
                  { blocks: blockCount, characters }
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
                {t('editor.aiBlocks.empty', 'The chosen blocks have no text the assistant can change.')}
              </Typography>
            ) : null}
            {tooLong ? (
              <Typography textColor="danger600">
                {t(
                  'editor.aiBlocks.error.tooLong',
                  'The chosen blocks are longer than the configured limit.'
                )}
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
            {result ? (
              <Flex direction="column" alignItems="stretch" gap={2}>
                <Typography variant="sigma" textColor="neutral600" tag="h3">
                  {t('editor.aiBlocks.preview', 'Changes')}
                </Typography>
                <Preview
                  padding={3}
                  background="neutral100"
                  hasRadius
                  tabIndex={0}
                  aria-label={t('editor.aiBlocks.preview', 'Changes')}
                  data-testid="mex-block-ai-preview"
                >
                  <Box tag="ul" margin={0} padding={0}>
                    {result.segments.map((segment) => (
                      <Row key={`${segment.blockId}-${segment.path}`}>
                        {segment.views.map((ops, index) => (
                          <TextOps key={index} ops={ops} t={t} />
                        ))}
                      </Row>
                    ))}
                  </Box>
                </Preview>
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'editor.aiBlocks.applyHint',
                    'Applying keeps every block, its type, settings, formatting and links. Use Undo in the toolbar to go back.'
                  )}
                </Typography>
              </Flex>
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
              data-testid={suggests ? 'mex-block-ai-review' : undefined}
            >
              {suggests
                ? t('editor.ai.review.run', 'Add suggestions')
                : result
                  ? t('editor.ai.retry', 'Try again')
                  : t('editor.aiField.send', 'Send to the AI provider')}
            </Button>
            {result ? (
              <Button onClick={apply} data-testid="mex-block-ai-apply">
                {t('editor.aiBlocks.apply', 'Apply to blocks')}
              </Button>
            ) : null}
          </Flex>
        </Modal.Footer>
      </TouchModalContent>
    </Modal.Root>
  );
};

export default BlockAiDialog;
