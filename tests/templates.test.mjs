/**
 * Templates and block patterns (2.3): scope matching, insertion rules (preset
 * filtering, fixes, block limit, fresh ids), the server service against an
 * in-memory query engine (validation, sanitising, bounds, scope filter), the
 * controller's permission rules and the settings form logic.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  TEMPLATE_LIMITS,
  normalizeScope,
  templateMatchesTarget,
  scopeFieldOf,
  prepareInsertion,
  insertBlocksAt,
  isEmptyDocument,
  searchTemplates,
  newBlockId,
} from '../shared/templates.mjs';
import { resolveFieldPreset } from '../shared/presets.mjs';
import {
  emptyValues,
  fromDto,
  toPayload,
  validateTemplate,
  mapServerErrors,
  valuesKey,
} from '../admin/src/pages/TemplatesPage/templateForm.mjs';

const require = createRequire(import.meta.url);
const templatesService = require('../server/src/services/templates.js');
const templatesController = require('../server/src/controllers/templates.js');
const routes = require('../server/src/routes/index.js');
const { ACTIONS, ACTION_DEFINITIONS } = require('../server/src/permissions.js');
const contentTypes = require('../server/src/content-types/index.js');

const doc = (blocks) => ({ time: 1, version: '2.31.7', blocks });
const p = (id, text) => ({ id, type: 'paragraph', data: { text } });

/* ------------------------------------------------------------ scope */

test('scope: empty or invalid scopes mean every field; entries are validated and de-duplicated', () => {
  assert.deepEqual(normalizeScope(null), { all: true, presets: [], fields: [] });
  assert.deepEqual(normalizeScope({ all: false, presets: ['basic', 'basic', 'nope'] }), {
    all: false,
    presets: ['basic'],
    fields: [],
  });
  const scope = normalizeScope({
    all: false,
    fields: [
      { uid: 'api::article.article', field: 'body' },
      { uid: 'api::article.article', field: 'body' },
      { uid: 'plugin::x.y', field: 'body' },
      { uid: 'api::article.article', field: 'sections.0.body' },
    ],
  });
  assert.deepEqual(scope.fields, [{ uid: 'api::article.article', field: 'body' }]);
  assert.equal(scopeFieldOf('sections.12.body'), 'sections.body');
});

test('scope matching: all, preset name, field path without indices', () => {
  const target = { uid: 'api::article.article', field: 'sections.3.body', presetName: 'basic' };
  assert.equal(templateMatchesTarget({ all: true }, target), true);
  assert.equal(templateMatchesTarget({ all: false, presets: ['basic'] }, target), true);
  assert.equal(templateMatchesTarget({ all: false, presets: ['minimal'] }, target), false);
  assert.equal(
    templateMatchesTarget(
      { all: false, fields: [{ uid: 'api::article.article', field: 'sections.body' }] },
      target
    ),
    true
  );
  assert.equal(
    templateMatchesTarget({ all: false, fields: [{ uid: 'api::article.article', field: 'body' }] }, target),
    false
  );
});

/* ------------------------------------------------------------ insertion */

test('insertion: every block gets a fresh id that does not clash with the field', () => {
  let n = 0;
  const ids = ['dup', 'dup', 'x1', 'x2'];
  const plan = prepareInsertion([p('a', 'One'), p('b', 'Two')], null, {
    existingIds: ['dup'],
    idFactory: () => ids[n++],
  });
  assert.deepEqual(
    plan.blocks.map((block) => block.id),
    ['x1', 'x2']
  );
  const fresh = prepareInsertion([p('a', 'One')], null);
  assert.notEqual(fresh.blocks[0].id, 'a');
  assert.match(newBlockId(), /^[A-Za-z0-9_-]{10}$/);
});

test('insertion: blocks the preset does not allow are left out, headings and links are fixed', () => {
  const preset = resolveFieldPreset({ preset: 'basic', linkTargets: 'internal' });
  const plan = prepareInsertion(
    [
      { id: 'h', type: 'header', data: { text: 'Title', level: 1 } },
      { id: 't', type: 'table', data: { content: [['a']] } },
      { id: 'c', type: 'code', data: { code: 'x' } },
      p('l', 'See <a href="https://www.example.test/">this</a>'),
      {
        id: 'q',
        type: 'quote',
        data: { text: 'Q', caption: '' },
        tunes: { alignmentTune: { alignment: 'center' } },
      },
    ],
    preset
  );
  assert.deepEqual(
    plan.omitted.sort((a, b) => a.type.localeCompare(b.type)),
    [
      { type: 'code', count: 1 },
      { type: 'table', count: 1 },
    ]
  );
  assert.equal(plan.adjusted, 2);
  assert.deepEqual(
    plan.blocks.map((block) => block.type),
    ['header', 'paragraph', 'quote']
  );
  assert.equal(plan.blocks[0].data.level, 2);
  assert.equal(plan.blocks[1].data.text, 'See this');
  assert.deepEqual(plan.blocks[2].tunes, { alignmentTune: { alignment: 'center' } });
});

test('insertion: the block limit counts the field and truncates the rest', () => {
  const preset = resolveFieldPreset({ maxBlocks: 5 });
  const plan = prepareInsertion([p('1', 'a'), p('2', 'b'), p('3', 'c')], preset, { existingCount: 4 });
  assert.equal(plan.blocks.length, 1);
  assert.equal(plan.truncated, 2);
});

test('insertion: template data is copied, not shared', () => {
  const source = [p('a', 'One')];
  const plan = prepareInsertion(source, null);
  plan.blocks[0].data.text = 'changed';
  assert.equal(source[0].data.text, 'One');
});

test('insertBlocksAt places blocks after the anchor, at the start or at the end', () => {
  const base = doc([p('a', 'A'), p('b', 'B')]);
  const ins = [p('x', 'X')];
  assert.deepEqual(
    insertBlocksAt(base, ins, 0).blocks.map((b) => b.id),
    ['a', 'x', 'b']
  );
  assert.deepEqual(
    insertBlocksAt(base, ins, -1).blocks.map((b) => b.id),
    ['x', 'a', 'b']
  );
  assert.deepEqual(
    insertBlocksAt(base, ins, 99).blocks.map((b) => b.id),
    ['a', 'b', 'x']
  );
  assert.deepEqual(
    insertBlocksAt(null, ins, 0).blocks.map((b) => b.id),
    ['x']
  );
});

test('empty documents and search', () => {
  assert.equal(isEmptyDocument(null), true);
  assert.equal(isEmptyDocument(doc([p('a', '<br>&nbsp; ')])), true);
  assert.equal(isEmptyDocument(doc([p('a', 'x')])), false);
  assert.equal(isEmptyDocument(doc([{ id: 'd', type: 'delimiter', data: {} }])), false);
  const list = [
    { name: 'Product launch', description: 'Hero and FAQ' },
    { name: 'Quote', description: '' },
  ];
  assert.deepEqual(searchTemplates(list, 'faq'), [list[0]]);
  assert.equal(searchTemplates(list, '  ').length, 2);
});

/* ------------------------------------------------------------ server service */

const ARTICLE = {
  uid: 'api::article.article',
  info: { displayName: 'Article' },
  attributes: {
    title: { type: 'string' },
    body: { type: 'json', customField: 'plugin::magic-editor-x.richtext' },
    summary: {
      type: 'json',
      customField: 'plugin::magic-editor-x.richtext',
      options: { preset: 'basic' },
    },
    sections: { type: 'component', component: 'blocks.section', repeatable: true },
  },
};
const SECTION = {
  uid: 'blocks.section',
  attributes: { body: { type: 'json', customField: 'plugin::magic-editor-x.richtext' } },
};

/**
 * Minimal Strapi with an in-memory query engine for the template content type.
 * @param {object} [config] - Plugin config.
 * @returns {{ strapi: object, rows: object[] }} Fake.
 */
const fakeStrapi = (config = {}) => {
  const rows = [];
  let id = 0;
  const match = (row, where = {}) => Object.entries(where).every(([key, value]) => row[key] === value);
  const sort = (list, orderBy) => {
    const orders = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
    return [...list].sort((a, b) => {
      for (const order of orders) {
        const [key, dir] = Object.entries(order)[0];
        if (a[key] !== b[key]) return (a[key] < b[key] ? -1 : 1) * (dir === 'desc' ? -1 : 1);
      }
      return 0;
    });
  };
  const query = {
    findMany: async ({ where, orderBy, limit } = {}) =>
      sort(
        rows.filter((row) => match(row, where)),
        orderBy
      ).slice(0, limit || 1000),
    findOne: async ({ where }) => rows.find((row) => match(row, where)) || null,
    count: async () => rows.length,
    create: async ({ data }) => {
      id += 1;
      const row = { id, documentId: `tpl${id}`, createdAt: 'now', updatedAt: 'now', ...data };
      rows.push(row);
      return row;
    },
    update: async ({ where, data }) => {
      const row = rows.find((item) => match(item, where));
      Object.assign(row, data);
      return row;
    },
    delete: async ({ where }) => {
      rows.splice(
        rows.findIndex((item) => match(item, where)),
        1
      );
    },
  };
  const strapi = {
    db: { query: () => query, transaction: async (fn) => fn() },
    contentTypes: { [ARTICLE.uid]: ARTICLE },
    components: { [SECTION.uid]: SECTION },
    contentType: (uid) => (uid === ARTICLE.uid ? ARTICLE : undefined),
    config: { get: (key) => config[key.replace('plugin::magic-editor-x.', '')] },
  };
  return { strapi, rows };
};

const definition = (overrides = {}) => ({
  name: 'Launch',
  description: 'Hero',
  kind: 'template',
  blocks: doc([p('a', 'Hello <b>world</b>')]),
  scope: { all: true },
  ...overrides,
});

test('service: create sanitises blocks, stores a name snapshot only and lists in order', async () => {
  const { strapi, rows } = fakeStrapi();
  const service = templatesService({ strapi });
  const created = await service.create(
    definition({
      blocks: doc([
        p('a', 'Hi<script>alert(1)</script><img src=x onerror=alert(1)><a href="javascript:alert(1)">x</a>'),
        { id: 'r', type: 'raw', data: { html: '<p onclick="x()">ok</p><script>bad()</script>' } },
      ]),
    }),
    { id: 7, firstname: 'Anna', lastname: 'Beispiel', email: 'anna@example.test' }
  );
  const stored = JSON.stringify(rows[0].blocks);
  assert.doesNotMatch(stored, /script|onerror|onclick|javascript:/i);
  assert.equal(rows[0].createdByName, 'Anna Beispiel');
  assert.equal('createdBy' in rows[0], false);
  assert.doesNotMatch(JSON.stringify(created), /example\.test|"7"/);
  assert.deepEqual(created.createdBy, { name: 'Anna Beispiel' });
  assert.equal(created.blockCount, 2);
  await service.create(definition({ name: 'Second', kind: 'pattern' }), null);
  assert.deepEqual(
    (await service.listAll()).map((item) => item.name),
    ['Launch', 'Second']
  );
});

test('service: raw HTML is emptied when the plugin disables it', async () => {
  const { strapi, rows } = fakeStrapi({ rawHtml: 'disable' });
  await templatesService({ strapi }).create(
    definition({ blocks: doc([p('a', 'x'), { id: 'r', type: 'raw', data: { html: '<p>x</p>' } }]) }),
    null
  );
  assert.equal(rows[0].blocks.blocks[1].data.html, '');
});

test('service: strict validation, bounds and empty content are 400', async () => {
  const { strapi } = fakeStrapi();
  const service = templatesService({ strapi });
  const reject = async (input, path) => {
    await assert.rejects(service.create(input, null), (error) => {
      assert.equal(error.name, 'ValidationError');
      if (path)
        assert.ok(
          Object.keys(error.details.fieldErrors).some((key) => key.startsWith(path)),
          path
        );
      return true;
    });
  };
  await reject(definition({ isAdmin: true }));
  await reject(definition({ name: '' }), 'name');
  await reject(definition({ name: 'x'.repeat(101) }), 'name');
  await reject(definition({ kind: 'macro' }), 'kind');
  await reject(definition({ blocks: doc([]) }), 'blocks');
  await reject(definition({ blocks: doc([p('a', '')]).blocks.slice(0, 0) }), 'blocks');
  await reject(definition({ blocks: doc(Array.from({ length: 201 }, (_, i) => p(`b${i}`, 'x'))) }), 'blocks');
  await reject(definition({ blocks: doc([p('a', 'x'.repeat(TEMPLATE_LIMITS.bytes))]) }), 'blocks');
  await reject(definition({ scope: { all: false } }), 'scope');
  await reject(
    definition({ scope: { all: false, fields: [{ uid: 'api::article.article', field: 'title' }] } }),
    'scope'
  );
  await reject(
    definition({ scope: { all: false, fields: [{ uid: 'api::nope.nope', field: 'body' }] } }),
    'scope'
  );
});

test('service: the field list filters by scope and preset; unknown fields are 404', async () => {
  const { strapi } = fakeStrapi();
  const service = templatesService({ strapi });
  await service.create(definition({ name: 'Everywhere' }), null);
  await service.create(definition({ name: 'Basic only', scope: { all: false, presets: ['basic'] } }), null);
  await service.create(
    definition({
      name: 'Sections',
      scope: { all: false, fields: [{ uid: ARTICLE.uid, field: 'sections.body' }] },
    }),
    null
  );
  await service.create(definition({ name: 'Off', enabled: false }), null);
  const names = async (field) => (await service.listForField({ uid: ARTICLE.uid, field })).map((t) => t.name);
  assert.deepEqual(await names('body'), ['Everywhere']);
  assert.deepEqual(await names('summary'), ['Everywhere', 'Basic only']);
  assert.deepEqual(await names('sections.2.body'), ['Everywhere', 'Sections']);
  await assert.rejects(service.listForField({ uid: ARTICLE.uid, field: 'title' }), { name: 'NotFoundError' });
  await assert.rejects(service.listForField({ uid: 'api::nope.nope', field: 'body' }), {
    name: 'NotFoundError',
  });
  const targets = service.targets().map((target) => `${target.field}:${target.preset}`);
  assert.deepEqual(targets, ['body:full', 'sections.body:full', 'summary:basic']);
});

test('service: get, update, duplicate (disabled copy), reorder and delete', async () => {
  const { strapi } = fakeStrapi();
  const service = templatesService({ strapi });
  const a = await service.create(definition({ name: 'A' }), null);
  const b = await service.create(definition({ name: 'B', enabled: false }), null);
  await assert.rejects(service.findOne(b.id, { includeDisabled: false }), { name: 'NotFoundError' });
  assert.equal((await service.findOne(b.id, { includeDisabled: true })).name, 'B');
  await assert.rejects(service.findOne('../x', { includeDisabled: true }), { name: 'NotFoundError' });
  const updated = await service.update(a.id, definition({ name: 'A2', kind: 'pattern' }));
  assert.equal(updated.kind, 'pattern');
  const copy = await service.duplicate(a.id, null);
  assert.equal(copy.name, 'A2 (copy)');
  assert.equal(copy.enabled, false);
  const order = await service.reorder([copy.id, b.id, a.id]);
  assert.deepEqual(
    order.map((item) => item.name),
    ['A2 (copy)', 'B', 'A2']
  );
  await assert.rejects(service.reorder([a.id]), { name: 'ValidationError' });
  assert.deepEqual(await service.remove(b.id), { id: b.id });
  await assert.rejects(service.remove(b.id), { name: 'NotFoundError' });
});

test('service: the number of templates is bounded', async () => {
  const { strapi, rows } = fakeStrapi();
  for (let i = 0; i < TEMPLATE_LIMITS.templates; i += 1) rows.push({ id: i, documentId: `r${i}` });
  await assert.rejects(templatesService({ strapi }).create(definition(), null), { name: 'ValidationError' });
});

/* ------------------------------------------------------------ routes, RBAC, controller */

test('routes: every template route needs access; changes need templates.manage', () => {
  const byKey = new Map(routes.admin.routes.map((route) => [`${route.method} ${route.path}`, route]));
  const actions = (key) => byKey.get(key).config.policies[1].config.actions;
  for (const key of ['GET /templates', 'GET /templates/:id'])
    assert.deepEqual(actions(key), [ACTIONS.access]);
  for (const key of [
    'GET /templates/targets',
    'PUT /templates/order',
    'POST /templates',
    'PUT /templates/:id',
    'DELETE /templates/:id',
    'POST /templates/:id/duplicate',
  ])
    assert.deepEqual(actions(key), [ACTIONS.access, ACTIONS.templatesManage], key);
  const paths = routes.admin.routes.map((route) => `${route.method} ${route.path}`);
  assert.ok(paths.indexOf('PUT /templates/order') < paths.indexOf('PUT /templates/:id'));
  assert.ok(paths.indexOf('GET /templates/targets') < paths.indexOf('GET /templates/:id'));
  assert.ok(ACTION_DEFINITIONS.some((action) => action.uid === 'templates.manage'));
  assert.match('templates.manage', /^[a-z]([a-z|.|-]+)[a-z]$/);
  const schema = contentTypes.template.schema;
  assert.equal(schema.collectionName, 'magic_editor_templates');
  assert.equal(schema.pluginOptions['content-manager'].visible, false);
  assert.equal(schema.pluginOptions['content-type-builder'].visible, false);
});

test('controller: all=true needs templates.manage (403), the field list needs Content Manager read (404)', async () => {
  const { strapi } = fakeStrapi();
  let canRead = true;
  strapi.plugin = (name) => ({
    service: (service) => {
      if (name === 'magic-editor-x') return templatesService({ strapi });
      assert.equal(`${name}.${service}`, 'content-manager.permission-checker');
      return { create: () => ({ cannot: { read: () => !canRead } }) };
    },
  });
  const controller = templatesController({ strapi });
  const ctx = (query, manage) => ({
    query,
    state: { userAbility: { can: (action) => manage && action === ACTIONS.templatesManage } },
  });
  await assert.rejects(controller.list(ctx({ all: 'true' }, false)), { name: 'ForbiddenError' });
  const ok = ctx({ all: 'true' }, true);
  await controller.list(ok);
  assert.deepEqual(ok.body, { data: [] });
  const field = ctx({ uid: ARTICLE.uid, field: 'body' }, false);
  await controller.list(field);
  assert.deepEqual(field.body, { data: [] });
  canRead = false;
  await assert.rejects(controller.list(ctx({ uid: ARTICLE.uid, field: 'body' }, false)), {
    name: 'NotFoundError',
  });
  await assert.rejects(controller.list(ctx({}, true)), { name: 'ValidationError' });
  await assert.rejects(controller.list(ctx({ uid: ARTICLE.uid, field: ['body', 'x'] }, true)), {
    name: 'ValidationError',
  });
});

/* ------------------------------------------------------------ settings form */

test('settings form: validation mirrors the server and the payload round-trips', () => {
  const values = emptyValues();
  assert.deepEqual(Object.keys(validateTemplate(values)).sort(), ['blocks', 'name']);
  const filled = {
    ...values,
    name: ' Launch ',
    scopeMode: 'limited',
    presets: [],
    fields: [],
    blocks: doc([p('a', 'x')]),
  };
  assert.deepEqual(validateTemplate(filled), { scope: 'scope' });
  filled.fields = ['api::article.article|sections.body'];
  assert.deepEqual(validateTemplate(filled), {});
  const payload = toPayload(filled);
  assert.equal(payload.name, 'Launch');
  assert.deepEqual(payload.scope, {
    all: false,
    presets: [],
    fields: [{ uid: 'api::article.article', field: 'sections.body' }],
  });
  const back = fromDto({ ...payload, id: 'x', enabled: true });
  assert.equal(back.scopeMode, 'limited');
  assert.deepEqual(back.fields, ['api::article.article|sections.body']);
  assert.equal(valuesKey(back), valuesKey(fromDto({ ...payload })));
  assert.deepEqual(mapServerErrors({ fieldErrors: { 'scope.fields.0': ['Unknown'], name: ['Bad'] } }), {
    scope: 'Unknown',
    name: 'Bad',
  });
});
