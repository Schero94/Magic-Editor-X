'use strict';

const { randomUUID } = require('node:crypto');
const sanitizeHtml = require('sanitize-html');
const { createLogger } = require('../utils/logger');
const { cleanEditorValue } = require('../utils/sanitizer');
const { legacyStateToEditorData } = require('../../../shared/ydoc.mjs');
const { SVG_OPTIONS, TEMPLATE_OPTIONS } = require('./custom-blocks');

/**
 * Versioned, idempotent data migrations run in bootstrap.
 *
 * Only one process runs them (database lease); finished migrations are
 * recorded in the plugin store, so a restart or a second process skips them.
 * Each migration pages by id and continues past rows it cannot convert, which
 * are counted (never logged with content).
 *
 * 2.0.0-snapshots: 1.x snapshots taken during live sessions stored only the
 *   Yjs state (`yjsSnapshot`), often with an empty `jsonContent`. They are
 *   converted to Editor.js JSON, sanitised and keyed with the 1.x room id.
 * 2.0.0-custom-blocks: 1.x stored icons and templates without sanitising;
 *   they are cleaned with the 2.0 rules.
 */

const PROCESS_ID = randomUUID();
const SNAPSHOT_UID = 'plugin::magic-editor-x.document-snapshot';
const BLOCK_UID = 'plugin::magic-editor-x.custom-block';

module.exports = ({ strapi }) => {
  const logger = createLogger(strapi);
  const pluginStore = () => strapi.store({ type: 'plugin', name: 'magic-editor-x' });
  const store = () => strapi.plugin('magic-editor-x').service('store');

  const migrations = [
    {
      id: '2.0.0-snapshots',
      async run() {
        const query = strapi.db.query(SNAPSHOT_UID);
        let lastId = 0;
        let converted = 0;
        let unreadable = 0;
        for (;;) {
          const rows = await query.findMany({
            where: { id: { $gt: lastId } },
            orderBy: { id: 'asc' },
            limit: 100,
            select: ['id', 'jsonContent', 'yjsSnapshot', 'trigger'],
          });
          if (rows.length === 0) break;
          for (const row of rows) {
            lastId = row.id;
            if (row.trigger) continue;
            let content = null;
            try {
              const hasJson =
                row.jsonContent && Array.isArray(row.jsonContent.blocks) && row.jsonContent.blocks.length > 0;
              if (hasJson) content = cleanEditorValue(row.jsonContent);
              else if (typeof row.yjsSnapshot === 'string' && row.yjsSnapshot) {
                const legacy = legacyStateToEditorData(
                  new Uint8Array(Buffer.from(row.yjsSnapshot, 'base64'))
                );
                content = legacy ? cleanEditorValue(legacy) : null;
              }
            } catch {
              content = null;
            }
            if (content) {
              await query.update({
                where: { id: row.id },
                data: { jsonContent: content, trigger: 'legacy' },
              });
              converted += 1;
            } else {
              await query.update({ where: { id: row.id }, data: { trigger: 'legacy' } });
              unreadable += 1;
            }
          }
        }
        return { converted, unreadable };
      },
    },
    {
      id: '2.0.0-custom-blocks',
      async run() {
        const query = strapi.db.query(BLOCK_UID);
        const rows = await query.findMany({ limit: 5000 });
        let cleaned = 0;
        for (const row of rows) {
          const data = {};
          if (row.icon) {
            const icon = sanitizeHtml(row.icon, SVG_OPTIONS);
            if (icon !== row.icon) data.icon = icon || null;
          }
          if (row.template) {
            const template = sanitizeHtml(row.template, TEMPLATE_OPTIONS);
            if (template !== row.template) data.template = template;
          }
          if (Object.keys(data).length > 0) {
            await query.update({ where: { id: row.id }, data });
            cleaned += 1;
          }
        }
        return { cleaned };
      },
    },
  ];

  return {
    /**
     * Runs pending migrations once across the cluster.
     * @returns {Promise<void>}
     */
    async run() {
      const done = (await pluginStore().get({ key: 'migrations' })) || {};
      const pending = migrations.filter((migration) => !done[migration.id]);
      if (pending.length === 0) return;
      if (!(await store().acquire('migrations', PROCESS_ID, 10 * 60 * 1000))) return;
      try {
        const current = (await pluginStore().get({ key: 'migrations' })) || {};
        for (const migration of pending) {
          if (current[migration.id]) continue;
          try {
            const result = await migration.run();
            current[migration.id] = { at: new Date().toISOString(), ...result };
            await pluginStore().set({ key: 'migrations', value: current });
            logger.info(`migration ${migration.id} finished`, result);
          } catch (error) {
            logger.error(`migration ${migration.id} failed; it runs again on the next start`, error);
          }
        }
      } finally {
        await store().release('migrations', PROCESS_ID);
      }
    },

    /** Migration ids (tests). */
    ids: migrations.map((migration) => migration.id),
  };
};
