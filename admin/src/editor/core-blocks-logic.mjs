/**
 * Core Blocks bridge (2.7), admin side: checks the block definitions a host passes to
 * `app.getPlugin('magic-editor-x').apis.addCoreBlocks(...)` before they go to Strapi's
 * Content Manager `addRichTextBlocks`, and compares editor and server registrations for Settings.
 * Pure functions (no React, no Strapi), so `node --test` covers them.
 */

/** Same rule as the server registry (server/src/utils/core-blocks-bridge.js). */
export const CORE_BLOCK_TYPE_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

/**
 * Keys the core Blocks editor or Strapi's validator already own: node types and the
 * Content Manager's built-in block keys (docs: content-manager-apis#addrichtextblocks).
 */
export const RESERVED_CORE_BLOCK_KEYS = Object.freeze([
  'paragraph',
  'heading',
  'quote',
  'list',
  'list-item',
  'image',
  'code',
  'text',
  'link',
  'heading-one',
  'heading-two',
  'heading-three',
  'heading-four',
  'heading-five',
  'heading-six',
  'list-ordered',
  'list-unordered',
]);

/** Error of `addCoreBlocks` with a stable `code` (`INVALID_BLOCKS`, `INVALID_TYPE`, `RESERVED_TYPE`, `INVALID_BLOCK`). */
export class CoreBlockEditorError extends Error {
  /**
   * @param {string} code - Stable code.
   * @param {string} message - Fixed message.
   */
  constructor(code, message) {
    super(`[magic-editor-x] addCoreBlocks: ${message}`);
    this.name = 'CoreBlockEditorError';
    this.code = code;
  }
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/**
 * Checks the blocks for `addRichTextBlocks` and fills `matchNode` with a type match when it is
 * missing. Every key is the node `type` the block writes, the same `type` the server registers.
 * @param {Record<string, object>} blocks - Block definitions by type (see the Content Manager docs).
 * @returns {Record<string, object>} New object with the same definitions (and `matchNode`).
 * @throws {CoreBlockEditorError} On a missing object, an invalid or reserved type, or a block
 *   without `renderElement` (or without `icon` and `label` while `isInBlocksSelector` is true).
 */
export const prepareCoreBlocks = (blocks) => {
  if (!isObject(blocks) || !Object.keys(blocks).length)
    throw new CoreBlockEditorError('INVALID_BLOCKS', 'pass an object of blocks keyed by node type');
  const out = {};
  for (const [type, block] of Object.entries(blocks)) {
    if (type.length > 64 || !CORE_BLOCK_TYPE_PATTERN.test(type))
      throw new CoreBlockEditorError(
        'INVALID_TYPE',
        `"${type.slice(0, 64)}" must be lowercase letters and digits joined by single hyphens`
      );
    if (RESERVED_CORE_BLOCK_KEYS.includes(type))
      throw new CoreBlockEditorError('RESERVED_TYPE', `"${type}" is a built-in block of the Blocks editor`);
    if (!isObject(block) || typeof block.renderElement !== 'function')
      throw new CoreBlockEditorError('INVALID_BLOCK', `"${type}" needs a renderElement function`);
    if (block.isInBlocksSelector === true && (!block.icon || !isObject(block.label)))
      throw new CoreBlockEditorError(
        'INVALID_BLOCK',
        `"${type}" needs an icon and a label to appear in the selector`
      );
    out[type] = {
      ...block,
      matchNode:
        typeof block.matchNode === 'function'
          ? block.matchNode
          : (node) => Boolean(node) && node.type === type,
    };
  }
  return out;
};

/**
 * Compares the types the editor knows (through `addCoreBlocks`) with the types the server
 * registered. An editor-only type is rejected when an entry is saved.
 * @param {{ type: string }[]} serverTypes - `coreBlocks.types` from GET /settings.
 * @param {string[]} editorTypes - Types added with `addCoreBlocks` in this admin bundle.
 * @returns {{ both: string[], editorOnly: string[], serverOnly: string[] }} Sorted type names.
 */
export const coreBlockCoverage = (serverTypes, editorTypes) => {
  const server = new Set(
    (Array.isArray(serverTypes) ? serverTypes : []).map((entry) => entry && entry.type).filter(Boolean)
  );
  const editor = new Set(Array.isArray(editorTypes) ? editorTypes : []);
  const sort = (list) => [...list].sort();
  return {
    both: sort([...server].filter((type) => editor.has(type))),
    editorOnly: sort([...editor].filter((type) => !server.has(type))),
    serverOnly: sort([...server].filter((type) => !editor.has(type))),
  };
};
