import {
  useQueryParams,
  unstable_useContentManagerContext as useContentManagerContext,
} from '@strapi/strapi/admin';

/**
 * Identifies the document field the editor edits: content type uid, document
 * id, locale and field path. Collaboration and version history need all four;
 * a new (unsaved) entry has no document id yet.
 * @param {string} name - Field name/path from the Content Manager.
 * @returns {{ uid: string|null, documentId: string|null, locale: string|null, field: string }} Target.
 */
export const useFieldTarget = (name) => {
  const context = useContentManagerContext();
  const [{ query }] = useQueryParams();
  const values = context && context.form && context.form.values;
  const fromForm = values && typeof values.documentId === 'string' ? values.documentId : null;
  const fromRoute = context && context.id && context.id !== 'create' ? context.id : null;
  const locale = query && query.plugins && query.plugins.i18n ? query.plugins.i18n.locale || null : null;
  return {
    uid: (context && context.model) || null,
    documentId: fromForm || fromRoute,
    locale: typeof locale === 'string' ? locale : null,
    field: name,
  };
};
