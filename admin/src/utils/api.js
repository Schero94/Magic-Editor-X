/**
 * Admin API paths of the plugin (served under the Strapi backend URL).
 * Calls go through `useFetchClient` / `getFetchClient`, which add the admin
 * token and refresh it.
 */
export const API = {
  config: '/magic-editor-x/config',
  link: '/magic-editor-x/link',
  imageByFile: '/magic-editor-x/image/byFile',
  imageByUrl: '/magic-editor-x/image/byUrl',
  fileUpload: '/magic-editor-x/file/upload',
  contentTypes: '/magic-editor-x/content-types',
  linkTypes: '/magic-editor-x/links/types',
  linkSearch: '/magic-editor-x/links/search',
  qualityLinks: '/magic-editor-x/quality/links',
  customBlocks: '/magic-editor-x/custom-blocks',
  customBlocksExport: '/magic-editor-x/custom-blocks/export',
  customBlocksImport: '/magic-editor-x/custom-blocks/import',
  customBlocksOrder: '/magic-editor-x/custom-blocks/order',
  customBlock: (id) => `/magic-editor-x/custom-blocks/${encodeURIComponent(id)}`,
  customBlockDuplicate: (id) => `/magic-editor-x/custom-blocks/${encodeURIComponent(id)}/duplicate`,
  collaborationSession: '/magic-editor-x/collaboration/session',
  history: '/magic-editor-x/history',
  historyItem: (id) => `/magic-editor-x/history/${encodeURIComponent(id)}`,
  ai: (action) => `/magic-editor-x/ai/${encodeURIComponent(action)}`,
  settings: '/magic-editor-x/settings',
  settingsAiTest: '/magic-editor-x/settings/ai/test',
};

/**
 * Returns the API error message and code from a fetch client error.
 * @param {unknown} error - Error thrown by the fetch client.
 * @returns {{ status: number|null, message: string|null, code: string|null, details: object|null }} Error info.
 */
export const readApiError = (error) => {
  const response = error && error.response;
  const body = response && response.data;
  const apiError = body && body.error;
  return {
    status: (response && response.status) || null,
    message: (apiError && apiError.message) || (body && body.message) || null,
    code: (apiError && apiError.details && apiError.details.code) || null,
    details: (apiError && apiError.details) || null,
  };
};
