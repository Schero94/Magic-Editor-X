/**
 * The plugin's registration (`register`, `bootstrap`) and the Redux middlewares it adds to the
 * admin store (`app.addMiddlewares`: logout draft cleanup, session state, session guard, sign-in
 * tab closer). Strapi creates the admin store once, but a middleware factory runs per store
 * (tests, hot reload): neither may leave listeners, BroadcastChannels, intervals or timers.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configureStore } from '@reduxjs/toolkit';
import { snapshotResources } from './harness/index.jsx';
import plugin from '../../admin/src/index.js';
import {
  SIGN_IN_WINDOW_NAME,
  createSessionGuard,
  createSessionGuardMiddleware,
  createSignInTabCloser,
} from '../../admin/src/editor/session-guard.mjs';

/**
 * Resources created since a snapshot that still exist.
 * @param {object} before - Snapshot.
 * @returns {string[]} Leftovers.
 */
const leftovers = (before) => {
  const { resources } = globalThis.__strictHarness;
  const out = [];
  for (const [kind, map] of [
    ['interval', resources.intervals],
    ['timeout', resources.timeouts],
    ['listener', resources.listeners],
  ])
    for (const [id, entry] of map) {
      // A pending library timeout expires on its own (same rule as the harness's expectNoLeaks).
      if (kind === 'timeout' && entry.origin.startsWith('lib:')) continue;
      if (!before[`${kind}s`].has(id)) out.push(`${kind} ${entry.origin}`);
    }
  for (const socket of resources.sockets)
    if (!before.sockets.has(socket)) out.push(`${socket.kind} ${socket.url}`);
  return out;
};

/**
 * A minimal admin app: records what the plugin registers.
 * @returns {object} App.
 */
const fakeApp = () => {
  const recorded = { middlewares: [], widgets: [], settings: [], panels: [], ctbInputs: [] };
  return {
    recorded,
    registerPlugin: () => {},
    widgets: { register: (entry) => recorded.widgets.push(...[].concat(entry)) },
    customFields: { register: () => {} },
    addSettingsLink: (_section, links) => recorded.settings.push(...links),
    addMiddlewares: (list) => recorded.middlewares.push(...list),
    getPlugin: (id) =>
      id === 'content-manager'
        ? { apis: { addEditViewSidePanel: (panels) => recorded.panels.push(...panels) } }
        : id === 'content-type-builder'
          ? { apis: { forms: { components: { add: (entry) => recorded.ctbInputs.push(entry) } } } }
          : undefined,
  };
};

/**
 * A store with the plugin's middlewares, as Strapi builds the admin store.
 * @param {Function[]} factories - `app.addMiddlewares` entries.
 * @returns {object} Store.
 */
const storeWith = (factories) =>
  configureStore({
    reducer: { probe: (state = 0) => state },
    middleware: (getDefault) => getDefault().concat(factories.map((factory) => factory())),
  });

test('register and bootstrap add the entries and leave no global listeners or timers', () => {
  const before = snapshotResources();
  const app = fakeApp();
  plugin.register(app);
  plugin.bootstrap(app);
  assert.equal(app.recorded.middlewares.length, 4);
  assert.equal(app.recorded.widgets.length, 3);
  assert.equal(app.recorded.settings.length, 4);
  assert.equal(app.recorded.panels.length, 1);
  assert.equal(app.recorded.ctbInputs.length, 1);
  assert.deepEqual(leftovers(before), []);
});

test('middlewares: two stores and the session actions leave nothing behind', async () => {
  const app = fakeApp();
  plugin.register(app);
  const before = snapshotResources();
  for (let index = 0; index < 2; index += 1) {
    const store = storeWith(app.recorded.middlewares);
    store.dispatch({ type: 'adminApi/executeQuery/rejected', payload: { status: 401 }, meta: {} });
    store.dispatch({ type: 'admin/setToken', payload: 'token' });
    store.dispatch({
      type: 'adminApi/executeMutation/pending',
      meta: { arg: { endpointName: 'logout' } },
    });
    store.dispatch({ type: 'admin/logout' });
    store.dispatch({ type: 'admin/login', payload: { token: 'token' } });
  }
  assert.deepEqual(leftovers(before), [], 'no listener, channel, interval or timer per store');
});

test('session guard middleware: one guard per store sees the session end and resume', () => {
  const guard = createSessionGuard();
  const store = storeWith([createSessionGuardMiddleware.bind(null, guard)]);
  store.dispatch({ type: 'adminApi/executeQuery/rejected', payload: { status: 401 }, meta: {} });
  assert.equal(guard.getState().status, 'ended');
  store.dispatch({ type: 'admin/login', payload: { token: 'token' } });
  assert.equal(guard.getState().status, 'active');
});

test('sign-in tab closer: only its own tab, and its one timer runs out', async () => {
  const before = snapshotResources();
  let closed = 0;
  const win = {
    name: SIGN_IN_WINDOW_NAME,
    setTimeout: (callback, delay) => globalThis.setTimeout(callback, delay),
    close: () => {
      closed += 1;
    },
  };
  const store = storeWith([() => createSignInTabCloser({ win, delayMs: 5 })]);
  store.dispatch({ type: 'admin/login', payload: { token: 'token' } });
  store.dispatch({ type: 'admin/login', payload: { token: 'token' } });
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(closed, 1, 'the tab closes once');
  assert.equal(win.name, '', 'the tab gives up its sign-in name');
  assert.deepEqual(leftovers(before), []);
});
