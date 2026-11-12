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
import { useFetchClient } from '@strapi/strapi/admin';
import styled from 'styled-components';
import { API, readApiError } from '../../utils/api';
import { sanitizeInline } from '../../editor/sanitize';
import { segmentPlainText } from '../../../../shared/ai-fields.mjs';
import { applyBlockResult, blockSegments, changeViews } from '../../../../shared/ai-blocks.mjs';
import { TextOps } from './VersionDiff';

/**
 * Block-aware AI actions (2.4): rewrite, shorten, translate or change the
 * tone of one or more chosen blocks. Only the inline text strings of these
 * blocks travel (with their inline formatting and links); block ids, types,
 * tunes and every other value stay in the browser. The answer is shown as a
 * word diff and applied only after "Apply to blocks", as one undo step and
 * only while the blocks still hold the strings that were sent.
 */

const ACTION_LABELS = {
  improve: ['editor.aiBlocks.action.improve', 'Rewrite (improve writing)'],
  shorten: ['editor.aiBlocks.action.shorten', 'Make shorter'],
  translate: ['editor.aiBlocks.action.translate', 'Translate'],
  tone: ['editor.aiBlocks.action.tone', 'Change tone'],
};

const TONE_LABELS = {
  professional: ['editor.ai.tone.professional', 'Professional'],
  friendly: ['editor.ai.tone.friendly', 'Friendly'],
  casual: ['editor.ai.tone.casual', 'Casual'],
  confident: ['editor.ai.tone.confident', 'Confident'],
  formal: ['editor.ai.tone.formal', 'Formal'],
  persuasive: ['editor.ai.tone.persuasive', 'Persuasive'],
};

const ERROR_MESSAGES = {
  DISABLED: ['editor.ai.error.disabled', 'The AI assistant is turned off.'],
  NOT_CONFIGURED: ['editor.ai.error.notConfigured', 'The AI assistant is not configured yet.'],
  NO_API_KEY: ['editor.ai.error.noKey', 'The AI provider key is missing.'],
  AUTH_FAILED: ['editor.ai.error.auth', 'The AI provider rejected the key.'],
  PROVIDER_RATE_LIMIT: ['editor.ai.error.busy', 'The AI provider is busy. Try again later.'],
  TIMEOUT: ['editor.ai.error.timeout', 'The AI provider did not answer in time.'],
  REFUSED: ['editor.ai.error.refused', 'The AI provider declined this request.'],
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
}) => {
  const { post } = useFetchClient();
  const languages = (config && config.languages) || ['English'];
  const tones = (config && config.tones) || ['professional'];
  const [action, setAction] = useState('improve');
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
    if (!segments || !segments.length) return;
    if (abort.current) abort.current.abort();
    abort.current = new AbortController();
    setState({ status: 'loading', result: null, error: '' });
    try {
      const { data } = await post(
        API.aiBlocks(action),
        {
          target: { uid: target.uid, field: target.field },
          segments,
          ...(action === 'translate' ? { language } : {}),
          ...(action === 'tone' ? { tone } : {}),
        },
        { signal: abort.current.signal }
      );
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
      const info = error && error.mismatch ? { code: 'BAD_RESPONSE' } : readApiError(error);
      const [key, text] =
        ERROR_MESSAGES[info.code] ||
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
      <Modal.Content
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
                {Object.entries(ACTION_LABELS).map(([value, [key, text]]) => (
                  <Radio.Item key={value} value={value}>
                    {t(key, text)}
                  </Radio.Item>
                ))}
              </Radio.Group>
            </Field.Root>
            {action === 'translate' ? (
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
            {action === 'tone' ? (
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
              disabled={!segments || !segments.length || tooLong || state.status === 'loading'}
            >
              {result
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
      </Modal.Content>
    </Modal.Root>
  );
};

export default BlockAiDialog;
