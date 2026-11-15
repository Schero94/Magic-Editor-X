import { rewriteFiles, urlBase } from '../../../shared/media-urls.mjs';

const MAX_PER_REQUEST = 100;

/**
 * @param {string} value - URL.
 * @returns {boolean} True for URLs the server may know (http(s) or site-relative).
 */
const signable = (value) => /^(https?:\/\/|\/(?!\/))/i.test(value);

/**
 * Maps the URL of a stored file and of its formats.
 * @param {object} file - Stored file.
 * @param {(url: string) => string} map - URL mapper.
 * @returns {object|null} New file, or null when nothing changed.
 */
const mapFileUrls = (file, map) => {
  let changed = false;
  const next = { ...file };
  if (typeof file.url === 'string' && file.url) {
    const url = map(file.url);
    if (url !== file.url) {
      next.url = url;
      changed = true;
    }
  }
  if (file.formats && typeof file.formats === 'object' && !Array.isArray(file.formats)) {
    const formats = {};
    for (const [name, format] of Object.entries(file.formats)) {
      if (format && typeof format === 'object' && typeof format.url === 'string' && format.url) {
        const url = map(format.url);
        formats[name] = url === format.url ? format : { ...format, url };
        if (url !== format.url) changed = true;
      } else formats[name] = format;
    }
    next.formats = formats;
  }
  return changed ? next : null;
};

/**
 * Per-field signer for what Editor.js renders (2.5). With a private provider the
 * stored (unsigned) URL answers 403, and a tool requests an image as soon as it
 * sets `src`, before any DOM observer can swap it. So the field signs the URLs of
 * its content first (one batch), hands Editor.js the signed copy for display,
 * and turns signed URLs back into the stored ones in everything `save()`
 * returns. Only bases the server signed are touched: other URLs pass through.
 * @param {{ ttlMs?: number }} [options] - Cache lifetime.
 * @returns {{ cache: Map<string, { url: string, at: number }>, basesOf: (value: unknown) => string[], prewarm: (bases: string[], request: (urls: string[]) => Promise<Record<string, string>>) => Promise<void>, signValue: (value: unknown) => unknown, unsignValue: (value: unknown) => unknown }} Signer;
 *   `prewarm` takes the request (URL bases in, signed URL by base out).
 */
export const createMediaSigner = ({ ttlMs = 4 * 60 * 1000 } = {}) => {
  const cache = new Map();
  const fresh = (base) => {
    const hit = cache.get(base);
    return hit && Date.now() - hit.at < ttlMs ? hit.url : null;
  };
  const basesOf = (value) => {
    const bases = new Set();
    rewriteFiles(value, (file) => {
      mapFileUrls(file, (url) => {
        const base = urlBase(url);
        if (base && signable(base)) bases.add(base);
        return url;
      });
      return null;
    });
    return [...bases];
  };
  const prewarm = async (bases, request) => {
    const wanted = [...new Set(bases)].filter((base) => base && signable(base) && !fresh(base));
    for (let i = 0; i < wanted.length; i += MAX_PER_REQUEST) {
      const chunk = wanted.slice(i, i + MAX_PER_REQUEST);
      try {
        const urls = await request(chunk);
        const at = Date.now();
        for (const base of chunk)
          if (urls && typeof urls[base] === 'string') cache.set(base, { url: urls[base], at });
      } catch {
        // Not signed: the refresher retries for what is shown.
      }
    }
  };
  const signValue = (value) =>
    rewriteFiles(value, (file) => mapFileUrls(file, (url) => fresh(urlBase(url)) || url));
  const unsignValue = (value) =>
    rewriteFiles(value, (file) =>
      mapFileUrls(file, (url) => {
        const base = urlBase(url);
        return base !== url && cache.has(base) ? base : url;
      })
    );
  return { cache, basesOf, prewarm, signValue, unsignValue };
};
