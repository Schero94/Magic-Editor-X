'use strict';

/**
 * Worker thread entry of the MCP tools (2.5). The converters (marked,
 * htmlparser2, sanitize-html) are synchronous and some inputs take super-linear
 * time (long emphasis delimiter runs, deeply nested inline tags), so the tools
 * run here, off Strapi's event loop, and `mcp-runner.js` stops a call that
 * takes too long. Built to `dist/server/mcp-worker.js`.
 *
 * Message in: `{ id, key, args, rawHtml }`; out: `{ id, result }` or `{ id, failed: true }`
 * (no error text: it could contain input).
 */

const { parentPort } = require('node:worker_threads');
const { createHandlers } = require('./mcp-tools');

if (parentPort) {
  let rawHtml = 'sanitize';
  const handlers = createHandlers({ rawHtml: () => rawHtml });
  parentPort.on('message', (message) => {
    const id = message && message.id;
    try {
      rawHtml = message.rawHtml || 'sanitize';
      const handler = Object.prototype.hasOwnProperty.call(handlers, message.key)
        ? handlers[message.key]
        : null;
      if (!handler) throw new Error('unknown tool');
      parentPort.postMessage({ id, result: handler(message.args) });
    } catch {
      parentPort.postMessage({ id, failed: true });
    }
  });
}
