import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { API } from '../../utils/api';

/**
 * Loads every template (`GET /templates?all=true`) and the Magic Editor X
 * fields for scope selection (`GET /templates/targets`).
 * @returns {object} State and actions.
 */
export const useTemplateList = () => {
  const { get } = useFetchClient();
  const [status, setStatus] = useState('loading');
  const [templates, setTemplates] = useState([]);
  const [refreshError, setRefreshError] = useState(false);
  const [targets, setTargets] = useState({ status: 'loading', items: [] });
  const mounted = useRef(true);
  const loaded = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchTemplates = useCallback(
    () =>
      get(API.templates, { params: { all: 'true' } }).then(
        ({ data }) => {
          if (!mounted.current) return;
          setTemplates(Array.isArray(data.data) ? data.data : []);
          setRefreshError(false);
          loaded.current = true;
          setStatus('ready');
        },
        () => {
          if (!mounted.current) return;
          if (loaded.current) setRefreshError(true);
          else setStatus('error');
        }
      ),
    [get]
  );

  const fetchTargets = useCallback(
    () =>
      get(API.templateTargets).then(
        ({ data }) => {
          if (mounted.current)
            setTargets({ status: 'ready', items: Array.isArray(data.data) ? data.data : [] });
        },
        () => {
          if (mounted.current) setTargets({ status: 'error', items: [] });
        }
      ),
    [get]
  );

  useEffect(() => {
    fetchTemplates();
    fetchTargets();
  }, [fetchTemplates, fetchTargets]);

  const reload = useCallback(() => {
    if (!loaded.current) setStatus('loading');
    return fetchTemplates();
  }, [fetchTemplates]);

  const reloadTargets = useCallback(() => {
    setTargets((current) => ({ ...current, status: 'loading' }));
    return fetchTargets();
  }, [fetchTargets]);

  return { status, templates, setTemplates, refreshError, reload, targets, reloadTargets };
};

export default useTemplateList;
