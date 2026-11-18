/**
 * True when a message comes from a frame embedded in this page (2.6
 * click-to-locate): the window of one of the document's iframes, such as
 * Strapi's preview iframe. Messages of other windows (openers, popups, other
 * tabs, the page itself) are ignored.
 * @param {unknown} source - `MessageEvent.source`.
 * @param {Document} [doc] - Document to search (default: the current one).
 * @returns {boolean} Result.
 */
export const isEmbeddedFrameWindow = (source, doc = typeof document === 'undefined' ? null : document) => {
  if (!source || !doc || typeof doc.querySelectorAll !== 'function') return false;
  return Array.from(doc.querySelectorAll('iframe')).some((frame) => frame.contentWindow === source);
};
