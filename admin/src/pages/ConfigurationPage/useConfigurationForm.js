import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetchClient } from '../../utils/fetch-client';
import { API, readApiError } from '../../utils/api';
import {
  adjustedFields,
  visibleFormErrors,
  mapServerErrors,
  sameDraft,
  toDraft,
  toPayload,
  toLanguageToolPayload,
  validateDraft,
  validateLanguageTool,
} from './configForm.mjs';

/**
 * Loads, edits, validates and saves the plugin settings.
 * Load failures keep the form hidden (status 'error') so defaults can never
 * overwrite stored settings.
 * @param {{ enabled?: boolean }} [options] - `enabled` false (permissions still loading or missing)
 *   sends no request (2.7.4: no 403 in the console for people without access).
 * @returns {object} Form state and actions.
 */
export const useConfigurationForm = ({ enabled = true } = {}) => {
  const { get, put, post } = useFetchClient();
  const [status, setStatus] = useState('loading');
  const [dto, setDto] = useState(null);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [serverErrors, setServerErrors] = useState({});
  const [showErrors, setShowErrors] = useState(false);
  // 2.7.8: fields the user left (blur) or changed after leaving show their errors at once,
  // before Save. Keys as in `errors` (`maxInputChars`, `languageTool.baseUrl`).
  const [touched, setTouched] = useState({});
  // 2.7.8: errors that only a connection test raises (an empty LanguageTool base URL while the
  // check is off is fine for saving, but there is nothing to test).
  const [testErrors, setTestErrors] = useState({});
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testingLanguageTool, setTestingLanguageTool] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const fetchSettings = useCallback(
    () =>
      get(API.settings).then(
        ({ data }) => {
          if (!mounted.current) return;
          const next = toDraft(data.data.ai, data.data.languageTool, data.data.coreBlocks);
          setDto(data.data);
          setSaved(next);
          setDraft(next);
          setServerErrors({});
          setShowErrors(false);
          setTouched({});
          setTestErrors({});
          setStatus('ready');
        },
        () => {
          if (mounted.current) setStatus('error');
        }
      ),
    [get]
  );

  useEffect(() => {
    if (enabled) fetchSettings();
  }, [enabled, fetchSettings]);

  const load = useCallback(() => {
    setStatus('loading');
    return fetchSettings();
  }, [fetchSettings]);

  const errors = useMemo(() => {
    if (!draft || !dto) return {};
    return {
      ...validateDraft(draft, { saved, ai: dto.ai, environment: dto.environment }),
      ...validateLanguageTool(draft.languageTool, {
        saved: saved && saved.languageTool,
        dto: dto.languageTool,
        environment: dto.environment,
      }),
    };
  }, [draft, dto, saved]);

  /**
   * Marks a field as visited (on blur), so its error shows without waiting for Save.
   * @param {string} key - Error key (`maxInputChars`, `languageTool.baseUrl`).
   */
  const touch = useCallback(
    (key) => setTouched((current) => (current[key] ? current : { ...current, [key]: true })),
    []
  );

  const setField = useCallback((key, value) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setServerErrors((current) => {
      if (!current[key] && !current._form) return current;
      const next = { ...current };
      delete next[key];
      delete next._form;
      return next;
    });
  }, []);

  const replaceDraft = useCallback((next) => setDraft(next), []);

  /** Updates one LanguageTool draft value (2.3); errors use `languageTool.<key>`. */
  const setLanguageToolField = useCallback((key, value) => {
    setDraft((current) => ({ ...current, languageTool: { ...current.languageTool, [key]: value } }));
    setTestErrors((current) => {
      const name = `languageTool.${key}`;
      if (!current[name]) return current;
      const next = { ...current };
      delete next[name];
      return next;
    });
    setServerErrors((current) => {
      const name = `languageTool.${key}`;
      if (!current[name] && !current._form) return current;
      const next = { ...current };
      delete next[name];
      delete next._form;
      return next;
    });
  }, []);

  /** Sets the Core Blocks bridge switch (2.7). */
  const setCoreBlocksEnabled = useCallback((enabled) => {
    setDraft((current) => ({ ...current, coreBlocks: { enabled: enabled === true } }));
    setServerErrors((current) => {
      if (!current['coreBlocks.enabled'] && !current._form) return current;
      const next = { ...current };
      delete next['coreBlocks.enabled'];
      delete next._form;
      return next;
    });
  }, []);

  const dirty = Boolean(draft && saved && !sameDraft(draft, saved));
  const hasErrors = Object.keys(errors).length > 0;

  /**
   * Saves the draft. Resolves to `{ ok, adjusted }`.
   * @returns {Promise<{ ok: boolean, adjusted?: string[], message?: string|null }>} Outcome.
   */
  const save = useCallback(async () => {
    setShowErrors(true);
    if (hasErrors) return { ok: false, invalid: true };
    setSaving(true);
    try {
      const { data } = await put(API.settings, toPayload(draft, saved));
      const stored = toDraft(data.data.ai, data.data.languageTool, data.data.coreBlocks);
      const adjusted = adjustedFields(draft, stored);
      setDto(data.data);
      setSaved(stored);
      setDraft(stored);
      setServerErrors({});
      setShowErrors(false);
      setTouched({});
      setTestErrors({});
      return { ok: true, adjusted };
    } catch (error) {
      const info = readApiError(error);
      setServerErrors(mapServerErrors(info.details));
      return { ok: false, message: info.status === 400 ? null : info.message };
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [draft, saved, hasErrors, put]);

  const clearServerErrors = useCallback(() => setServerErrors({}), []);

  const discard = useCallback(() => {
    setDraft(saved);
    setServerErrors({});
    setShowErrors(false);
    setTouched({});
    setTestErrors({});
  }, [saved]);

  /**
   * Tests the provider connection with the current draft.
   * @returns {Promise<{ ok: boolean, code?: string|null }>} Outcome.
   */
  const test = useCallback(async () => {
    setShowErrors(true);
    const blocking = Object.keys(errors).filter(
      (key) => !key.startsWith('languageTool.') && (key !== 'apiKey' || draft.apiKeyMode === 'replace')
    );
    if (blocking.length) return { ok: false, invalid: true };
    setTesting(true);
    try {
      const payload = toPayload(draft);
      if (draft.apiKeyMode === 'remove') delete payload.ai.apiKey;
      await post(API.settingsAiTest, payload);
      return { ok: true };
    } catch (error) {
      const info = readApiError(error);
      return { ok: false, code: info.code, status: info.status };
    } finally {
      if (mounted.current) setTesting(false);
    }
  }, [draft, errors, post]);

  /**
   * Tests the LanguageTool connection with the current draft (2.3).
   * @returns {Promise<{ ok: boolean, code?: string|null, invalid?: boolean }>} Outcome.
   */
  const testLanguageTool = useCallback(async () => {
    setShowErrors(true);
    const lt = draft && draft.languageTool;
    const blocking = Object.keys(errors).filter(
      (key) =>
        key.startsWith('languageTool.') && (key !== 'languageTool.apiKey' || lt.apiKeyMode === 'replace')
    );
    if (!lt || !String(lt.baseUrl || '').trim()) {
      // 2.7.8: the message says "Fix the highlighted fields", so the base URL is highlighted.
      if (lt) setTestErrors({ 'languageTool.baseUrl': 'required' });
      return { ok: false, invalid: true, missingUrl: true };
    }
    if (blocking.length) return { ok: false, invalid: true };
    setTestingLanguageTool(true);
    try {
      const payload = toLanguageToolPayload(lt);
      if (lt.apiKeyMode === 'remove') payload.apiKey = '';
      await post(API.settingsLanguageToolTest, { languageTool: payload });
      return { ok: true };
    } catch (error) {
      const info = readApiError(error);
      return { ok: false, code: info.code, status: info.status };
    } finally {
      if (mounted.current) setTestingLanguageTool(false);
    }
  }, [draft, errors, post]);

  const visibleErrors = useMemo(
    () => visibleFormErrors({ errors, serverErrors, testErrors, touched, showErrors }),
    [errors, serverErrors, testErrors, touched, showErrors]
  );

  return {
    status,
    dto,
    saved,
    draft,
    errors: visibleErrors,
    dirty,
    hasErrors,
    saving,
    testing,
    testingLanguageTool,
    setLanguageToolField,
    setCoreBlocksEnabled,
    testLanguageTool,
    touch,
    reload: load,
    setField,
    replaceDraft,
    save,
    discard,
    test,
    clearServerErrors,
  };
};

export default useConfigurationForm;
