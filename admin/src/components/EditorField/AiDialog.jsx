import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Field,
  Flex,
  Loader,
  Modal,
  SingleSelect,
  SingleSelectOption,
  Typography,
} from '@strapi/design-system';
import { useFetchClient } from '../../utils/fetch-client';
import { API, readApiError } from '../../utils/api';
import { changeViews } from '../../../../shared/ai-blocks.mjs';
import { MAX_INSTRUCTION_CHARS } from '../../../../shared/ai-actions.mjs';
import { TextOps } from './VersionDiff';
import { aiErrorEntry } from '../../editor/ai-errors.mjs';
import { aiMenuEntries, entryRequest } from '../../editor/ai-menu.mjs';
import { entryLabel } from './aiLabels';
import { AskInstruction } from './AskInstruction';
import { reviewErrorEntry } from './useAiReview';
import { TouchModalContent } from '../ui/touch';

/**
 * AI assistant dialog: the admin picks an action for the selected text, the
 * server asks the configured provider and the suggestion can replace the
 * selection. Nothing changes until "Replace" is chosen. The selection is sent
 * with its inline formatting and links, and the suggestion keeps them (2.4:
 * shown as a word diff; the server allows only the field preset's inline
 * tags and no new link targets).
 *
 * 2.9: "Ask AI…" takes the admin's own instruction (same preview), the AI
 * reviews and owner-defined actions with the output "suggestions" add
 * suggestions for the blocks the selection is in (nothing changes in the
 * field), and owner-defined actions for selections follow the built-in ones.
 */

const TONE_LABELS = {
  professional: ['editor.ai.tone.professional', 'Professional'],
  friendly: ['editor.ai.tone.friendly', 'Friendly'],
  casual: ['editor.ai.tone.casual', 'Casual'],
  confident: ['editor.ai.tone.confident', 'Confident'],
  formal: ['editor.ai.tone.formal', 'Formal'],
  persuasive: ['editor.ai.tone.persuasive', 'Persuasive'],
};

/**
 * Plain text of an HTML snippet (inert parsing).
 * @param {string} html - HTML.
 * @returns {string} Text.
 */
const toText = (html) =>
  new DOMParser().parseFromString(String(html || ''), 'text/html').body.textContent || '';

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {{ html?: string, text?: string, blockIds?: string[] }} props.request - Selection (2.9: and the blocks it is in).
 * @param {object} props.config - `config.ai`.
 * @param {{ uid: string, field: string }} props.target - Field.
 * @param {object} [props.preset] - 2.9: field preset (`aiActions` allow-list).
 * @param {boolean} [props.canSuggest] - 2.9: reviews that add suggestions are offered.
 * @param {Function} [props.review] - 2.9: `useAiReview()` runner.
 * @param {(meta: object) => void} [props.onReviewed] - 2.9: after a review stored its suggestions.
 * @param {string[]} [props.recent] - 2.9: recent "Ask AI…" instructions.
 * @param {(instruction: string) => void} [props.onInstructionUsed] - 2.9: remembers an instruction.
 * @param {(html: string) => void} props.onApply - Replaces the selection.
 * @param {() => void} props.onClose - Closes.
 * @param {() => void} [props.returnFocus] - 2.7.4: puts focus back into the editor (the selection, or the
 *   applied text) when the dialog closes; the inline toolbar button that opened it is gone by then.
 * @returns {JSX.Element} Modal.
 */
export const AiDialog = ({
  t,
  request,
  config,
  target,
  preset,
  canSuggest = false,
  review,
  onReviewed,
  recent = [],
  onInstructionUsed,
  onApply,
  onClose,
  returnFocus,
}) => {
  const { post } = useFetchClient();
  const blockIds = (request && request.blockIds) || [];
  const entries = useMemo(
    () =>
      aiMenuEntries('selection', {
        builtins: config && config.actions,
        preset,
        reviews: config && config.reviews,
        custom: config && config.custom,
        canSuggest: Boolean(canSuggest && review && blockIds.length),
      }),
    [config, preset, canSuggest, review, blockIds.length]
  );
  const [value, setValue] = useState(entries.length ? entries[0].value : '');
  const entry = entries.find((item) => item.value === value) || null;
  const [language, setLanguage] = useState((config && config.languages && config.languages[0]) || 'English');
  const [tone, setTone] = useState((config && config.tones && config.tones[0]) || 'professional');
  const [instruction, setInstruction] = useState('');
  const [state, setState] = useState({ loading: false, result: null, error: null });
  const abort = useRef(null);
  const original = useMemo(() => request.html || request.text || '', [request]);
  const originalText = useMemo(() => toText(original), [original]);
  const tooLong = config && originalText.length > config.maxInputChars;
  const maxInstruction = (config && config.maxInstructionChars) || MAX_INSTRUCTION_CHARS;
  const suggests = Boolean(entry && entry.output === 'suggestions');
  const needsInstruction = Boolean(entry && entry.type === 'ask');

  useEffect(() => () => abort.current && abort.current.abort(), []);

  const choose = (next) => {
    setValue(String(next));
    setState({ loading: false, result: null, error: null });
  };

  const failWith = (error) => {
    const info = error && error.tooManyBlocks ? { status: null, code: null } : readApiError(error);
    const [key, text] =
      (suggests ? reviewErrorEntry(info, error) : null) ||
      aiErrorEntry(info.code) ||
      (info.status === 429
        ? ['editor.ai.error.rateLimit', 'You sent many requests. Try again in a minute.']
        : info.status === 413
          ? ['editor.ai.error.tooLong', 'The selected text is too long for the assistant.']
          : info.status === 403
            ? ['editor.ai.error.actionOff', 'This AI action is turned off for this field.']
            : ['editor.ai.error.generic', 'The AI assistant is not available right now.']);
    setState({ loading: false, result: null, error: t(key, text) });
  };

  const run = async () => {
    if (!entry) return;
    if (needsInstruction && !instruction.trim()) {
      setState({
        loading: false,
        result: null,
        error: null,
        missing: t('editor.ai.ask.required', 'Write an instruction first.'),
      });
      return;
    }
    if (abort.current) abort.current.abort();
    abort.current = new AbortController();
    setState({ loading: true, result: null, error: null });
    const { action, body } = entryRequest(entry);
    try {
      if (suggests) {
        const meta = await review({
          kind: entry.type === 'custom' ? 'custom' : entry.key,
          actionKey: body.actionKey,
          scope: 'selection',
          blockIds,
          signal: abort.current.signal,
        });
        setState({ loading: false, result: null, error: null });
        if (onReviewed) onReviewed(meta);
        onClose();
        return;
      }
      const { data } = await post(
        API.ai(action),
        {
          text: original,
          target,
          ...body,
          ...(action === 'translate' ? { language } : {}),
          ...(action === 'tone' ? { tone } : {}),
          ...(needsInstruction ? { instruction: instruction.trim() } : {}),
        },
        { signal: abort.current.signal }
      );
      if (needsInstruction && onInstructionUsed) onInstructionUsed(instruction.trim());
      setState({ loading: false, result: data.data.text, error: null });
    } catch (error) {
      if (abort.current && abort.current.signal.aborted) return;
      failWith(error);
    }
  };

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
          <Modal.Title>{t('editor.ai.title', 'AI assistant')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={4}>
            <Box padding={3} background="neutral100" hasRadius>
              <Typography variant="sigma" textColor="neutral600" tag="p">
                {t('editor.ai.selection', 'Selected text')}
              </Typography>
              <Typography
                tag="p"
                variant="omega"
                textColor="neutral800"
                style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}
              >
                {originalText || t('editor.ai.noSelection', 'Select text in the editor first.')}
              </Typography>
            </Box>
            <Field.Root name="ai-action">
              <Field.Label>{t('editor.ai.action', 'What should the assistant do?')}</Field.Label>
              <SingleSelect value={value} onChange={choose} data-testid="mex-ai-action">
                {entries.map((item) => (
                  <SingleSelectOption key={item.value} value={item.value}>
                    {entryLabel(t, item, 'selection')}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
            {entry && entry.key === 'translate' && entry.type === 'builtin' ? (
              <Field.Root name="ai-language">
                <Field.Label>{t('editor.ai.language', 'Target language')}</Field.Label>
                <SingleSelect value={language} onChange={(next) => setLanguage(String(next))}>
                  {(config.languages || []).map((name) => (
                    <SingleSelectOption key={name} value={name}>
                      {name}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            ) : null}
            {entry && entry.key === 'tone' && entry.type === 'builtin' ? (
              <Field.Root name="ai-tone">
                <Field.Label>{t('editor.ai.tone', 'Tone')}</Field.Label>
                <SingleSelect value={tone} onChange={(next) => setTone(String(next))}>
                  {(config.tones || []).map((name) => (
                    <SingleSelectOption key={name} value={name}>
                      {TONE_LABELS[name] ? t(TONE_LABELS[name][0], TONE_LABELS[name][1]) : name}
                    </SingleSelectOption>
                  ))}
                </SingleSelect>
              </Field.Root>
            ) : null}
            {needsInstruction ? (
              <AskInstruction
                t={t}
                value={instruction}
                onChange={(next) => {
                  setInstruction(next);
                  if (state.missing) setState({ loading: false, result: null, error: null });
                }}
                max={maxInstruction}
                recent={recent}
                error={state.missing}
              />
            ) : null}
            <Typography variant="pi" textColor="neutral600">
              {suggests
                ? t(
                    'editor.ai.review.privacy',
                    'The text of the {count, plural, one {block} other {# blocks}} with the selection is sent to the AI provider your administrator configured. Each change appears as a suggestion in the Suggestions panel; the field does not change.',
                    { count: blockIds.length }
                  )
                : t(
                    'editor.ai.privacy',
                    'The selected text is sent to the AI provider your administrator configured.'
                  )}
            </Typography>
            {tooLong ? (
              <Typography textColor="danger600">
                {t('editor.ai.error.tooLong', 'The selected text is too long for the assistant.')}
              </Typography>
            ) : null}
            {state.loading ? <Loader small>{t('editor.ai.working', 'Writing a suggestion')}</Loader> : null}
            {state.error ? (
              <Typography textColor="danger600" role="alert">
                {state.error}
              </Typography>
            ) : null}
            {state.result !== null ? (
              <Box padding={3} hasRadius borderColor="primary200" background="primary100">
                <Typography variant="sigma" textColor="primary700" tag="p">
                  {t('editor.ai.suggestion', 'Suggestion')}
                </Typography>
                <Box data-testid="mex-ai-suggestion">
                  {changeViews(originalText, toText(state.result)).map((ops, index) => (
                    <TextOps key={index} ops={ops} t={t} />
                  ))}
                </Box>
              </Box>
            ) : null}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('editor.ai.cancel', 'Cancel')}</Button>
          </Modal.Close>
          <Flex gap={2} wrap="wrap" justifyContent="flex-end">
            {suggests ? (
              <Button
                onClick={run}
                loading={state.loading}
                disabled={!originalText || tooLong || state.loading}
                data-testid="mex-ai-review-run"
              >
                {t('editor.ai.review.run', 'Add suggestions')}
              </Button>
            ) : (
              <>
                <Button
                  variant="secondary"
                  onClick={run}
                  loading={state.loading}
                  disabled={!entry || !originalText || tooLong}
                >
                  {state.result !== null
                    ? t('editor.ai.retry', 'Try again')
                    : t('editor.ai.generate', 'Generate')}
                </Button>
                <Button
                  onClick={() => onApply(state.result)}
                  disabled={state.result === null || state.loading}
                >
                  {t('editor.ai.apply', 'Replace selection')}
                </Button>
              </>
            )}
          </Flex>
        </Modal.Footer>
      </TouchModalContent>
    </Modal.Root>
  );
};
