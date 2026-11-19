// Core Blocks bridge (2.7) on a real Strapi: boots the installed @strapi/strapi programmatically
// (SQLite, no admin build, no HTTP listener) with the built plugin and writes through the Document
// Service, the same path REST, the admin save and publish take. CI runs it on the peer floor and on
// the newest 5.x (job `core-blocks`), so a change of Strapi's hook point fails the PR.
// Needs `npm run build` and a built better-sqlite3 (`npm rebuild better-sqlite3`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const strapiVersion = require('@strapi/strapi/package.json').version;

const secret = () => randomBytes(24).toString('base64url');

/**
 * Writes a minimal Strapi app (one draft-and-publish type with a blocks field, a component with a
 * blocks field, a dynamic zone) under .tmp/ of this repository, so Strapi resolves its packages
 * from this repository's node_modules.
 * @param {boolean} enabled - `coreBlocks.enabled` in config/plugins.
 * @returns {string} App directory.
 */
const writeApp = (enabled) => {
  const dir = path.join(ROOT, '.tmp', `core-blocks-host-${randomBytes(4).toString('hex')}`);
  const file = (relative, content) => {
    mkdirSync(path.dirname(path.join(dir, relative)), { recursive: true });
    writeFileSync(path.join(dir, relative), content);
  };
  file('public/uploads/.gitkeep', '');
  file('package.json', JSON.stringify({ name: 'mex-core-blocks-host', private: true, version: '0.0.0' }));
  file(
    'config/database.js',
    `module.exports = () => ({ connection: { client: 'sqlite', connection: { filename: ${JSON.stringify(
      path.join(dir, 'data.db')
    )} }, useNullAsDefault: true } });`
  );
  file(
    'config/server.js',
    `module.exports = () => ({ host: '127.0.0.1', port: 0, app: { keys: [${JSON.stringify(secret())}, ${JSON.stringify(secret())}] } });`
  );
  file(
    'config/admin.js',
    `module.exports = () => ({ auth: { secret: ${JSON.stringify(secret())} }, apiToken: { salt: ${JSON.stringify(
      secret()
    )} }, transfer: { token: { salt: ${JSON.stringify(secret())} } }, secrets: { encryptionKey: ${JSON.stringify(secret())} } });`
  );
  file(
    'config/plugins.js',
    `module.exports = () => ({ 'magic-editor-x': { enabled: true, resolve: ${JSON.stringify(
      ROOT
    )}, config: { coreBlocks: { enabled: ${enabled} }, collaboration: { enabled: false } } } });`
  );
  file(
    'src/index.js',
    `module.exports = {
  register({ strapi }) {
    strapi.plugin('magic-editor-x').service('core-blocks').register({
      type: 'callout',
      validator: ({ yup, inlineNodeValidator }) =>
        yup.object().shape({
          type: yup.string().equals(['callout']).required(),
          tone: yup.string().oneOf(['info', 'warning']).required(),
          children: yup.array().of(inlineNodeValidator).min(1).required(),
        }),
    });
  },
  bootstrap() {},
};`
  );
  file(
    'src/components/shared/box.json',
    JSON.stringify({
      collectionName: 'components_shared_boxes',
      info: { displayName: 'Box' },
      attributes: { label: { type: 'string' }, content: { type: 'blocks' } },
    })
  );
  file(
    'src/api/article/content-types/article/schema.json',
    JSON.stringify({
      kind: 'collectionType',
      collectionName: 'articles',
      info: { singularName: 'article', pluralName: 'articles', displayName: 'Article' },
      options: { draftAndPublish: true },
      attributes: {
        title: { type: 'string' },
        body: { type: 'blocks' },
        box: { type: 'component', component: 'shared.box', repeatable: false },
        zone: { type: 'dynamiczone', components: ['shared.box'] },
      },
    })
  );
  for (const name of ['controllers', 'routes', 'services'])
    file(
      `src/api/article/${name}/article.js`,
      `module.exports = require('@strapi/strapi').factories.createCore${
        { controllers: 'Controller', routes: 'Router', services: 'Service' }[name]
      }('api::article.article');`
    );
  return dir;
};

const boot = async (enabled) => {
  const appDir = writeApp(enabled);
  const { createStrapi } = require('@strapi/strapi');
  const app = await createStrapi({
    appDir,
    distDir: appDir,
    autoReload: false,
    serveAdminPanel: false,
  }).load();
  return { app, appDir };
};

const UID = 'api::article.article';
const P = (text) => ({ type: 'paragraph', children: [{ type: 'text', text }] });
const CALLOUT = (text) => ({
  type: 'callout',
  tone: 'warning',
  children: [{ type: 'text', text, bold: true }],
});

const rejection = async (promise) => {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  return assert.fail('expected the write to be rejected');
};

test(
  `Core Blocks bridge on Strapi ${strapiVersion}: Document Service create, update, publish`,
  { timeout: 180000 },
  async (t) => {
    assert.ok(existsSync(path.join(ROOT, 'dist/server/index.js')), 'run npm run build first');
    const { app, appDir } = await boot(true);
    t.after(async () => {
      await app.destroy();
      rmSync(appDir, { recursive: true, force: true });
    });
    const service = app.plugin('magic-editor-x').service('core-blocks');
    assert.equal(service.status().state, 'active', JSON.stringify(service.status()));

    const callout = CALLOUT('Heads up');
    const body = [P('Intro'), callout];
    const created = await app.documents(UID).create({
      data: {
        title: 'Synthetic',
        body,
        box: { label: 'b', content: [CALLOUT('in box')] },
        zone: [{ __component: 'shared.box', content: [P('z'), CALLOUT('in zone')] }],
      },
    });
    const draft = await app
      .documents(UID)
      .findOne({ documentId: created.documentId, populate: ['box', 'zone'] });
    assert.equal(
      JSON.stringify(draft.body[1]),
      JSON.stringify(callout),
      'stored custom node is the sent node'
    );
    assert.equal(JSON.stringify(draft.box.content[0]), JSON.stringify(CALLOUT('in box')));
    assert.equal(JSON.stringify(draft.zone[0].content[1]), JSON.stringify(CALLOUT('in zone')));
    const raw = await app.db
      .connection('articles')
      .select('body')
      .where({ document_id: created.documentId })
      .first();
    const stored = typeof raw.body === 'string' ? raw.body : JSON.stringify(raw.body);
    assert.ok(stored.includes(JSON.stringify(callout)), 'the stored JSON contains the node byte for byte');

    await app
      .documents(UID)
      .update({ documentId: created.documentId, data: { body: [...body, CALLOUT('second')] } });
    await app.documents(UID).publish({ documentId: created.documentId });
    const published = await app
      .documents(UID)
      .findOne({ documentId: created.documentId, status: 'published' });
    assert.equal(JSON.stringify(published.body[2]), JSON.stringify(CALLOUT('second')));
    const direct = await app
      .documents(UID)
      .create({ data: { body: [CALLOUT('published directly')] }, status: 'published' });
    assert.ok(direct.documentId);

    // Unregistered types: Strapi's own error, unchanged.
    const banner = await rejection(
      app
        .documents(UID)
        .create({ data: { body: [{ type: 'banner', children: [{ type: 'text', text: 'x' }] }] } })
    );
    assert.equal(banner.name, 'ValidationError');
    assert.equal(banner.message, 'Block node is of invalid type');

    // Invalid custom node: its own error and path.
    const invalid = await rejection(
      app.documents(UID).create({
        data: { body: [{ type: 'callout', tone: 'loud', children: [{ type: 'text', text: 'x' }] }] },
      })
    );
    assert.equal(invalid.name, 'ValidationError');
    assert.deepEqual(invalid.details.errors[0].path, ['body', '0', 'tone']);

    // Switched off (Settings): Strapi's validator is restored and rejects the custom node as before.
    await service.setEnabled(false);
    assert.equal(service.status().state, 'off');
    assert.equal(
      app.entityValidator.validateEntityCreation[Symbol.for('magic-editor-x.coreBlocksBridge')],
      undefined
    );
    const off = await rejection(app.documents(UID).create({ data: { body: [CALLOUT('off')] } }));
    assert.equal(off.message, 'Block node is of invalid type');
    await service.setEnabled(true);
    assert.equal(service.status().state, 'active');
  }
);

test(
  `Core Blocks bridge off by default on Strapi ${strapiVersion}: nothing is wrapped`,
  { timeout: 180000 },
  async (t) => {
    const { app, appDir } = await boot(false);
    t.after(async () => {
      await app.destroy();
      rmSync(appDir, { recursive: true, force: true });
    });
    const service = app.plugin('magic-editor-x').service('core-blocks');
    assert.equal(service.status().state, 'off');
    assert.equal(
      app.entityValidator.validateEntityCreation[Symbol.for('magic-editor-x.coreBlocksBridge')],
      undefined
    );
    assert.equal(
      app.entityValidator.validateEntityUpdate[Symbol.for('magic-editor-x.coreBlocksBridge')],
      undefined
    );
    const error = await rejection(app.documents(UID).create({ data: { body: [P('a'), CALLOUT('b')] } }));
    assert.equal(error.message, 'Block node is of invalid type');
    const ok = await app.documents(UID).create({ data: { body: [P('only built-in')] } });
    assert.ok(ok.documentId);
  }
);
