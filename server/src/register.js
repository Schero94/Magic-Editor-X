/**
 * Magic Editor X - Server Register
 * Registers the custom field on the Strapi server
 * @see https://docs.strapi.io/cms/features/custom-fields
 */
'use strict';

const { createLogger } = require('./utils');

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);

  // Register the custom field on the server
  strapi.customFields.register({
    name: 'richtext',
    plugin: 'magic-editor-x',
    type: 'text', // Stores JSON content as text
    inputSize: {
      default: 12, // Full width
      isResizable: true,
    },
  });

  logger.info('Custom field registered');
};
