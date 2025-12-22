/**
 * Magic Editor X - Content Types
 * Stores collaboration sessions, snapshots, and version history
 * 
 * IMPORTANT: These content types are excluded from Strapi Transfer
 * because they contain transient/session data and admin::user relations
 * that cannot be properly transferred between environments.
 */
'use strict';

module.exports = {
  /**
   * Collaboration Sessions
   * Tracks active realtime editing sessions
   * 
   * NOTE: Sessions are transient and should NOT be transferred.
   * They are cleared on server restart anyway.
   */
  'collab-session': {
    schema: {
      kind: 'collectionType',
      collectionName: 'magic_editor_collab_sessions',
      info: {
        singularName: 'collab-session',
        pluralName: 'collab-sessions',
        displayName: 'Collaboration Session',
        description: 'Active realtime collaboration sessions',
      },
      options: {
        draftAndPublish: false,
      },
      pluginOptions: {
        'content-manager': {
          visible: false,
        },
        'content-type-builder': {
          visible: false,
        },
        // Exclude from Strapi Transfer - sessions are transient
        'import-export-entries': {
          idField: 'roomId',
        },
      },
      attributes: {
        roomId: {
          type: 'string',
          required: true,
          unique: true,
        },
        contentType: {
          type: 'string',
          required: true,
        },
        entryId: {
          type: 'string',
          required: true,
        },
        fieldName: {
          type: 'string',
          required: true,
        },
        activeUsers: {
          type: 'json',
          default: [],
        },
        lastActivity: {
          type: 'datetime',
        },
        yjsState: {
          type: 'text',
          default: null,
        },
      },
    },
  },

  /**
   * Document Snapshots
   * Periodic snapshots for version history and recovery
   * 
   * NOTE: Snapshots contain Yjs binary data and admin::user references.
   * Transfer is possible but user relations may break.
   */
  'document-snapshot': {
    schema: {
      kind: 'collectionType',
      collectionName: 'magic_editor_doc_snapshots',
      info: {
        singularName: 'document-snapshot',
        pluralName: 'document-snapshots',
        displayName: 'Document Snapshot',
        description: 'Document version snapshots',
      },
      options: {
        draftAndPublish: false,
      },
      pluginOptions: {
        'content-manager': {
          visible: false,
        },
        'content-type-builder': {
          visible: false,
        },
        // Transfer config - use roomId+version as unique identifier
        'import-export-entries': {
          idField: 'roomId',
        },
      },
      attributes: {
        roomId: {
          type: 'string',
          required: true,
        },
        contentType: {
          type: 'string',
          required: true,
        },
        entryId: {
          type: 'string',
          required: true,
        },
        fieldName: {
          type: 'string',
          required: true,
        },
        version: {
          type: 'integer',
          required: true,
        },
        yjsSnapshot: {
          type: 'text',
          required: false, // Optional for JSON-only snapshots
        },
        jsonContent: {
          type: 'json',
        },
        createdBy: {
          type: 'relation',
          relation: 'oneToOne',
          target: 'admin::user',
        },
        // Note: createdAt/updatedAt are auto-managed by Strapi
      },
    },
  },

  /**
   * Collaboration Permissions
   * Access control for realtime editing
   * 
   * NOTE: Permissions reference admin::user which are environment-specific.
   * On transfer, user relations will need to be re-created manually.
   * The contentType field can be used to match permissions.
   */
  'collab-permission': {
    schema: {
      kind: 'collectionType',
      collectionName: 'magic_editor_collab_permissions',
      info: {
        singularName: 'collab-permission',
        pluralName: 'collab-permissions',
        displayName: 'Collaboration Permission',
        description: 'User permissions for realtime editing',
      },
      options: {
        draftAndPublish: false,
      },
      pluginOptions: {
        'content-manager': {
          visible: false, // Hidden - use plugin settings page instead
        },
        'content-type-builder': {
          visible: false,
        },
        // Transfer note: admin::user relations won't transfer
        // Permissions should be re-created in target environment
        'import-export-entries': {
          idField: 'id',
        },
      },
      attributes: {
        contentType: {
          type: 'string',
          required: false, // null = all content types
          default: '*',
        },
        entryId: {
          type: 'string',
        },
        fieldName: {
          type: 'string',
        },
        user: {
          type: 'relation',
          relation: 'oneToOne',
          target: 'admin::user',
          required: true,
        },
        role: {
          type: 'enumeration',
          enum: ['viewer', 'editor', 'owner'],
          default: 'editor',
        },
        expiresAt: {
          type: 'datetime',
        },
        grantedBy: {
          type: 'relation',
          relation: 'oneToOne',
          target: 'admin::user',
        },
      },
    },
  },

  /**
   * Custom Blocks
   * User-defined blocks for the editor
   * Supports simple text/HTML blocks and embedded Strapi entries
   */
  'custom-block': {
    schema: {
      kind: 'collectionType',
      collectionName: 'magic_editor_custom_blocks',
      info: {
        singularName: 'custom-block',
        pluralName: 'custom-blocks',
        displayName: 'Custom Block',
        description: 'User-defined editor blocks',
      },
      options: {
        draftAndPublish: false,
      },
      pluginOptions: {
        'content-manager': {
          visible: false, // Hidden - use plugin settings page instead
        },
        'content-type-builder': {
          visible: false,
        },
      },
      attributes: {
        // Block identifier (used as tool name in Editor.js)
        name: {
          type: 'string',
          required: true,
          unique: true,
          minLength: 2,
          maxLength: 50,
          regex: '^[a-zA-Z][a-zA-Z0-9_-]*$',
        },
        // Display label in toolbox
        label: {
          type: 'string',
          required: true,
          maxLength: 100,
        },
        // Block type: 'simple' or 'embedded-entry'
        blockType: {
          type: 'enumeration',
          enum: ['simple', 'embedded-entry'],
          required: true,
          default: 'simple',
        },
        // Description for documentation
        description: {
          type: 'text',
        },
        // SVG icon for toolbox (optional, uses default if empty)
        icon: {
          type: 'text',
        },
        // For embedded-entry blocks: target content type
        contentType: {
          type: 'string',
        },
        // Fields to display in preview
        displayFields: {
          type: 'json',
          default: ['title', 'name', 'id'],
        },
        // Field to use as title in preview
        titleField: {
          type: 'string',
          default: 'title',
        },
        // Additional fields to show in preview
        previewFields: {
          type: 'json',
          default: [],
        },
        // For simple blocks: field configuration
        fields: {
          type: 'json',
          default: [],
        },
        // HTML template for simple blocks
        template: {
          type: 'text',
        },
        // Placeholder text for content
        placeholder: {
          type: 'string',
          default: 'Enter content...',
        },
        // Custom CSS styles
        styles: {
          type: 'json',
          default: {},
        },
        // Enable inline toolbar
        inlineToolbar: {
          type: 'boolean',
          default: true,
        },
        // Block tunes to enable
        tunes: {
          type: 'json',
          default: [],
        },
        // Keyboard shortcut
        shortcut: {
          type: 'string',
        },
        // Sort order in toolbox
        sortOrder: {
          type: 'integer',
          default: 0,
        },
        // Is block enabled
        enabled: {
          type: 'boolean',
          default: true,
        },
        // Who created this block
        createdByUser: {
          type: 'relation',
          relation: 'oneToOne',
          target: 'admin::user',
        },
      },
    },
  },
};
