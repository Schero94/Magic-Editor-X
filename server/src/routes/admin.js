'use strict';

module.exports = {
  type: 'admin',
  routes: [
    {
      method: 'POST',
      path: '/collab/session',
      handler: 'realtime.createSession',
      config: {
        policies: [],
      },
    },
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
  ],
};
