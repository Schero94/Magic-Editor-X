import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { API } from '../../utils/api';

/**
 * Loads the templates and patterns offered in one field
 * (`GET /templates?uid&field`) while the insert dialog is open.
 * @param {{ uid: string|null, field: string }} target - The field.
 * @param {boolean} open - Load only while the dialog is open.
 * @returns {{ status: 'loading'|'ready'|'error', items: object[], reload: () => void }} State.
 */
export const useTemplates = (target, open) => {
  const { get } = useFetchClient();
  const [state, setState] = useState({ status: 'loading', items: [] });
  const [attempt, setAttempt] = useState(0);
  const active = useRef(true);

  useEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
    };
  }, []);

  useEffect(() => {
    if (!open || !target.uid) return undefined;
    const controller = new AbortController();
    get(API.templates, { params: { uid: target.uid, field: target.field }, signal: controller.signal }).then(
      ({ data }) => {
        if (active.current && !controller.signal.aborted)
          setState({ status: 'ready', items: Array.isArray(data.data) ? data.data : [] });
      },
      () => {
        if (active.current && !controller.signal.aborted) setState({ status: 'error', items: [] });
      }
    );
    return () => controller.abort();
  }, [get, open, target.uid, target.field, attempt]);

  const reload = useCallback(() => {
    setState((current) => ({ status: 'loading', items: current.items }));
    setAttempt((value) => value + 1);
  }, []);
  return { ...state, reload };
};

export default useTemplates;
