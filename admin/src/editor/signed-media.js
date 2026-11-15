import { urlBase } from '../../../shared/media-urls.mjs';

/**
 * Private upload providers (2.5): keeps the Media Library images, videos,
 * audio files, tracks and attachment links shown inside a field working.
 *
 * A private provider serves files through signed URLs that expire. Stored
 * content holds the unsigned URL (the server signs Content Manager reads),
 * but content can also come from a live collaboration room, a version, a
 * template or an older signature. This helper watches the field's DOM and
 * replaces every media URL with a fresh signed one from
 * `POST /magic-editor-x/media/signed-urls` (batched, cached for `ttlMs`).
 * Only the displayed attributes change: the tools keep their data, and the
 * server removes signatures before anything is stored.
 */

const SELECTOR =
  'img[src], video[src], video[poster], audio[src], source[src], track[src], .cdx-attaches a[href]';
const ATTRIBUTES = ['src', 'poster', 'href'];
const MAX_PER_REQUEST = 100;

/**
 * @param {string} value - Attribute value.
 * @returns {boolean} True for URLs the server may know (http(s) or site-relative).
 */
const signable = (value) => /^(https?:\/\/|\/(?!\/))/i.test(value);

/**
 * Starts the refresher.
 * @param {{ root: HTMLElement, request: (urls: string[]) => Promise<Record<string, string>>, ttlMs?: number, retryMs?: number }} options - Field
 *   element to watch and the request (URL bases in, signed URL by base out).
 * @returns {{ refresh: () => void, destroy: () => void }} Handle.
 */
export const createSignedMediaRefresher = ({ root, request, ttlMs = 4 * 60 * 1000, retryMs = 30 * 1000 }) => {
  const cache = new Map();
  const missed = new Map();
  const pending = new Set();
  let timer = null;
  let stopped = false;

  const apply = () => {
    if (stopped) return;
    const now = Date.now();
    const wanted = new Set();
    for (const element of root.querySelectorAll(SELECTOR)) {
      for (const name of ATTRIBUTES) {
        const value = element.getAttribute(name);
        if (!value || !signable(value)) continue;
        if (name === 'href' && element.tagName !== 'A') continue;
        if (name === 'poster' && element.tagName !== 'VIDEO') continue;
        const base = urlBase(value);
        const hit = cache.get(base);
        if (hit && now - hit.at < ttlMs) {
          if (value !== hit.url) element.setAttribute(name, hit.url);
          continue;
        }
        if (pending.has(base)) continue;
        const miss = missed.get(base);
        if (miss && now - miss < retryMs) continue;
        wanted.add(base);
      }
    }
    if (!wanted.size) return;
    const bases = [...wanted].slice(0, MAX_PER_REQUEST);
    bases.forEach((base) => pending.add(base));
    request(bases)
      .then((urls) => {
        const at = Date.now();
        for (const base of bases) {
          const url = urls && typeof urls[base] === 'string' ? urls[base] : null;
          if (url) cache.set(base, { url, at });
          else missed.set(base, at);
        }
      })
      .catch(() => {
        const at = Date.now();
        bases.forEach((base) => missed.set(base, at));
      })
      .finally(() => {
        bases.forEach((base) => pending.delete(base));
        schedule();
      });
  };

  const schedule = () => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = null;
      apply();
    }, 60);
  };

  // A signature that expired while the page was open: ask again once.
  const onError = (event) => {
    const element = event.target;
    if (!element || typeof element.getAttribute !== 'function') return;
    const value = element.getAttribute('src') || element.getAttribute('poster') || '';
    const base = urlBase(value);
    const hit = cache.get(base);
    if (hit && Date.now() - hit.at > 5000) {
      cache.delete(base);
      schedule();
    }
  };

  const observer = new MutationObserver(schedule);
  observer.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ATTRIBUTES });
  root.addEventListener('error', onError, true);
  schedule();

  return {
    refresh: schedule,
    destroy() {
      stopped = true;
      clearTimeout(timer);
      observer.disconnect();
      root.removeEventListener('error', onError, true);
    },
  };
};
