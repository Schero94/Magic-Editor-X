'use strict';

/**
 * Plugin content types. All are internal (hidden from the Content Manager and
 * the Content-Type Builder) and keep their 1.x table names and columns so
 * existing data survives the upgrade.
 *
 * 1.x also had `collab-session` and `collab-permission`. 2.0 replaces them
 * (collaboration access now follows Content Manager permissions; live state is
 * kept in the `magic_editor_x_collab_*` tables created in bootstrap), so Strapi
 * drops their tables on the first start of 2.0.
 */

const hidden = {
  'content-manager': { visible: false },
  'content-type-builder': { visible: false },
};

module.exports = {
  'document-snapshot': {
    schema: {
      kind: 'collectionType',
      collectionName: 'magic_editor_doc_snapshots',
      info: {
        singularName: 'document-snapshot',
        pluralName: 'document-snapshots',
        displayName: 'Editor snapshot',
        description: 'Version history of Magic Editor X fields',
      },
      options: { draftAndPublish: false },
      pluginOptions: hidden,
      attributes: {
        /** `uid|documentId|locale|field` (1.x rows: `uid|documentId|field`). */
        roomId: { type: 'string', required: true },
        contentType: { type: 'string', required: true },
        entryId: { type: 'string', required: true },
        entryLocale: { type: 'string' },
        fieldName: { type: 'string', required: true },
        version: { type: 'integer', required: true },
        /** manual | auto | restore | legacy */
        trigger: { type: 'string' },
        contentHash: { type: 'string' },
        /** Optional version name (2.2, plain text, max 120 characters). */
        label: { type: 'string', maxLength: 120 },
        jsonContent: { type: 'json' },
        /** 1.x Yjs state (base64). Read once by the 2.0 migration, never written again. */
        yjsSnapshot: { type: 'text' },
        createdBy: { type: 'relation', relation: 'oneToOne', target: 'admin::user' },
        /**
         * Synced source versions (2.4, `contentType` = `plugin::magic-editor-x.template`,
         * `fieldName` = `blocks`, `entryLocale` null): the source name at that version, and the
         * author as admin id + name snapshot (both cleared when the admin is deleted; the id is
         * never returned). Null on field versions.
         */
        sourceName: { type: 'string', maxLength: 100 },
        authorId: { type: 'integer' },
        authorName: { type: 'string', maxLength: 200 },
      },
    },
  },

  /**
   * Block comments (2.3). One row per comment; a thread is its root row
   * (`threadId` null) plus the replies that point to the root's documentId.
   * Keyed like versions by content type, document, locale and field; anchored
   * to an Editor.js block id. Plain text only. Author data is a snapshot
   * (admin id + display name) that is cleared when the admin user is deleted.
   */
  comment: {
    schema: {
      kind: 'collectionType',
      collectionName: 'magic_editor_comments',
      info: {
        singularName: 'comment',
        pluralName: 'comments',
        displayName: 'Editor comment',
        description: 'Block comments of Magic Editor X fields',
      },
      options: { draftAndPublish: false },
      pluginOptions: hidden,
      // Secondary indexes owned by Strapi's schema sync (`indexes` is kept by
      // @strapi/core pickSchema and passed to the database model): the list
      // query per field and the reply lookup per thread.
      indexes: [
        { name: 'mex_comments_target_idx', columns: ['entry_id', 'field_name', 'content_type'] },
        { name: 'mex_comments_thread_idx', columns: ['thread_id'] },
      ],
      attributes: {
        contentType: { type: 'string', required: true },
        entryId: { type: 'string', required: true },
        entryLocale: { type: 'string' },
        fieldName: { type: 'string', required: true },
        blockId: { type: 'string', required: true, maxLength: 64 },
        /** documentId of the thread's root comment; null on the root itself. */
        threadId: { type: 'string' },
        /** Plain-text excerpt of the block when the thread was opened (root only). */
        excerpt: { type: 'string', maxLength: 200 },
        body: { type: 'text', required: true },
        /** Admin user id of the author (null after the user was deleted). */
        authorId: { type: 'integer' },
        /** Display name snapshot (null after the user was deleted). */
        authorName: { type: 'string', maxLength: 200 },
        editedAt: { type: 'datetime' },
        /** Thread state (root only). */
        resolved: { type: 'boolean', default: false },
        resolvedAt: { type: 'datetime' },
        resolvedById: { type: 'integer' },
        resolvedByName: { type: 'string', maxLength: 200 },
      },
    },
  },

  /**
   * Block suggestions (2.4). One row per proposed change to one block of one
   * editor field of one document locale, keyed like comments (`fieldName` is
   * the field identity of `access.checkField`). `proposed` is a single block,
   * normalised, sanitised and checked against the field preset on write.
   * Author and decider are admin id + name snapshots, cleared when the admin
   * user is deleted. Plain-text `note`.
   */
  suggestion: {
    schema: {
      kind: 'collectionType',
      collectionName: 'magic_editor_suggestions',
      info: {
        singularName: 'suggestion',
        pluralName: 'suggestions',
        displayName: 'Editor suggestion',
        description: 'Block suggestions of Magic Editor X fields',
      },
      options: { draftAndPublish: false },
      pluginOptions: hidden,
      indexes: [{ name: 'mex_suggestions_target_idx', columns: ['entry_id', 'field_name', 'content_type'] }],
      attributes: {
        contentType: { type: 'string', required: true },
        entryId: { type: 'string', required: true },
        entryLocale: { type: 'string' },
        fieldName: { type: 'string', required: true },
        /** Editor.js id of the block changed or deleted, or of the inserted block. */
        blockId: { type: 'string', required: true, maxLength: 64 },
        op: { type: 'enumeration', enum: ['update', 'insert', 'delete'], required: true },
        /** Inserts: id of the block the new block goes after (null: at the start). */
        afterBlockId: { type: 'string', maxLength: 64 },
        /** Proposed block `{ id, type, data, tunes? }` (null for deletes). */
        proposed: { type: 'json' },
        /** Hash of the block when the change was suggested (`shared/suggestions.mjs` blockHash). */
        baseHash: { type: 'string', maxLength: 32 },
        /** Optional plain-text note of the author. */
        note: { type: 'text' },
        status: {
          type: 'enumeration',
          enum: ['open', 'accepted', 'rejected'],
          required: true,
          default: 'open',
        },
        authorId: { type: 'integer' },
        authorName: { type: 'string', maxLength: 200 },
        decidedAt: { type: 'datetime' },
        decidedById: { type: 'integer' },
        decidedByName: { type: 'string', maxLength: 200 },
      },
    },
  },

  /**
   * Templates, block patterns and synced block sources (2.3; `kind`
   * `synced`: fields store a reference to the row's documentId). `blocks` is an Editor.js document,
   * normalised and sanitised on every write (services/templates.js); `scope`
   * is `{ all, presets, fields: [{ uid, field }] }`. The creator is a name
   * snapshot only (no admin id is stored).
   */
  template: {
    schema: {
      kind: 'collectionType',
      collectionName: 'magic_editor_templates',
      info: {
        singularName: 'template',
        pluralName: 'templates',
        displayName: 'Editor template',
        description: 'Templates and block patterns of Magic Editor X',
      },
      options: { draftAndPublish: false },
      pluginOptions: hidden,
      attributes: {
        name: { type: 'string', required: true, maxLength: 100 },
        description: { type: 'text' },
        kind: {
          type: 'enumeration',
          enum: ['template', 'pattern', 'synced'],
          required: true,
          default: 'pattern',
        },
        blocks: { type: 'json', required: true },
        scope: { type: 'json' },
        enabled: { type: 'boolean', default: true },
        sortOrder: { type: 'integer', default: 0 },
        createdByName: { type: 'string', maxLength: 200 },
      },
    },
  },

  'custom-block': {
    schema: {
      kind: 'collectionType',
      collectionName: 'magic_editor_custom_blocks',
      info: {
        singularName: 'custom-block',
        pluralName: 'custom-blocks',
        displayName: 'Custom block',
        description: 'Custom blocks for Magic Editor X',
      },
      options: { draftAndPublish: false },
      pluginOptions: hidden,
      attributes: {
        name: { type: 'string', required: true, unique: true, minLength: 2, maxLength: 50 },
        label: { type: 'string', required: true, maxLength: 100 },
        blockType: {
          type: 'enumeration',
          enum: ['simple', 'embedded-entry'],
          required: true,
          default: 'simple',
        },
        description: { type: 'text' },
        icon: { type: 'text' },
        contentType: { type: 'string' },
        displayFields: { type: 'json' },
        titleField: { type: 'string' },
        previewFields: { type: 'json' },
        fields: { type: 'json' },
        template: { type: 'text' },
        placeholder: { type: 'string' },
        styles: { type: 'json' },
        inlineToolbar: { type: 'boolean', default: true },
        tunes: { type: 'json' },
        shortcut: { type: 'string' },
        sortOrder: { type: 'integer', default: 0 },
        enabled: { type: 'boolean', default: true },
        createdByUser: { type: 'relation', relation: 'oneToOne', target: 'admin::user' },
      },
    },
  },
};
