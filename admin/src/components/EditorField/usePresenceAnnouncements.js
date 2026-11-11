import { useState } from 'react';

/**
 * Text for a polite live region when people join or leave the field.
 * One message per change of the peer list, display names only. Uses the
 * "adjust state while rendering" pattern instead of an effect.
 * @param {Array<{ id: string, name: string }>} peers - People in the room (without self).
 * @param {(id: string, text: string, values?: object) => string} t - Translator.
 * @returns {string} Latest announcement.
 */
export const usePresenceAnnouncements = (peers, t) => {
  const [previous, setPrevious] = useState(peers);
  const [message, setMessage] = useState('');
  if (peers !== previous) {
    const before = new Map((previous || []).map((peer) => [peer.id, peer.name]));
    const current = new Map((peers || []).map((peer) => [peer.id, peer.name]));
    const joined = [...current.keys()].filter((id) => !before.has(id)).map((id) => current.get(id));
    const left = [...before.keys()].filter((id) => !current.has(id)).map((id) => before.get(id));
    const parts = [];
    if (joined.length) parts.push(t('editor.collab.joined', '{names} joined', { names: joined.join(', ') }));
    if (left.length) parts.push(t('editor.collab.left', '{names} left', { names: left.join(', ') }));
    setPrevious(peers);
    if (parts.length) setMessage(parts.join('. '));
  }
  return message;
};
