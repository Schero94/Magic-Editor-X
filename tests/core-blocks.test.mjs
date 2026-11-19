// Core Blocks bridge (2.7). Runs against the REAL entity validator of the installed @strapi/core,
// so the CI jobs `peer-floor` (5.38.0) and `core-blocks` (floor and newest 5.x) catch a Strapi
// change in the hook point or in the blocks validator.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { yup, errors } = require('@strapi/utils');
const bridge = require('../server/src/utils/core-blocks-bridge.js');
const coreBlocksService = require('../server/src/services/core-blocks.js');
const config = require('../server/src/config/index.js');

const corePackage = require.resolve('@strapi/core/package.json');
const coreVersion = require('@strapi/core/package.json').version;
// Not in @strapi/core's exports map: loaded by file path on purpose, it is the object the
// Document Service and `strapi.entityValidator` share.
const realValidator = require(
  path.join(path.dirname(corePackage), 'dist/services/entity-validator/index.js')
);

const MODELS = {
  'api::article.article': {
    uid: 'api::article.article',
    modelType: 'contentType',
    kind: 'collectionType',
    info: { displayName: 'Article', singularName: 'article', pluralName: 'articles' },
    options: { draftAndPublish: true },
    attributes: {
      title: { type: 'string' },
      body: { type: 'blocks' },
      box: { type: 'component', component: 'shared.box', repeatable: false },
      boxes: { type: 'component', component: 'shared.box', repeatable: true },
      zone: { type: 'dynamiczone', components: ['shared.box'] },
    },
  },
  'shared.box': {
    uid: 'shared.box',
    modelType: 'component',
    info: { displayName: 'Box' },
    options: {},
    attributes: { label: { type: 'string' }, content: { type: 'blocks' } },
  },
  'admin::user': {
    uid: 'admin::user',
    modelType: 'contentType',
    kind: 'collectionType',
    info: { displayName: 'User', singularName: 'user', pluralName: 'users' },
    options: {},
    attributes: { firstname: { type: 'string' } },
  },
};

globalThis.strapi = {
  getModel: (uid) => MODELS[uid],
  components: { 'shared.box': MODELS['shared.box'] },
  db: { query: () => ({ count: async () => 0 }) },
};

const ARTICLE = MODELS['api::article.article'];
const P = (text) => ({ type: 'paragraph', children: [{ type: 'text', text }] });
const CALLOUT = (text, extra = {}) => ({
  type: 'callout',
  tone: 'info',
  children: [{ type: 'text', text }],
  ...extra,
});

const helpers = bridge.createValidatorHelpers(yup);
const calloutValidator = ({ yup: y, inlineNodeValidator }) =>
  y.object().shape({
    type: y.string().equals(['callout']).required(),
    tone: y.string().oneOf(['info', 'warning']).required(),
    children: y.array().of(inlineNodeValidator).min(1).required(),
  });

const makeRegistry = () => {
  const registry = bridge.createRegistry(helpers);
  registry.register({ type: 'callout', validator: calloutValidator });
  return registry;
};

/** Wraps the real validator without touching the shared module object. */
const wrapped = (registry, { reportOnce = () => {} } = {}) => {
  const target = {
    validateEntityCreation: realValidator.validateEntityCreation,
    validateEntityUpdate: realValidator.validateEntityUpdate,
  };
  bridge.installBridge(target, {
    activeRegistry: () => registry,
    getModel: (uid) => MODELS[uid],
    errors,
    reportOnce,
  });
  return target;
};

const captureError = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  assert.fail('expected a rejection');
};

test(`the installed @strapi/core (${coreVersion}) still rejects a custom node without the bridge`, async () => {
  const error = await captureError(
    realValidator.validateEntityCreation(ARTICLE, { body: [P('a'), CALLOUT('b')] }, { isDraft: true })
  );
  assert.equal(error.name, 'ValidationError');
  assert.equal(error.message, 'Block node is of invalid type');
  assert.deepEqual(error.details.errors[0].path, ['body', '1']);
});

test('registry: types follow the rules, built-ins and duplicates are refused, validators must be Yup', () => {
  const registry = bridge.createRegistry(helpers);
  const code = (fn) => {
    try {
      fn();
    } catch (error) {
      assert.equal(error.name, 'CoreBlockDefinitionError');
      return error.code;
    }
    return null;
  };
  const schema = yup.object();
  assert.equal(
    code(() => registry.register(null)),
    'INVALID_DEFINITION'
  );
  assert.equal(
    code(() => registry.register({ type: 'callout', validator: schema, extra: 1 })),
    'INVALID_DEFINITION'
  );
  for (const type of ['Callout', 'call_out', '-x', 'x-', 'a--b', '', 'x'.repeat(65), '__proto__', 7])
    assert.equal(
      code(() => registry.register({ type, validator: schema })),
      'INVALID_TYPE',
      String(type)
    );
  for (const type of bridge.BUILTIN_TYPES)
    assert.equal(
      code(() => registry.register({ type, validator: schema })),
      'BUILTIN_TYPE'
    );
  assert.equal(
    code(() => registry.register({ type: 'callout', validator: {} })),
    'INVALID_VALIDATOR'
  );
  assert.equal(
    code(() => registry.register({ type: 'callout', validator: () => ({}) })),
    'INVALID_VALIDATOR'
  );
  assert.equal(
    code(() =>
      registry.register({
        type: 'callout',
        validator: () => {
          throw new Error('boom');
        },
      })
    ),
    'INVALID_VALIDATOR'
  );
  assert.equal(
    code(() => registry.register({ type: 'callout', validator: schema, plugin: 'Bad Name' })),
    'INVALID_DEFINITION'
  );
  assert.deepEqual(registry.register({ type: 'callout', validator: schema }), {
    type: 'callout',
    plugin: 'magic-editor-x',
  });
  assert.equal(
    code(() => registry.register({ type: 'callout', validator: schema })),
    'TYPE_TAKEN'
  );
  assert.deepEqual(
    registry.register({ type: 'pro-tip2', validator: calloutValidator, plugin: 'my-plugin' }),
    {
      type: 'pro-tip2',
      plugin: 'my-plugin',
    }
  );
  assert.deepEqual(
    registry.list().map((entry) => entry.type),
    ['callout', 'pro-tip2']
  );
  assert.equal(registry.has('constructor'), false);
  assert.equal(registry.has({}), false);
});

test('limits: plain JSON only, no prototype keys, bounded depth, values and size', () => {
  assert.equal(bridge.inspectNode(CALLOUT('ok')), null);
  const proto = JSON.parse(
    '{"type":"callout","children":[{"type":"text","text":"x","__proto__":{"admin":true}}]}'
  );
  assert.equal(bridge.inspectNode(proto).message, bridge.MESSAGES.forbiddenKey);
  assert.equal(bridge.inspectNode({ type: 'callout', constructor: 1 }).message, bridge.MESSAGES.forbiddenKey);
  assert.equal(bridge.inspectNode({ type: 'callout', prototype: {} }).message, bridge.MESSAGES.forbiddenKey);
  let deep = { type: 'callout' };
  let cursor = deep;
  for (let i = 0; i < 40; i += 1) cursor = cursor.next = {};
  assert.equal(bridge.inspectNode(deep).message, bridge.MESSAGES.tooDeep);
  assert.equal(
    bridge.inspectNode({ type: 'callout', list: Array.from({ length: 20000 }, () => 1) }).message,
    bridge.MESSAGES.tooManyValues
  );
  assert.equal(
    bridge.inspectNode({ type: 'callout', text: 'x'.repeat(300 * 1024) }).message,
    bridge.MESSAGES.tooLarge
  );
  assert.equal(bridge.inspectNode({ type: 'callout', n: Infinity }).message, bridge.MESSAGES.notJson);
  assert.equal(bridge.inspectNode({ type: 'callout', d: new Date(0) }).message, bridge.MESSAGES.notJson);
  assert.equal(bridge.inspectNode({ type: 'callout', f: () => 1 }).message, bridge.MESSAGES.notJson);
  assert.equal(bridge.inspectNode({ type: 'callout', u: undefined }).message, bridge.MESSAGES.notJson);
  assert.equal(bridge.inspectNode({ type: 'callout', [Symbol('s')]: 1 }).message, bridge.MESSAGES.notJson);
  const getter = { type: 'callout' };
  Object.defineProperty(getter, 'x', { get: () => 1, enumerable: true });
  assert.equal(bridge.inspectNode(getter).message, bridge.MESSAGES.notJson);
  // eslint-disable-next-line no-sparse-arrays -- a hole is not JSON
  assert.equal(bridge.inspectNode({ type: 'callout', list: [1, , 3] }).message, bridge.MESSAGES.notJson);
  const cyclic = { type: 'callout' };
  cyclic.self = cyclic;
  assert.ok(bridge.inspectNode(cyclic));
});

test('a registered custom block passes, stored unchanged; the caller data is not mutated', async () => {
  const target = wrapped(makeRegistry());
  const callout = CALLOUT('Heads up', { marks: { b: [1, 2] }, z: null });
  const data = { title: 'T', body: [P('a'), callout, P('c')] };
  const before = JSON.stringify(data);
  for (const [fn, options] of [
    ['validateEntityCreation', { isDraft: true }],
    ['validateEntityCreation', { isDraft: false }],
    ['validateEntityUpdate', { isDraft: true }],
    ['validateEntityUpdate', { isDraft: false }],
  ]) {
    const result = await target[fn](ARTICLE, data, options);
    assert.equal(JSON.stringify(result.body[1]), JSON.stringify(callout), fn);
    assert.equal(result.body[1], callout, 'the very node the caller sent');
    assert.equal(result.body[0].type, 'paragraph');
    assert.equal(JSON.stringify(data), before, 'input unchanged');
  }
});

test('built-in nodes and documents without custom nodes come out byte-identical to Strapi alone', async () => {
  const target = wrapped(makeRegistry());
  const data = {
    title: 'T',
    body: [P('a'), { type: 'heading', level: 2, children: [{ type: 'text', text: 'h', bold: true }] }],
    box: { label: 'x', content: [P('in box')] },
    boxes: [{ label: 'y', content: [P('in boxes')] }],
    zone: [{ __component: 'shared.box', content: [P('in zone')] }],
  };
  const original = await realValidator.validateEntityCreation(ARTICLE, data, { isDraft: false });
  const viaBridge = await target.validateEntityCreation(ARTICLE, data, { isDraft: false });
  assert.equal(JSON.stringify(viaBridge), JSON.stringify(original));
  // With a custom node, everything except that node equals Strapi's output for the same document
  // with a paragraph in its place.
  const withCustom = { ...data, body: [P('a'), CALLOUT('x'), data.body[1]] };
  const bridged = await target.validateEntityCreation(ARTICLE, withCustom, { isDraft: false });
  const reference = await realValidator.validateEntityCreation(
    ARTICLE,
    { ...data, body: [P('a'), P('x'), data.body[1]] },
    { isDraft: false }
  );
  assert.equal(JSON.stringify({ ...bridged, body: null }), JSON.stringify({ ...reference, body: null }));
  assert.equal(JSON.stringify(bridged.body[2]), JSON.stringify(reference.body[2]));
});

test('unregistered types are still rejected with Strapi error, unchanged', async () => {
  const target = wrapped(makeRegistry());
  const data = { body: [P('a'), { type: 'banner', children: [{ type: 'text', text: 'x' }] }] };
  const alone = await captureError(realValidator.validateEntityCreation(ARTICLE, data, { isDraft: true }));
  const bridged = await captureError(target.validateEntityCreation(ARTICLE, data, { isDraft: true }));
  assert.equal(bridged.message, 'Block node is of invalid type');
  assert.equal(JSON.stringify(bridged.details), JSON.stringify(alone.details));
  // Also next to a valid custom node; the reported value is the node the caller sent.
  const mixed = { body: [CALLOUT('ok'), { type: 'banner', children: [] }] };
  const error = await captureError(target.validateEntityCreation(ARTICLE, mixed, { isDraft: true }));
  assert.equal(error.message, 'Block node is of invalid type');
  assert.deepEqual(
    error.details.errors.map((item) => item.path),
    [['body', '1']]
  );
});

test('an invalid custom block is rejected with its own errors and paths', async () => {
  const target = wrapped(makeRegistry());
  const data = { body: [P('a'), { type: 'callout', tone: 'loud', children: [{ type: 'image' }] }] };
  const error = await captureError(target.validateEntityCreation(ARTICLE, data, { isDraft: true }));
  assert.ok(error instanceof errors.ValidationError);
  assert.equal(error.message, '2 errors occurred');
  const paths = error.details.errors.map((item) => item.path.join('.')).sort();
  assert.deepEqual(paths, ['body.1.children.0', 'body.1.tone']);
  assert.ok(error.details.errors.some((item) => item.message === 'Inline node must be Text or Link'));
  // strict: no casting, a number is not a string
  const cast = await captureError(
    target.validateEntityCreation(
      ARTICLE,
      { body: [{ type: 'callout', tone: 'info', children: [{ type: 'text', text: 5 }] }] },
      {}
    )
  );
  assert.deepEqual(cast.details.errors[0].path, ['body', '0', 'children', '0', 'text']);
  // a prototype key never reaches the registered validator
  const proto = JSON.parse(
    '{"type":"callout","tone":"info","children":[{"type":"text","text":"x"}],"__proto__":{"x":1}}'
  );
  const protoError = await captureError(target.validateEntityCreation(ARTICLE, { body: [proto] }, {}));
  assert.equal(protoError.message, bridge.MESSAGES.forbiddenKey);
});

test('Strapi errors and custom errors are reported together', async () => {
  const target = wrapped(makeRegistry());
  const data = {
    body: [
      { type: 'paragraph', children: [] },
      { type: 'callout', tone: 'x', children: [P('nested')] },
    ],
  };
  const error = await captureError(target.validateEntityCreation(ARTICLE, data, { isDraft: true }));
  const paths = error.details.errors.map((item) => item.path.join('.'));
  assert.ok(paths.includes('body.0.children'), paths.join(','));
  assert.ok(paths.includes('body.1.tone'));
  assert.ok(paths.includes('body.1.children.0'));
});

test('custom blocks inside components, repeatable components and dynamic zones', async () => {
  const target = wrapped(makeRegistry());
  const data = {
    box: { label: 'a', content: [CALLOUT('in box')] },
    boxes: [{ content: [P('p')] }, { content: [P('p'), CALLOUT('in boxes')] }],
    zone: [{ __component: 'shared.box', content: [CALLOUT('in zone')] }],
  };
  const result = await target.validateEntityCreation(ARTICLE, data, { isDraft: false });
  assert.equal(JSON.stringify(result.box.content[0]), JSON.stringify(data.box.content[0]));
  assert.equal(JSON.stringify(result.boxes[1].content[1]), JSON.stringify(data.boxes[1].content[1]));
  assert.equal(JSON.stringify(result.zone[0].content[0]), JSON.stringify(data.zone[0].content[0]));
  const bad = await captureError(
    target.validateEntityCreation(
      ARTICLE,
      { zone: [{ __component: 'shared.box', content: [CALLOUT('x', { tone: 1 })] }] },
      {}
    )
  );
  assert.deepEqual(bad.details.errors[0].path, ['zone', '0', 'content', '0', 'tone']);
  // Without the bridge the same data fails in Strapi.
  const alone = await captureError(realValidator.validateEntityCreation(ARTICLE, data, { isDraft: false }));
  assert.ok(alone.details.errors.every((item) => item.message === 'Block node is of invalid type'));
  assert.equal(alone.details.errors.length, 3);
});

test('too many custom nodes in one write and throwing validators fail closed', async () => {
  const target = wrapped(makeRegistry());
  const many = { body: Array.from({ length: bridge.LIMITS.maxNodesPerWrite + 1 }, () => CALLOUT('x')) };
  const error = await captureError(target.validateEntityCreation(ARTICLE, many, {}));
  assert.equal(error.message, bridge.MESSAGES.tooManyNodes);

  const registry = bridge.createRegistry(helpers);
  registry.register({
    type: 'callout',
    validator: yup.mixed().test('bug', 'never', () => {
      throw new TypeError('validator bug');
    }),
  });
  const reported = [];
  const buggy = wrapped(registry, { reportOnce: (code) => reported.push(code) });
  const bugError = await captureError(buggy.validateEntityCreation(ARTICLE, { body: [CALLOUT('x')] }, {}));
  assert.equal(bugError.message, bridge.MESSAGES.validatorFailed);
  assert.deepEqual(reported, ['VALIDATOR_THREW']);
});

test('an inactive bridge or an empty registry passes every call straight to Strapi', async () => {
  for (const registry of [null, bridge.createRegistry(helpers)]) {
    const target = {
      validateEntityCreation: realValidator.validateEntityCreation,
      validateEntityUpdate: realValidator.validateEntityUpdate,
    };
    bridge.installBridge(target, {
      activeRegistry: () => registry,
      getModel: (uid) => MODELS[uid],
      errors,
      reportOnce: () => {},
    });
    const data = { body: [P('a'), CALLOUT('b')] };
    const alone = await captureError(realValidator.validateEntityCreation(ARTICLE, data, {}));
    const bridged = await captureError(target.validateEntityCreation(ARTICLE, data, {}));
    assert.equal(bridged.message, alone.message);
    assert.equal(JSON.stringify(bridged.details), JSON.stringify(alone.details));
  }
});

test('hook point checks, install without stacking and a clean uninstall', () => {
  assert.equal(bridge.checkHookPoint(undefined), 'NO_ENTITY_VALIDATOR');
  assert.equal(bridge.checkHookPoint({ validateEntityCreation() {} }), 'HOOK_CHANGED');
  assert.equal(bridge.checkHookPoint(Object.freeze({ ...realValidator })), 'HOOK_READ_ONLY');
  assert.equal(bridge.checkHookPoint(realValidator), null, `hook point of @strapi/core ${coreVersion}`);

  const target = { ...realValidator };
  const context = { activeRegistry: () => null, getModel: () => undefined, errors, reportOnce: () => {} };
  const first = bridge.installBridge(target, context);
  const second = bridge.installBridge(target, context);
  assert.equal(target.validateEntityCreation[bridge.BRIDGE_MARK], true);
  assert.equal(bridge.unwrap(target.validateEntityCreation), realValidator.validateEntityCreation);
  first(); // not ours any more: no change
  assert.equal(target.validateEntityCreation[bridge.BRIDGE_MARK], true);
  second();
  assert.equal(target.validateEntityCreation, realValidator.validateEntityCreation);
  assert.equal(target.validateEntityUpdate, realValidator.validateEntityUpdate);
});

test(`canary passes on @strapi/core ${coreVersion} and catches a changed validator`, async () => {
  assert.deepEqual(
    await bridge.runCanary({ original: realValidator.validateEntityCreation, uid: 'admin::user' }),
    { ok: true }
  );
  assert.deepEqual(await bridge.runCanary({ original: async (m, d) => d, uid: 'admin::user' }), {
    ok: false,
    reason: 'PROBE_ACCEPTED',
  });
  assert.deepEqual(
    await bridge.runCanary({
      original: async () => {
        throw new Error('x');
      },
      uid: 'admin::user',
    }),
    { ok: false, reason: 'PROBE_BUILTIN_REJECTED' }
  );
});

test('native support detection', () => {
  assert.deepEqual(bridge.detectNativeSupport({}), { native: false });
  const viaProperty = bridge.detectNativeSupport({ customBlocks: { register() {} } });
  assert.equal(viaProperty.native, true);
  assert.equal(typeof viaProperty.register, 'function');
  const viaContainer = bridge.detectNativeSupport({
    has: (name) => name === 'custom-blocks',
    get: () => ({ register() {} }),
  });
  assert.equal(viaContainer.native, true);
  const throwing = {};
  Object.defineProperty(throwing, 'customBlocks', {
    get() {
      throw new Error('x');
    },
  });
  assert.deepEqual(bridge.detectNativeSupport(throwing), { native: false });
});

test('config: coreBlocks.enabled is off by default and validated', () => {
  assert.equal(config.default.coreBlocks.enabled, false);
  config.validator({ ...config.default, coreBlocks: { enabled: true } });
  assert.throws(
    () => config.validator({ ...config.default, coreBlocks: { enabled: 'yes' } }),
    /coreBlocks\.enabled/
  );
});

// Service with a minimal Strapi: switch, states, logs, native hand-over.
const serviceHost = ({ enabledConfig = false, stored = null, validator, native } = {}) => {
  const logs = [];
  let storeValue = stored === null ? null : { coreBlocks: { enabled: stored } };
  const host = {
    config: {
      get: (key) => (key === 'plugin::magic-editor-x.coreBlocks.enabled' ? enabledConfig : undefined),
    },
    log: {
      info: (message) => logs.push(['info', message]),
      warn: (message) => logs.push(['warn', message]),
      error: (message) => logs.push(['error', message]),
      debug: () => {},
    },
    store: () => ({ get: async () => storeValue, set: async ({ value }) => (storeValue = value) }),
    getModel: (uid) => MODELS[uid],
    contentTypes: {},
    entityValidator: validator,
    ...(native ? { customBlocks: native } : {}),
  };
  return { host, logs };
};

test('service: off by default leaves Strapi untouched; Settings switch turns it on and off', async () => {
  const validator = { ...realValidator };
  const { host, logs } = serviceHost({ validator });
  const service = coreBlocksService({ strapi: host });
  service.register({ type: 'callout', validator: calloutValidator });
  await service.start();
  try {
    assert.equal(service.status().state, 'off');
    assert.equal(service.status().source, 'config');
    assert.equal(validator.validateEntityCreation, realValidator.validateEntityCreation);
    await service.setEnabled(true);
    assert.equal(service.status().state, 'active');
    assert.equal(service.status().source, 'settings');
    const result = await validator.validateEntityCreation(ARTICLE, { body: [CALLOUT('x')] }, {});
    assert.equal(result.body[0].type, 'callout');
    await service.setEnabled(false);
    assert.equal(validator.validateEntityCreation, realValidator.validateEntityCreation);
    assert.deepEqual(service.status().types, [{ type: 'callout', plugin: 'magic-editor-x' }]);
    assert.equal(logs.filter(([level]) => level === 'error').length, 0);
  } finally {
    service.stop();
  }
});

test('service: config on, idle without registrations, a stored Settings value wins', async () => {
  const validator = { ...realValidator };
  const { host } = serviceHost({ enabledConfig: true, validator });
  const service = coreBlocksService({ strapi: host });
  await service.start();
  assert.equal(service.status().state, 'idle');
  service.register({ type: 'callout', validator: calloutValidator });
  assert.equal(service.status().state, 'active');
  service.stop();
  assert.equal(validator.validateEntityCreation, realValidator.validateEntityCreation);

  const second = serviceHost({ enabledConfig: true, stored: false, validator });
  const off = coreBlocksService({ strapi: second.host });
  await off.start();
  assert.equal(off.status().state, 'off');
  assert.equal(off.status().source, 'settings');
  off.stop();
});

test('service: a missing or changed hook point logs one error and changes nothing', async () => {
  for (const validator of [
    undefined,
    Object.freeze({ ...realValidator }),
    { validateEntityCreation: async (m, d) => d, validateEntityUpdate: async (m, d) => d },
  ]) {
    const { host, logs } = serviceHost({ enabledConfig: true, validator });
    const service = coreBlocksService({ strapi: host });
    service.register({ type: 'callout', validator: calloutValidator });
    await service.start();
    await service.setEnabled(true);
    assert.equal(service.status().state, 'unavailable');
    assert.ok(service.status().reason);
    assert.equal(logs.filter(([level]) => level === 'error').length, 1, JSON.stringify(logs));
    if (validator && !Object.isFrozen(validator))
      assert.equal(validator.validateEntityCreation[bridge.BRIDGE_MARK], undefined);
    service.stop();
  }
});

test('service: native support turns the bridge off and hands registrations to Strapi', async () => {
  const validator = { ...realValidator };
  const received = [];
  const nativeHelpers = { inlineNodeValidator: helpers.inlineNodeValidator, blockNodeValidator: yup.mixed() };
  const native = {
    register(definition) {
      received.push({
        name: definition.name,
        plugin: definition.plugin,
        schema: definition.validator(nativeHelpers),
      });
    },
  };
  const { host, logs } = serviceHost({ enabledConfig: true, validator, native });
  const service = coreBlocksService({ strapi: host });
  service.register({ type: 'callout', validator: calloutValidator });
  await service.start();
  service.register({ type: 'tip', validator: yup.object(), plugin: 'my-plugin' });
  assert.equal(service.status().state, 'native');
  assert.equal(validator.validateEntityCreation, realValidator.validateEntityCreation);
  assert.deepEqual(
    received.map(({ name, plugin }) => [name, plugin]),
    [
      ['callout', 'magic-editor-x'],
      ['tip', 'my-plugin'],
    ]
  );
  assert.ok(received.every(({ schema }) => schema.__isYupSchema__));
  assert.equal(logs.filter(([level]) => level === 'info').length, 1);
  service.stop();
});
