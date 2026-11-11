'use strict';

module.exports = {
  register: require('./register'),
  bootstrap: require('./bootstrap'),
  destroy: require('./destroy'),
  config: require('./config'),
  contentTypes: require('./content-types'),
  controllers: require('./controllers'),
  middlewares: require('./middlewares'),
  policies: {},
  routes: require('./routes'),
  services: require('./services'),
};
