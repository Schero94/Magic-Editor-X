'use strict';

const sanitizeHtml = require('sanitize-html');
const { z } = require('zod');
const { errors } = require('@strapi/utils');
const { uidSchema, issueDetails } = require('../utils/validation');

/**
 * Custom blocks: owner-defined Editor.js tools. All limits of 1.x (tiers,
 * counts, import/export gating) are gone; every installation can create any
 * number of simple and embedded-entry blocks.
 *
 * Definitions are validated with a strict schema and their markup (SVG icon,
 * HTML template) is sanitised on the server, because the editor renders them
 * for every admin who opens a document.
 */

const UID = 'plugin::magic-editor-x.custom-block';

/**
 * Names that became built-in blocks in 2.3. New custom blocks cannot use
 * them; a block created earlier under one of them keeps working (its stored
 * data lacks the built-in marker key, see `MEDIA_BLOCK_MARKERS`) and can still
 * be edited under its name.
 */
const MEDIA_BLOCK_NAMES = new Set(['gallery', 'video', 'audio']);

/** Built-in tool names a custom block must not shadow. */
const RESERVED_NAMES = new Set(
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
    'toc',
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
    'mention',
    'aiAssistant',
    'textVariant',
    'alignmentTune',
    'indentTune',
    'embeddedEntry',
  ].map((name) => name.toLowerCase())
);

const FIELD_TYPES = ['text', 'textarea', 'url', 'number', 'select', 'checkbox', 'image', 'color'];
const TUNES = ['alignmentTune', 'textVariant', 'indentTune'];
const STYLE_PROPERTIES = new Set([
  'background',
  'backgroundColor',
  'border',
  'borderColor',
  'borderRadius',
  'borderStyle',
  'borderWidth',
  'color',
  'fontSize',
  'fontWeight',
  'fontStyle',
  'lineHeight',
  'margin',
  'marginTop',
  'marginBottom',
  'padding',
  'textAlign',
  'display',
  'gap',
  'width',
  'maxWidth',
]);

const SVG_OPTIONS = {
  allowedTags: ['svg', 'g', 'path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon', 'title'],
  allowedAttributes: {
    '*': [
      'viewBox',
      'width',
      'height',
      'fill',
      'stroke',
      'stroke-width',
      'stroke-linecap',
      'stroke-linejoin',
      'd',
      'x',
      'y',
      'rx',
      'ry',
      'cx',
      'cy',
      'r',
      'x1',
      'y1',
      'x2',
      'y2',
      'points',
      'transform',
      'xmlns',
      'fill-rule',
      'clip-rule',
      'opacity',
    ],
  },
  allowedSchemes: [],
  parser: { lowerCaseAttributeNames: false, lowerCaseTags: false },
};

const TEMPLATE_OPTIONS = {
  allowedTags: [
    'div',
    'span',
    'p',
    'h2',
    'h3',
    'h4',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'small',
    'br',
    'hr',
    'ul',
    'ol',
    'li',
    'blockquote',
    'figure',
    'figcaption',
    'img',
    'a',
    'section',
    'header',
    'footer',
    'code',
    'pre',
    'mark',
  ],
  allowedAttributes: {
    '*': ['class', 'data-field', 'title'],
    a: ['href', 'target', 'rel'],
    img: ['src', 'alt', 'width', 'height', 'loading'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowProtocolRelative: false,
};

const nameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{1,49}$/);
const fieldNameSchema = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/);

const fieldSchema = z.strictObject({
  name: fieldNameSchema,
  label: z.string().trim().min(1).max(100),
  type: z.enum(FIELD_TYPES),
  required: z.boolean().optional(),
  placeholder: z.string().max(200).optional(),
  default: z.union([z.string().max(2000), z.number(), z.boolean()]).optional(),
  options: z
    .array(
      z.union([
        z.string().max(100),
        z.strictObject({ value: z.string().max(100), label: z.string().max(100) }),
      ])
    )
    .max(50)
    .optional(),
});

const blockSchema = z
  .strictObject({
    name: nameSchema,
    label: z.string().trim().min(1).max(100),
    blockType: z.enum(['simple', 'embedded-entry']),
    description: z.string().max(1000).nullish(),
    icon: z.string().max(10000).nullish(),
    contentType: uidSchema.nullish(),
    displayFields: z.array(fieldNameSchema).max(20).nullish(),
    titleField: fieldNameSchema.nullish(),
    previewFields: z.array(fieldNameSchema).max(20).nullish(),
    fields: z.array(fieldSchema).max(20).nullish(),
    template: z.string().max(20000).nullish(),
    placeholder: z.string().max(200).nullish(),
    styles: z.record(z.string(), z.string().max(200)).nullish(),
    inlineToolbar: z.boolean().nullish(),
    tunes: z.array(z.enum(TUNES)).max(3).nullish(),
    shortcut: z
      .string()
      .regex(/^(CMD|CTRL|ALT|SHIFT|OPTION)(\+(CMD|CTRL|ALT|SHIFT|OPTION|[A-Z0-9]))+$/)
      .nullish(),
    sortOrder: z.number().int().min(0).max(100000).nullish(),
    enabled: z.boolean().nullish(),
  })
  .superRefine((block, ctx) => {
    if (RESERVED_NAMES.has(block.name.toLowerCase())) {
      ctx.addIssue({ code: 'custom', path: ['name'], message: 'This name is used by a built-in tool' });
    }
    const names = (block.fields || []).map((field) => field.name);
    if (new Set(names).size !== names.length) {
      ctx.addIssue({ code: 'custom', path: ['fields'], message: 'Field names must be unique' });
    }
    for (const [index, field] of (block.fields || []).entries()) {
      if (field.type === 'select' && (!field.options || field.options.length === 0)) {
        ctx.addIssue({
          code: 'custom',
          path: ['fields', index, 'options'],
          message: 'A select field needs options',
        });
      }
    }
  });

const importSchema = z.strictObject({
  format: z.literal('magic-editor-x/custom-blocks').optional(),
  version: z.union([z.string().max(20), z.number()]).optional(),
  exportedAt: z.string().max(40).optional(),
  blocks: z.array(z.record(z.string(), z.unknown())).max(200),
});

/**
 * Throws a Strapi ValidationError from a zod error.
 * @param {z.ZodError} error - Zod error.
 * @returns {never}
 */
const fail = (error) => {
  throw new errors.ValidationError('Validation failed', issueDetails(error));
};

/**
 * Keeps only allowed inline style properties without url()/expression().
 * @param {Record<string, string>|null|undefined} styles - Style map.
 * @returns {Record<string, string>} Clean styles.
 */
const cleanStyles = (styles) => {
  const out = {};
  for (const [key, value] of Object.entries(styles || {})) {
    if (!STYLE_PROPERTIES.has(key)) continue;
    if (/url\s*\(|expression\s*\(|javascript:|[<>{};]/i.test(value)) continue;
    out[key] = value;
  }
  return out;
};

/**
 * Turns a validated definition into a database row.
 * @param {z.infer<typeof blockSchema>} block - Definition.
 * @returns {object} Row data.
 */
const toRow = (block) => ({
  name: block.name,
  label: block.label,
  blockType: block.blockType,
  description: block.description || null,
  icon: block.icon ? sanitizeHtml(block.icon, SVG_OPTIONS) || null : null,
  contentType: block.blockType === 'embedded-entry' ? block.contentType || null : null,
  displayFields: block.displayFields || [],
  titleField: block.titleField || null,
  previewFields: block.previewFields || [],
  fields: block.blockType === 'simple' ? block.fields || [] : [],
  template: block.template ? sanitizeHtml(block.template, TEMPLATE_OPTIONS) : null,
  placeholder: block.placeholder || null,
  styles: cleanStyles(block.styles),
  inlineToolbar: block.inlineToolbar !== false,
  tunes: block.tunes || [],
  shortcut: block.shortcut || null,
  sortOrder: block.sortOrder ?? 0,
  enabled: block.enabled !== false,
});

/**
 * Public representation of a block.
 * @param {object} row - Database row.
 * @returns {object} DTO.
 */
const toDto = (row) => ({
  id: row.documentId,
  name: row.name,
  label: row.label,
  blockType: row.blockType,
  description: row.description || '',
  icon: row.icon || '',
  contentType: row.contentType || null,
  displayFields: Array.isArray(row.displayFields) ? row.displayFields : [],
  titleField: row.titleField || null,
  previewFields: Array.isArray(row.previewFields) ? row.previewFields : [],
  fields: Array.isArray(row.fields) ? row.fields : [],
  template: row.template || '',
  placeholder: row.placeholder || '',
  styles: row.styles && typeof row.styles === 'object' ? row.styles : {},
  inlineToolbar: row.inlineToolbar !== false,
  tunes: Array.isArray(row.tunes) ? row.tunes : [],
  shortcut: row.shortcut || null,
  sortOrder: Number(row.sortOrder) || 0,
  enabled: row.enabled !== false,
  updatedAt: row.updatedAt,
});

/**
 * Definition fields taken from a stored row (used by duplicate and by
 * validation of legacy rows).
 * @param {object} row - Row.
 * @returns {object} Definition input.
 */
const definitionOf = (row) => {
  const dto = toDto(row);
  const { id: _id, updatedAt: _updatedAt, ...definition } = dto;
  return definition;
};

module.exports = ({ strapi }) => {
  const query = () => strapi.db.query(UID);

  const findByDocumentId = async (documentId) => {
    if (typeof documentId !== 'string' || !/^[a-z0-9]{1,64}$/.test(documentId))
      throw new errors.NotFoundError('Not found');
    const row = await query().findOne({ where: { documentId } });
    if (!row) throw new errors.NotFoundError('Not found');
    return row;
  };

  const assertNameFree = async (name, exceptDocumentId) => {
    // A block registered in code (custom block SDK) owns its name.
    if (strapi.plugin('magic-editor-x').service('blocks').isRegisteredName(name)) {
      throw new errors.ValidationError('Validation failed', {
        formErrors: [],
        fieldErrors: { name: ['A block with this name is defined in code'] },
      });
    }
    const rows = await query().findMany({ select: ['documentId', 'name'] });
    const clash = rows.find(
      (row) => row.name.toLowerCase() === name.toLowerCase() && row.documentId !== exceptDocumentId
    );
    if (clash) {
      throw new errors.ValidationError('Validation failed', {
        formErrors: [],
        fieldErrors: { name: ['A block with this name already exists'] },
      });
    }
  };

  /**
   * Refuses the 2.3 built-in block names unless the block already has that name.
   * @param {string} name - Requested name.
   * @param {string|null} [current] - Stored name of the block being updated.
   */
  const assertNotMediaName = (name, current = null) => {
    if (MEDIA_BLOCK_NAMES.has(name.toLowerCase()) && name !== current) {
      throw new errors.ValidationError('Validation failed', {
        formErrors: [],
        fieldErrors: { name: ['This name is used by a built-in tool'] },
      });
    }
  };

  const nextSortOrder = async () => {
    const [last] = await query().findMany({
      orderBy: { sortOrder: 'desc' },
      limit: 1,
      select: ['sortOrder'],
    });
    return (Number(last?.sortOrder) || 0) + 1;
  };

  return {
    schema: blockSchema,

    /**
     * Lists blocks.
     * @param {{ enabledOnly: boolean }} options - Filter.
     * @returns {Promise<object[]>} Blocks in toolbox order.
     */
    async list({ enabledOnly }) {
      const rows = await query().findMany({
        where: enabledOnly ? { enabled: true } : {},
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        limit: 1000,
      });
      return rows.map(toDto);
    },

    /**
     * Creates a block.
     * @param {unknown} input - Definition.
     * @param {{ id: number }} user - Creator.
     * @returns {Promise<object>} Created block.
     */
    async create(input, user) {
      const parsed = blockSchema.safeParse(input);
      if (!parsed.success) fail(parsed.error);
      assertNotMediaName(parsed.data.name);
      await assertNameFree(parsed.data.name);
      const data = toRow(parsed.data);
      if (input.sortOrder === undefined) data.sortOrder = await nextSortOrder();
      const row = await query().create({ data: { ...data, createdByUser: user?.id || null } });
      return toDto(row);
    },

    /**
     * Replaces a block definition.
     * @param {string} documentId - Block id.
     * @param {unknown} input - Full definition.
     * @returns {Promise<object>} Updated block.
     */
    async update(documentId, input) {
      const existing = await findByDocumentId(documentId);
      const parsed = blockSchema.safeParse(input);
      if (!parsed.success) fail(parsed.error);
      assertNotMediaName(parsed.data.name, existing.name);
      await assertNameFree(parsed.data.name, existing.documentId);
      const row = await query().update({ where: { id: existing.id }, data: toRow(parsed.data) });
      return toDto(row);
    },

    /**
     * Deletes a block. Content that uses the block keeps its data; the editor
     * shows such blocks as "unavailable" until a block with the same name exists.
     * @param {string} documentId - Block id.
     * @returns {Promise<{ id: string }>} Deleted id.
     */
    async remove(documentId) {
      const existing = await findByDocumentId(documentId);
      await query().delete({ where: { id: existing.id } });
      return { id: existing.documentId };
    },

    /**
     * Copies a block under a new unique name.
     * @param {string} documentId - Source block.
     * @param {{ id: number }} user - Creator.
     * @returns {Promise<object>} New block.
     */
    async duplicate(documentId, user) {
      const existing = await findByDocumentId(documentId);
      const rows = await query().findMany({ select: ['name'] });
      const taken = new Set(rows.map((row) => row.name.toLowerCase()));
      const base = existing.name.slice(0, 44);
      let name = `${base}Copy`;
      for (let i = 2; taken.has(name.toLowerCase()) && i < 1000; i += 1) name = `${base}Copy${i}`;
      return this.create(
        {
          ...definitionOf(existing),
          name,
          label: `${existing.label} (copy)`.slice(0, 100),
          sortOrder: undefined,
        },
        user
      );
    },

    /**
     * Saves a new toolbox order.
     * @param {string[]} ids - Every block id in the desired order.
     * @returns {Promise<object[]>} Blocks in the new order.
     */
    async reorder(ids) {
      const rows = await query().findMany({ select: ['id', 'documentId'] });
      const byDocumentId = new Map(rows.map((row) => [row.documentId, row.id]));
      if (
        ids.length !== rows.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !byDocumentId.has(id))
      ) {
        throw new errors.ValidationError('The order must list every block exactly once');
      }
      await strapi.db.transaction(async () => {
        for (const [index, documentId] of ids.entries()) {
          await query().update({
            where: { id: byDocumentId.get(documentId) },
            data: { sortOrder: index + 1 },
          });
        }
      });
      return this.list({ enabledOnly: false });
    },

    /**
     * Export file content.
     * @returns {Promise<object>} Export document.
     */
    async exportAll() {
      const blocks = (await this.list({ enabledOnly: false })).map((block) => {
        const { id: _id, updatedAt: _updatedAt, ...definition } = block;
        return definition;
      });
      return {
        format: 'magic-editor-x/custom-blocks',
        version: 2,
        exportedAt: new Date().toISOString(),
        blocks,
      };
    },

    /**
     * Imports blocks. Every entry is validated first; nothing is written when
     * the file itself is malformed. Entries whose name exists are skipped and
     * reported, never overwritten.
     * @param {unknown} input - Parsed export file.
     * @param {{ id: number }} user - Creator.
     * @returns {Promise<{ created: string[], skipped: Array<{ name: string, reason: string }> }>} Outcome.
     */
    async importAll(input, user) {
      const parsed = importSchema.safeParse(input);
      if (!parsed.success) fail(parsed.error);
      const rows = await query().findMany({ select: ['name'] });
      const taken = new Set(rows.map((row) => row.name.toLowerCase()));
      const created = [];
      const skipped = [];
      const valid = [];
      for (const entry of parsed.data.blocks) {
        const { id: _id, updatedAt: _u, createdAt: _c, documentId: _d, ...definition } = entry;
        const result = blockSchema.safeParse(definition);
        const name = typeof entry.name === 'string' ? entry.name.slice(0, 50) : '';
        if (!result.success || MEDIA_BLOCK_NAMES.has(result.data.name.toLowerCase()))
          skipped.push({ name, reason: 'invalid' });
        else if (
          taken.has(result.data.name.toLowerCase()) ||
          strapi.plugin('magic-editor-x').service('blocks').isRegisteredName(result.data.name)
        )
          skipped.push({ name, reason: 'exists' });
        else {
          taken.add(result.data.name.toLowerCase());
          valid.push(result.data);
        }
      }
      let order = await nextSortOrder();
      for (const definition of valid) {
        const data = toRow(definition);
        data.sortOrder = order;
        order += 1;
        await query().create({ data: { ...data, createdByUser: user?.id || null } });
        created.push(definition.name);
      }
      return { created, skipped };
    },
  };
};

module.exports.blockSchema = blockSchema;
module.exports.RESERVED_NAMES = RESERVED_NAMES;
module.exports.MEDIA_BLOCK_NAMES = MEDIA_BLOCK_NAMES;
module.exports.SVG_OPTIONS = SVG_OPTIONS;
module.exports.TEMPLATE_OPTIONS = TEMPLATE_OPTIONS;
