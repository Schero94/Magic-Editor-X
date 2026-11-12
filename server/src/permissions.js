'use strict';

/**
 * RBAC actions of Magic Editor X. Registered in bootstrap; the admin mirrors
 * the ids in admin/src/permissions.js for menu links and screens.
 *
 * `access` keeps its 1.x uid so existing roles keep using the editor after the
 * upgrade.
 */

const PLUGIN = 'magic-editor-x';

const ACTIONS = Object.freeze({
  access: `plugin::${PLUGIN}.access`,
  collaborate: `plugin::${PLUGIN}.collaborate`,
  ai: `plugin::${PLUGIN}.ai.use`,
  customBlocksManage: `plugin::${PLUGIN}.custom-blocks.manage`,
  settingsRead: `plugin::${PLUGIN}.settings.read`,
  settingsUpdate: `plugin::${PLUGIN}.settings.update`,
  commentsRead: `plugin::${PLUGIN}.comments.read`,
  commentsWrite: `plugin::${PLUGIN}.comments.write`,
  commentsModerate: `plugin::${PLUGIN}.comments.moderate`,
  grammar: `plugin::${PLUGIN}.grammar.use`,
});

const ACTION_DEFINITIONS = [
  { uid: 'access', displayName: 'Use the editor (uploads, link previews, custom blocks, version history)' },
  { uid: 'collaborate', displayName: 'Edit together in real time' },
  { uid: 'ai.use', displayName: 'Use the AI assistant' },
  { uid: 'custom-blocks.manage', displayName: 'Manage custom blocks' },
  { uid: 'settings.read', displayName: 'Read settings' },
  { uid: 'settings.update', displayName: 'Update settings' },
  { uid: 'comments.read', displayName: 'Read block comments' },
  {
    uid: 'comments.write',
    displayName: 'Write block comments (comment, reply, resolve, edit and delete own)',
  },
  { uid: 'comments.moderate', displayName: "Moderate block comments (delete anyone's)" },
  { uid: 'grammar.use', displayName: 'Use the grammar check (LanguageTool)' },
];

/**
 * Registers the plugin actions with the admin permission provider.
 * @param {import('@strapi/strapi').Core.Strapi} strapi - Strapi instance.
 * @returns {Promise<void>}
 * @throws {Error} When the admin permission service is missing.
 */
const registerPermissions = async (strapi) => {
  const actionProvider = strapi.admin?.services?.permission?.actionProvider;
  if (typeof actionProvider?.registerMany !== 'function') {
    throw new Error('Strapi admin permission action provider is not available');
  }
  await actionProvider.registerMany(
    ACTION_DEFINITIONS.map((action) => ({ section: 'plugins', pluginName: PLUGIN, ...action }))
  );
};

/**
 * Route policy list: authenticated admin plus every listed action.
 * @param {...string} actions - Required action ids.
 * @returns {Array} Policies.
 */
const requireActions = (...actions) => [
  'admin::isAuthenticatedAdmin',
  { name: 'admin::hasPermissions', config: { actions } },
];

module.exports = { PLUGIN, ACTIONS, ACTION_DEFINITIONS, registerPermissions, requireActions };
