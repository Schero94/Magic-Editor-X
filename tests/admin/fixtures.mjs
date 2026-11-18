/**
 * Synthetic data for the admin StrictMode tests: one article content type with a Magic Editor X
 * field, the Content Manager routes the real `unstable_useContentManagerContext` reads, and the
 * plugin's own admin API answers in the shapes of server/src/controllers.
 */
import { act } from 'react';
import { network, permission } from './harness/index.jsx';

export const ARTICLE = 'api::article.article';
export const DOCUMENT_ID = 'doc-article-1';
export const FIELD = 'body';
export const EDIT_PATH = `/content-manager/collection-types/${ARTICLE}/${DOCUMENT_ID}`;
export const EDIT_ROUTE = '/content-manager/:collectionType/:slug/:id';

const ACTIONS = [
  'access',
  'collaborate',
  'ai.use',
  'custom-blocks.manage',
  'settings.read',
  'settings.update',
  'comments.read',
  'comments.write',
  'comments.moderate',
  'grammar.use',
  'templates.manage',
  'audit.read',
  'suggestions.create',
  'suggestions.review',
];

/** Every plugin action plus the Content Manager actions on the article type. */
export const ALL = [
  ...ACTIONS.map((action) => permission(`plugin::magic-editor-x.${action}`)),
  ...['read', 'create', 'update', 'delete', 'publish'].map((action) =>
    permission(`plugin::content-manager.explorer.${action}`, ARTICLE)
  ),
];

/** A stored Editor.js value with two blocks. */
export const VALUE = {
  time: 1763460000000,
  version: '2.31.7',
  blocks: [
    { id: 'blk-heading', type: 'header', data: { text: 'Release notes', level: 2 } },
    { id: 'blk-intro', type: 'paragraph', data: { text: 'Synthetic paragraph for the harness.' } },
  ],
};

export const UPDATED_AT = '2026-11-18T10:00:00.000Z';

const contentType = {
  uid: ARTICLE,
  apiID: 'article',
  kind: 'collectionType',
  isDisplayed: true,
  info: { displayName: 'Article', singularName: 'article', pluralName: 'articles' },
  options: { draftAndPublish: false },
  pluginOptions: {},
  attributes: {
    id: { type: 'integer' },
    documentId: { type: 'string' },
    title: { type: 'string' },
    [FIELD]: { type: 'json', customField: 'plugin::magic-editor-x.richtext', options: {} },
    createdAt: { type: 'datetime' },
    updatedAt: { type: 'datetime' },
  },
};

const metadata = (label) => ({
  edit: { label, description: '', placeholder: '', visible: true, editable: true },
  list: { label, searchable: true, sortable: true },
});

/** Content Manager routes behind `unstable_useContentManagerContext` (schema, layout, document). */
export const contentManagerRoutes = ({ value = VALUE } = {}) => {
  network.on('GET', '/content-manager/init', {
    data: { contentTypes: [contentType], components: [], fieldSizes: {} },
  });
  network.on('GET', `/content-manager/content-types/${ARTICLE}/configuration`, {
    data: {
      contentType: {
        uid: ARTICLE,
        settings: {
          bulkable: true,
          filterable: true,
          searchable: true,
          pageSize: 10,
          mainField: 'title',
          defaultSortBy: 'title',
          defaultSortOrder: 'ASC',
        },
        metadatas: { id: metadata('id'), title: metadata('Title'), [FIELD]: metadata('Body') },
        layouts: {
          edit: [[{ name: 'title', size: 6 }], [{ name: FIELD, size: 12 }]],
          list: ['id', 'title'],
        },
      },
      components: {},
    },
  });
  network.on('GET', `/content-manager/collection-types/${ARTICLE}/${DOCUMENT_ID}`, {
    data: {
      id: 1,
      documentId: DOCUMENT_ID,
      title: 'Harness article',
      [FIELD]: value,
      createdAt: UPDATED_AT,
      updatedAt: UPDATED_AT,
      locale: null,
    },
    meta: { availableLocales: [], availableStatus: [] },
  });
};

/** `GET /magic-editor-x/config` (server/src/controllers/config.js) for an admin with every action. */
export const editorConfig = (overrides = {}) => ({
  collaboration: { enabled: true, path: '/magic-editor-x/realtime' },
  ai: {
    enabled: false,
    actions: [],
    languages: [],
    tones: [],
    maxInputChars: 8000,
    altText: false,
    fieldActions: false,
  },
  grammar: { enabled: false },
  uploads: {
    maxImageBytes: 10485760,
    maxFileBytes: 20971520,
    attachmentTypes: ['pdf'],
    privateFiles: false,
  },
  linkPreview: true,
  quality: { externalLinks: false, scheduledLinks: false },
  comments: { enabled: true },
  suggestions: { enabled: true },
  audit: { enabled: true },
  rawHtml: 'sanitize',
  codeBlocks: [],
  palette: null,
  annotations: [],
  permissions: {
    collaborate: true,
    ai: true,
    upload: true,
    mediaLibrary: true,
    customBlocksManage: true,
    settingsRead: true,
    commentsRead: true,
    commentsWrite: true,
    commentsModerate: true,
    grammar: true,
    templatesManage: true,
    auditRead: true,
    suggestionsCreate: true,
    suggestionsReview: true,
  },
  components: [],
  reuse: { enabled: true },
  drafts: { enabled: true, ttlHours: 72 },
  lazyInit: { enabled: true, marginPx: 800 },
  ...overrides,
});

/** The plugin routes an editor field reads while it mounts. */
export const editorRoutes = ({ config = editorConfig() } = {}) => {
  network.on('GET', '/magic-editor-x/config', { data: config });
  network.on('GET', '/magic-editor-x/custom-blocks', { data: [] });
};

const WHEN = '2026-11-18T09:30:00.000Z';
const target = {
  uid: ARTICLE,
  documentId: DOCUMENT_ID,
  locale: null,
  field: FIELD,
  title: 'Harness article',
  typeName: 'Article',
};

/** `GET /magic-editor-x/settings` (server/src/services/settings.js, no secrets). */
export const settingsDto = () => ({
  ai: {
    enabled: false,
    provider: 'anthropic',
    baseUrl: '',
    model: 'claude-sonnet-4-5',
    maxInputChars: 8000,
    maxOutputTokens: 4096,
    allowImages: false,
    allowFieldActions: false,
    hasApiKey: false,
    apiKeyFromEnvironment: false,
    apiKeyUnreadable: false,
    canStoreApiKey: true,
  },
  languageTool: {
    enabled: false,
    baseUrl: '',
    username: '',
    level: 'default',
    hasApiKey: false,
    apiKeyUnreadable: false,
    canStoreApiKey: true,
  },
  environment: {
    allowPrivateBaseUrl: false,
    requestsPerMinute: 20,
    altTextPrivateOrigins: [],
    languageTool: { allowPrivateBaseUrl: false, requestsPerMinute: 30 },
    collaboration: { enabled: true, snapshotMinutes: 10 },
    rawHtml: 'sanitize',
    uploads: { maxImageBytes: 10485760, maxFileBytes: 20971520 },
    linkSchedule: { enabled: false },
    mcp: {},
    csp: { active: false, frameSrcMissing: [], imgSrcMissing: false, snippet: '' },
    palette: null,
  },
});

/** Plugin routes of the settings pages, widgets and the Content-Type Builder input. */
export const pluginRoutes = () => {
  network.on('GET', '/magic-editor-x/settings', { data: settingsDto() });
  network.on('GET', '/magic-editor-x/config', { data: editorConfig() });
  network.on('GET', '/magic-editor-x/custom-blocks', {
    data: [
      {
        id: 'cb-callout',
        name: 'callout',
        label: 'Callout',
        icon: 'star',
        blockType: 'simple',
        description: 'Highlighted note',
        enabled: true,
        fields: [{ name: 'text', type: 'text', label: 'Text' }],
        updatedAt: WHEN,
      },
    ],
  });
  network.on('GET', '/magic-editor-x/content-types', {
    data: [{ uid: ARTICLE, displayName: 'Article', fields: [FIELD] }],
  });
  network.on('GET', '/magic-editor-x/templates', {
    data: [
      {
        id: 'tpl-1',
        name: 'Release note',
        description: 'Heading and intro',
        kind: 'template',
        enabled: true,
        scope: { contentTypes: [], fields: [] },
        blocks: VALUE,
        blockCount: 2,
        sortOrder: 0,
        createdBy: { name: 'Ada Example' },
        createdAt: WHEN,
        updatedAt: WHEN,
      },
    ],
  });
  network.on('GET', '/magic-editor-x/templates/targets', {
    data: [{ uid: ARTICLE, displayName: 'Article', fields: [FIELD] }],
  });
  network.on('GET', '/magic-editor-x/audit', {
    data: [
      {
        id: 'audit-1',
        event: 'settings.update',
        createdAt: WHEN,
        actor: { id: 1, name: 'Ada Example' },
        target: {},
      },
    ],
    meta: { pagination: { page: 1, pageSize: 25, pageCount: 1, total: 1 }, enabled: true },
  });
  network.on('GET', '/magic-editor-x/audit/actors', { data: [{ id: 1, name: 'Ada Example' }] });
  network.on('GET', '/magic-editor-x/notifications', {
    data: [
      {
        id: 'note-1',
        kind: 'mention',
        read: false,
        createdAt: WHEN,
        actor: { name: 'Grace Example' },
        snippet: 'Please check the intro',
        target,
      },
    ],
    meta: { unread: 1 },
  });
  network.on('GET', '/magic-editor-x/widgets/open-threads', {
    data: [
      {
        threadId: 'thread-1',
        started: true,
        updatedAt: WHEN,
        excerpt: 'Intro needs a source',
        snippet: 'Intro needs a source',
        target,
      },
    ],
    meta: {},
  });
  network.on('GET', '/magic-editor-x/widgets/broken-links', {
    data: [{ target, problems: 2 }],
    meta: { enabled: true, lastRun: { finishedAt: WHEN }, more: false },
  });
  network.on('GET', '/content-type-builder/components', {
    data: [
      {
        uid: 'shared.cta',
        category: 'shared',
        schema: {
          displayName: 'Call to action',
          icon: 'cursor',
          attributes: { label: { type: 'string' }, url: { type: 'string' } },
        },
      },
    ],
  });
};

/** `GET /entry-summary` and `POST /presence` of the side panel (server/src/services/entry-panel.js). */
export const entryPanelRoutes = ({ editors = [], record = [] } = {}) => {
  network.on('GET', '/magic-editor-x/entry-summary', {
    data: {
      comments: { enabled: true, open: 1 },
      quality: { enabled: true },
      links: { lastRun: null },
      fields: [
        {
          path: FIELD,
          label: 'Body',
          openThreads: 1,
          issues: { errors: 0, warnings: 1 },
          brokenLinks: { draft: 0 },
        },
      ],
    },
  });
  network.on('POST', '/magic-editor-x/presence', (call) => {
    record.push(call.json());
    return presenceAnswer(call.json(), editors);
  });
};

const presenceAnswer = (body, editors) => ({
  data: body.leave ? { left: true } : { enabled: true, softLock: false, canEdit: true, editors },
});

/**
 * Lets React and timers run until `predicate()` is true (lazy chunks, Editor.js start).
 * @param {() => boolean} predicate - Condition.
 * @param {string} what - Description for the failure message.
 * @param {number} [timeoutMs] - Limit.
 */
export const waitFor = async (predicate, what, timeoutMs = 10000) => {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting for ${what}`);
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
};

/** Plugin routes the editor field reads while it is open (comments, suggestions, history, session). */
export const fieldRoutes = ({ record = [] } = {}) => {
  network.on('GET', '/magic-editor-x/comments', { data: [], meta: { counts: { open: 0 } } });
  network.on('GET', '/magic-editor-x/suggestions', { data: [], meta: {} });
  network.on('GET', '/magic-editor-x/history', {
    data: [
      {
        id: 'snap-1',
        label: 'Before review',
        source: 'manual',
        createdAt: WHEN,
        author: { name: 'Ada Example' },
        stats: { blocks: 2, words: 7 },
      },
    ],
    meta: { pagination: { page: 1, pageSize: 20, pageCount: 1, total: 1 } },
  });
  network.on('POST', '/magic-editor-x/collaboration/session', (call) => {
    record.push(call.json());
    return {
      data: {
        token: 'harness-room-token',
        path: '/magic-editor-x/realtime',
        canEdit: true,
        seeded: false,
        protocol: 3,
        expiresAt: Date.now() + 60000,
      },
    };
  });
};
