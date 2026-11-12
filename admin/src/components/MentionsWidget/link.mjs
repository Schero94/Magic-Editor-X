/**
 * Content Manager location of a comment notification (2.4): the edit view of
 * the entry and locale, with `mexThread=<thread id>` so the editor field opens
 * the thread (admin/src/components/EditorField `linkedThread`).
 * @param {{ threadId: string, target: { kind: 'collectionType'|'singleType', uid: string, documentId: string, locale: string|null } }} item - Notification.
 * @returns {string} Router path (relative to the admin base URL).
 */
export const notificationPath = (item) => {
  const target = item && item.target ? item.target : {};
  const uid = encodeURIComponent(String(target.uid || ''));
  const path =
    target.kind === 'singleType'
      ? `/content-manager/single-types/${uid}`
      : `/content-manager/collection-types/${uid}/${encodeURIComponent(String(target.documentId || ''))}`;
  const params = new URLSearchParams();
  if (target.locale) params.set('plugins[i18n][locale]', target.locale);
  params.set('mexThread', String(item.threadId || ''));
  return `${path}?${params.toString()}`;
};
