import { Flex, Switch, Typography } from '@strapi/design-system';
import { LIMITS } from './configForm.mjs';

/**
 * Form parts shared by the Configuration page sections (2.9: moved out of AiSection so the
 * AI actions editor can use them without an import cycle; AiSection re-exports them).
 */

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
    case 'httpsLanguageTool':
      return t(
        'settings.languageTool.validation.https',
        'Use an https URL. Private or http hosts need languageTool.allowPrivateBaseUrl in config/plugins.js.'
      );
    case 'reenterLanguageTool':
      return t(
        'settings.languageTool.validation.reenterKey',
        'Enter the API key again when you change the base URL or user name.'
      );
    // 2.9: owner-defined AI actions and the style guide.
    case 'tooLongText':
      return t('settings.validation.tooLongText', 'This text is too long.');
    case 'actionKey':
      return t(
        'settings.ai.actions.validation.key',
        'Use 2 to 40 lower-case letters, digits and hyphens, starting with a letter.'
      );
    case 'reservedKey':
      return t(
        'settings.ai.actions.validation.reserved',
        'A built-in AI action uses this key. Choose another one.'
      );
    case 'takenKey':
      return t('settings.ai.actions.validation.taken', 'Another action uses this key.');
    case 'tooMany':
      return t('settings.ai.actions.validation.tooMany', 'Remove actions until there are at most 10.');
    case 'invalid':
      return t('settings.validation.invalid', 'Check this value.');
    default:
      return t('settings.validation.invalid', 'Check this value.');
  }
};

/**
 * One labelled switch with its disclosure text (2.3 owner switches).
 * @param {{ id: string, label: string, hint: string, checked: boolean, disabled: boolean, onChange: (checked: boolean) => void, t: Function }} props - Props.
 * @returns {JSX.Element} Row.
 */
export const SwitchRow = ({ id, label, hint, checked, disabled, onChange, t }) => (
  <Flex gap={4} alignItems="flex-start" justifyContent="space-between" minWidth={0}>
    <Flex direction="column" alignItems="flex-start" gap={1} minWidth={0} flex="1 1 auto">
      <Typography variant="omega" fontWeight="bold" textColor="neutral800" id={`${id}-label`}>
        {label}
      </Typography>
      <Typography variant="pi" textColor="neutral600" id={`${id}-hint`}>
        {hint}
      </Typography>
    </Flex>
    <Switch
      checked={checked}
      onCheckedChange={(next) => onChange(next === true)}
      disabled={disabled}
      aria-labelledby={`${id}-label`}
      aria-describedby={`${id}-hint`}
      onLabel={t('settings.switch.on', 'On')}
      offLabel={t('settings.switch.off', 'Off')}
      visibleLabels
    />
  </Flex>
);
