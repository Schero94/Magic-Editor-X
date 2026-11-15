import { Suspense, lazy } from 'react';
import { useIntl } from 'react-intl';
import { Typography } from '@strapi/design-system';
import {
  useQueryParams,
  useRBAC,
  unstable_useContentManagerContext as useContentManagerContext,
} from '@strapi/strapi/admin';
import { PERMISSIONS } from '../../permissions';
import { getTranslation } from '../../utils/getTranslation';
import { hasEditorFields } from './logic.mjs';

const Content = lazy(() => import('./Content'));

/**
 * The ONE Magic Editor X Content Manager side panel (2.5, `addEditViewSidePanel` in bootstrap):
 * a description component that returns `{ title, content }` or null. Hidden while an entry is
 * created, for content types without Magic Editor X fields and for admins without the plugin's
 * `access` action (the server checks every request again). Sections live in `./sections.jsx`.
 * @param {{ model: string, documentId?: string, document?: { updatedAt?: string } }} props - Edit view context.
 * @returns {{ title: string, content: JSX.Element } | null} Panel description.
 */
export const EntryPanel = ({ model, documentId, document }) => {
  const { formatMessage } = useIntl();
  const context = useContentManagerContext();
  const [{ query }] = useQueryParams();
  const { isLoading, allowedActions } = useRBAC(PERMISSIONS.access);
  const locale =
    query && query.plugins && query.plugins.i18n && typeof query.plugins.i18n.locale === 'string'
      ? query.plugins.i18n.locale
      : null;
  const editorType = hasEditorFields(context && context.contentType, (context && context.components) || {});
  if (!documentId || !model || !editorType || isLoading || !allowedActions.canAccess) return null;
  const loading = formatMessage({ id: getTranslation('entryPanel.loading'), defaultMessage: 'Loading' });
  return {
    title: formatMessage({ id: getTranslation('entryPanel.title'), defaultMessage: 'Magic Editor X' }),
    content: (
      <Suspense
        fallback={
          <Typography variant="pi" textColor="neutral600">
            {loading}
          </Typography>
        }
      >
        <Content
          uid={model}
          documentId={documentId}
          locale={locale}
          version={String((document && document.updatedAt) || '')}
        />
      </Suspense>
    ),
  };
};

export default EntryPanel;
