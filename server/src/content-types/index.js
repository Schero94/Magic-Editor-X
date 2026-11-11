'use strict';

/**
 * Plugin content types. Both are internal (hidden from the Content Manager and
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
