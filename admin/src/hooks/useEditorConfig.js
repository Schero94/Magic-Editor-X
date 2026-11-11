import { useEffect, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { API } from '../utils/api';

/**
 * Loads the editor runtime configuration (`GET /magic-editor-x/config`) and the
 * enabled custom blocks once per page load; every editor field on the page
 * shares the same promises.
 */

let configPromise = null;
let blocksPromise = null;

/**
 * Clears the cache (after custom blocks change in settings, and in tests).
 */
export const resetEditorConfigCache = () => {
  configPromise = null;
  blocksPromise = null;
};

/**
 * @returns {{ config: object|null, customBlocks: object[], error: boolean, loading: boolean, retry: () => void }} State.
 */
export const useEditorConfig = () => {
  const { get } = useFetchClient();
  const [state, setState] = useState({ config: null, customBlocks: [], error: false, loading: true });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    if (!configPromise) {
      configPromise = get(API.config).then((response) => response.data.data);
      configPromise.catch(() => {
        configPromise = null;
      });
    }
    if (!blocksPromise) {
      blocksPromise = get(API.customBlocks)
        .then((response) => (Array.isArray(response.data.data) ? response.data.data : []))
        .catch(() => []);
    }
    Promise.all([configPromise, blocksPromise])
      .then(([config, customBlocks]) => {
        if (active) setState({ config, customBlocks, error: false, loading: false });
      })
      .catch(() => {
        if (active) setState({ config: null, customBlocks: [], error: true, loading: false });
      });
    return () => {
      active = false;
    };
  }, [get, attempt]);

  return {
    ...state,
    retry: () => {
      setState((current) => ({ ...current, loading: true, error: false }));
      setAttempt((value) => value + 1);
    },
  };
};
