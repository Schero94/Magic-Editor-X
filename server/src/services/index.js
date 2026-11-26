'use strict';

module.exports = {
  store: require('./store'),
  access: require('./access'),
  links: require('./links'),
  references: require('./references'),
  quality: require('./quality'),
  'link-schedule': require('./link-schedule'),
  editor: require('./editor'),
  settings: require('./settings'),
  ai: require('./ai'),
  grammar: require('./grammar'),
  'custom-blocks': require('./custom-blocks'),
  blocks: require('./blocks'),
  history: require('./history'),
  // 2.12: published version of a field ("Changes since last publish")
  published: require('./published'),
  comments: require('./comments'),
  'comment-notifications': require('./comment-notifications'),
  suggestions: require('./suggestions'),
  templates: require('./templates'),
  'synced-versions': require('./synced-versions'),
  audit: require('./audit'),
  collaboration: require('./collaboration'),
  migrations: require('./migrations'),
  migrate: require('./migrate'),
  // 2.13: admin migration wizard on top of `migrate`
  'migration-wizard': require('./migration-wizard'),
  // 2.5 entry panel and homepage widgets
  'entry-panel': require('./entry-panel'),
  reuse: require('./reuse'),
  // 2.5: private upload providers (signed Media Library URLs)
  media: require('./media'),
  // 2.7: Core Blocks bridge (custom blocks in Strapi's core Blocks field)
  'core-blocks': require('./core-blocks'),
  // 2.8: TypeScript types per field (`magic-editor-x types`)
  types: require('./types'),
};
