/**
 * Pure helpers for the custom block form. Validation mirrors `blockSchema` in
 * server/src/services/custom-blocks.js (the server stays authoritative and its
 * field errors are mapped back with `mapServerErrors`).
 */

export const FIELD_TYPES = Object.freeze([
  'text',
  'textarea',
  'url',
  'number',
  'select',
  'checkbox',
  'image',
  'color',
]);
export const TUNES = Object.freeze(['alignmentTune', 'textVariant', 'indentTune']);
export const BLOCK_TYPES = Object.freeze(['simple', 'embedded-entry']);

/** Built-in tool names (lower case), same list as the server. */
export const RESERVED_NAMES = Object.freeze(
  [
    'paragraph',
    'header',
    'list',
    'checklist',
    'quote',
    'warning',
    'code',
    'codeFlask',
    'delimiter',
    'table',
    'embed',
    'raw',
    'image',
    'simpleImage',
    'linkTool',
    'attaches',
    'personality',
    'mediaLib',
    'alert',
    'toggle',
    'button',
    'bold',
    'italic',
    'marker',
    'inlineCode',
    'underline',
    'strikethrough',
    'tooltip',
    'hyperlink',
    'aiAssistant',
    'textVariant',
    'alignmentTune',
    'indentTune',
    'embeddedEntry',
  ].map((name) => name.toLowerCase())
);

export const NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{1,49}$/;
export const FIELD_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_]{0,39}$/;
export const SHORTCUT_PATTERN = /^(CMD|CTRL|ALT|SHIFT|OPTION)(\+(CMD|CTRL|ALT|SHIFT|OPTION|[A-Z0-9]))+$/;

let keySeed = 0;
/** @returns {string} Local React key for a field row. */
const nextKey = () => {
  keySeed += 1;
  return `field-${keySeed}`;
};

/**
 * Suggests a block name from its label: "Call to action" -> "callToAction".
 * @param {string} label - Label.
 * @returns {string} Name (may be empty when the label has no letters).
 */
export const deriveName = (label) => {
  const words = String(label || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!words.length) return '';
  let name = words
    .map((word, index) =>
      index === 0 ? word.toLowerCase() : word[0].toUpperCase() + word.slice(1).toLowerCase()
    )
    .join('');
  if (!/^[a-zA-Z]/.test(name)) name = `block${name}`;
  if (name.length < 2) name = `${name}Block`;
  return name.slice(0, 50);
};

/**
 * Converts an options array into the textarea format ("value | label" per line).
 * @param {Array<string|{ value: string, label: string }>|undefined} options - Options.
 * @returns {string} Text.
 */
export const optionsToText = (options) =>
  (Array.isArray(options) ? options : [])
    .map((option) =>
      typeof option === 'string'
        ? option
        : option.label && option.label !== option.value
          ? `${option.value} | ${option.label}`
          : option.value
    )
    .join('\n');

/**
 * Parses the options textarea.
 * @param {string} text - Text.
 * @returns {Array<string|{ value: string, label: string }>} Options.
 */
export const textToOptions = (text) =>
  String(text || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const index = line.indexOf('|');
      if (index < 0) return line;
      const value = line.slice(0, index).trim();
      const label = line.slice(index + 1).trim();
      return label && label !== value ? { value, label } : value;
    });

/** @returns {object} Values of a new block. */
export const emptyValues = () => ({
  name: '',
  nameTouched: false,
  label: '',
  blockType: 'simple',
  description: '',
  icon: '',
  contentType: '',
  titleField: '',
  displayFields: [],
  previewFields: [],
  fields: [],
  template: '',
  placeholder: '',
  inlineToolbar: true,
  tunes: [],
  shortcut: '',
  enabled: true,
  sortOrder: null,
});

/** @returns {object} A new field row. */
export const emptyField = (index = 0) => ({
  key: nextKey(),
  name: `field${index + 1}`,
  label: '',
  type: 'text',
  required: false,
  placeholder: '',
  default: '',
  optionsText: '',
});

/**
 * Form values from a server DTO.
 * @param {object} dto - Block DTO.
 * @returns {object} Values.
 */
export const fromDto = (dto) => ({
  ...emptyValues(),
  name: dto.name || '',
  nameTouched: true,
  label: dto.label || '',
  blockType: BLOCK_TYPES.includes(dto.blockType) ? dto.blockType : 'simple',
  description: dto.description || '',
  icon: dto.icon || '',
  contentType: dto.contentType || '',
  titleField: dto.titleField || '',
  displayFields: Array.isArray(dto.displayFields) ? dto.displayFields : [],
  previewFields: Array.isArray(dto.previewFields) ? dto.previewFields : [],
  fields: (Array.isArray(dto.fields) ? dto.fields : []).map((field) => ({
    key: nextKey(),
    name: field.name || '',
    label: field.label || '',
    type: FIELD_TYPES.includes(field.type) ? field.type : 'text',
    required: Boolean(field.required),
    placeholder: field.placeholder || '',
    default: field.default === undefined || field.default === null ? '' : field.default,
    optionsText: optionsToText(field.options),
  })),
  template: dto.template || '',
  placeholder: dto.placeholder || '',
  inlineToolbar: dto.inlineToolbar !== false,
  tunes: Array.isArray(dto.tunes) ? dto.tunes.filter((tune) => TUNES.includes(tune)) : [],
  shortcut: dto.shortcut || '',
  enabled: dto.enabled !== false,
  sortOrder: Number.isInteger(dto.sortOrder) ? dto.sortOrder : null,
});

/**
 * Definition for the server: exactly the keys `blockSchema` accepts.
 * @param {object} values - Form values.
 * @returns {object} Definition.
 */
export const toPayload = (values) => {
  const simple = values.blockType === 'simple';
  const optional = (value) => {
    const text = String(value || '').trim();
    return text ? text : null;
  };
  const payload = {
    name: String(values.name || '').trim(),
    label: String(values.label || '').trim(),
    blockType: values.blockType,
    description: optional(values.description),
    icon: optional(values.icon),
    contentType: simple ? null : optional(values.contentType),
    titleField: simple ? null : optional(values.titleField),
    displayFields: simple ? [] : values.displayFields,
    previewFields: simple ? [] : values.previewFields,
    fields: simple
      ? values.fields.map((field) => {
          const out = {
            name: String(field.name || '').trim(),
            label: String(field.label || '').trim(),
            type: field.type,
          };
          if (field.required) out.required = true;
          if (String(field.placeholder || '').trim()) out.placeholder = String(field.placeholder).trim();
          if (field.type === 'checkbox') {
            if (field.default === true || field.default === 'true') out.default = true;
          } else if (field.type === 'number') {
            if (field.default !== '' && field.default !== null && Number.isFinite(Number(field.default)))
              out.default = Number(field.default);
          } else if (String(field.default ?? '') !== '') out.default = String(field.default);
          if (field.type === 'select') out.options = textToOptions(field.optionsText);
          return out;
        })
      : [],
    template: simple ? optional(values.template) : null,
    placeholder: optional(values.placeholder),
    inlineToolbar: Boolean(values.inlineToolbar),
    tunes: values.tunes.filter((tune) => TUNES.includes(tune)),
    shortcut: optional(values.shortcut ? String(values.shortcut).toUpperCase().replace(/\s+/g, '') : ''),
    enabled: Boolean(values.enabled),
  };
  if (Number.isInteger(values.sortOrder)) payload.sortOrder = values.sortOrder;
  return payload;
};

/**
 * Validates the form like the server does.
 * @param {object} values - Form values.
 * @param {{ existingNames?: string[] }} [context] - Names of other blocks (lower case not required).
 * @returns {Record<string, string>} Path -> error code.
 */
export const validateBlock = (values, context = {}) => {
  const errors = {};
  const name = String(values.name || '').trim();
  if (!name) errors.name = 'required';
  else if (!NAME_PATTERN.test(name)) errors.name = 'namePattern';
  else if (RESERVED_NAMES.includes(name.toLowerCase())) errors.name = 'reserved';
  else if ((context.existingNames || []).some((other) => other.toLowerCase() === name.toLowerCase()))
    errors.name = 'taken';
  const label = String(values.label || '').trim();
  if (!label) errors.label = 'required';
  else if (label.length > 100) errors.label = 'tooLong';
  if (!BLOCK_TYPES.includes(values.blockType)) errors.blockType = 'required';
  if (String(values.description || '').length > 1000) errors.description = 'tooLong';
  if (String(values.icon || '').length > 10000) errors.icon = 'tooLong';
  if (String(values.placeholder || '').length > 200) errors.placeholder = 'tooLong';
  const shortcut = String(values.shortcut || '')
    .toUpperCase()
    .replace(/\s+/g, '');
  if (shortcut && !SHORTCUT_PATTERN.test(shortcut)) errors.shortcut = 'shortcut';
  if (values.blockType === 'simple') {
    if (String(values.template || '').length > 20000) errors.template = 'tooLong';
    if (values.fields.length > 20) errors.fields = 'tooMany';
    const seen = new Set();
    values.fields.forEach((field, index) => {
      const fieldName = String(field.name || '').trim();
      if (!fieldName) errors[`fields.${index}.name`] = 'required';
      else if (!FIELD_NAME_PATTERN.test(fieldName)) errors[`fields.${index}.name`] = 'fieldName';
      else if (seen.has(fieldName)) errors[`fields.${index}.name`] = 'duplicate';
      seen.add(fieldName);
      const fieldLabel = String(field.label || '').trim();
      if (!fieldLabel) errors[`fields.${index}.label`] = 'required';
      else if (fieldLabel.length > 100) errors[`fields.${index}.label`] = 'tooLong';
      if (String(field.placeholder || '').length > 200) errors[`fields.${index}.placeholder`] = 'tooLong';
      if (String(field.default ?? '').length > 2000) errors[`fields.${index}.default`] = 'tooLong';
      if (
        field.type === 'number' &&
        field.default !== '' &&
        field.default !== null &&
        !Number.isFinite(Number(field.default))
      ) {
        errors[`fields.${index}.default`] = 'number';
      }
      if (field.type === 'select') {
        const options = textToOptions(field.optionsText);
        if (!options.length) errors[`fields.${index}.options`] = 'options';
        else if (options.length > 50) errors[`fields.${index}.options`] = 'tooMany';
        else if (
          options.some(
            (option) =>
              (typeof option === 'string' ? option : option.value).length > 100 ||
              (typeof option === 'object' && option.label.length > 100)
          )
        ) {
          errors[`fields.${index}.options`] = 'tooLong';
        }
      }
    });
  } else {
    if (values.titleField && !FIELD_NAME_PATTERN.test(values.titleField)) errors.titleField = 'fieldName';
    if (values.displayFields.length > 20) errors.displayFields = 'tooMany';
    if (values.previewFields.length > 20) errors.previewFields = 'tooMany';
  }
  return errors;
};

/**
 * Maps server `details.fieldErrors` (top-level keys of the definition) to form paths.
 * @param {unknown} details - Error details.
 * @returns {Record<string, { server: string }>} Path -> server message.
 */
export const mapServerErrors = (details) => {
  const out = {};
  const fieldErrors = details && typeof details === 'object' ? details.fieldErrors || {} : {};
  for (const [key, messages] of Object.entries(fieldErrors)) {
    const message = Array.isArray(messages) ? messages[0] : String(messages || '');
    if (message) out[key] = { server: message };
  }
  const formErrors = details && Array.isArray(details.formErrors) ? details.formErrors : [];
  if (formErrors[0]) out._form = { server: formErrors[0] };
  return out;
};

/**
 * Full definition of a stored block with `enabled` changed (for the row switch).
 * @param {object} dto - Block DTO.
 * @param {boolean} enabled - New state.
 * @returns {object} Definition.
 */
export const withEnabled = (dto, enabled) => ({ ...toPayload(fromDto(dto)), enabled });

/**
 * Moves an id one position up or down in a list of ids.
 * @param {string[]} ids - Current order.
 * @param {string} id - Id to move.
 * @param {-1|1} direction - Up (-1) or down (1).
 * @returns {string[]|null} New order, or null when the move is not possible.
 */
export const moveId = (ids, id, direction) => {
  const index = ids.indexOf(id);
  const target = index + direction;
  if (index < 0 || target < 0 || target >= ids.length) return null;
  const next = ids.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
};

/**
 * Template preview HTML: replaces {{field}} with the escaped label or default.
 * The result is sanitised by the caller before rendering.
 * @param {string} template - Template.
 * @param {Array<object>} fields - Field rows.
 * @returns {string} HTML.
 */
export const fillTemplate = (template, fields) => {
  const escape = (text) =>
    String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const values = new Map(
    fields.map((field) => [
      String(field.name),
      String(field.default ?? '') || String(field.label || field.name),
    ])
  );
  values.set('content', 'Content');
  return String(template || '').replace(/\{\{\s*([A-Za-z][A-Za-z0-9_]{0,39})\s*\}\}/g, (match, key) =>
    values.has(key) ? escape(values.get(key)) : match
  );
};
