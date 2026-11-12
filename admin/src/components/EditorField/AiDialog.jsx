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
import { useFetchClient } from '@strapi/strapi/admin';
import { API, readApiError } from '../../utils/api';
import { diffText } from '../../../../shared/diff.mjs';
import { TextOps } from './VersionDiff';

/**
 * AI assistant dialog: the admin picks an action for the selected text, the
 * server asks the configured provider and the suggestion can replace the
 * selection. Nothing changes until "Replace" is chosen. The selection is sent
 * with its inline formatting and links, and the suggestion keeps them (2.4:
 * shown as a word diff; the server allows only the field preset's inline
 * tags and no new link targets).
 */

const ACTION_LABELS = {
  improve: ['editor.ai.action.improve', 'Improve writing'],
  grammar: ['editor.ai.action.grammar', 'Fix spelling and grammar'],
  shorten: ['editor.ai.action.shorten', 'Make shorter'],
  expand: ['editor.ai.action.expand', 'Make longer'],
  summarize: ['editor.ai.action.summarize', 'Summarize'],
  simplify: ['editor.ai.action.simplify', 'Simplify'],
  translate: ['editor.ai.action.translate', 'Translate'],
  tone: ['editor.ai.action.tone', 'Change tone'],
  continue: ['editor.ai.action.continue', 'Continue writing'],
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
 * @returns {JSX.Element} Modal.
 */
export const AiDialog = ({ t, request, config, target, onApply, onClose }) => {
  const { post } = useFetchClient();
  const actions = (config && config.actions) || Object.keys(ACTION_LABELS);
  const [action, setAction] = useState(actions[0] || 'improve');
  const [language, setLanguage] = useState((config && config.languages && config.languages[0]) || 'English');
  const [tone, setTone] = useState((config && config.tones && config.tones[0]) || 'professional');
  const [state, setState] = useState({ loading: false, result: null, error: null });
  const abort = useRef(null);
  const original = useMemo(() => request.html || request.text || '', [request]);
  const originalText = useMemo(() => toText(original), [original]);
  const tooLong = config && originalText.length > config.maxInputChars;

  useEffect(() => () => abort.current && abort.current.abort(), []);

  const run = async () => {
    if (abort.current) abort.current.abort();
    abort.current = new AbortController();
    setState({ loading: true, result: null, error: null });
    try {
      const { data } = await post(
        API.ai(action),
        {
          text: original,
          target,
          ...(action === 'translate' ? { language } : {}),
          ...(action === 'tone' ? { tone } : {}),
        },
        { signal: abort.current.signal }
      );
      setState({ loading: false, result: data.data.text, error: null });
    } catch (error) {
      if (abort.current && abort.current.signal.aborted) return;
      const info = readApiError(error);
      const [key, text] =
        ERROR_MESSAGES[info.code] ||
        (info.status === 429
          ? ['editor.ai.error.rateLimit', 'You sent many requests. Try again in a minute.']
          : info.status === 413
            ? ['editor.ai.error.tooLong', 'The selected text is too long for the assistant.']
            : ['editor.ai.error.generic', 'The AI assistant is not available right now.']);
      setState({ loading: false, result: null, error: t(key, text) });
    }
  };

  return (
    <Modal.Root open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
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
              <SingleSelect value={action} onChange={(next) => setAction(String(next))}>
                {actions.map((name) => (
                  <SingleSelectOption key={name} value={name}>
                    {ACTION_LABELS[name] ? t(ACTION_LABELS[name][0], ACTION_LABELS[name][1]) : name}
                  </SingleSelectOption>
                ))}
              </SingleSelect>
            </Field.Root>
            {action === 'translate' ? (
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
            {action === 'tone' ? (
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
            <Typography variant="pi" textColor="neutral600">
              {t(
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
                  <TextOps ops={diffText(originalText, toText(state.result))} t={t} />
                </Box>
              </Box>
            ) : null}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('editor.ai.cancel', 'Cancel')}</Button>
          </Modal.Close>
          <Flex gap={2}>
            <Button
              variant="secondary"
              onClick={run}
              loading={state.loading}
              disabled={!originalText || tooLong}
            >
              {state.result !== null
                ? t('editor.ai.retry', 'Try again')
                : t('editor.ai.generate', 'Generate')}
            </Button>
            <Button onClick={() => onApply(state.result)} disabled={state.result === null || state.loading}>
              {t('editor.ai.apply', 'Replace selection')}
            </Button>
          </Flex>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};
