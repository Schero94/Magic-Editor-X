import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@strapi/strapi/admin';
import { prepareEditorValue } from '../../editor/sanitize';
import { stableStringify } from '../../../../shared/ydoc.mjs';
import { diffDocuments, summarizeDiff } from '../../../../shared/diff.mjs';
import {
  DRAFT_WRITE_DELAY_MS,
  bufferAction,
  buildDraftRecord,
  draftIdentity,
  restoreDecision,
  ttlMsOf,
} from '../../editor/drafts-logic.mjs';
import { deleteDraft, getDraft, pruneDrafts, putDraft } from '../../editor/draft-store';
import { recoveryAction } from '../../editor/session-guard.mjs';
import { useSessionState } from '../../editor/useSessionGuard';

/** After signing in again, a form reset within this time brings the buffer back (2.6). */
const RECOVERY_WINDOW_MS = 15000;

/**
 * Comparable form of a value as the editor would show it (normalised, sanitised, blocks only).
 * @param {unknown} value - Field value.
 * @returns {{ data: object|null, key: string }} Normalised data and fingerprint.
 */
const fingerprint = (value) => {
  const data = prepareEditorValue(value).data;
  return { data, key: stableStringify(data && Array.isArray(data.blocks) ? data.blocks : []) };
};

/**
 * Local draft buffer of one editor field (2.5, roadmap item 7).
 *
 * While the field's content differs from the saved value, the content is
 * written (debounced, and at once when the tab is hidden or closed) to
 * IndexedDB for this admin (editor/draft-store.js). It is removed again when
 * the content equals the saved value (after Save, after undoing every
 * change), when the person discards it, when it expires, and when the admin
 * logs out (admin/src/index.js). During live collaboration that is
 * connected with nothing unsent, the room keeps the content and nothing is
 * buffered; a disconnected gap (reconnecting, offline, unsent edits) is.
 *
 * When the field opens and a buffer exists that differs from what the editor
 * shows and from what is saved, `notice` is set: the field shows one notice
 * with Restore and Discard. It is never restored on its own; `conflict` says
 * the saved content changed after the buffer was taken (with block counts).
 *
 * Signed out (2.6, `editor/session-guard.mjs`): while the admin session has
 * ended, a changed field is buffered at once and on every change, also during
 * live collaboration (the room no longer receives edits), and the buffer is
 * never deleted. After signing in again, Strapi resets the edit form from the
 * server; when the form value of a still mounted field falls back to the saved
 * value within 15 s, the field's last buffer is put back (`onRecover`) so the
 * typed text is in the form again and Save works. A field that was unmounted
 * (Strapi left the page) offers the buffer with the notice when it opens.
 * @param {object} options - Options.
 * @param {boolean} options.enabled - Config `drafts.enabled` and a Content Manager field (uid set).
 * @param {unknown} options.ttlHours - Config `drafts.ttlHours`.
 * @param {{ uid: string|null, documentId: string|null, locale: string|null, field: string, fieldKey?: string|null }} options.target - Field (`fieldKey` only when saved).
 * @param {unknown} options.value - Current form value of the field.
 * @param {unknown} options.savedValue - Saved value of the field (form initial values).
 * @param {object|null} options.shownData - What the editor shows (after a live room synced: the room).
 * @param {boolean} options.ready - The editor is ready.
 * @param {boolean} options.readOnly - The field cannot be edited (no notice then).
 * @param {{ active: boolean, status: string, pending: boolean }} options.collaboration - Live state.
 * @param {(data: object) => Promise<unknown>} options.onRestore - Puts content into the editor (one undo step).
 * @param {(data: object) => Promise<unknown>} [options.onRecover] - Same, after signing in again (2.6; no notification).
 * @returns {{ notice: { savedAt: number, conflict: boolean, counts: object|null }|null, restore: () => Promise<void>, discard: () => Promise<void>, busy: boolean }} State.
 */
export const useDraftBuffer = ({
  enabled,
  ttlHours,
  target,
  value,
  savedValue,
  shownData,
  ready,
  readOnly,
  collaboration,
  onRestore,
  onRecover,
}) => {
  const session = useSessionState();
  const sessionEnded = session.status === 'ended';
  const resumedAt = session.resumedAt;
  const owner = useAuth('MagicEditorX', (state) => (state.user ? state.user.id : null));
  const id = useMemo(
    () =>
      enabled
        ? draftIdentity({
            owner,
            uid: target.uid,
            documentId: target.documentId,
            locale: target.locale,
            field: target.field,
            fieldKey: target.fieldKey,
          })
        : null,
    [enabled, owner, target.uid, target.documentId, target.locale, target.field, target.fieldKey]
  );
  const ttlMs = ttlMsOf(ttlHours);
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  // `decided`: the buffer found on opening was handled (or there was none); writes start after that.
  const [decided, setDecided] = useState(null);
  const ownRef = useRef(false);
  const timerRef = useRef(null);
  const flushRef = useRef(null);
  const latestRef = useRef({});
  // 2.6: the last content this field buffered ({ data, key }), put back after signing in again.
  const lastWrittenRef = useRef(null);
  const recoveredRef = useRef(null);
  const endedRef = useRef(false);
  useEffect(() => {
    latestRef.current = {
      value,
      savedValue,
      shownData,
      collaboration,
      readOnly,
      ttlMs,
      sessionEnded,
      resumedAt,
    };
  });

  // A live room shows its own content after the first sync: decide only once it settled.
  const settled =
    !collaboration.active || ['live', 'reconnecting', 'offline', 'paused'].includes(collaboration.status);

  useEffect(() => {
    if (!id || !ready || !settled || decided === id) return undefined;
    let cancelled = false;
    const now = Date.now();
    pruneDrafts(now);
    getDraft(id).then(async (record) => {
      if (cancelled) return;
      const current = latestRef.current;
      const saved = fingerprint(current.savedValue);
      const shown = fingerprint(current.shownData);
      const recorded = record && record.data ? fingerprint(record.data) : null;
      const decision = restoreDecision({
        record,
        now,
        readOnly: current.readOnly,
        recordKey: recorded ? recorded.key : undefined,
        shownKey: shown.key,
        savedKey: saved.key,
      });
      if (decision.action === 'delete') await deleteDraft(id);
      if (cancelled) return;
      if (decision.action === 'offer') {
        let counts = null;
        if (decision.conflict) {
          try {
            counts = summarizeDiff(diffDocuments(saved.data || { blocks: [] }, recorded.data));
          } catch {
            counts = null;
          }
        }
        setNotice({
          savedAt: record.savedAt,
          foundAt: Date.now(),
          conflict: Boolean(decision.conflict),
          counts,
          data: recorded.data,
        });
      }
      setDecided(id);
    });
    return () => {
      cancelled = true;
    };
  }, [id, ready, settled, decided]);

  const pendingNotice = Boolean(notice);
  useEffect(() => {
    if (!id || decided !== id || pendingNotice) return undefined;
    const write = async () => {
      timerRef.current = null;
      flushRef.current = null;
      const current = latestRef.current;
      const shown = fingerprint(current.value);
      const saved = fingerprint(current.savedValue);
      const action = bufferAction({
        dirty: shown.key !== saved.key,
        collaboration: current.collaboration,
        sessionEnded: current.sessionEnded,
      });
      // Right after signing in again the form may be reset to the saved value: keep the buffer for the recovery.
      const recovering = Boolean(
        current.resumedAt && Date.now() - current.resumedAt <= RECOVERY_WINDOW_MS && lastWrittenRef.current
      );
      if (action === 'write' && shown.data) {
        const record = buildDraftRecord({
          id,
          data: shown.data,
          baseKey: saved.key,
          now: Date.now(),
          ttlMs: current.ttlMs,
        });
        if (record && (await putDraft(record))) {
          ownRef.current = true;
          lastWrittenRef.current = { data: shown.data, key: shown.key };
        }
      } else if (action === 'delete' && ownRef.current && !recovering) {
        ownRef.current = false;
        lastWrittenRef.current = null;
        await deleteDraft(id);
      }
    };
    clearTimeout(timerRef.current);
    flushRef.current = write;
    // The session just ended: write at once, the next request may already leave the page.
    const delay = sessionEnded && !endedRef.current ? 0 : DRAFT_WRITE_DELAY_MS;
    endedRef.current = sessionEnded;
    timerRef.current = setTimeout(write, delay);
    return () => clearTimeout(timerRef.current);
  }, [
    sessionEnded,
    id,
    decided,
    pendingNotice,
    value,
    savedValue,
    collaboration.active,
    collaboration.status,
    collaboration.pending,
  ]);

  // 2.6: signed in again. Strapi reloads the entry and resets the form: put the buffered text back once.
  const valueKey = useMemo(() => fingerprint(value).key, [value]);
  const savedKey = useMemo(() => fingerprint(savedValue).key, [savedValue]);
  useEffect(() => {
    if (!id || !ready || readOnly || !resumedAt || typeof onRecover !== 'function') return undefined;
    if (recoveredRef.current === resumedAt) return undefined;
    const check = () => {
      const last = lastWrittenRef.current;
      const action = recoveryAction({
        sinceResumeMs: Date.now() - resumedAt,
        windowMs: RECOVERY_WINDOW_MS,
        valueKey,
        savedKey,
        draftKey: last ? last.key : null,
      });
      if (action === 'wait') return;
      recoveredRef.current = resumedAt;
      if (action === 'restore') Promise.resolve(onRecover(last.data)).catch(() => {});
    };
    check();
    return undefined;
  }, [id, ready, readOnly, resumedAt, valueKey, savedKey, onRecover]);

  // Closing or hiding the tab writes a pending change right away.
  useEffect(() => {
    if (!id) return undefined;
    const flush = () => {
      if (flushRef.current) {
        clearTimeout(timerRef.current);
        flushRef.current();
      }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onVisibility);
      // Unmount (leaving the entry): a pending write still runs.
      flush();
    };
  }, [id]);

  const restore = useCallback(async () => {
    if (!notice) return;
    setBusy(true);
    try {
      await onRestore(notice.data);
      // The restored content is this field's buffer from now on (rewritten on the next change check).
      ownRef.current = true;
      setNotice(null);
    } finally {
      setBusy(false);
    }
  }, [notice, onRestore]);

  const discard = useCallback(async () => {
    if (!id) return;
    setBusy(true);
    try {
      await deleteDraft(id);
      ownRef.current = false;
      setNotice(null);
    } finally {
      setBusy(false);
    }
  }, [id]);

  return {
    notice: notice
      ? { savedAt: notice.savedAt, foundAt: notice.foundAt, conflict: notice.conflict, counts: notice.counts }
      : null,
    restore,
    discard,
    busy,
  };
};
