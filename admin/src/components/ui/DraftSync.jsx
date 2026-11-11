import { useEffect } from 'react';
import { useForm } from '@strapi/strapi/admin';

/**
 * Mirrors a page's draft into Strapi's Form so the native Blocker knows
 * whether there are unsaved changes. Render inside `<Form initialValues={saved}>`.
 * @param {{ values: object }} props - Current draft.
 * @returns {null} Nothing.
 */
export const DraftSync = ({ values }) => {
  const setValues = useForm('MagicEditorXDraftSync', (state) => state.setValues);
  useEffect(() => {
    setValues(values);
  }, [values, setValues]);
  return null;
};

export default DraftSync;
