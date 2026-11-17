/**
 * Loads one server bundle format (`cjs` or `esm`) and checks the Strapi plugin
 * exports. Run by verify-server-bundle.mjs in its own process, because Strapi
 * loads only one server entry and both builds keep `yjs` external: loading
 * both in one process would load Yjs twice.
 */
import { createRequire } from 'node:module';

const format = process.argv[2];
const require = createRequire(import.meta.url);
let mod;
if (format === 'cjs') mod = require('../dist/server/index.js');
else if (format === 'esm') mod = await import('../dist/server/index.mjs');
else throw new Error(`Unknown server bundle format: ${format}`);
const plugin = mod.default || mod;
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
for (const [key, expected] of Object.entries(expectedTypes)) {
  if (typeof plugin?.[key] !== expected) {
    throw new Error(
      `${format.toUpperCase()} server bundle export ${key} must be ${expected}, received ${typeof plugin?.[key]}`
    );
  }
}
console.log(`${format.toUpperCase()} server bundle OK`);
