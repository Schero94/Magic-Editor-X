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

// 2.5: inline annotations (glossary, abbreviation, ...).
export {
  defineInlineAnnotation,
  annotationJsonSchema,
  abbreviationAnnotation,
  ANNOTATION_ATTRIBUTE,
  ANNOTATION_VALUE_PREFIX,
  ANNOTATION_FIELD_TYPES,
  ANNOTATION_LIMITS,
  ANNOTATION_PRESETS,
  ANNOTATION_RENDER_TAGS,
  ANNOTATION_SHORTCUTS,
} from './annotations.mjs';
