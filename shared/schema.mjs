/**
 * JSON Schema (draft 2020-12) of a stored Magic Editor X value.
 *
 * It mirrors `BLOCK_POLICIES` in `sanitize-policy.mjs`: every key the policy
 * writes is described here, and `tests/schema.test.mjs` fails when the two
 * drift apart. `scripts/build-schema.mjs` writes the published file
 * `schema/magic-editor-x.schema.json` from `buildEditorSchema()`.
 */

import { BUILT_IN_MARKER, MARKED_BLOCKS } from './sanitize-policy.mjs';

export const SCHEMA_ID = 'https://schero94.github.io/Magic-Editor-X/schema/magic-editor-x.schema.json';

const str = (maxLength) => (maxLength ? { type: 'string', maxLength } : { type: 'string' });
const html = { $ref: '#/$defs/inlineHtml' };
const url = { $ref: '#/$defs/url' };
const bool = { type: 'boolean' };
const int = (minimum, maximum) => ({ type: 'integer', minimum, maximum });
const enumOf = (...values) => ({ type: 'string', enum: values });
const COUNTER_TYPES = ['numeric', 'lower-roman', 'upper-roman', 'lower-alpha', 'upper-alpha'];
const focalPoint = { $ref: '#/$defs/focalPoint' };
const marker = {
  type: 'integer',
  minimum: 1,
  description:
    'Built-in block marker (2.3: 1). Tells the built-in block apart from a custom block created before 2.3 under the same name.',
};
const JSON_TYPES = { array: 'array', object: 'object', string: 'string' };

/**
 * `if` condition of a `MARKED_BLOCKS` type: the marker, or exactly the built-in
 * shape (only its keys, the anchor key with its type). Mirrors `isBuiltInBlock`.
 * @param {string} type - Block type.
 * @returns {object} Schema of the block.
 */
const markedCondition = (type) => {
  const { keys, anchor } = MARKED_BLOCKS[type];
  const shape = {
    properties: Object.fromEntries(
      keys.map((key) => [key, anchor && anchor[0] === key ? { type: JSON_TYPES[anchor[1]] } : {}])
    ),
    additionalProperties: false,
    ...(anchor ? { required: [anchor[0]] } : {}),
  };
  return {
    properties: {
      type: { const: type },
      data: {
        type: 'object',
        anyOf: [{ required: [BUILT_IN_MARKER], properties: { [BUILT_IN_MARKER]: marker } }, shape],
      },
    },
    required: ['type', 'data'],
  };
};

/**
 * Closed object schema.
 * @param {Record<string, object>} properties - Properties.
 * @param {string[]} [required] - Required keys.
 * @param {string} [description] - Description.
 * @returns {object} Schema.
 */
const obj = (properties, required = [], description) => ({
  type: 'object',
  ...(description ? { description } : {}),
  properties,
  ...(required.length ? { required } : {}),
  additionalProperties: false,
});

/**
 * Data schema per built-in block type. Keys equal `BLOCK_POLICIES`.
 * Required keys are those the policy always writes.
 */
export const BLOCK_DATA_SCHEMAS = Object.freeze({
  paragraph: obj({ text: html }, ['text']),
  header: obj({ text: html, level: int(1, 6) }, ['text', 'level']),
  quote: obj({ text: html, caption: html, alignment: enumOf('left', 'center') }, [
    'text',
    'caption',
    'alignment',
  ]),
  list: obj(
    {
      style: enumOf('ordered', 'unordered', 'checklist'),
      items: { type: 'array', items: { $ref: '#/$defs/listItem' } },
      meta: obj({ start: int(0, 100000), counterType: enumOf(...COUNTER_TYPES) }),
    },
    ['style', 'items']
  ),
  checklist: obj(
    { items: { type: 'array', items: obj({ text: html, checked: bool }, ['text', 'checked']) } },
    ['items']
  ),
  warning: obj({ title: html, message: html }, ['title', 'message']),
  alert: obj(
    {
      type: enumOf('primary', 'secondary', 'info', 'success', 'warning', 'danger', 'light', 'dark'),
      align: enumOf('left', 'center', 'right'),
      message: html,
    },
    ['type', 'align', 'message']
  ),
  toggle: obj(
    {
      text: html,
      status: enumOf('open', 'closed'),
      fk: str(64),
      items: {
        ...int(0, 5000),
        description: 'Number of blocks right after the toggle that form its content.',
      },
    },
    ['text', 'status', 'items']
  ),
  code: obj({ code: str(500000) }, ['code']),
  codeFlask: obj(
    {
      code: str(500000),
      language: { type: 'string', pattern: '^[a-zA-Z0-9+#-]{1,32}$' },
      showlinenumbers: bool,
      filename: {
        ...str(200),
        minLength: 1,
        description:
          'Optional file name label shown above the code (plain text, no control characters; 2.4). Omitted when empty.',
      },
    },
    ['code', 'language']
  ),
  raw: obj(
    {
      html: {
        ...str(500000),
        description: 'Raw HTML, sanitised or emptied according to the `rawHtml` option.',
      },
    },
    ['html']
  ),
  table: obj(
    {
      withHeadings: bool,
      stretched: bool,
      content: { type: 'array', maxItems: 500, items: { type: 'array', maxItems: 100, items: html } },
    },
    ['withHeadings', 'stretched', 'content']
  ),
  image: obj(
    {
      file: obj(
        {
          url,
          id: { type: ['integer', 'string'], description: 'Media Library file id.' },
          documentId: str(64),
          alt: { ...str(500), description: 'Alternative text.' },
          mime: str(500),
          name: str(500),
          hash: str(500),
          ext: str(500),
          width: { type: 'number' },
          height: { type: 'number' },
          size: { type: 'number' },
          formats: {
            type: 'object',
            description: 'Media Library formats (thumbnail, small, medium, large) for responsive images.',
            additionalProperties: { $ref: '#/$defs/mediaFormat' },
          },
        },
        ['url']
      ),
      caption: html,
      withBorder: bool,
      withBackground: bool,
      stretched: bool,
      decorative: {
        type: 'boolean',
        description: 'True when the image is decorative (rendered with an empty alt).',
      },
      focalPoint,
    },
    ['file', 'caption', 'withBorder', 'withBackground', 'stretched']
  ),
  simpleImage: obj(
    {
      url,
      caption: html,
      withBorder: bool,
      withBackground: bool,
      stretched: bool,
      alt: str(500),
      decorative: {
        type: 'boolean',
        description: 'True when the image is decorative (rendered with an empty alt).',
      },
    },
    ['url', 'caption', 'withBorder', 'withBackground', 'stretched']
  ),
  gallery: obj(
    {
      images: {
        type: 'array',
        maxItems: 50,
        items: obj(
          {
            file: { $ref: '#/$defs/imageFile' },
            caption: html,
            decorative: {
              type: 'boolean',
              description: 'True when the image is decorative (rendered with an empty alt).',
            },
            focalPoint,
          },
          ['file', 'caption']
        ),
      },
      layout: { ...enumOf('grid', 'carousel'), description: 'Layout hint for frontends.' },
      columns: { ...int(1, 6), description: 'Columns of the grid layout (hint).' },
      caption: html,
      _mex: marker,
    },
    ['images', 'layout', 'columns', 'caption', '_mex']
  ),
  video: obj(
    {
      file: { $ref: '#/$defs/mediaFile' },
      poster: { $ref: '#/$defs/imageFile' },
      title: str(200),
      caption: html,
      loop: bool,
      muted: bool,
      tracks: { type: 'array', maxItems: 8, items: { $ref: '#/$defs/mediaTrack' } },
      _mex: marker,
    },
    ['file', 'title', 'caption', 'loop', 'muted', 'tracks', '_mex']
  ),
  audio: obj(
    {
      file: { $ref: '#/$defs/mediaFile' },
      title: str(200),
      caption: html,
      loop: bool,
      tracks: { type: 'array', maxItems: 8, items: { $ref: '#/$defs/mediaTrack' } },
      _mex: marker,
    },
    ['file', 'title', 'caption', 'loop', 'tracks', '_mex']
  ),
  linkTool: obj(
    {
      link: url,
      meta: obj(
        { title: str(500), description: str(2000), site_name: str(200), image: obj({ url }, ['url']) },
        ['title', 'description']
      ),
    },
    ['link', 'meta']
  ),
  attaches: obj(
    {
      file: obj({ url, name: str(255), extension: str(16), size: { type: 'number' }, title: str(255) }, [
        'url',
      ]),
      title: str(255),
    },
    ['file', 'title']
  ),
  embed: obj(
    {
      service: { type: 'string', pattern: '^([a-zA-Z0-9_-]{1,40})?$' },
      source: url,
      embed: url,
      width: int(1, 10000),
      height: int(1, 10000),
      caption: html,
    },
    ['service', 'source', 'embed', 'caption']
  ),
  personality: obj({ name: str(500), description: str(2000), link: url, photo: url }, [
    'name',
    'description',
    'link',
    'photo',
  ]),
  button: obj(
    {
      text: str(200),
      link: url,
      style: enumOf('primary', 'secondary', 'outline', 'ghost', 'danger', 'success'),
      openInNewTab: bool,
    },
    ['text', 'link', 'style', 'openInNewTab']
  ),
  delimiter: obj({}),
  toc: obj(
    {
      title: { ...str(200), description: 'Plain-text title; empty for none.' },
      minLevel: { ...int(1, 6), description: 'Lowest heading level listed (at most maxLevel).' },
      maxLevel: { ...int(1, 6), description: 'Highest heading level listed.' },
      style: enumOf('ordered', 'unordered'),
      _mex: marker,
    },
    ['title', 'minLevel', 'maxLevel', 'style', '_mex'],
    'Table of contents. The entries are built from the headings when the content is rendered.'
  ),
  synced: obj(
    {
      ref: {
        type: 'string',
        pattern: '^([a-z0-9]{1,64})?$',
        description:
          'documentId of the synced block source (Settings > Templates). Only the reference is stored; `?mex=` output and the renderers (`options.synced`) expand it. Empty when invalid.',
      },
      _mex: marker,
    },
    ['ref', '_mex'],
    'Synced block: a reference to shared content that is edited in one place.'
  ),
});

/** Keys described by the schema that the current policy may not write yet (forward compatible). */
export const SCHEMA_ONLY_KEYS = Object.freeze({});

/**
 * Builds the published schema.
 * @returns {object} JSON Schema document.
 */
export const buildEditorSchema = () => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: SCHEMA_ID,
  title: 'Magic Editor X field value',
  description:
    'Editor.js document stored by a Magic Editor X 2.x field after server-side sanitising. Values written by 1.x are normalised to this shape on the next save. Custom blocks (any other `type`) have object data.',
  type: 'object',
  properties: {
    time: { type: 'integer', minimum: 0 },
    blocks: { type: 'array', maxItems: 5000, items: { $ref: '#/$defs/block' } },
    version: str(32),
  },
  required: ['time', 'blocks', 'version'],
  additionalProperties: false,
  $defs: {
    inlineHtml: {
      type: 'string',
      description:
        'Inline HTML limited to b, strong, i, em, u, s, mark, code, a, br, span, sub, sup with the attributes of the sanitising policy. Internal links carry data-mex-uid, data-mex-document-id and data-mex-locale; mentions (inline entry references) also data-mex-mention="true".',
    },
    url: {
      type: 'string',
      maxLength: 2048,
      description: 'http(s), mailto, tel or site-relative URL; empty when the stored URL was not allowed.',
    },
    mediaFormat: {
      type: 'object',
      properties: { url, width: { type: 'number' }, height: { type: 'number' } },
      additionalProperties: true,
    },
    focalPoint: obj(
      {
        x: { type: 'number', minimum: 0, maximum: 1, description: 'From the left edge, two decimals.' },
        y: { type: 'number', minimum: 0, maximum: 1, description: 'From the top edge, two decimals.' },
      },
      ['x', 'y'],
      'Focal point of the image (0..1). Media Library formats are resized, not cropped, so it applies to every format.'
    ),
    mediaFile: obj(
      {
        url,
        id: { type: ['integer', 'string'], description: 'Media Library file id.' },
        documentId: str(64),
        mime: str(500),
        name: str(500),
        hash: str(500),
        ext: str(500),
        width: { type: 'number' },
        height: { type: 'number' },
        size: { type: 'number' },
      },
      ['url'],
      'Media Library file (video, audio or WebVTT track).'
    ),
    imageFile: obj(
      {
        url,
        id: { type: ['integer', 'string'], description: 'Media Library file id.' },
        documentId: str(64),
        alt: { ...str(500), description: 'Alternative text.' },
        mime: str(500),
        name: str(500),
        hash: str(500),
        ext: str(500),
        width: { type: 'number' },
        height: { type: 'number' },
        size: { type: 'number' },
        formats: {
          type: 'object',
          description: 'Media Library formats (thumbnail, small, medium, large) for responsive images.',
          additionalProperties: { $ref: '#/$defs/mediaFormat' },
        },
      },
      ['url'],
      'Media Library image file.'
    ),
    mediaTrack: obj(
      {
        file: { $ref: '#/$defs/mediaFile' },
        kind: enumOf('captions', 'subtitles', 'descriptions', 'chapters'),
        srclang: { type: 'string', pattern: '^([A-Za-z]{2,3}(-[A-Za-z0-9]{1,8}){0,3})?$' },
        label: str(100),
        default: bool,
      },
      ['file', 'kind', 'srclang', 'label'],
      'WebVTT text track from the Media Library.'
    ),
    listItem: {
      anyOf: [
        { type: 'string', description: 'Legacy list item (inline HTML).' },
        obj(
          {
            content: html,
            meta: obj({ checked: bool, start: int(0, 100000), counterType: enumOf(...COUNTER_TYPES) }),
            items: { type: 'array', items: { $ref: '#/$defs/listItem' } },
          },
          ['content', 'items']
        ),
      ],
    },
    tunes: obj({
      alignmentTune: obj({ alignment: enumOf('left', 'center', 'right', 'justify') }, ['alignment']),
      textVariant: enumOf('', 'call-out', 'citation', 'details'),
      indentTune: obj({ indentLevel: int(0, 10) }, ['indentLevel']),
    }),
    block: {
      type: 'object',
      properties: {
        id: { type: 'string', pattern: '^[A-Za-z0-9_-]{1,64}$' },
        type: { type: 'string', pattern: '^[A-Za-z][A-Za-z0-9_-]{0,63}$' },
        data: { type: 'object' },
        tunes: { $ref: '#/$defs/tunes' },
      },
      required: ['id', 'type', 'data'],
      additionalProperties: false,
      allOf: Object.keys(BLOCK_DATA_SCHEMAS).map((type) => ({
        // 2.3 types (`MARKED_BLOCKS`): data without the marker or the exact shape is custom block data written before 2.3.
        if: MARKED_BLOCKS[type]
          ? markedCondition(type)
          : { properties: { type: { const: type } }, required: ['type'] },
        then: { properties: { data: { $ref: `#/$defs/data_${type}` } } },
      })),
    },
    ...Object.fromEntries(
      Object.entries(BLOCK_DATA_SCHEMAS).map(([type, schema]) => [`data_${type}`, schema])
    ),
  },
});
