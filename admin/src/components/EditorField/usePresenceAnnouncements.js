import { useId, useState } from 'react';
import { claimPresence, diffPeers, presenceRegistry } from '../../editor/presence-announce.mjs';

/**
 * Entry of the page (the edit view URL): fields of one entry share their announcements.
 * @returns {string} Key.
 */
const pageEntry = () =>
  typeof window !== 'undefined' && window.location
    ? `${window.location.pathname}${window.location.search}`
    : '';

/**
 * Text for a polite live region when people join or leave the field.
 * One message per change of the peer list, display names only. Uses the
 * "adjust state while rendering" pattern instead of an effect.
 * 2.7.8: once per entry, not once per field (`editor/presence-announce.mjs`).
 * @param {Array<{ id: string, name: string }>} peers - People in the room (without self).
 * @param {(id: string, text: string, values?: object) => string} t - Translator.
 * @param {string} [entry] - Entry key (defaults to the page URL).
 * @returns {string} Latest announcement.
 */
export const usePresenceAnnouncements = (peers, t, entry) => {
  const owner = useId();
  const [previous, setPrevious] = useState(peers);
  const [message, setMessage] = useState('');
  if (peers !== previous) {
    const { joined, left } = diffPeers(previous, peers);
    const key = entry || pageEntry();
    const claim = (event, names) =>
      names.length ? claimPresence(presenceRegistry, { entry: key, event, names, owner }) : [];
    const joinedHere = claim('joined', joined);
    const leftHere = claim('left', left);
    const parts = [];
    if (joinedHere.length)
      parts.push(t('editor.collab.joined', '{names} joined', { names: joinedHere.join(', ') }));
    if (leftHere.length) parts.push(t('editor.collab.left', '{names} left', { names: leftHere.join(', ') }));
    setPrevious(peers);
    if (parts.length) setMessage(parts.join('. '));
  }
  return message;
};
