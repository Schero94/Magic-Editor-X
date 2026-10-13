'use strict';

const { PLUGIN_ACCESS_ACTION } = require('../permissions');

const adminPolicies = () => [
  'admin::isAuthenticatedAdmin',
  { name: 'admin::hasPermissions', config: { actions: [PLUGIN_ACCESS_ACTION] } },
];

const mediaPolicies = () => [
  ...adminPolicies(),
  { name: 'admin::hasPermissions', config: { actions: ['plugin::upload.assets.create'] } },
];

const adminRouteConfig = {
  type: 'admin',
  routes: [
    // EditorJS preview and uploads are privileged admin operations, not public Content API routes.
    ...[
      { method: 'GET', path: '/link', handler: 'editor.fetchLinkMeta', description: 'Fetch link metadata for an editor preview' },
      { method: 'POST', path: '/image/byFile', handler: 'editor.uploadByFile', description: 'Upload an editor image', requiresMediaCreate: true },
      { method: 'POST', path: '/image/byUrl', handler: 'editor.uploadByUrl', description: 'Fetch and upload a remote editor image', requiresMediaCreate: true },
      { method: 'POST', path: '/file/upload', handler: 'editor.uploadFile', description: 'Upload an editor attachment', requiresMediaCreate: true },
    ].map(({ method, path, handler, description, requiresMediaCreate }) => ({
      method,
      path,
      handler,
      config: {
        description,
        policies: [
          ...(requiresMediaCreate ? mediaPolicies() : adminPolicies()),
        ],
      },
    })),

    // Collaboration Session
    {
      method: 'POST',
      path: '/collab/session',
      handler: 'realtime.createSession',
      config: {
        policies: adminPolicies(),
      },
    },
    // Collaboration Users & Permissions
    {
      method: 'GET',
      path: '/collaboration/users',
      handler: 'collaboration.listAdminUsers',
      config: {
        policies: adminPolicies(),
      },
    },
    {
      method: 'GET',
      path: '/collaboration/permissions',
      handler: 'collaboration.listPermissions',
      config: {
        policies: adminPolicies(),
      },
    },
    {
      method: 'POST',
      path: '/collaboration/permissions',
      handler: 'collaboration.createPermission',
      config: {
        policies: adminPolicies(),
      },
    },
    {
      method: 'PUT',
      path: '/collaboration/permissions/:id',
      handler: 'collaboration.updatePermission',
      config: {
        policies: adminPolicies(),
      },
    },
    {
      method: 'DELETE',
      path: '/collaboration/permissions/:id',
      handler: 'collaboration.deletePermission',
      config: {
        policies: adminPolicies(),
      },
    },
    {
      method: 'GET',
      path: '/collaboration/check-access',
      handler: 'collaboration.checkAccess',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    // License Management
    {
      method: 'GET',
      path: '/license/status',
      handler: 'license.getStatus',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'POST',
      path: '/license/auto-create',
      handler: 'license.autoCreate',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'POST',
      path: '/license/store-key',
      handler: 'license.storeKey',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'GET',
      path: '/license/limits',
      handler: 'license.getLimits',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'GET',
      path: '/license/can-add-collaborator',
      handler: 'license.canAddCollaborator',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    // Version History (Snapshots)
    {
      method: 'GET',
      path: '/snapshots/:roomId',
      handler: 'snapshot.list',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'POST',
      path: '/snapshots/:roomId',
      handler: 'snapshot.create',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'POST',
      path: '/snapshots/restore/:documentId',
      handler: 'snapshot.restore',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    // Custom Blocks Management
    {
      method: 'GET',
      path: '/custom-blocks/limits',
      handler: 'customBlock.getLimits',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'GET',
      path: '/custom-blocks/can-create/:blockType',
      handler: 'customBlock.canCreate',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'GET',
      path: '/custom-blocks',
      handler: 'customBlock.find',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'GET',
      path: '/custom-blocks/:id',
      handler: 'customBlock.findOne',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'POST',
      path: '/custom-blocks',
      handler: 'customBlock.create',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'PUT',
      path: '/custom-blocks/:id',
      handler: 'customBlock.update',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'DELETE',
      path: '/custom-blocks/:id',
      handler: 'customBlock.delete',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'POST',
      path: '/custom-blocks/:id/toggle',
      handler: 'customBlock.toggle',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'POST',
      path: '/custom-blocks/reorder',
      handler: 'customBlock.reorder',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'POST',
      path: '/custom-blocks/:id/duplicate',
      handler: 'customBlock.duplicate',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'GET',
      path: '/custom-blocks/export',
      handler: 'customBlock.export',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'POST',
      path: '/custom-blocks/import',
      handler: 'customBlock.import',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'GET',
      path: '/content-types',
      handler: 'customBlock.getContentTypes',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
  ],
};

module.exports = {
  ...adminRouteConfig,
  routes: adminRouteConfig.routes.map((route) => {
    const existingPolicies = (route.config?.policies || []).filter((policy) => {
      if (policy === 'admin::isAuthenticatedAdmin') return false;
      return !(policy && typeof policy === 'object'
        && policy.name === 'admin::hasPermissions'
        && policy.config?.actions?.includes(PLUGIN_ACCESS_ACTION));
    });

    return {
      ...route,
      config: {
        ...route.config,
        policies: [...adminPolicies(), ...existingPolicies],
      },
    };
  }),
};
