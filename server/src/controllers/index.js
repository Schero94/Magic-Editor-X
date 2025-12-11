/**
 * Magic Editor X - Controllers
 */
'use strict';

const editor = require('./editor-controller');
const realtime = require('./realtime-controller');
const collaboration = require('./collaboration-controller');
const license = require('./license-controller');
const snapshot = require('./snapshot-controller');

module.exports = {
  editor,
  realtime,
  collaboration,
  license,
  snapshot,
};
