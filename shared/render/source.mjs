/**
 * Block source attributes (2.6): opt-in render option `blockIds` that marks
 * every top-level block element with the Editor.js block id
 * (`data-mex-block-id`), the field path (`data-mex-field-path`) and, for Strapi's
 * preview, a `data-strapi-source` value. A front end (or Strapi's preview
 * highlighting) can then map a rendered block back to its field and block.
 *
 * Every value is validated against a strict pattern; an invalid id, path or
 * source part leaves that attribute out (never an error). Off by default, so
 * existing output does not change.
 *
 * Pure ESM without dependencies (part of the renderer core).
 */

/** Editor.js block ids the attribute accepts (same rule as heading anchors). */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * Content Manager field paths: attribute names separated by dots, with
 * numeric indices for repeatable components and dynamic zones
 * (`body`, `seo.body`, `sections.2.body`). At most 20 segments, 300 characters.
 */
export const FIELD_PATH_PATTERN =
  /^[A-Za-z_][A-Za-z0-9_]{0,99}(?:\.(?:\d{1,6}|[A-Za-z_][A-Za-z0-9_]{0,99})){0,19}$/;

const MAX_PATH_LENGTH = 300;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;
const MODEL_PATTERN = /^(?:api|plugin)::[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9_-]{1,80}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/;
const KINDS = new Set(['collectionType', 'singleType']);

/**
 * True for a block id the renderer writes into `data-mex-block-id`.
 * @param {unknown} id - Candidate.
 * @returns {boolean} Result.
 */
export const isBlockId = (id) => typeof id === 'string' && BLOCK_ID_PATTERN.test(id);

/**
 * True for a field path the renderer writes into `data-mex-field-path`.
 * @param {unknown} path - Candidate.
 * @returns {boolean} Result.
 */
export const isFieldPath = (path) =>
  typeof path === 'string' && path.length <= MAX_PATH_LENGTH && FIELD_PATH_PATTERN.test(path);

/**
 * `data-strapi-source` value for a Magic Editor X field: URL search params
 * in the order Strapi's content source maps use, with `type=json` and the
 * field in `fieldPath`. There is deliberately no `path` key: Strapi 5.62's
 * preview script replaces the text of every element whose source contains
 * `path=<field>` when a non-Blocks field changes (`strapiFieldChange`), which
 * would overwrite the rendered blocks with "[object Object]". With
 * `fieldPath` only, the script groups the blocks into one highlight and maps a
 * double-click to the field (`path` = `fieldPath`), and leaves the DOM alone.
 * @param {{ documentId?: unknown, model?: unknown, kind?: unknown, locale?: unknown }} source - Entry of the field.
 * @param {string} field - Valid field path.
 * @returns {string|null} Attribute value, or null when documentId or model are invalid.
 */
export const strapiSourceValue = (source, field) => {
  if (!source || typeof source !== 'object' || !isFieldPath(field)) return null;
  const { documentId, model, kind, locale } = source;
  if (typeof documentId !== 'string' || !DOCUMENT_ID_PATTERN.test(documentId)) return null;
  if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) return null;
  const parts = [
    ['documentId', documentId],
    ['type', 'json'],
    ['model', model],
  ];
  if (typeof kind === 'string' && KINDS.has(kind)) parts.push(['kind', kind]);
  if (typeof locale === 'string' && LOCALE_PATTERN.test(locale)) parts.push(['locale', locale]);
  parts.push(['fieldPath', field]);
  return parts.map(([key, value]) => `${key}=${encodeURIComponent(value)}`).join('&');
};

/**
 * Normalises the `blockIds` render option.
 * @param {unknown} option - `true`, or `{ field?, strapiSource? }`.
 * @returns {{ field: string|null, source: string|null }|null} Attributes to add, or null (off).
 */
export const blockIdOptions = (option) => {
  if (option === true) return { field: null, source: null };
  if (!option || typeof option !== 'object' || Array.isArray(option)) return null;
  const field = isFieldPath(option.field) ? option.field : null;
  const source = field ? strapiSourceValue(option.strapiSource, field) : null;
  return { field, source };
};

/**
 * Adds the source attributes to the element nodes of every top-level block
 * wrapper (`{ type: 'block' }`). Elements are copied, never changed in place;
 * raw HTML from string overrides cannot carry attributes and stays as it is.
 * @param {Array<object>} nodes - Top-level nodes of the tree builder.
 * @param {{ field: string|null, source: string|null }|null} settings - From `blockIdOptions`.
 * @returns {Array<object>} Nodes (the same array when off).
 */
export const annotateBlockSources = (nodes, settings) => {
  if (!settings) return nodes;
  return nodes.map((node) => {
    if (!node || node.type !== 'block') return node;
    /** @type {Record<string, string>} */
    const extra = {};
    const id = node.block && node.block.id;
    if (isBlockId(id)) extra['data-mex-block-id'] = id;
    if (settings.field) extra['data-mex-field-path'] = settings.field;
    if (settings.source) extra['data-strapi-source'] = settings.source;
    if (!Object.keys(extra).length) return node;
    return {
      ...node,
      children: node.children.map((child) =>
        child && child.type === 'element' ? { ...child, attrs: { ...child.attrs, ...extra } } : child
      ),
    };
  });
};
