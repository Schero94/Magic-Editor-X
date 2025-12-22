/**
 * Magic Editor X - Services
 */
'use strict';

const editorService = require('./editor-service');
const realtimeService = require('./realtime-service');
const accessService = require('./access-service');
const snapshotService = require('./snapshot-service');
const licenseService = require('./license-service');
const customBlockService = require('./custom-block-service');

module.exports = {
  editorService,
  realtimeService,
  accessService,
  snapshotService,
  licenseService,
  customBlockService,
};
