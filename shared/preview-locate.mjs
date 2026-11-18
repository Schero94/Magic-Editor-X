/**
 * Click-to-locate (2.6): a front end asks the Content Manager to show one
 * block of a Magic Editor X field. Two transports, both owned by Magic Editor
 * X (no Strapi internals):
 *
 * - URL: the edit view URL with `mexField=<path>&mexBlock=<block id>`. The
 *   field with that path scrolls to the block and puts the caret into it when
 *   the edit view opens. Works on every Strapi plan, also from a page that is
 *   not in a preview iframe ("Edit this block" links).
 * - Message: `postMessage({ type: 'magic-editor-x:locate', field, blockId })`
 *   from a frame embedded in the admin (Strapi's preview iframe) to the admin
 *   window. A mounted field with that path handles it (the Live Preview side
 *   editor shows the edit form next to the preview); nothing happens otherwise.
 *
 * Only ids and paths that pass strict patterns are accepted. Pure ESM without
 * dependencies: used by the renderer bundle, the admin and the tests.
 */

import { isBlockId, isFieldPath } from './render/source.mjs';

/** `type` of the locate message. */
export const LOCATE_MESSAGE_TYPE = 'magic-editor-x:locate';

/** `type` of the answer a field posts back to the frame when it handles a locate message. */
export const LOCATED_MESSAGE_TYPE = 'magic-editor-x:located';

/** Query keys of the locate URL. */
export const LOCATE_QUERY = Object.freeze({ field: 'mexField', block: 'mexBlock' });

const ADMIN_PATH_PATTERN = /^\/[A-Za-z0-9/_-]{0,100}$/;
const MODEL_PATTERN = /^(?:api|plugin)::[A-Za-z0-9_-]{1,80}\.[A-Za-z0-9_-]{1,80}$/;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;
const LOCALE_PATTERN = /^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8}){0,3}$/;

/**
 * Locate request from untrusted input, or null.
 * @param {unknown} field - Field path.
 * @param {unknown} blockId - Block id (optional: null locates the field).
 * @returns {{ field: string, blockId: string|null }|null} Request.
 */
const request = (field, blockId) => {
  if (!isFieldPath(field)) return null;
  if (blockId === undefined || blockId === null || blockId === '') return { field, blockId: null };
  return isBlockId(blockId) ? { field, blockId } : null;
};

/**
 * Message a front end posts to the admin window (`window.parent.postMessage(message, adminOrigin)`).
 * @param {string} field - Field path (`data-mex-field-path`).
 * @param {string} [blockId] - Block id (`data-mex-block-id`).
 * @returns {{ type: string, field: string, blockId: string|null }|null} Message, or null for invalid input.
 */
export const locateMessage = (field, blockId) => {
  const valid = request(field, blockId);
  return valid ? { type: LOCATE_MESSAGE_TYPE, ...valid } : null;
};

/**
 * Parses a received message.
 * @param {unknown} data - `event.data`.
 * @returns {{ field: string, blockId: string|null }|null} Request, or null when it is not a valid locate message.
 */
export const parseLocateMessage = (data) => {
  if (!data || typeof data !== 'object' || Array.isArray(data) || data.type !== LOCATE_MESSAGE_TYPE)
    return null;
  return request(data.field, data.blockId);
};

/**
 * Parses the locate keys of a URL query string.
 * @param {unknown} search - `location.search` (with or without `?`).
 * @returns {{ field: string, blockId: string|null }|null} Request, or null.
 */
export const parseLocateQuery = (search) => {
  if (typeof search !== 'string' || search.length > 4096) return null;
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  if (params.getAll(LOCATE_QUERY.field).length !== 1) return null;
  if (params.getAll(LOCATE_QUERY.block).length > 1) return null;
  return request(params.get(LOCATE_QUERY.field), params.get(LOCATE_QUERY.block));
};

/**
 * Content Manager edit view URL that opens the entry and shows the block.
 * @param {{ adminUrl: string, model: string, kind?: 'collectionType'|'singleType', documentId?: string, locale?: string, field: string, blockId?: string }} input - Admin URL (`https://cms.example.test/admin`), entry and target.
 * @returns {string|null} URL, or null for invalid input.
 */
export const editViewUrl = (input) => {
  if (!input || typeof input !== 'object') return null;
  const { adminUrl, model, kind = 'collectionType', documentId, locale, field, blockId } = input;
  const target = request(field, blockId);
  if (!target || typeof adminUrl !== 'string' || typeof model !== 'string' || !MODEL_PATTERN.test(model))
    return null;
  let base;
  try {
    base = new URL(adminUrl);
  } catch {
    return null;
  }
  if (base.protocol !== 'https:' && base.protocol !== 'http:') return null;
  const adminPath = base.pathname.replace(/\/+$/, '') || '/';
  if (!ADMIN_PATH_PATTERN.test(adminPath)) return null;
  let path;
  if (kind === 'singleType') path = `single-types/${model}`;
  else if (
    kind === 'collectionType' &&
    typeof documentId === 'string' &&
    DOCUMENT_ID_PATTERN.test(documentId)
  )
    path = `collection-types/${model}/${documentId}`;
  else return null;
  const params = new URLSearchParams();
  if (locale !== undefined && locale !== null) {
    if (typeof locale !== 'string' || !LOCALE_PATTERN.test(locale)) return null;
    params.set('plugins[i18n][locale]', locale);
  }
  params.set(LOCATE_QUERY.field, target.field);
  if (target.blockId) params.set(LOCATE_QUERY.block, target.blockId);
  const prefix = adminPath === '/' ? '' : adminPath;
  return `${base.origin}${prefix}/content-manager/${path}?${params}`;
};

/**
 * Asks the admin window around this frame to show a block, for a front end
 * inside Strapi's preview iframe. Resolves true when a mounted field answered
 * (Live Preview side editor), false otherwise (full-screen preview: navigate
 * to `editViewUrl(...)` instead). Never throws.
 * @param {{ field: string, blockId?: string|null, adminOrigin: string, timeoutMs?: number }} input - Target and the admin origin (`https://cms.example.test`).
 * @returns {Promise<boolean>} Whether a field handled the request.
 */
export const requestLocate = (input) =>
  new Promise((resolve) => {
    const win = typeof window === 'undefined' ? null : window;
    const message = input ? locateMessage(input.field, input.blockId) : null;
    let origin = null;
    try {
      origin = new URL(input && input.adminOrigin).origin;
    } catch {
      origin = null;
    }
    if (!win || !message || !origin || origin === 'null' || win.parent === win) {
      resolve(false);
      return;
    }
    const timeout = Math.min(Math.max(Number(input.timeoutMs) || 400, 50), 5000);
    const onMessage = (event) => {
      if (event.source !== win.parent || event.origin !== origin) return;
      const data = event.data;
      if (!data || data.type !== LOCATED_MESSAGE_TYPE || data.field !== message.field) return;
      done(true);
    };
    const timer = setTimeout(() => done(false), timeout);
    function done(result) {
      clearTimeout(timer);
      win.removeEventListener('message', onMessage);
      resolve(result);
    }
    win.addEventListener('message', onMessage);
    try {
      win.parent.postMessage(message, origin);
    } catch {
      done(false);
    }
  });
