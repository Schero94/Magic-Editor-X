import { unstable_useContentManagerContext as useContentManagerContext } from '@strapi/strapi/admin';

/**
 * The saved values of the entry open in the Content Manager (the form's
 * `initialValues`, replaced by Strapi after every successful save). The local
 * draft buffer (2.5) compares the field's content with its saved value.
 * @returns {object|null} Saved form values, or null outside an edit view.
 */
export const useSavedValues = () => {
  const context = useContentManagerContext();
  return (context && context.form && context.form.initialValues) || null;
};
