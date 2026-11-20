/**
 * Presence announcements once per entry (2.7.8, re-audit minor).
 *
 * Every live field of an entry has its own collaboration room, so when a
 * person opened or left the entry each field announced "Ben M. joined" in its
 * own polite live region: three fields, three announcements. The field that
 * sees a change first claims it in a registry shared by all fields of the
 * page; the other fields stay silent until that person's next change.
 */

/**
 * People who joined and left between two peer lists (by display name, as announced).
 * @param {Array<{ id: string, name: string }>|null|undefined} before - Previous peers.
 * @param {Array<{ id: string, name: string }>|null|undefined} after - Current peers.
 * @returns {{ joined: string[], left: string[] }} Names.
 */
export const diffPeers = (before, after) => {
  const previous = new Map((before || []).map((peer) => [peer.id, peer.name]));
  const current = new Map((after || []).map((peer) => [peer.id, peer.name]));
  const previousNames = new Set(previous.values());
  const currentNames = new Set(current.values());
  const joined = [...current.keys()]
    .filter((id) => !previous.has(id))
    .map((id) => current.get(id))
    .filter((name) => !previousNames.has(name));
  const left = [...previous.keys()]
    .filter((id) => !current.has(id))
    .map((id) => previous.get(id))
    .filter((name) => !currentNames.has(name));
  return { joined: [...new Set(joined)], left: [...new Set(left)] };
};

/**
 * Claims the announcement of names for one field. The registry keeps, per entry and person, the
 * last announced event and the field that announced it: a join is announced by the first field
 * that reports it and not again by the other fields until that person left (and the other way
 * round). The same field (owner) may claim again, as React StrictMode renders twice.
 * @param {Map<string, { owner: string, event: string }>} registry - Shared registry.
 * @param {{ entry: string, event: 'joined'|'left', names: string[], owner: string }} claim - Claim.
 * @returns {string[]} Names this field announces.
 */
export const claimPresence = (registry, { entry, event, names, owner }) =>
  names.filter((name) => {
    const key = `${entry}\u0000${name}`;
    const last = registry.get(key);
    if (last && last.event === event && last.owner !== owner) return false;
    registry.set(key, { owner, event });
    return true;
  });

/** Registry shared by every field of the page. */
export const presenceRegistry = new Map();
