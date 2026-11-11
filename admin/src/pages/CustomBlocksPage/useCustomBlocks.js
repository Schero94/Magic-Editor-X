import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { API } from '../../utils/api';

/**
 * Loads custom blocks (all, including disabled) and readable content types.
 * @returns {object} State and actions.
 */
export const useCustomBlocks = () => {
  const { get } = useFetchClient();
  const [status, setStatus] = useState('loading');
  const [blocks, setBlocks] = useState([]);
  const [refreshError, setRefreshError] = useState(false);
  const [contentTypes, setContentTypes] = useState({ status: 'loading', items: [] });
  const mounted = useRef(true);
  const loaded = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchBlocks = useCallback(
    () =>
      get(API.customBlocks, { params: { all: 'true' } }).then(
        ({ data }) => {
          if (!mounted.current) return;
          setBlocks(Array.isArray(data.data) ? data.data : []);
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

  const fetchContentTypes = useCallback(
    () =>
      get(API.contentTypes).then(
        ({ data }) => {
          if (mounted.current)
            setContentTypes({ status: 'ready', items: Array.isArray(data.data) ? data.data : [] });
        },
        () => {
          if (mounted.current) setContentTypes({ status: 'error', items: [] });
        }
      ),
    [get]
  );

  useEffect(() => {
    fetchBlocks();
    fetchContentTypes();
  }, [fetchBlocks, fetchContentTypes]);

  const load = useCallback(() => {
    if (!loaded.current) setStatus('loading');
    return fetchBlocks();
  }, [fetchBlocks]);

  const loadContentTypes = useCallback(() => {
    setContentTypes((current) => ({ ...current, status: 'loading' }));
    return fetchContentTypes();
  }, [fetchContentTypes]);

  return {
    status,
    blocks,
    setBlocks,
    refreshError,
    reload: load,
    contentTypes,
    reloadContentTypes: loadContentTypes,
  };
};

export default useCustomBlocks;
