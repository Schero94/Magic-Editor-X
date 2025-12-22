'use strict';

module.exports = {
  type: 'admin',
  routes: [
    // Collaboration Session
    {
      method: 'POST',
      path: '/collab/session',
      handler: 'realtime.createSession',
      config: {
        policies: [],
      },
    },
    // Collaboration Users & Permissions
    {
      method: 'GET',
      path: '/collaboration/users',
      handler: 'collaboration.listAdminUsers',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'GET',
      path: '/collaboration/permissions',
      handler: 'collaboration.listPermissions',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'POST',
      path: '/collaboration/permissions',
      handler: 'collaboration.createPermission',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'PUT',
      path: '/collaboration/permissions/:id',
      handler: 'collaboration.updatePermission',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
      },
    },
    {
      method: 'DELETE',
      path: '/collaboration/permissions/:id',
      handler: 'collaboration.deletePermission',
      config: {
        policies: ['admin::isAuthenticatedAdmin'],
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
