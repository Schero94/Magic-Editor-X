'use strict';

/**
 * Runs MCP tool calls (2.5) in one worker thread, one call at a time, with a
 * time limit: a call over the limit terminates the worker (the next call starts
 * a new one), so a slow input never blocks Strapi's event loop. The queue is
 * bounded. Results are tool results (`isError` with a fixed text on failure).
 */

const { Worker } = require('node:worker_threads');
const { fail } = require('./mcp-tools');

/** Time limit of one tool call. */
const TIMEOUT_MS = 10000;
/** Calls waiting behind the running one before new calls are refused. */
const MAX_QUEUE = 20;
/** Memory limits of the worker (MiB). */
const RESOURCE_LIMITS = Object.freeze({ maxOldGenerationSizeMb: 512, maxYoungGenerationSizeMb: 64 });

/**
 * Path of the worker script: `dist/server/mcp-worker.js` next to the server
 * bundle, or `server/src/utils/mcp-worker.js` next to this file in the sources.
 * @returns {string} Absolute path.
 */
const workerPath = () => require.resolve('./mcp-worker.js');

/**
 * Creates a runner.
 * @param {{ timeoutMs?: number, maxQueue?: number, logger?: { warn: Function }, path?: string }} [options] - Limits, logger, worker script.
 * @returns {{ run: (key: string, args: object, rawHtml: string) => Promise<object>, stop: () => Promise<void> }} Runner.
 */
const createRunner = (options = {}) => {
  const timeoutMs = options.timeoutMs || TIMEOUT_MS;
  const maxQueue = options.maxQueue === undefined ? MAX_QUEUE : options.maxQueue;
  const logger = options.logger || { warn: () => {} };
  let worker = null;
  let nextId = 0;
  let current = null;
  const queue = [];

  const finish = (result) => {
    const job = current;
    current = null;
    if (job) {
      clearTimeout(job.timer);
      job.resolve(result);
    }
    pump();
  };

  const kill = () => {
    if (!worker) return;
    const old = worker;
    worker = null;
    old.removeAllListeners();
    old.on('error', () => {});
    old.terminate().catch(() => {});
  };

  const spawn = () => {
    worker = new Worker(options.path || workerPath(), { resourceLimits: RESOURCE_LIMITS });
    worker.unref();
    worker.on('message', (message) => {
      if (!current || !message || message.id !== current.id) return;
      finish(message.failed ? fail('INTERNAL') : message.result);
    });
    worker.on('error', (error) => {
      logger.warn('MCP tool worker failed', { code: error && error.code });
      kill();
      finish(fail(error && error.code === 'ERR_WORKER_OUT_OF_MEMORY' ? 'TOO_LARGE' : 'INTERNAL'));
    });
    worker.on('exit', () => {
      if (worker) {
        worker = null;
        finish(fail('INTERNAL'));
      }
    });
  };

  const pump = () => {
    if (current || !queue.length) return;
    current = queue.shift();
    if (!worker) spawn();
    current.timer = setTimeout(() => {
      logger.warn('MCP tool call stopped after the time limit', { tool: current && current.key, timeoutMs });
      kill();
      finish(fail('TIMEOUT'));
    }, timeoutMs);
    worker.postMessage({ id: current.id, key: current.key, args: current.args, rawHtml: current.rawHtml });
  };

  return {
    run(key, args, rawHtml) {
      if (queue.length >= maxQueue) return Promise.resolve(fail('BUSY'));
      return new Promise((resolve) => {
        nextId += 1;
        queue.push({ id: nextId, key, args, rawHtml, resolve });
        pump();
      });
    },
    async stop() {
      for (const job of queue.splice(0)) job.resolve(fail('BUSY'));
      if (current) finish(fail('BUSY'));
      kill();
    },
  };
};

module.exports = { createRunner, TIMEOUT_MS, MAX_QUEUE };
