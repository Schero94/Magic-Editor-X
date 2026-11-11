import { PLUGIN_ID } from '../pluginId';

/**
 * Prefixes a translation key with the plugin id.
 * @param {string} id - Key such as `editor.toolbar.fullscreen`.
 * @returns {string} Runtime id `magic-editor-x.<key>`.
 */
export const getTranslation = (id) => `${PLUGIN_ID}.${id}`;
