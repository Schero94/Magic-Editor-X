import { FIELD_TYPES } from './blockForm.mjs';

/**
 * Translated text for a custom block validation code (or a server message).
 * @param {Function} t - Translate.
 * @param {string|{ server: string }|undefined} error - Error.
 * @returns {string|undefined} Message.
 */
export const blockErrorText = (t, error) => {
  if (!error) return undefined;
  if (typeof error === 'object') return error.server;
  switch (error) {
    case 'required':
      return t('settings.validation.required', 'This field is required.');
    case 'namePattern':
      return t(
        'settings.blocks.validation.name',
        'Start with a letter; use 2 to 50 letters, digits, - or _.'
      );
    case 'reserved':
      return t(
        'settings.blocks.validation.reserved',
        'This name is used by a built-in tool. Choose another one.'
      );
    case 'taken':
      return t('settings.blocks.validation.taken', 'Another block already uses this name.');
    case 'fieldName':
      return t(
        'settings.blocks.validation.fieldName',
        'Start with a letter; use up to 40 letters, digits or _.'
      );
    case 'duplicate':
      return t('settings.blocks.validation.duplicate', 'Field names must be unique.');
    case 'options':
      return t('settings.blocks.validation.options', 'A select field needs at least one option.');
    case 'number':
      return t('settings.blocks.validation.number', 'Enter a number.');
    case 'shortcut':
      return t('settings.blocks.validation.shortcut', 'Use a combination such as CMD+SHIFT+K.');
    case 'tooMany':
      return t('settings.blocks.validation.tooMany', 'Too many entries.');
    case 'tooLong':
      return t('settings.blocks.validation.tooLong', 'This text is too long.');
    default:
      return t('settings.validation.invalid', 'Check this value.');
  }
};

/**
 * Label of a field type.
 * @param {Function} t - Translate.
 * @param {string} type - Field type.
 * @returns {string} Label.
 */
export const fieldTypeLabel = (t, type) =>
  ({
    text: t('settings.blocks.fieldType.text', 'Text'),
    textarea: t('settings.blocks.fieldType.textarea', 'Long text'),
    url: t('settings.blocks.fieldType.url', 'Link (URL)'),
    number: t('settings.blocks.fieldType.number', 'Number'),
    select: t('settings.blocks.fieldType.select', 'Choice list'),
    checkbox: t('settings.blocks.fieldType.checkbox', 'Checkbox'),
    image: t('settings.blocks.fieldType.image', 'Image (Media Library)'),
    color: t('settings.blocks.fieldType.color', 'Colour'),
  })[type] || type;

/**
 * Label of a block type.
 * @param {Function} t - Translate.
 * @param {string} type - Block type.
 * @returns {string} Label.
 */
export const blockTypeLabel = (t, type) =>
  type === 'embedded-entry'
    ? t('settings.blocks.type.embedded', 'Embedded entry')
    : t('settings.blocks.type.simple', 'Simple block');

export { FIELD_TYPES };
