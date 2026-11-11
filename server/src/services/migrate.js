'use strict';

const { z } = require('zod');
const { createLogger } = require('../utils/logger');
const { cleanEditorValue } = require('../utils/sanitizer');
const { isEditorAttribute } = require('../utils/editor-fields');
const { normalizeEditorData, looksLikeEditorData } = require('../../../shared/editor-data.mjs');
const {
  htmlToBlocks,
  markdownToBlocks,
  strapiBlocksToEditor,
  isStrapiBlocks,
  parseHtmlWithHtmlparser2,
  toDocument,
} = require('../../../shared/convert/index.mjs');

/**
 * Field migration into Magic Editor X: copies and converts the content of a
 * Strapi Blocks, Rich text (Markdown), text/string (HTML or Markdown) or JSON
 * field into a Magic Editor X field of the same content type.
 *
 * - Dry run by default: nothing is written, the report shows what would change.
 * - Idempotent: documents whose target field already has content are skipped
 *   (unless `overwrite`), so a second run is a no-op. The source field is never
 *   changed, so the migration can be undone by clearing the target field.
 * - Writes go through the Document Service (one `update` per document and
 *   locale), so the plugin's sanitising middleware and lifecycles run.
 * - The report and the log hold counts, document ids, locales and codes only,
 *   never content.
 */

const SOURCE_TYPES = new Set(['blocks', 'richtext', 'text', 'string', 'json']);
const FORMATS = ['auto', 'blocks', 'markdown', 'html'];

const optionsSchema = z.strictObject({
  uid: z.string().regex(/^(api|plugin)::[a-z0-9-]{1,60}\.[a-z0-9-]{1,60}$/),
  from: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  to: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,63}$/),
  format: z.enum(FORMATS).default('auto'),
  locale: z
    .string()
    .regex(/^(\*|[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3})$/)
    .optional(),
  status: z.literal('draft').default('draft'),
  dryRun: z.boolean().default(true),
  overwrite: z.boolean().default(false),
  batchSize: z.number().int().min(1).max(500).default(50),
  limit: z.number().int().min(1).max(1000000).optional(),
});

/**
 * Error thrown for invalid migration options.
 */
class MigrationOptionsError extends Error {
  /**
   * @param {string} message - What is wrong.
   * @param {string} code - Machine-readable code.
   */
  constructor(message, code) {
    super(message);
    this.name = 'MigrationOptionsError';
    this.code = code;
  }
}

/**
 * Picks the source format of one value.
 * @param {object} attribute - Source attribute.
 * @param {unknown} value - Source value.
 * @param {string} format - Requested format.
 * @returns {'blocks'|'markdown'|'html'|'editor'|null} Format, or null when the value cannot be read.
 */
const detectFormat = (attribute, value, format) => {
  if (format !== 'auto') return format;
  if (attribute.type === 'blocks') return 'blocks';
  if (attribute.type === 'richtext') return 'markdown';
  if (attribute.type === 'json') {
    if (isStrapiBlocks(value)) return 'blocks';
    if (looksLikeEditorData(value)) return 'editor';
    return null;
  }
  if (typeof value !== 'string') return null;
  return /<\/?[a-z][a-z0-9-]{0,20}(?:\s[^>]{0,500})?>/i.test(value.slice(0, 20000)) ? 'html' : 'markdown';
};

/**
 * True when a value has no content to migrate.
 * @param {unknown} value - Value.
 * @returns {boolean} Result.
 */
const isEmptySource = (value) => {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
};

/**
 * True when a Magic Editor X value already holds blocks (or holds something unreadable).
 * @param {unknown} value - Target value.
 * @returns {boolean} Result.
 */
const hasEditorContent = (value) => {
  if (value === null || value === undefined) return false;
  try {
    const data = normalizeEditorData(value);
    return Boolean(data && data.blocks.length > 0);
  } catch {
    // Unreadable content is kept: it is never overwritten without `overwrite`.
    return true;
  }
};

/**
 * Turns a converter report into short notes without content.
 * @param {{ skipped: Array<{ reason: string, tag?: string, count: number }> }} report - Converter report.
 * @returns {string[]} Notes such as `image-skipped` or `unsupported-element:iframe`.
 */
const notesOf = (report) =>
  (report.skipped || []).map((entry) => {
    if (entry.reason === 'image') return 'image-skipped';
    const tag =
      typeof entry.tag === 'string' && /^[a-z][a-z0-9-]{0,30}$/.test(entry.tag) ? `:${entry.tag}` : '';
    return `${entry.reason}${tag}`;
  });

/**
 * Converts one source value into a clean Magic Editor X value.
 * @param {unknown} value - Source value.
 * @param {string} format - Detected format.
 * @param {string} rawHtml - Raw HTML policy.
 * @returns {{ value: object|null, notes: string[] }} Converted value and notes.
 */
const convertValue = (value, format, rawHtml) => {
  if (format === 'editor') return { value: cleanEditorValue(value, { rawHtml }), notes: [] };
  let result;
  if (format === 'blocks') result = strapiBlocksToEditor(value);
  else if (format === 'markdown')
    result = markdownToBlocks(String(value), { parse: parseHtmlWithHtmlparser2 });
  else result = htmlToBlocks(String(value), { parse: parseHtmlWithHtmlparser2 });
  const clean = result.blocks.length ? cleanEditorValue(toDocument(result.blocks), { rawHtml }) : null;
  return { value: clean, notes: notesOf(result.report) };
};

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);

  /**
   * Checks the options against the content type schema.
   * @param {object} input - Raw options.
   * @returns {object} Parsed options with `contentType`, `source` and `localized`.
   * @throws {MigrationOptionsError} When the options or fields are not valid.
   */
  const prepare = (input) => {
    const parsed = optionsSchema.safeParse(input || {});
    if (!parsed.success) {
      const field = parsed.error.issues[0] && parsed.error.issues[0].path.join('.');
      throw new MigrationOptionsError(`Invalid option: ${field || 'options'}`, 'INVALID_OPTIONS');
    }
    const options = parsed.data;
    const contentType = strapi.contentType(options.uid);
    if (!contentType || contentType.kind === undefined)
      throw new MigrationOptionsError(`Unknown content type ${options.uid}`, 'UNKNOWN_CONTENT_TYPE');
    const source = contentType.attributes && contentType.attributes[options.from];
    const target = contentType.attributes && contentType.attributes[options.to];
    if (options.from === options.to)
      throw new MigrationOptionsError('The source and target fields must differ', 'SAME_FIELD');
    if (!source || source.customField || !SOURCE_TYPES.has(source.type))
      throw new MigrationOptionsError(
        `${options.from} is not a blocks, richtext, text, string or json field`,
        'INVALID_SOURCE'
      );
    if (!isEditorAttribute(target))
      throw new MigrationOptionsError(`${options.to} is not a Magic Editor X field`, 'INVALID_TARGET');
    const localized = Boolean(contentType.pluginOptions?.i18n?.localized);
    return { ...options, contentType, source, localized };
  };

  /**
   * Locales to migrate.
   * @param {object} options - Prepared options.
   * @returns {Promise<Array<string|undefined>>} Locale codes (undefined for types without i18n).
   */
  const localesOf = async (options) => {
    if (!options.localized) return [undefined];
    if (options.locale && options.locale !== '*') return [options.locale];
    if (!options.locale) return [undefined];
    const service = strapi.plugin('i18n') && strapi.plugin('i18n').service('locales');
    const locales = service ? await service.find() : [];
    return locales.map((entry) => entry.code).filter((code) => typeof code === 'string');
  };

  return {
    /**
     * Migrates one field of one content type into a Magic Editor X field.
     * @param {object} input - Options.
     * @param {string} input.uid - Content type uid (`api::article.article`).
     * @param {string} input.from - Source attribute (blocks, richtext, text, string or json).
     * @param {string} input.to - Target Magic Editor X attribute (top level).
     * @param {'auto'|'blocks'|'markdown'|'html'} [input.format='auto'] - Source format.
     * @param {string} [input.locale] - Locale code, `*` for every locale; default locale when omitted.
     * @param {'draft'} [input.status='draft'] - Version that is read and written.
     * @param {boolean} [input.dryRun=true] - Only report, write nothing.
     * @param {boolean} [input.overwrite=false] - Replace target fields that already have content.
     * @param {number} [input.batchSize=50] - Documents per page (1-500).
     * @param {number} [input.limit] - Stop after this many documents.
     * @returns {Promise<{ uid: string, from: string, to: string, format: string, dryRun: boolean, scanned: number, converted: number, skippedExisting: number, skippedEmpty: number, failed: Array<{ documentId: string, locale: string|null, code: string }>, lossy: Array<{ documentId: string, locale: string|null, notes: string[] }> }>} Report without content.
     * @throws {MigrationOptionsError} When the options are not valid.
     * @sideeffect Updates the target field of each converted document (draft) unless `dryRun`.
     */
    async run(input) {
      const options = prepare(input);
      const rawHtml = strapi.config.get('plugin::magic-editor-x.rawHtml') || 'sanitize';
      const report = {
        uid: options.uid,
        from: options.from,
        to: options.to,
        format: options.format,
        dryRun: options.dryRun,
        scanned: 0,
        converted: 0,
        skippedExisting: 0,
        skippedEmpty: 0,
        failed: [],
        lossy: [],
      };
      const documents = strapi.documents(options.uid);
      const max = options.limit || Infinity;
      for (const locale of await localesOf(options)) {
        let start = 0;
        while (report.scanned < max) {
          const page = await documents.findMany({
            ...(locale ? { locale } : {}),
            status: options.status,
            fields: [options.from, options.to],
            sort: ['id:asc'],
            start,
            limit: Math.min(options.batchSize, max - report.scanned),
          });
          if (!Array.isArray(page) || page.length === 0) break;
          start += page.length;
          for (const entry of page) {
            report.scanned += 1;
            const where = { documentId: entry.documentId, locale: locale || entry.locale || null };
            const sourceValue = entry[options.from];
            if (isEmptySource(sourceValue)) {
              report.skippedEmpty += 1;
              continue;
            }
            if (!options.overwrite && hasEditorContent(entry[options.to])) {
              report.skippedExisting += 1;
              continue;
            }
            let converted;
            try {
              const format = detectFormat(options.source, sourceValue, options.format);
              if (!format) {
                report.failed.push({ ...where, code: 'UNSUPPORTED_VALUE' });
                continue;
              }
              converted = convertValue(sourceValue, format, rawHtml);
            } catch (error) {
              report.failed.push({ ...where, code: (error && error.code) || 'CONVERT_FAILED' });
              continue;
            }
            if (!converted.value) {
              report.skippedEmpty += 1;
              continue;
            }
            if (converted.notes.length) report.lossy.push({ ...where, notes: converted.notes });
            if (!options.dryRun) {
              try {
                await documents.update({
                  documentId: entry.documentId,
                  ...(locale ? { locale } : {}),
                  data: { [options.to]: converted.value },
                });
              } catch (error) {
                report.failed.push({
                  ...where,
                  code: error && error.name === 'ValidationError' ? 'VALIDATION' : 'WRITE_FAILED',
                });
                continue;
              }
            }
            report.converted += 1;
          }
          if (page.length < options.batchSize) break;
        }
      }
      logger.info(options.dryRun ? 'field migration dry run finished' : 'field migration finished', {
        scanned: report.scanned,
        converted: report.converted,
        skippedExisting: report.skippedExisting,
        skippedEmpty: report.skippedEmpty,
        failed: report.failed.length,
        lossy: report.lossy.length,
      });
      return report;
    },
  };
};

module.exports.MigrationOptionsError = MigrationOptionsError;
module.exports.detectFormat = detectFormat;
