import { useCallback, useEffect, useRef, useState } from 'react';
import { useFetchClient } from '../../utils/fetch-client';
import { API, readApiError } from '../../utils/api';
import { ALL_LOCALES, backupFileName, fieldDefaults, isRunning, requestBody } from './migrationFlow.mjs';

/**
 * State and requests of the migration wizard (2.13): types and locales, selection, preview,
 * backup download, and the batch loop of a run (one request per batch; leaving the page pauses
 * the run, which stays resumable on the server).
 * @param {{ enabled: boolean }} options - Load only when the admin may use the wizard.
 * @returns {object} Wizard state and actions.
 */
export const useMigrationWizard = ({ enabled }) => {
  const { get, post } = useFetchClient();
  // The loaded result belongs to one request (`nonce`); while a newer one runs the status is loading.
  const [result, setResult] = useState({ key: -1, failed: false, types: [], locales: [], jobs: [] });
  const [nonce, setNonce] = useState(0);
  const [selection, setSelection] = useState({
    uid: '',
    from: '',
    to: '',
    locale: ALL_LOCALES,
    overwrite: false,
  });
  const [preview, setPreview] = useState({ status: 'idle', data: null, error: null, key: null });
  const [job, setJob] = useState(null);
  const [runError, setRunError] = useState(null);
  const [backupState, setBackupState] = useState({ status: 'idle', error: null });
  const runningRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      runningRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    Promise.all([
      get(API.migrationTypes, { signal: controller.signal }),
      get(API.migrationJobs, { signal: controller.signal }),
    ]).then(
      ([types, jobs]) => {
        if (controller.signal.aborted) return;
        const list = (types.data.data && types.data.data.types) || [];
        // One content type to migrate: it is preselected with its only source and target.
        if (list.length === 1)
          setSelection((current) =>
            current.uid ? current : { ...current, uid: list[0].uid, ...fieldDefaults(list[0]) }
          );
        setResult({
          key: nonce,
          failed: false,
          types: (types.data.data && types.data.data.types) || [],
          locales: (types.data.data && types.data.data.locales) || [],
          jobs: jobs.data.data || [],
        });
      },
      () => {
        if (!controller.signal.aborted) setResult((current) => ({ ...current, key: nonce, failed: true }));
      }
    );
    return () => controller.abort();
  }, [enabled, get, nonce]);

  const load = {
    ...result,
    status: result.key !== nonce ? 'loading' : result.failed ? 'error' : 'ready',
  };
  const type = load.types.find((entry) => entry.uid === selection.uid) || null;
  const body = requestBody(selection, Boolean(type && type.localized));
  const bodyKey = body ? JSON.stringify(body) : null;

  /** Changes the selection; a new content type preselects the only source and target. */
  const select = useCallback(
    (patch) => {
      setSelection((current) => {
        const next = { ...current, ...patch };
        if (patch.uid !== undefined && patch.uid !== current.uid) {
          const nextType = result.types.find((entry) => entry.uid === patch.uid) || null;
          Object.assign(next, fieldDefaults(nextType), { locale: ALL_LOCALES });
        }
        return next;
      });
    },
    [result.types]
  );

  const runPreview = useCallback(async () => {
    if (!bodyKey) return;
    setPreview({ status: 'loading', data: null, error: null, key: bodyKey });
    try {
      const { data } = await post(API.migrationPreview, { ...JSON.parse(bodyKey), size: 5 });
      if (mountedRef.current) setPreview({ status: 'ready', data: data.data, error: null, key: bodyKey });
    } catch (error) {
      if (mountedRef.current)
        setPreview({ status: 'error', data: null, error: readApiError(error), key: bodyKey });
    }
  }, [bodyKey, post]);

  const downloadBackup = useCallback(async () => {
    if (!bodyKey) return false;
    const params = JSON.parse(bodyKey);
    delete params.overwrite;
    setBackupState({ status: 'loading', error: null });
    try {
      const { data } = await get(API.migrationBackup, { params });
      const blob = new Blob([JSON.stringify(data.data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = backupFileName(params);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      if (mountedRef.current) setBackupState({ status: 'done', error: null });
      return true;
    } catch (error) {
      if (mountedRef.current) setBackupState({ status: 'error', error: readApiError(error) });
      return false;
    }
  }, [bodyKey, get]);

  /** Requests batches until the job is done, stopped, fails or the page is left. */
  const loop = useCallback(
    async (current) => {
      if (runningRef.current) return;
      runningRef.current = true;
      setRunError(null);
      let state = current;
      try {
        while (mountedRef.current && runningRef.current && isRunning(state)) {
          const { data } = await post(API.migrationNext(state.id), {});
          state = data.data;
          if (mountedRef.current) setJob(state);
        }
      } catch (error) {
        if (mountedRef.current) setRunError(readApiError(error));
      } finally {
        runningRef.current = false;
      }
    },
    [post]
  );

  const start = useCallback(async () => {
    if (!bodyKey) return;
    setRunError(null);
    try {
      const { data } = await post(API.migrationJobs, JSON.parse(bodyKey));
      if (!mountedRef.current) return;
      setJob(data.data);
      await loop(data.data);
    } catch (error) {
      if (mountedRef.current) setRunError(readApiError(error));
      throw error;
    }
  }, [bodyKey, loop, post]);

  const resume = useCallback(
    async (target) => {
      const resumed = target || job;
      if (!resumed) return;
      setJob(resumed);
      setResult((current) => ({ ...current, jobs: current.jobs.filter((entry) => entry.id !== resumed.id) }));
      setSelection({
        uid: resumed.uid,
        from: resumed.from,
        to: resumed.to,
        locale: resumed.locale || ALL_LOCALES,
        overwrite: resumed.overwrite,
      });
      await loop(resumed);
    },
    [job, loop]
  );

  const stop = useCallback(
    async (target) => {
      const stopped = target || job;
      if (!stopped) return;
      runningRef.current = false;
      const { data } = await post(API.migrationCancel(stopped.id), {});
      if (!mountedRef.current) return;
      setResult((current) => ({ ...current, jobs: current.jobs.filter((entry) => entry.id !== stopped.id) }));
      if (job && job.id === stopped.id) setJob(data.data);
    },
    [job, post]
  );

  const reset = useCallback(() => {
    setJob(null);
    setRunError(null);
    setPreview({ status: 'idle', data: null, error: null, key: null });
    setBackupState({ status: 'idle', error: null });
  }, []);

  return {
    load,
    reload: () => setNonce((value) => value + 1),
    selection,
    select,
    type,
    ready: Boolean(bodyKey),
    // A preview belongs to the selection it was made for.
    preview: preview.key === bodyKey ? preview : { status: 'idle', data: null, error: null, key: null },
    runPreview,
    backupState,
    downloadBackup,
    job,
    runError,
    start,
    resume,
    stop,
    reset,
  };
};
