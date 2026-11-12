/**
 * Which mounted editor field renders the shared editor stylesheet.
 *
 * The editor styles are one large global style (several hundred rules that use
 * theme tokens). styled-components keeps one copy per mounted instance and
 * rebuilds the whole group (remove and insert every copy) on each mount and
 * unmount, so with four fields on a page opening or leaving the edit view
 * blocked the browser for seconds. Only the first mounted field renders the
 * styles; when it unmounts, the next field takes over.
 */

/**
 * Creates an owner registry (subscribe/getSnapshot shape for React's useSyncExternalStore).
 * @returns {{ add: (id: string) => void, remove: (id: string) => void, owner: () => string|null, subscribe: (listener: () => void) => () => void }} Registry.
 */
export const createStyleOwners = () => {
  let ids = [];
  const listeners = new Set();
  const notify = () => listeners.forEach((listener) => listener());
  return {
    add(id) {
      if (ids.includes(id)) return;
      ids = [...ids, id];
      notify();
    },
    remove(id) {
      if (!ids.includes(id)) return;
      ids = ids.filter((entry) => entry !== id);
      notify();
    },
    owner: () => (ids.length ? ids[0] : null),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};
