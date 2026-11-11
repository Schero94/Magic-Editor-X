import { useCallback } from 'react';
import { useIntl } from 'react-intl';
import { getTranslation } from '../../utils/getTranslation';

/**
 * Translation helper for plugin screens.
 * Call it as t(id, defaultMessage, values); the id gets the plugin prefix
 * with the English default; the i18n test checks that the default equals en.json.
 * @returns {(id: string, defaultMessage: string, values?: object) => string} Translate function.
 */
export const useT = () => {
  const { formatMessage } = useIntl();
  return useCallback(
    (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values),
    [formatMessage]
  );
};
