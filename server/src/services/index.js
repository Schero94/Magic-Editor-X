/**
 * Magic Editor X - Services
 */
'use strict';

const editorService = require('./editor-service');
const realtimeService = require('./realtime-service');
const accessService = require('./access-service');
const snapshotService = require('./snapshot-service');

module.exports = {
  editorService,
  realtimeService,
  accessService,
  snapshotService,
};
