'use strict';

const { generateTypes } = require('../../../shared/typegen.mjs');

/**
 * TypeScript types per field for `npx magic-editor-x types`.
 *
 * Collects the loaded project's content types and components, the Settings
 * custom blocks (enabled and disabled, because stored content can hold both)
 * and the blocks registered with the block SDK, and hands them to the pure
 * generator in `shared/typegen.mjs`. Reads only; makes no outgoing requests.
 * @param {{ strapi: import('@strapi/strapi').Core.Strapi }} context - Strapi.
 * @returns {object} Service.
 */
module.exports = ({ strapi }) => ({
  /**
   * Generates the TypeScript module.
   * @param {{ uids?: string[], importFrom?: string, version?: string }} [options] - Only these content types or components (and the components they use); module of the built-in types; plugin version for the header.
   * @returns {Promise<{ code: string, fields: number, customBlocks: number, codeBlocks: number }>} Module text and counts.
   * @throws {import('../../../shared/typegen.mjs').TypegenError} Unknown uid or too many fields.
   */
  async generate(options = {}) {
    const plugin = strapi.plugin('magic-editor-x');
    const customBlocks = await plugin.service('custom-blocks').list({ enabledOnly: false });
    const codeBlocks = plugin.service('blocks').list();
    return generateTypes(
      {
        contentTypes: strapi.contentTypes,
        components: strapi.components,
        customBlocks,
        codeBlocks,
        uids: options.uids,
      },
      { importFrom: options.importFrom, version: options.version }
    );
  },
});
