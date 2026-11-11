import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Grid,
  NumberInput,
  SingleSelect,
  SingleSelectOption,
  Switch,
  TextButton,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { useT, SectionCard } from '../../components/ui';
import { LIMITS, applyProvider } from './configForm.mjs';

/**
 * Translates a field error code (or a server message) for display.
 * @param {Function} t - Translate function.
 * @param {string|{ server: string }|undefined} error - Error code.
 * @param {string} field - Field name (for ranges).
 * @returns {string|undefined} Message.
 */
export const errorText = (t, error, field) => {
  if (!error) return undefined;
  if (typeof error === 'object') return error.server;
  switch (error) {
    case 'required':
      return t('settings.validation.required', 'This field is required.');
    case 'modelPattern':
      return t(
        'settings.validation.model',
        'Use letters, digits and the characters . _ : / @ - (up to 120 characters).'
      );
    case 'url':
      return t('settings.validation.url', 'Enter a valid http or https URL without user name or password.');
    case 'https':
      return t(
        'settings.validation.https',
        'Use an https URL. Private or http hosts need ai.allowPrivateBaseUrl in config/plugins.js.'
      );
    case 'range':
      return t('settings.validation.range', 'Enter a whole number from {min} to {max}.', LIMITS[field] || {});
    case 'reenter':
      return t(
        'settings.validation.reenterKey',
        'Enter the API key again when you change the provider or base URL.'
      );
    case 'cannotStore':
      return t('settings.validation.cannotStore', 'Set MAGIC_EDITOR_X_ENCRYPTION_KEY to store an API key.');
    case 'tooLong':
      return t('settings.validation.keyTooLong', 'The API key is too long.');
    default:
      return t('settings.validation.invalid', 'Check this value.');
  }
};

/**
 * Display name of a provider for the privacy disclosure.
 * @param {Function} t - Translate.
 * @param {object} draft - Draft.
 * @returns {string} Name.
 */
const providerName = (t, draft) => {
  if (draft.provider === 'anthropic') return t('settings.ai.provider.anthropic.name', 'Anthropic');
  if (draft.provider === 'openai') return t('settings.ai.provider.openai.name', 'OpenAI');
  const host = (() => {
    try {
      return draft.baseUrl ? new URL(draft.baseUrl).host : '';
    } catch {
      return '';
    }
  })();
  return host || t('settings.ai.provider.compatible.name', 'the server at the base URL');
};

/**
 * Status of the stored provider key.
 * @param {{ ai: object, draft: object, t: Function }} props - Props.
 * @returns {JSX.Element} Badge and explanation.
 */
const KeyStatus = ({ ai, draft, t }) => {
  let tone = { backgroundColor: 'neutral150', textColor: 'neutral700' };
  let label = t('settings.ai.key.status.none', 'No key stored');
  let text = '';
  if (ai.apiKeyFromEnvironment) {
    tone = { backgroundColor: 'success100', textColor: 'success700' };
    label = t('settings.ai.key.status.environment', 'From the environment');
    text = t(
      'settings.ai.key.environmentHint',
      'The ai.apiKey setting in config/plugins.js is used and overrides a stored key.'
    );
  } else if (draft.apiKeyMode === 'remove') {
    tone = { backgroundColor: 'warning200', textColor: 'neutral800' };
    label = t('settings.ai.key.status.removing', 'Removed when you save');
  } else if (ai.apiKeyUnreadable) {
    tone = { backgroundColor: 'warning200', textColor: 'neutral800' };
    label = t('settings.ai.key.status.unreadable', 'Stored key unreadable');
    text = t(
      'settings.ai.key.unreadableHint',
      'A key is stored but cannot be decrypted, usually because MAGIC_EDITOR_X_ENCRYPTION_KEY changed. Enter the key again.'
    );
  } else if (ai.hasApiKey) {
    tone = { backgroundColor: 'success100', textColor: 'success700' };
    label = t('settings.ai.key.status.stored', 'Stored, encrypted');
  }
  return (
    <Flex direction="column" alignItems="flex-start" gap={1}>
      <Badge {...tone}>{label}</Badge>
      {text ? (
        <Typography variant="pi" textColor="neutral600">
          {text}
        </Typography>
      ) : null}
    </Flex>
  );
};

/**
 * AI assistant settings section.
 * @param {object} props - Props.
 * @param {object} props.form - useConfigurationForm() result.
 * @param {boolean} props.readOnly - True without settings.update.
 * @param {() => void} props.onTest - Runs the connection test.
 * @returns {JSX.Element} Section.
 */
export const AiSection = ({ form, readOnly, onTest }) => {
  const t = useT();
  const { draft, dto, errors, setField, replaceDraft, testing } = form;
  const ai = dto.ai;
  const defaults = dto.environment.defaults || { models: {}, baseUrls: {} };
  const keyDisabled = readOnly || ai.apiKeyFromEnvironment || !ai.canStoreApiKey;

  return (
    <SectionCard
      title={t('settings.ai.title', 'AI assistant')}
      subtitle={t(
        'settings.ai.subtitle',
        'Editors can improve, shorten, translate or continue selected text with your own AI provider. It is off until you turn it on.'
      )}
      action={
        <Button variant="secondary" onClick={onTest} loading={testing} disabled={testing}>
          {t('settings.ai.test', 'Test connection')}
        </Button>
      }
    >
      <Flex gap={4} alignItems="flex-start" justifyContent="space-between" minWidth={0}>
        <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0} flex="1 1 auto">
          <Typography variant="omega" fontWeight="bold" textColor="neutral800" id="mex-ai-enabled-label">
            {t('settings.ai.enabled.label', 'Turn on the AI assistant')}
          </Typography>
          <Typography variant="pi" textColor="neutral600" id="mex-ai-enabled-hint">
            {t(
              'settings.ai.enabled.privacy',
              'When an editor runs an AI action, the selected text is sent to {provider}. Nothing is sent while the assistant is off.',
              { provider: providerName(t, draft) }
            )}
          </Typography>
        </Flex>
        <Switch
          checked={draft.enabled}
          onCheckedChange={(checked) => setField('enabled', checked === true)}
          disabled={readOnly}
          aria-labelledby="mex-ai-enabled-label"
          aria-describedby="mex-ai-enabled-hint"
          onLabel={t('settings.switch.on', 'On')}
          offLabel={t('settings.switch.off', 'Off')}
          visibleLabels
        />
      </Flex>

      <Grid.Root gap={{ initial: 4, medium: 5 }}>
        <Grid.Item col={6} xs={12} s={12} m={12} direction="column" alignItems="stretch" minWidth={0}>
          <Field.Root name="provider" error={errorText(t, errors.provider, 'provider')} required>
            <Field.Label>{t('settings.ai.provider.label', 'Provider')}</Field.Label>
            <SingleSelect
              value={draft.provider}
              disabled={readOnly}
              onChange={(value) => replaceDraft(applyProvider(draft, String(value), defaults.models))}
            >
              <SingleSelectOption value="anthropic">
                {t('settings.ai.provider.anthropic', 'Anthropic (Messages API)')}
              </SingleSelectOption>
              <SingleSelectOption value="openai">
                {t('settings.ai.provider.openai', 'OpenAI (Chat Completions)')}
              </SingleSelectOption>
              <SingleSelectOption value="openai-compatible">
                {t('settings.ai.provider.compatible', 'OpenAI-compatible server (for example a local model)')}
              </SingleSelectOption>
            </SingleSelect>
            <Field.Error />
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={6} xs={12} s={12} m={12} direction="column" alignItems="stretch" minWidth={0}>
          <Field.Root
            name="model"
            error={errorText(t, errors.model, 'model')}
            hint={
              defaults.models[draft.provider]
                ? t('settings.ai.model.hint', 'Default: {model}', { model: defaults.models[draft.provider] })
                : t('settings.ai.model.hintCompatible', 'Use the model name your server expects.')
            }
            required
          >
            <Field.Label>{t('settings.ai.model.label', 'Model')}</Field.Label>
            <TextInput
              value={draft.model}
              disabled={readOnly}
              onChange={(event) => setField('model', event.target.value)}
            />
            <Field.Hint />
            <Field.Error />
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={12} direction="column" alignItems="stretch" minWidth={0}>
          <Field.Root
            name="baseUrl"
            error={errorText(t, errors.baseUrl, 'baseUrl')}
            hint={
              defaults.baseUrls[draft.provider]
                ? t('settings.ai.baseUrl.hint', 'Leave empty to use {url}.', {
                    url: defaults.baseUrls[draft.provider],
                  })
                : t(
                    'settings.ai.baseUrl.hintCompatible',
                    'Required. Requests go to the base URL followed by /v1/chat/completions.'
                  )
            }
            required={draft.provider === 'openai-compatible'}
          >
            <Field.Label>{t('settings.ai.baseUrl.label', 'Base URL')}</Field.Label>
            <TextInput
              type="url"
              value={draft.baseUrl}
              disabled={readOnly}
              placeholder={defaults.baseUrls[draft.provider] || 'https://'}
              onChange={(event) => setField('baseUrl', event.target.value)}
            />
            <Field.Hint />
            <Field.Error />
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={12} direction="column" alignItems="stretch" minWidth={0}>
          <Field.Root
            name="apiKey"
            error={errorText(t, errors.apiKey, 'apiKey')}
            hint={
              !ai.canStoreApiKey && !ai.apiKeyFromEnvironment
                ? t(
                    'settings.ai.key.cannotStoreHint',
                    'Set MAGIC_EDITOR_X_ENCRYPTION_KEY (at least 32 characters) on the server to store a key here, or pass ai.apiKey in config/plugins.js.'
                  )
                : t(
                    'settings.ai.key.hint',
                    'Leave empty to keep the stored key. The key is never shown again after saving.'
                  )
            }
          >
            <Field.Label>{t('settings.ai.key.label', 'API key')}</Field.Label>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <KeyStatus ai={ai} draft={draft} t={t} />
              <TextInput
                type="password"
                autoComplete="new-password"
                value={draft.apiKeyMode === 'replace' ? draft.apiKey : ''}
                disabled={keyDisabled || draft.apiKeyMode === 'remove'}
                placeholder={t('settings.ai.key.placeholder', 'Enter a new key')}
                onChange={(event) => {
                  const value = event.target.value;
                  replaceDraft({ ...draft, apiKey: value, apiKeyMode: value ? 'replace' : 'keep' });
                }}
              />
            </Flex>
            <Field.Hint />
            <Field.Error />
          </Field.Root>
          {!readOnly && ai.hasApiKey && !ai.apiKeyFromEnvironment ? (
            <Box paddingTop={2}>
              {draft.apiKeyMode === 'remove' ? (
                <TextButton onClick={() => replaceDraft({ ...draft, apiKeyMode: 'keep', apiKey: '' })}>
                  {t('settings.ai.key.keep', 'Keep the stored key')}
                </TextButton>
              ) : (
                <TextButton onClick={() => replaceDraft({ ...draft, apiKeyMode: 'remove', apiKey: '' })}>
                  {t('settings.ai.key.remove', 'Remove the stored key')}
                </TextButton>
              )}
            </Box>
          ) : null}
        </Grid.Item>
        <Grid.Item col={6} xs={12} s={12} m={6} direction="column" alignItems="stretch" minWidth={0}>
          <Field.Root
            name="maxInputChars"
            error={errorText(t, errors.maxInputChars, 'maxInputChars')}
            hint={t(
              'settings.ai.maxInput.hint',
              'Longer selections are refused. Allowed: {min} to {max} characters.',
              LIMITS.maxInputChars
            )}
            required
          >
            <Field.Label>{t('settings.ai.maxInput.label', 'Maximum text length')}</Field.Label>
            <NumberInput
              value={draft.maxInputChars ?? null}
              disabled={readOnly}
              onValueChange={(value) => setField('maxInputChars', value ?? null)}
            />
            <Field.Hint />
            <Field.Error />
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={6} xs={12} s={12} m={6} direction="column" alignItems="stretch" minWidth={0}>
          <Field.Root
            name="maxOutputTokens"
            error={errorText(t, errors.maxOutputTokens, 'maxOutputTokens')}
            hint={t(
              'settings.ai.maxOutput.hint',
              'Upper limit for one answer. Allowed: {min} to {max} tokens.',
              LIMITS.maxOutputTokens
            )}
            required
          >
            <Field.Label>{t('settings.ai.maxOutput.label', 'Maximum answer length (tokens)')}</Field.Label>
            <NumberInput
              value={draft.maxOutputTokens ?? null}
              disabled={readOnly}
              onValueChange={(value) => setField('maxOutputTokens', value ?? null)}
            />
            <Field.Hint />
            <Field.Error />
          </Field.Root>
        </Grid.Item>
      </Grid.Root>
      <Typography variant="pi" textColor="neutral600">
        {t(
          'settings.ai.rbacHint',
          'Only roles with the "Use the AI assistant" permission see the assistant. Requests per editor are limited to {count} per minute.',
          { count: dto.environment.requestsPerMinute }
        )}
      </Typography>
    </SectionCard>
  );
};

export default AiSection;
