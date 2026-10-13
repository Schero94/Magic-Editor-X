import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const cjsModule = require('../dist/server/index.js');
const esmModule = await import('../dist/server/index.mjs');
const cjsPlugin = cjsModule.default || cjsModule;
const esmPlugin = esmModule.default || esmModule;
const expectedTypes = {
  bootstrap: 'function',
  destroy: 'function',
  register: 'function',
  config: 'object',
  contentTypes: 'object',
  controllers: 'object',
  middlewares: 'object',
  policies: 'object',
  routes: 'object',
  services: 'object',
};

for (const [format, plugin] of [['CJS', cjsPlugin], ['ESM', esmPlugin]]) {
  for (const [key, expected] of Object.entries(expectedTypes)) {
    if (typeof plugin?.[key] !== expected) {
      throw new Error(`${format} server bundle export ${key} must be ${expected}, received ${typeof plugin?.[key]}`);
    }
  }
}

console.log('Magic Editor X CJS and ESM server bundles load with all Strapi plugin exports');
