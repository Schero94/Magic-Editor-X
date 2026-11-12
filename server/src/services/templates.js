'use strict';

const { z } = require('zod');
const { errors } = require('@strapi/utils');
const { issueDetails } = require('../utils/validation');
const { cleanEditorValue } = require('../utils/sanitizer');
const { isEditorAttribute, resolveEditorField } = require('../utils/editor-fields');
const { PRESET_NAMES, resolveFieldPreset } = require('../../../shared/presets.mjs');
const {
  TEMPLATE_KINDS,
  TEMPLATE_LIMITS,
  SCOPE_FIELD_PATTERN,
  normalizeScope,
  templateMatchesTarget,
  scopeFieldOf,
} = require('../../../shared/templates.mjs');

/**
 * Templates and block patterns (2.3): admin-defined starting content
 * (`kind: 'template'`) and insertable block sequences (`kind: 'pattern'`).
 *
 * Data access only: the controller checks RBAC (`access` to use them,
 * `templates.manage` to change them). Rows live in the hidden content type
 * `plugin::magic-editor-x.template` (table `magic_editor_templates`) and are
 * read and written with the query engine. Blocks are normalised and
 * sanitised with the field policy on every write (`cleanEditorValue`; raw
 * HTML is always sanitised, or dropped when `rawHtml` is `disable`), so a
 * stored template is as safe as stored field content. Nothing here logs
 * template content.
 */

const UID = 'plugin::magic-editor-x.template';
const ID_PATTERN = /^[a-z0-9]{1,64}$/;
const API_UID = /^api::[a-z0-9-]{1,60}\.[a-z0-9-]{1,60}$/;
const MAX_DEPTH = 4;

const notFound = () => new errors.NotFoundError('Not found');

/**
 * Throws a Strapi ValidationError with one field message.
 * @param {string} path - Field path.
 * @param {string} message - Fixed message.
 * @returns {never}
 */
const invalid = (path, message) => {
  throw new errors.ValidationError('Validation failed', {
    formErrors: [],
    fieldErrors: { [path]: [message] },
  });
};

const text = (max) =>
  z
    .string()
    .trim()
    .max(max)
    // eslint-disable-next-line no-control-regex -- control characters are rejected
    .regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/);

const scopeSchema = z
  .strictObject({
    all: z.boolean(),
    presets: z.array(z.enum(PRESET_NAMES)).max(PRESET_NAMES.length).optional(),
    fields: z
      .array(
        z.strictObject({
          uid: z.string().max(160).regex(API_UID),
          field: z.string().max(200).regex(SCOPE_FIELD_PATTERN),
        })
      )
      .max(TEMPLATE_LIMITS.scopeFields)
      .optional(),
  })
  .superRefine((scope, ctx) => {
    if (!scope.all && !(scope.presets || []).length && !(scope.fields || []).length) {
      ctx.addIssue({ code: 'custom', path: ['scope'], message: 'Choose at least one preset or field' });
    }
  });

/** Template definition sent by the settings page and "Save as template". */
const templateSchema = z.strictObject({
  name: text(TEMPLATE_LIMITS.name).min(1),
  description: text(TEMPLATE_LIMITS.description).nullish(),
  kind: z.enum(TEMPLATE_KINDS),
  // Editor.js document or bare block array; shape and size are checked by cleanEditorValue and the byte limit.
  blocks: z.union([
    z.looseObject({ blocks: z.array(z.unknown()).max(TEMPLATE_LIMITS.blocks) }),
    z.array(z.unknown()).max(TEMPLATE_LIMITS.blocks),
  ]),
  scope: scopeSchema,
  enabled: z.boolean().optional(),
  sortOrder: z.number().int().min(0).max(100000).optional(),
});

/** Editor list query: `?uid&field` (the field the editor shows) or `?all=true` (managers). */
const listQuerySchema = z.union([
  z.strictObject({ all: z.literal('true') }),
  z.strictObject({
    uid: z.string().max(160).regex(API_UID),
    field: z
      .string()
      .max(200)
      .regex(/^[A-Za-z_][A-Za-z0-9_]{0,79}(\.(\d{1,4}|[A-Za-z_][A-Za-z0-9_]{0,79})){0,8}$/),
  }),
]);

// eslint-disable-next-line no-control-regex -- control characters are removed from the name snapshot
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * Display name snapshot of an admin user.
 * @param {{ firstname?: string, lastname?: string, username?: string }|null|undefined} user - Admin.
 * @returns {string|null} Name (max 200).
 */
const displayName = (user) => {
  if (!user) return null;
  const name = [user.firstname, user.lastname]
    .filter((part) => typeof part === 'string' && part.trim())
    .join(' ')
    .trim();
  const clean = (name || (typeof user.username === 'string' ? user.username : '')).replace(CONTROL, '');
  return clean.slice(0, 200) || null;
};

/**
 * Normalises, sanitises and bounds template blocks.
 * @param {unknown} blocks - Submitted blocks (document or array).
 * @param {string} rawHtml - Configured raw HTML policy.
 * @returns {{ time: number, version: string, blocks: Array<object> }} Clean document.
 * @throws {errors.ValidationError} When the content is invalid, empty or too large.
 */
const cleanBlocks = (blocks, rawHtml) => {
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(blocks), 'utf8');
  } catch {
    invalid('blocks', 'The content is not valid editor content');
  }
  if (size > TEMPLATE_LIMITS.bytes) invalid('blocks', 'The content is too large');
  let clean;
  try {
    clean = cleanEditorValue(blocks, { rawHtml: rawHtml === 'disable' ? 'disable' : 'sanitize' });
  } catch {
    invalid('blocks', 'The content is not valid editor content');
  }
  if (!clean || !Array.isArray(clean.blocks) || clean.blocks.length === 0)
    invalid('blocks', 'A template needs at least one block');
  if (clean.blocks.length > TEMPLATE_LIMITS.blocks) invalid('blocks', 'The content has too many blocks');
  return { time: Number(clean.time) || Date.now(), version: clean.version || '2.31.7', blocks: clean.blocks };
};

/**
 * Stored row -> API object. The creator is a name snapshot only.
 * @param {object} row - Row.
 * @returns {object} Template DTO.
 */
const toDto = (row) => {
  const blocks =
    row.blocks && typeof row.blocks === 'object' && Array.isArray(row.blocks.blocks)
      ? row.blocks
      : { time: 0, version: '2.31.7', blocks: [] };
  return {
    id: row.documentId,
    name: row.name,
    description: row.description || '',
    kind: TEMPLATE_KINDS.includes(row.kind) ? row.kind : 'pattern',
    blocks,
    blockCount: blocks.blocks.length,
    scope: normalizeScope(row.scope),
    enabled: row.enabled !== false,
    sortOrder: Number(row.sortOrder) || 0,
    createdBy: row.createdByName ? { name: row.createdByName } : null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};

module.exports = ({ strapi }) => {
  const query = () => strapi.db.query(UID);
  const rawHtml = () => strapi.config.get('plugin::magic-editor-x.rawHtml') || 'sanitize';

  const findRow = async (documentId) => {
    if (typeof documentId !== 'string' || !ID_PATTERN.test(documentId)) throw notFound();
    const row = await query().findOne({ where: { documentId } });
    if (!row) throw notFound();
    return row;
  };

  const nextSortOrder = async () => {
    const [last] = await query().findMany({
      orderBy: { sortOrder: 'desc' },
      limit: 1,
      select: ['sortOrder'],
    });
    return (Number(last?.sortOrder) || 0) + 1;
  };

  /**
   * Every Magic Editor X field of the API content types: `{ uid, field, preset }`
   * with component and dynamic zone paths without indices.
   * @returns {Array<{ uid: string, displayName: string, field: string, preset: string }>} Fields.
   */
  const editorTargets = () => {
    const out = [];
    const walk = (schema, prefix, depth, push) => {
      if (!schema || depth > MAX_DEPTH) return;
      for (const [name, attribute] of Object.entries(schema.attributes || {})) {
        const path = prefix ? `${prefix}.${name}` : name;
        if (isEditorAttribute(attribute)) push(path, attribute);
        else if (attribute.type === 'component')
          walk(strapi.components[attribute.component], path, depth + 1, push);
        else if (attribute.type === 'dynamiczone')
          for (const uid of attribute.components || []) walk(strapi.components[uid], path, depth + 1, push);
      }
    };
    for (const contentType of Object.values(strapi.contentTypes)) {
      if (!contentType.uid.startsWith('api::')) continue;
      const seen = new Set();
      walk(contentType, '', 0, (field, attribute) => {
        if (seen.has(field) || !SCOPE_FIELD_PATTERN.test(field)) return;
        seen.add(field);
        out.push({
          uid: contentType.uid,
          displayName: contentType.info?.displayName || contentType.uid,
          field,
          preset: resolveFieldPreset(attribute.options).name,
        });
      });
    }
    return out.sort((a, b) => a.displayName.localeCompare(b.displayName) || a.field.localeCompare(b.field));
  };

  /**
   * Validates a definition and turns it into row data.
   * @param {unknown} input - Untrusted definition.
   * @returns {object} Row data (without sortOrder unless given).
   */
  const toRow = (input) => {
    const parsed = templateSchema.safeParse(input);
    if (!parsed.success) throw new errors.ValidationError('Validation failed', issueDetails(parsed.error));
    const definition = parsed.data;
    const scope = normalizeScope({
      all: definition.scope.all,
      presets: definition.scope.presets || [],
      fields: definition.scope.fields || [],
    });
    if (!scope.all) {
      const known = new Set(editorTargets().map((target) => `${target.uid}|${target.field}`));
      definition.scope.fields?.forEach((entry, index) => {
        if (!known.has(`${entry.uid}|${entry.field}`))
          invalid(`scope.fields.${index}`, 'This field does not exist or is not a Magic Editor X field');
      });
    }
    const row = {
      name: definition.name,
      description: definition.description || null,
      kind: definition.kind,
      blocks: cleanBlocks(definition.blocks, rawHtml()),
      scope,
      enabled: definition.enabled !== false,
    };
    if (definition.sortOrder !== undefined) row.sortOrder = definition.sortOrder;
    return row;
  };

  return {
    listQuerySchema,
    templateSchema,

    /** @returns {Array<{ uid: string, displayName: string, field: string, preset: string }>} Fields for scope selection. */
    targets: editorTargets,

    /**
     * Every template (settings page), in display order.
     * @returns {Promise<object[]>} Templates.
     */
    async listAll() {
      const rows = await query().findMany({
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        limit: TEMPLATE_LIMITS.templates,
      });
      return rows.map(toDto);
    },

    /**
     * Enabled templates offered in one field.
     * @param {{ uid: string, field: string }} target - Field (validated).
     * @returns {Promise<object[]>} Templates.
     * @throws {errors.NotFoundError} When the type or field is not a Magic Editor X field.
     */
    async listForField({ uid, field }) {
      const contentType = strapi.contentType(uid);
      const resolved = contentType ? resolveEditorField(strapi, contentType, field) : null;
      if (!resolved) throw notFound();
      const presetName = resolveFieldPreset(resolved.attribute.options).name;
      const rows = await query().findMany({
        where: { enabled: true },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        limit: TEMPLATE_LIMITS.templates,
      });
      return rows
        .filter((row) => templateMatchesTarget(row.scope, { uid, field: scopeFieldOf(field), presetName }))
        .map(toDto);
    },

    /**
     * One template.
     * @param {string} documentId - Id.
     * @param {{ includeDisabled: boolean }} options - Managers also see disabled templates.
     * @returns {Promise<object>} Template.
     */
    async findOne(documentId, { includeDisabled }) {
      const row = await findRow(documentId);
      if (!includeDisabled && row.enabled === false) throw notFound();
      return toDto(row);
    },

    /**
     * Creates a template.
     * @param {unknown} input - Definition.
     * @param {object} user - Admin user (name snapshot only).
     * @returns {Promise<object>} Created template.
     */
    async create(input, user) {
      const data = toRow(input);
      const count = await query().count();
      if (count >= TEMPLATE_LIMITS.templates)
        throw new errors.ValidationError('Too many templates', { code: 'TOO_MANY_TEMPLATES' });
      if (data.sortOrder === undefined) data.sortOrder = await nextSortOrder();
      const row = await query().create({ data: { ...data, createdByName: displayName(user) } });
      return toDto(row);
    },

    /**
     * Replaces a template definition.
     * @param {string} documentId - Id.
     * @param {unknown} input - Full definition.
     * @returns {Promise<object>} Updated template.
     */
    async update(documentId, input) {
      const existing = await findRow(documentId);
      const data = toRow(input);
      const row = await query().update({ where: { id: existing.id }, data });
      return toDto(row);
    },

    /**
     * Deletes a template. Content created from it is not affected.
     * @param {string} documentId - Id.
     * @returns {Promise<{ id: string }>} Deleted id.
     */
    async remove(documentId) {
      const existing = await findRow(documentId);
      await query().delete({ where: { id: existing.id } });
      return { id: existing.documentId };
    },

    /**
     * Copies a template ("<name> (copy)", same scope, disabled until reviewed).
     * @param {string} documentId - Source.
     * @param {object} user - Admin user.
     * @returns {Promise<object>} New template.
     */
    async duplicate(documentId, user) {
      const existing = toDto(await findRow(documentId));
      return this.create(
        {
          name: `${existing.name.slice(0, TEMPLATE_LIMITS.name - 7)} (copy)`,
          description: existing.description || null,
          kind: existing.kind,
          blocks: existing.blocks,
          scope: existing.scope,
          enabled: false,
        },
        user
      );
    },

    /**
     * Saves a new order.
     * @param {string[]} ids - Every template id once.
     * @returns {Promise<object[]>} Templates in the new order.
     */
    async reorder(ids) {
      const rows = await query().findMany({ select: ['id', 'documentId'], limit: TEMPLATE_LIMITS.templates });
      const byDocumentId = new Map(rows.map((row) => [row.documentId, row.id]));
      if (
        ids.length !== rows.length ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !byDocumentId.has(id))
      ) {
        throw new errors.ValidationError('The order must list every template exactly once');
      }
      await strapi.db.transaction(async () => {
        for (const [index, documentId] of ids.entries()) {
          await query().update({
            where: { id: byDocumentId.get(documentId) },
            data: { sortOrder: index + 1 },
          });
        }
      });
      return this.listAll();
    },
  };
};

module.exports.templateSchema = templateSchema;
module.exports.listQuerySchema = listQuerySchema;
module.exports.cleanBlocks = cleanBlocks;
module.exports.displayName = displayName;
module.exports.toDto = toDto;
