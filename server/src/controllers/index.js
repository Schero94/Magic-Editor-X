'use strict';

module.exports = {
  config: require('./config'),
  editor: require('./editor'),
  customBlocks: require('./custom-blocks'),
  collaboration: require('./collaboration'),
  history: require('./history'),
  ai: require('./ai'),
  grammar: require('./grammar'),
  settings: require('./settings'),
  links: require('./links'),
  quality: require('./quality'),
  comments: require('./comments'),
  notifications: require('./notifications'),
  suggestions: require('./suggestions'),
  templates: require('./templates'),
  audit: require('./audit'),
  // 2.5 entry panel and homepage widgets
  entryPanel: require('./entry-panel'),
  reuse: require('./reuse'),
  // 2.5: private upload providers
  media: require('./media'),
  // 2.13: admin migration wizard (Settings > Migrate content)
  migration: require('./migration'),
};
