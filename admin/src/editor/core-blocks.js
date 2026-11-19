import { prepareCoreBlocks } from './core-blocks-logic.mjs';

export { CoreBlockEditorError } from './core-blocks-logic.mjs';

/**
 * Core Blocks bridge (2.7), admin helper. The host app calls
 * `app.getPlugin('magic-editor-x').apis.addCoreBlocks({ callout: { renderElement, ... } })` in its
 * `src/admin/app.js` `register(app)`; the blocks go to the Content Manager's `addRichTextBlocks`
 * (Strapi 5.46 and newer) and the types are remembered, so Settings can show block types the
 * editor offers but the server has not registered (those would be rejected on save).
 */

let appRef = null;
const editorTypes = new Set();

/**
 * Remembers the admin app. Called by the plugin's own `register(app)`.
 * @param {object} app - Strapi admin app.
 * @returns {void}
 */
export const bindCoreBlocksApp = (app) => {
  appRef = app;
};

/**
 * Adds custom blocks to Strapi's core Blocks editor. Use the node `type` as the key and register
 * the same type on the server with `strapi.plugin('magic-editor-x').service('core-blocks').register()`.
 * @param {Record<string, object>} blocks - Content Manager block definitions keyed by node type;
 *   `matchNode` defaults to `node.type === <key>`.
 * @returns {boolean} True when the blocks were added; false (with one console error) when the
 *   running Strapi has no `addRichTextBlocks` (before 5.46).
 * @throws {import('./core-blocks-logic.mjs').CoreBlockEditorError} On invalid definitions.
 * @sideeffect Calls `addRichTextBlocks`; records the types for Settings.
 */
export const addCoreBlocks = (blocks) => {
  const prepared = prepareCoreBlocks(blocks);
  const contentManager =
    appRef && typeof appRef.getPlugin === 'function' ? appRef.getPlugin('content-manager') : null;
  const add = contentManager && contentManager.apis && contentManager.apis.addRichTextBlocks;
  if (typeof add !== 'function') {
    console.error(
      '[magic-editor-x] addCoreBlocks needs Strapi 5.46 or newer (Content Manager addRichTextBlocks).'
    );
    return false;
  }
  add(prepared);
  for (const type of Object.keys(prepared)) editorTypes.add(type);
  return true;
};

/**
 * Types added with `addCoreBlocks` in this admin bundle.
 * @returns {string[]} Types in insertion order.
 */
export const coreBlockEditorTypes = () => [...editorTypes];
