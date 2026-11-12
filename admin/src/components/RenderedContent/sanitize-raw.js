import createDOMPurify from 'dompurify';

/**
 * Raw HTML in the admin preview: a private DOMPurify instance with a strict
 * profile (no scripts, frames, forms, styles or event handlers). The server
 * already sanitised stored raw HTML; this is defence in depth for content
 * that comes straight from the editor or a collaborator.
 */

let purify = null;

/**
 * @param {string} html - Raw HTML block content.
 * @returns {string} Inert HTML.
 */
export const sanitizeRawPreview = (html) => {
  if (!purify) purify = createDOMPurify(window);
  return purify.sanitize(String(html || ''), {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      'script',
      'style',
      'iframe',
      'frame',
      'object',
      'embed',
      'form',
      'input',
      'button',
      'link',
      'meta',
      'base',
      'svg',
      'math',
    ],
    FORBID_ATTR: ['style', 'srcdoc', 'formaction', 'action'],
    ALLOW_DATA_ATTR: false,
  });
};

export default sanitizeRawPreview;
