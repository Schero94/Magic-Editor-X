/**
 * Texts of the audit trail (2.4), shared by Settings > Audit trail and the
 * per-field Activity tab of the version history.
 */

/** Event labels. Unknown events (other features) are shown by their name. */
export const EVENT_LABELS = {
  'entry.create': { key: 'settings.audit.event.entryCreate', text: 'Entry created' },
  'entry.update': { key: 'settings.audit.event.entryUpdate', text: 'Entry saved' },
  'entry.publish': { key: 'settings.audit.event.entryPublish', text: 'Published' },
  'entry.unpublish': { key: 'settings.audit.event.entryUnpublish', text: 'Unpublished' },
  'entry.discard': { key: 'settings.audit.event.entryDiscard', text: 'Draft discarded' },
  'entry.delete': { key: 'settings.audit.event.entryDelete', text: 'Entry deleted' },
  'version.create': { key: 'settings.audit.event.versionCreate', text: 'Version saved' },
  'version.restore': { key: 'settings.audit.event.versionRestore', text: 'Version restored' },
  'version.rename': { key: 'settings.audit.event.versionRename', text: 'Version renamed' },
  'ai.action': { key: 'settings.audit.event.aiAction', text: 'AI assistant used' },
  'comment.create': { key: 'settings.audit.event.commentCreate', text: 'Comment added' },
  'comment.reply': { key: 'settings.audit.event.commentReply', text: 'Reply added' },
  'comment.resolve': { key: 'settings.audit.event.commentResolve', text: 'Thread resolved' },
  'comment.reopen': { key: 'settings.audit.event.commentReopen', text: 'Thread reopened' },
  'comment.delete': { key: 'settings.audit.event.commentDelete', text: 'Comment deleted' },
  'comment.moderate': { key: 'settings.audit.event.commentModerate', text: 'Comment removed by a moderator' },
  'template.create': { key: 'settings.audit.event.templateCreate', text: 'Template created' },
  'template.update': { key: 'settings.audit.event.templateUpdate', text: 'Template changed' },
  'template.delete': { key: 'settings.audit.event.templateDelete', text: 'Template deleted' },
  'synced.create': { key: 'settings.audit.event.syncedCreate', text: 'Synced block created' },
  'synced.update': { key: 'settings.audit.event.syncedUpdate', text: 'Synced block changed' },
  'synced.delete': { key: 'settings.audit.event.syncedDelete', text: 'Synced block deleted' },
  'synced.restore': { key: 'settings.audit.event.syncedRestore', text: 'Synced block version restored' },
  'settings.update': { key: 'settings.audit.event.settingsUpdate', text: 'Settings changed' },
  'linkcheck.run': { key: 'settings.audit.event.linkcheckRun', text: 'Link check run' },
  'ai.localize': { key: 'settings.audit.event.aiLocalize', text: 'Strapi AI translation checked' },
};

/**
 * Label of an event.
 * @param {Function} t - Translate.
 * @param {string} event - Event name.
 * @returns {string} Label.
 */
export const eventLabel = (t, event) => {
  const entry = EVENT_LABELS[event];
  return entry ? t(entry.key, entry.text) : event;
};

/**
 * Actor name: a person, "Deleted user", "API" or "System".
 * @param {Function} t - Translate.
 * @param {{ kind: string, name: string|null, own?: boolean }} actor - Actor.
 * @returns {string} Name.
 */
export const actorLabel = (t, actor) => {
  if (!actor) return t('settings.audit.actor.system', 'System');
  if (actor.kind === 'deleted') return t('settings.audit.actor.deleted', 'Deleted user');
  if (actor.kind === 'api') return t('settings.audit.actor.api', 'Content API');
  if (actor.kind === 'system') return t('settings.audit.actor.system', 'System');
  const name = actor.name || t('settings.audit.actor.unnamed', 'Admin without a name');
  return actor.own ? t('settings.audit.actor.you', '{name} (you)', { name }) : name;
};

/**
 * One-line summary of what changed: counts and identifiers only.
 * @param {Function} t - Translate.
 * @param {{ event: string, counts: Record<string, number>, blockIds: string[], meta: Record<string, unknown> }} item - Event.
 * @returns {string} Summary ('' when there is nothing to say).
 */
export const changeSummary = (t, item) => {
  const counts = item.counts || {};
  const meta = item.meta || {};
  const parts = [];
  if (item.event && item.event.startsWith('entry.')) {
    if (counts.added)
      parts.push(t('settings.audit.counts.added', '{count, number} added', { count: counts.added }));
    if (counts.changed)
      parts.push(t('settings.audit.counts.changed', '{count, number} changed', { count: counts.changed }));
    if (counts.removed)
      parts.push(t('settings.audit.counts.removed', '{count, number} removed', { count: counts.removed }));
    if (counts.moved)
      parts.push(t('settings.audit.counts.moved', '{count, number} moved', { count: counts.moved }));
  }
  if (item.event && item.event.startsWith('version.') && counts.version)
    parts.push(t('settings.audit.counts.version', 'Version {version}', { version: counts.version }));
  if (item.event === 'ai.action' && typeof meta.action === 'string') {
    parts.push(t('settings.audit.meta.action', 'Action: {action}', { action: meta.action }));
    if (counts.segments)
      parts.push(
        t('settings.audit.counts.segments', '{count, plural, one {# text} other {# texts}}', {
          count: counts.segments,
        })
      );
  }
  if (item.event === 'settings.update' && Array.isArray(meta.keys) && meta.keys.length)
    parts.push(t('settings.audit.meta.keys', 'Sections: {keys}', { keys: meta.keys.join(', ') }));
  if (item.event === 'linkcheck.run')
    parts.push(
      t(
        'settings.audit.counts.linkcheck',
        '{checked, number} links checked, {problems, number} with problems',
        { checked: counts.checked || 0, problems: counts.problems || 0 }
      )
    );
  if (item.event === 'ai.localize')
    parts.push(
      t(
        'settings.audit.counts.aiLocalize',
        '{translated, number} of {segments, number} texts translated, {kept, number} kept from the source locale',
        { translated: counts.translated || 0, segments: counts.segments || 0, kept: counts.kept || 0 }
      )
    );
  if ((item.event || '').match(/^(template|synced)\./) && Number.isInteger(counts.blocks))
    parts.push(
      t('settings.audit.counts.blocks', '{count, plural, one {# block} other {# blocks}}', {
        count: counts.blocks,
      })
    );
  return parts.join(' · ');
};
