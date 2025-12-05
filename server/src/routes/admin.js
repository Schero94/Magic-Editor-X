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
  ],
};
