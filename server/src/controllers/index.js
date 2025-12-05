/**
 * Magic Editor X - Controllers
 */
'use strict';

const editor = require('./editor-controller');
const realtime = require('./realtime-controller');
const collaboration = require('./collaboration-controller');
const license = require('./license-controller');

module.exports = {
  editor,
  realtime,
  collaboration,
  license,
};
