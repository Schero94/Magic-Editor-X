import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Dialog, Flex } from '@strapi/design-system';
import styled from 'styled-components';
import { useFetchClient } from '../../utils/fetch-client';
import { sessionGuard } from '../../editor/session-guard.mjs';
import { API } from '../../utils/api';
import { useT } from '../ui/useT';
import { useEntryPresence } from './useEntryPresence';
import { ENTRY_PANEL_SECTIONS } from './sections';

const FOCUS_REFRESH_MS = 10000;

/** Sections are separated by a rule; a section that renders nothing leaves no gap or rule. */
const Sections = styled(Flex)`
  & > [data-mex-panel-section] ~ [data-mex-panel-section] {
    border-top: 1px solid ${({ theme }) => theme.colors.neutral150};
    padding-top: ${({ theme }) => theme.spaces[3]};
  }
`;

/**
 * Loads GET /entry-summary for the entry: on mount, after each save (`version` changes) and when the
 * window gets focus again (at most every 10 s).
 * @param {{ uid: string, documentId: string, locale: string|null }} target - Entry.
 * @param {string} version - Changes when the saved draft changed (`document.updatedAt`).
 * @returns {{ status: 'loading'|'ready'|'error', data: object|null, reload: () => void }} Summary.
 */
const useEntrySummary = ({ uid, documentId, locale }, version) => {
  const { get } = useFetchClient();
  const [state, setState] = useState({ status: 'loading', data: null });
  const requestRef = useRef(0);
  const lastRef = useRef(0);
  const load = useCallback(() => {
    const id = requestRef.current + 1;
    requestRef.current = id;
    lastRef.current = Date.now();
    get(API.entrySummary, { params: { uid, documentId, ...(locale ? { locale } : {}) } }).then(
      ({ data }) => {
        if (requestRef.current === id) setState({ status: 'ready', data: (data && data.data) || null });
      },
      () => {
        if (requestRef.current === id) setState((current) => ({ ...current, status: 'error' }));
      }
    );
  }, [get, uid, documentId, locale]);
  useEffect(() => {
    load();
  }, [load, version]);
  useEffect(() => {
    const onFocus = () => {
      // 2.6: nothing is requested while the admin session has ended.
      if (sessionGuard.isActive() && Date.now() - lastRef.current > FOCUS_REFRESH_MS) load();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [load]);
  const reload = useCallback(() => {
    setState((current) => ({ ...current, status: 'loading' }));
    load();
  }, [load]);
  return { ...state, reload };
};

/**
 * Remembers per tab that the admin chose to continue on an entry someone else edits.
 * @param {string} key - Entry key.
 * @returns {[boolean, () => void]} Acknowledged and the setter.
 */
const useAcknowledged = (key) => {
  const storageKey = `magic-editor-x:soft-lock:${key}`;
  const read = () => {
    try {
      return window.sessionStorage.getItem(storageKey) === '1';
    } catch {
      return false;
    }
  };
  const [acknowledged, setAcknowledged] = useState(read);
  const acknowledge = useCallback(() => {
    setAcknowledged(true);
    try {
      window.sessionStorage.setItem(storageKey, '1');
    } catch {
      // per-tab convenience only
    }
  }, [storageKey]);
  return [acknowledged, acknowledge];
};

/**
 * Body of the Magic Editor X side panel (2.5): presence, comments and quality of the entry, plus the
 * optional soft-lock dialog.
 * @param {{ uid: string, documentId: string, locale: string|null, version: string }} props - Entry and saved version.
 * @returns {JSX.Element} Panel content.
 */
export const EntryPanelContent = ({ uid, documentId, locale, version }) => {
  const t = useT();
  const target = { uid, documentId, locale };
  const presence = useEntryPresence(target);
  const summary = useEntrySummary(target, version);
  const continueRef = useRef(null);
  const [acknowledged, acknowledge] = useAcknowledged(`${uid}|${documentId}|${locale || '-'}`);
  const others = presence.editors.filter((editor) => !editor.idle);
  const lockOpen =
    presence.status === 'ready' &&
    presence.softLock &&
    presence.canEdit &&
    !acknowledged &&
    others.length > 0;
  const names = others.map((editor) => editor.name);

  return (
    <Sections direction="column" alignItems="stretch" gap={3} width="100%" data-testid="mex-entry-panel">
      {ENTRY_PANEL_SECTIONS.map(({ id, Component }) => (
        <Component key={id} t={t} target={target} presence={presence} summary={summary} />
      ))}
      <Dialog.Root open={lockOpen} onOpenChange={(open) => (!open ? acknowledge() : undefined)}>
        <Dialog.Content
          data-testid="mex-soft-lock"
          onOpenAutoFocus={(event) => {
            // The one action gets focus, so Enter continues (Radix would focus the dialog itself).
            event.preventDefault();
            if (continueRef.current) continueRef.current.focus();
          }}
        >
          <Dialog.Header>
            {t('entryPanel.softLock.title', 'Someone else is editing this entry')}
          </Dialog.Header>
          <Dialog.Body>
            <Dialog.Description>
              {t(
                'entryPanel.softLock.body',
                "{names} {count, plural, one {is} other {are}} editing this entry right now. To avoid overwriting each other's changes, agree who changes what.",
                { names: names.join(', '), count: names.length }
              )}
            </Dialog.Description>
          </Dialog.Body>
          <Dialog.Footer>
            <Dialog.Action>
              <Button ref={continueRef} fullWidth onClick={acknowledge}>
                {t('entryPanel.softLock.continue', 'Continue editing')}
              </Button>
            </Dialog.Action>
          </Dialog.Footer>
        </Dialog.Content>
      </Dialog.Root>
    </Sections>
  );
};

export default EntryPanelContent;
