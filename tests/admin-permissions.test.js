const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const adminRoutes = require('../server/src/routes/admin').routes;
const { registerPermissions, PLUGIN_ACCESS_ACTION } = require('../server/src/permissions');

test('every admin route requires authentication and the Magic Editor X permission', () => {
  assert.ok(adminRoutes.length > 0);
  for (const route of adminRoutes) {
    const policies = route.config?.policies || [];
    assert.ok(policies.includes('admin::isAuthenticatedAdmin'), `${route.method} ${route.path} requires an admin`);
    assert.ok(policies.some((policy) => policy?.name === 'admin::hasPermissions'
      && policy.config?.actions?.includes(PLUGIN_ACCESS_ACTION)), `${route.method} ${route.path} requires plugin access`);
  }
});

test('uploads also require the Strapi Media Library create permission', () => {
  for (const pathName of ['/image/byFile', '/image/byUrl', '/file/upload']) {
    const route = adminRoutes.find(({ path: routePath }) => routePath === pathName);
    assert.ok(route, `missing ${pathName}`);
    assert.ok(route.config.policies.some((policy) => policy?.name === 'admin::hasPermissions'
      && policy.config?.actions?.includes('plugin::upload.assets.create')), `${pathName} requires media create`);
  }
});

test('permission action is registered before admin routes are served', async () => {
  const actions = [];
  await registerPermissions({
    admin: { services: { permission: { actionProvider: { registerMany: (values) => actions.push(...values) } } } },
  });
  assert.deepEqual(actions, [{
    section: 'plugins',
    displayName: 'Access Magic Editor X',
    uid: 'access',
    pluginName: 'magic-editor-x',
  }]);
});

test('menu link is permission-backed for navigation UX', () => {
  const entry = readFileSync(path.join(__dirname, '../admin/src/index.js'), 'utf8');
  assert.match(entry, /import pluginPermissions from ['"]\.\/permissions['"]/);
  assert.match(entry, /permissions:\s*pluginPermissions\.access/);
});
