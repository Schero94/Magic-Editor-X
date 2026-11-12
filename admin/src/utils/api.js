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
  mediaByUrl: '/magic-editor-x/media/byUrl',
  contentTypes: '/magic-editor-x/content-types',
  linkTypes: '/magic-editor-x/links/types',
  linkSearch: '/magic-editor-x/links/search',
  qualityLinks: '/magic-editor-x/quality/links',
  qualityLinkReport: '/magic-editor-x/quality/link-report',
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
  aiAltText: '/magic-editor-x/ai/image/alt-text',
  aiField: (action) => `/magic-editor-x/ai/field/${encodeURIComponent(action)}`,
  aiBlocks: (action) => `/magic-editor-x/ai/blocks/${encodeURIComponent(action)}`,
  grammarCheck: '/magic-editor-x/grammar/check',
  comments: '/magic-editor-x/comments',
  comment: (id) => `/magic-editor-x/comments/${encodeURIComponent(id)}`,
  commentReplies: (id) => `/magic-editor-x/comments/${encodeURIComponent(id)}/replies`,
  commentResolve: (id) => `/magic-editor-x/comments/${encodeURIComponent(id)}/resolve`,
  commentReopen: (id) => `/magic-editor-x/comments/${encodeURIComponent(id)}/reopen`,
  // 2.4: @mentions and notifications.
  commentMentionable: '/magic-editor-x/comments/mentionable',
  notifications: '/magic-editor-x/notifications',
  notificationsReadAll: '/magic-editor-x/notifications/read-all',
  notificationRead: (id) => `/magic-editor-x/notifications/${encodeURIComponent(id)}/read`,
  notificationUnread: (id) => `/magic-editor-x/notifications/${encodeURIComponent(id)}/unread`,
  templates: '/magic-editor-x/templates',
  templateTargets: '/magic-editor-x/templates/targets',
  templatesOrder: '/magic-editor-x/templates/order',
  template: (id) => `/magic-editor-x/templates/${encodeURIComponent(id)}`,
  templateDuplicate: (id) => `/magic-editor-x/templates/${encodeURIComponent(id)}/duplicate`,
  templateUsage: (id) => `/magic-editor-x/templates/${encodeURIComponent(id)}/usage`,
  templateVersions: (id) => `/magic-editor-x/templates/${encodeURIComponent(id)}/versions`,
  templateVersion: (id, versionId) =>
    `/magic-editor-x/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}`,
  templateVersionRestore: (id, versionId) =>
    `/magic-editor-x/templates/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/restore`,
  audit: '/magic-editor-x/audit',
  auditActors: '/magic-editor-x/audit/actors',
  linkSchedule: '/magic-editor-x/quality/link-schedule',
  linkScheduleRun: '/magic-editor-x/quality/link-schedule/run',
  settings: '/magic-editor-x/settings',
  settingsAiTest: '/magic-editor-x/settings/ai/test',
  settingsLanguageToolTest: '/magic-editor-x/settings/language-tool/test',
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
  // Strapi's fetch client (FetchError) puts the HTTP status on the error and the body in `response.data`.
  const status =
    (response && response.status) ||
    (error && typeof error.status === 'number' ? error.status : null) ||
    (apiError && typeof apiError.status === 'number' ? apiError.status : null);
  return {
    status: status || null,
    message: (apiError && apiError.message) || (body && body.message) || null,
    code: (apiError && apiError.details && apiError.details.code) || null,
    details: (apiError && apiError.details) || null,
  };
};
