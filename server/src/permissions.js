'use strict';

const PLUGIN_ACCESS_ACTION = 'plugin::magic-editor-x.access';

const registerPermissions = async (strapi) => {
  const actionProvider = strapi.admin?.services?.permission?.actionProvider;
  if (typeof actionProvider?.registerMany !== 'function') {
    throw new Error('Strapi admin permission action provider is not available.');
  }
  await actionProvider.registerMany([{
    section: 'plugins',
    displayName: 'Access Magic Editor X',
    uid: 'access',
    pluginName: 'magic-editor-x',
  }]);
};

module.exports = { PLUGIN_ACCESS_ACTION, registerPermissions };
