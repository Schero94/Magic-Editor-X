import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetchClient } from '../../utils/fetch-client';
import { API } from '../../utils/api';

/**
 * Loads custom blocks (all, including disabled) and readable content types.
 * @param {{ enabled?: boolean }} [options] - `enabled` false (permissions still loading or
 *   missing) sends no request (2.7.8, as the Configuration page since 2.7.4).
 * @returns {object} State and actions.
 */
export const useCustomBlocks = ({ enabled = true } = {}) => {
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
    if (!enabled) return;
    fetchBlocks();
    fetchContentTypes();
  }, [enabled, fetchBlocks, fetchContentTypes]);

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
