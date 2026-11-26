/**
 * JSON Schema of a field preset (2.5, MCP resources and the validate tool):
 * the published value schema (`shared/schema.mjs`) narrowed to the blocks,
 * heading levels and block limit the preset allows. Rules the schema cannot
 * express (inline tools, link targets, alternative texts, character limit) are
 * described in `x-mex-preset` and checked by `checkPreset`.
 */

import { buildEditorSchema } from './schema.mjs';
import { INLINE_TOOLS } from './presets.mjs';
import { EDITOR_DATA_LIMITS } from './editor-data.mjs';

/**
 * Plain description of a preset (also used by the MCP prompt).
 * @param {import('./presets.mjs').FieldPreset} preset - Resolved preset.
 * @returns {{ name: string, blocks: string[]|null, inlineTools: string[], headingLevels: number[], maxBlocks: number|null, maxCharacters: number|null, requireAlt: boolean, linkTargets: string }} Summary.
 */
export const describePreset = (preset) => ({
  name: preset.name,
  blocks: preset.blocks ? [...preset.blocks] : null,
  excludedBlocks: [...(preset.excludedBlocks || [])],
  inlineTools: preset.inline ? [...preset.inline] : [...INLINE_TOOLS],
  headingLevels: [...preset.headingLevels],
  maxBlocks: preset.maxBlocks,
  maxCharacters: preset.maxCharacters,
  requireAlt: preset.requireAlt,
  linkTargets: preset.linkTargets,
});

/**
 * Builds the JSON Schema (2020-12) of the values a preset accepts.
 * @param {import('./presets.mjs').FieldPreset} preset - Resolved preset (`resolveFieldPreset`).
 * @returns {object} JSON Schema document (no `$id`: it is not published under a URL).
 */
export const buildPresetSchema = (preset) => {
  // Deep copy: buildEditorSchema() shares the frozen per-block schemas, which must never change.
  const schema = JSON.parse(JSON.stringify(buildEditorSchema()));
  delete schema.$id;
  schema.title = `Magic Editor X field value (preset "${preset.name}")`;
  schema.description = `${schema.description} This schema is narrowed to what the field preset allows; inline tools, link targets, alternative texts and the character limit are listed in x-mex-preset and checked on save.`;
  const maxItems = Math.min(EDITOR_DATA_LIMITS.maxBlocks, preset.maxBlocks || EDITOR_DATA_LIMITS.maxBlocks);
  schema.properties.blocks = { ...schema.properties.blocks, maxItems };
  const block = schema.$defs.block;
  if (preset.blocks) {
    block.properties.type = { type: 'string', enum: [...preset.blocks] };
    block.allOf = block.allOf.filter((rule) => {
      const type = rule.if && rule.if.properties && rule.if.properties.type && rule.if.properties.type.const;
      return typeof type !== 'string' || preset.blocks.includes(type);
    });
    for (const key of Object.keys(schema.$defs)) {
      if (key.startsWith('data_') && !preset.blocks.includes(key.slice(5))) delete schema.$defs[key];
    }
  }
  // 2.13: an open list without some blocks (`standard`: no raw HTML).
  const excluded = preset.blocks ? [] : preset.excludedBlocks || [];
  if (excluded.length) {
    block.properties.type = { ...block.properties.type, not: { enum: [...excluded] } };
    block.allOf = block.allOf.filter((rule) => {
      const type = rule.if && rule.if.properties && rule.if.properties.type && rule.if.properties.type.const;
      return typeof type !== 'string' || !excluded.includes(type);
    });
    for (const type of excluded) delete schema.$defs[`data_${type}`];
  }
  const header = schema.$defs.data_header;
  if (header && preset.headingLevels.length && preset.headingLevels.length < 6) {
    header.properties.level = { type: 'integer', enum: [...preset.headingLevels] };
  }
  schema['x-mex-preset'] = describePreset(preset);
  return schema;
};
