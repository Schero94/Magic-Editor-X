/**
 * The one Yjs import for CommonJS server code.
 *
 * Server modules written as CommonJS take Yjs from here instead of
 * `require('yjs')`. The shared modules import Yjs as an ES module, and in the
 * ESM server bundle a direct `require('yjs')` would load the CommonJS build of
 * Yjs next to its ES module build: two copies, whose documents and types fail
 * each other's constructor checks (https://github.com/yjs/yjs/issues/438).
 * Through this module both server bundles load exactly one build.
 */
export * from 'yjs';
