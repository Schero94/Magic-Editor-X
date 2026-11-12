/**
 * Custom block SDK (`magic-editor-x/blocks`): define a block type once and
 * pass the same object to the server (`strapi.plugin('magic-editor-x')
 * .service('blocks').register(definition)`), the admin
 * (`app.getPlugin('magic-editor-x').apis.registerBlock({ definition, tool })`)
 * and the renderers (`renderHtml(value, { blocks: [definition] })`).
 *
 * Framework-free, no dependencies, no Node built-ins.
 */

export {
  defineBlock,
  blockJsonSchema,
  blockNameProblem,
  BlockDefinitionError,
  BLOCK_FIELD_TYPES,
  BLOCK_LIMITS,
  BLOCK_PRESETS,
  RESERVED_BLOCK_NAMES,
  SDK_COMPATIBLE_NAMES,
} from './define.mjs';
