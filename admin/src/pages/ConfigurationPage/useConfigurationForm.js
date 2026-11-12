import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { API, readApiError } from '../../utils/api';
import {
  adjustedFields,
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
 * @returns {object} Form state and actions.
 */
export const useConfigurationForm = () => {
  const { get, put, post } = useFetchClient();
  const [status, setStatus] = useState('loading');
  const [dto, setDto] = useState(null);
  const [saved, setSaved] = useState(null);
  const [draft, setDraft] = useState(null);
  const [serverErrors, setServerErrors] = useState({});
  const [showErrors, setShowErrors] = useState(false);
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
          const next = toDraft(data.data.ai, data.data.languageTool);
          setDto(data.data);
          setSaved(next);
          setDraft(next);
          setServerErrors({});
          setShowErrors(false);
          setStatus('ready');
        },
        () => {
          if (mounted.current) setStatus('error');
        }
      ),
    [get]
  );

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  const load = useCallback(() => {
    setStatus('loading');
    fetchSettings();
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
    setServerErrors((current) => {
      const name = `languageTool.${key}`;
      if (!current[name] && !current._form) return current;
      const next = { ...current };
      delete next[name];
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
      const { data } = await put(API.settings, toPayload(draft));
      const stored = toDraft(data.data.ai, data.data.languageTool);
      const adjusted = adjustedFields(draft, stored);
      setDto(data.data);
      setSaved(stored);
      setDraft(stored);
      setServerErrors({});
      setShowErrors(false);
      return { ok: true, adjusted };
    } catch (error) {
      const info = readApiError(error);
      setServerErrors(mapServerErrors(info.details));
      return { ok: false, message: info.status === 400 ? null : info.message };
    } finally {
      if (mounted.current) setSaving(false);
    }
  }, [draft, hasErrors, put]);

  const clearServerErrors = useCallback(() => setServerErrors({}), []);

  const discard = useCallback(() => {
    setDraft(saved);
    setServerErrors({});
    setShowErrors(false);
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
    if (!lt || !String(lt.baseUrl || '').trim()) return { ok: false, invalid: true, missingUrl: true };
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

  const visibleErrors = useMemo(() => {
    const merged = showErrors ? { ...errors } : {};
    for (const [key, value] of Object.entries(serverErrors)) merged[key] = { server: value };
    return merged;
  }, [errors, serverErrors, showErrors]);

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
    testLanguageTool,
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
