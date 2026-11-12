import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  Grid,
  SingleSelect,
  SingleSelectOption,
  TextButton,
  TextInput,
  Typography,
} from '@strapi/design-system';
import { useT, SectionCard } from '../../components/ui';
import { errorText, SwitchRow } from './AiSection';

/**
 * Host of a base URL for the disclosure text.
 * @param {Function} t - Translate.
 * @param {string} baseUrl - Base URL.
 * @returns {string} Host or a generic name.
 */
const hostOf = (t, baseUrl) => {
  try {
    return new URL(baseUrl).host || t('settings.languageTool.server', 'the LanguageTool server');
  } catch {
    return t('settings.languageTool.server', 'the LanguageTool server');
  }
};

/**
 * Grammar check (LanguageTool) settings section (2.3).
 * @param {object} props - Props.
 * @param {object} props.form - useConfigurationForm() result.
 * @param {boolean} props.readOnly - True without settings.update.
 * @param {() => void} props.onTest - Runs the connection test.
 * @returns {JSX.Element|null} Section, or null when the server has no LanguageTool settings.
 */
export const LanguageToolSection = ({ form, readOnly, onTest }) => {
  const t = useT();
  const { draft, dto, errors, setLanguageToolField, replaceDraft, testingLanguageTool } = form;
  const lt = draft.languageTool;
  const stored = dto.languageTool;
  if (!lt || !stored) return null;
  const environment = dto.environment.languageTool || { allowPrivateBaseUrl: false, requestsPerMinute: 30 };
  const setKeyMode = (apiKeyMode, apiKey = '') =>
    replaceDraft({ ...draft, languageTool: { ...lt, apiKeyMode, apiKey } });
  const err = (name) => errorText(t, errors[`languageTool.${name}`], name);

  let keyTone = { backgroundColor: 'neutral150', textColor: 'neutral700' };
  let keyLabel = t('settings.ai.key.status.none', 'No key stored');
  if (lt.apiKeyMode === 'remove') {
    keyTone = { backgroundColor: 'warning200', textColor: 'neutral800' };
    keyLabel = t('settings.ai.key.status.removing', 'Removed when you save');
  } else if (stored.apiKeyUnreadable) {
    keyTone = { backgroundColor: 'warning200', textColor: 'neutral800' };
    keyLabel = t('settings.ai.key.status.unreadable', 'Stored key unreadable');
  } else if (stored.hasApiKey) {
    keyTone = { backgroundColor: 'success100', textColor: 'success700' };
    keyLabel = t('settings.ai.key.status.stored', 'Stored, encrypted');
  }

  return (
    <SectionCard
      title={t('settings.languageTool.title', 'Grammar check (LanguageTool)')}
      subtitle={t(
        'settings.languageTool.subtitle',
        'Editors can check spelling and grammar of a field with a LanguageTool server: your own (self-hosted) or a hosted service. It is off until you turn it on.'
      )}
      action={
        <Button
          variant="secondary"
          onClick={onTest}
          loading={testingLanguageTool}
          disabled={testingLanguageTool}
        >
          {t('settings.languageTool.test', 'Test LanguageTool')}
        </Button>
      }
    >
      <SwitchRow
        id="mex-lt-enabled"
        t={t}
        label={t('settings.languageTool.enabled.label', 'Turn on the grammar check')}
        hint={t(
          'settings.languageTool.enabled.privacy',
          'When an editor checks a field, the plain text of every block in it is sent to {host}. Nothing is sent while the check is off or until an editor starts a check.',
          { host: hostOf(t, lt.baseUrl) }
        )}
        checked={lt.enabled}
        disabled={readOnly}
        onChange={(checked) => setLanguageToolField('enabled', checked)}
      />
      <Grid.Root gap={{ initial: 4, medium: 5 }}>
        <Grid.Item col={12} direction="column" alignItems="stretch" minWidth={0}>
          <Field.Root
            name="languageTool.baseUrl"
            error={err('baseUrl')}
            hint={t(
              'settings.languageTool.baseUrl.hint',
              'For example https://languagetool.example.com. Requests go to the base URL followed by /v2/check.'
            )}
            required={lt.enabled}
          >
            <Field.Label>{t('settings.languageTool.baseUrl.label', 'LanguageTool base URL')}</Field.Label>
            <TextInput
              type="url"
              value={lt.baseUrl}
              disabled={readOnly}
              placeholder="https://"
              onChange={(event) => setLanguageToolField('baseUrl', event.target.value)}
            />
            <Field.Hint />
            <Field.Error />
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={6} xs={12} s={12} m={6} direction="column" alignItems="stretch" minWidth={0}>
          <Field.Root
            name="languageTool.username"
            error={err('username')}
            hint={t(
              'settings.languageTool.username.hint',
              'Only for hosted accounts that need a user name and API key. Leave empty for your own server.'
            )}
          >
            <Field.Label>{t('settings.languageTool.username.label', 'User name (optional)')}</Field.Label>
            <TextInput
              value={lt.username}
              disabled={readOnly}
              autoComplete="off"
              onChange={(event) => setLanguageToolField('username', event.target.value)}
            />
            <Field.Hint />
            <Field.Error />
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={6} xs={12} s={12} m={6} direction="column" alignItems="stretch" minWidth={0}>
          <Field.Root
            name="languageTool.level"
            hint={t('settings.languageTool.level.hint', 'Strict adds style rules for formal text.')}
          >
            <Field.Label>{t('settings.languageTool.level.label', 'Rules')}</Field.Label>
            <SingleSelect
              value={lt.level}
              disabled={readOnly}
              onChange={(value) => setLanguageToolField('level', String(value))}
            >
              <SingleSelectOption value="default">
                {t('settings.languageTool.level.default', 'Standard')}
              </SingleSelectOption>
              <SingleSelectOption value="picky">
                {t('settings.languageTool.level.picky', 'Strict')}
              </SingleSelectOption>
            </SingleSelect>
            <Field.Hint />
          </Field.Root>
        </Grid.Item>
        <Grid.Item col={12} direction="column" alignItems="stretch" minWidth={0}>
          <Field.Root
            name="languageTool.apiKey"
            error={err('apiKey')}
            hint={
              stored.canStoreApiKey
                ? t(
                    'settings.ai.key.hint',
                    'Leave empty to keep the stored key. The key is never shown again after saving.'
                  )
                : t(
                    'settings.languageTool.key.cannotStoreHint',
                    'Set MAGIC_EDITOR_X_ENCRYPTION_KEY (at least 32 characters) on the server to store a key.'
                  )
            }
          >
            <Field.Label>{t('settings.languageTool.key.label', 'API key (optional)')}</Field.Label>
            <Flex direction="column" alignItems="stretch" gap={2}>
              <Flex>
                <Badge {...keyTone}>{keyLabel}</Badge>
              </Flex>
              <TextInput
                type="password"
                autoComplete="new-password"
                value={lt.apiKeyMode === 'replace' ? lt.apiKey : ''}
                disabled={readOnly || !stored.canStoreApiKey || lt.apiKeyMode === 'remove'}
                placeholder={t('settings.ai.key.placeholder', 'Enter a new key')}
                onChange={(event) => {
                  const value = event.target.value;
                  setKeyMode(value ? 'replace' : 'keep', value);
                }}
              />
            </Flex>
            <Field.Hint />
            <Field.Error />
          </Field.Root>
          {!readOnly && stored.hasApiKey ? (
            <Box paddingTop={2}>
              {lt.apiKeyMode === 'remove' ? (
                <TextButton onClick={() => setKeyMode('keep')}>
                  {t('settings.ai.key.keep', 'Keep the stored key')}
                </TextButton>
              ) : (
                <TextButton onClick={() => setKeyMode('remove')}>
                  {t('settings.ai.key.remove', 'Remove the stored key')}
                </TextButton>
              )}
            </Box>
          ) : null}
        </Grid.Item>
      </Grid.Root>
      <Typography variant="pi" textColor="neutral600">
        {t(
          'settings.languageTool.rbacHint',
          'Only roles with the "Use the grammar check (LanguageTool)" permission see the check. Checks per editor are limited to {count} per minute. Private or http servers need languageTool.allowPrivateBaseUrl in config/plugins.js ({state}).',
          {
            count: environment.requestsPerMinute,
            state: environment.allowPrivateBaseUrl
              ? t('settings.languageTool.private.on', 'allowed')
              : t('settings.languageTool.private.off', 'not allowed'),
          }
        )}
      </Typography>
    </SectionCard>
  );
};

export default LanguageToolSection;
