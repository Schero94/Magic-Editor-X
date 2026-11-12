'use strict';

const { registerBlockDefinition } = require('../../../shared/blocks/registry.mjs');
const { BlockDefinitionError } = require('../../../shared/blocks/define.mjs');
const { activeBlocks, activeBlock } = require('../../../shared/blocks/active.mjs');

/**
 * Code-registered blocks (custom block SDK, 2.3).
 *
 * The host app registers definitions in its `register()` lifecycle:
 * `strapi.plugin('magic-editor-x').service('blocks').register(definition)`.
 * From then on the sanitiser, field presets, the collaboration guard, the
 * Content API `?mex=` output, GraphQL `…Rendered`, quality, version diff and
 * find and replace use the definition for that block type.
 *
 * Rules: names follow the custom block name rule and must not be built-in
 * tool names (`RESERVED_BLOCK_NAMES`) or another registered name (ignoring
 * case); a Settings-defined custom block with the same name stops the start
 * in bootstrap. After the plugin's bootstrap the registry is sealed, so every
 * definition is known before content is written.
 * @param {{ strapi: import('@strapi/strapi').Core.Strapi }} context - Strapi.
 * @returns {object} Service.
 */
module.exports = ({ strapi }) => {
  let sealed = false;

  /**
   * Summary of a definition for the admin (names and field types only).
   * @param {object} definition - Compiled definition.
   * @returns {{ name: string, version: number, title: string|null, presets: string[], fields: Array<{ key: string, type: string }> }} Summary.
   */
  const summary = (definition) => ({
    name: definition.name,
    version: definition.version,
    title: definition.title || null,
    presets: [...definition.presets],
    fields: Object.entries(definition.schema).map(([key, field]) => ({ key, type: field.type })),
  });

  return {
    /**
     * Registers a block definition (call it in the host app's `register()`).
     * @param {object} definition - Definition from `defineBlock` (`magic-editor-x/blocks`).
     * @returns {Readonly<object>} The compiled definition.
     * @throws {BlockDefinitionError} Invalid definition, reserved or taken name, or called after bootstrap (`REGISTRY_SEALED`).
     */
    register(definition) {
      if (sealed)
        throw new BlockDefinitionError(
          'Magic Editor X blocks must be registered in register(), before the plugin bootstrap',
          'REGISTRY_SEALED'
        );
      return registerBlockDefinition(definition);
    },

    /**
     * Registered definitions.
     * @returns {object[]} Compiled definitions in registration order.
     */
    list() {
      return activeBlocks();
    },

    /**
     * One registered definition.
     * @param {string} name - Block type.
     * @returns {object|null} Compiled definition.
     */
    get(name) {
      return activeBlock(name);
    },

    /**
     * Summaries for `GET /config` (`data.codeBlocks`).
     * @returns {Array<object>} Summaries.
     */
    summaries() {
      return activeBlocks().map(summary);
    },

    /**
     * Bootstrap step: refuses to start when a Settings-defined custom block
     * uses the name of a code-registered block (ignoring case), then seals
     * the registry.
     * @returns {Promise<void>}
     * @throws {BlockDefinitionError} `NAME_TAKEN` on a clash.
     */
    async verify() {
      const registered = activeBlocks();
      if (registered.length) {
        const rows = await strapi.db
          .query('plugin::magic-editor-x.custom-block')
          .findMany({ select: ['name'] });
        const names = new Map(
          registered.map((definition) => [definition.name.toLowerCase(), definition.name])
        );
        const clashes = rows
          .map((row) => String(row.name || ''))
          .filter((name) => names.has(name.toLowerCase()));
        if (clashes.length)
          throw new BlockDefinitionError(
            `Magic Editor X: the code-registered block(s) ${clashes
              .map((name) => `"${names.get(name.toLowerCase())}"`)
              .join(
                ', '
              )} clash with a custom block defined in Settings > Custom blocks. Rename or delete the Settings block, or rename the code definition (stored content keeps its block type).`,
            'NAME_TAKEN'
          );
      }
      sealed = true;
    },

    /**
     * True when a name is taken by a code-registered block (ignoring case).
     * @param {string} name - Name.
     * @returns {boolean} Result.
     */
    isRegisteredName(name) {
      const lower = String(name).toLowerCase();
      return activeBlocks().some((definition) => definition.name.toLowerCase() === lower);
    },
  };
};
