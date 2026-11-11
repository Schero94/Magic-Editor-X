/**
 * Pure data logic of the in-repo Editor.js tools. No DOM access, so it runs
 * under `node --test` and the tools stay thin.
 *
 * Every normaliser returns exactly the data shape Magic Editor X 1.x stored
 * for that block type, so existing content keeps rendering and the server
 * sanitiser (shared/sanitize-policy.mjs) accepts it unchanged.
 */

export const ALERT_TYPES = Object.freeze([
  'primary',
  'secondary',
  'info',
  'success',
  'warning',
  'danger',
  'light',
  'dark',
]);
export const ALERT_ALIGNMENTS = Object.freeze(['left', 'center', 'right']);
export const ALIGNMENTS = Object.freeze(['left', 'center', 'right', 'justify']);
export const TEXT_VARIANTS = Object.freeze(['call-out', 'citation', 'details']);
export const BUTTON_STYLES = Object.freeze(['primary', 'secondary', 'outline', 'ghost', 'danger', 'success']);
export const CODE_LANGUAGES = Object.freeze([
  'plaintext',
  'javascript',
  'typescript',
  'jsx',
  'tsx',
  'json',
  'markup',
  'css',
  'scss',
  'bash',
  'python',
  'php',
  'ruby',
  'java',
  'kotlin',
  'swift',
  'csharp',
  'c',
  'cpp',
  'go',
  'rust',
  'sql',
  'graphql',
  'yaml',
  'markdown',
  'docker',
  'diff',
]);

/** Aliases used by 1.x CodeFlask content. */
const LANGUAGE_ALIASES = {
  js: 'javascript',
  ts: 'typescript',
  html: 'markup',
  xml: 'markup',
  svg: 'markup',
  sh: 'bash',
  shell: 'bash',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
  dockerfile: 'docker',
  'c#': 'csharp',
  cs: 'csharp',
  'c++': 'cpp',
  text: 'plaintext',
  plain: 'plaintext',
  none: 'plaintext',
};

const str = (value) => (typeof value === 'string' ? value : '');
const pick = (value, allowed, fallback) =>
  typeof value === 'string' && allowed.includes(value) ? value : fallback;

/**
 * Normalises alert data (editorjs-alert 1.x shape).
 * @param {unknown} data - Stored data.
 * @param {{ defaultType?: string, defaultAlign?: string }} [config] - Defaults.
 * @returns {{ type: string, align: string, message: string }} Data.
 */
export const normalizeAlert = (data, config = {}) => {
  const d = data && typeof data === 'object' ? data : {};
  return {
    type: pick(d.type, ALERT_TYPES, pick(config.defaultType, ALERT_TYPES, 'info')),
    align: pick(d.align, ALERT_ALIGNMENTS, pick(config.defaultAlign, ALERT_ALIGNMENTS, 'left')),
    // Some editorjs-alert versions wrote `text` instead of `message`.
    message: str(d.message) || str(d.text),
  };
};

/**
 * Normalises alignment tune data.
 * @param {unknown} data - Stored tune data.
 * @param {string} [fallback='left'] - Default alignment.
 * @returns {{ alignment: string }} Data.
 */
export const normalizeAlignment = (data, fallback = 'left') => ({
  alignment: pick(data && data.alignment, ALIGNMENTS, pick(fallback, ALIGNMENTS, 'left')),
});

/**
 * Normalises text variant tune data ('' means no variant).
 * @param {unknown} data - Stored tune data.
 * @returns {string} Variant.
 */
export const normalizeTextVariant = (data) => pick(data, TEXT_VARIANTS, '');

/**
 * Normalises a code language name.
 * @param {unknown} language - Stored language.
 * @returns {string} Supported language id.
 */
export const normalizeLanguage = (language) => {
  const raw = str(language).trim().toLowerCase();
  const mapped = LANGUAGE_ALIASES[raw] || raw;
  return CODE_LANGUAGES.includes(mapped) ? mapped : 'plaintext';
};

/**
 * Normalises CodeFlask block data (`@calumk/editorjs-codeflask` shape) and plain
 * `code` block data.
 * @param {unknown} data - Stored data.
 * @param {{ language?: string }} [config] - Defaults.
 * @returns {{ code: string, language: string, showlinenumbers: boolean }} Data.
 */
export const normalizeCodeFlask = (data, config = {}) => {
  const d = data && typeof data === 'object' ? data : {};
  return {
    code: str(d.code),
    language: d.language ? normalizeLanguage(d.language) : normalizeLanguage(config.language || 'plaintext'),
    showlinenumbers: d.showlinenumbers !== false,
  };
};

/**
 * Converts 1.x checklist data to @editorjs/list 2 data.
 * @param {unknown} data - `{ items: [{ text, checked }] }` (or already list data).
 * @returns {{ style: 'checklist', meta: object, items: Array }} List data.
 */
export const checklistToList = (data) => {
  const items = data && Array.isArray(data.items) ? data.items : [];
  return {
    style: 'checklist',
    meta: {},
    items: items.map((item) => {
      if (typeof item === 'string') return { content: item, meta: { checked: false }, items: [] };
      const value = item && typeof item === 'object' ? item : {};
      return {
        content: str(value.text) || str(value.content),
        meta: { checked: Boolean(value.checked ?? (value.meta && value.meta.checked)) },
        items: [],
      };
    }),
  };
};

/**
 * Converts @editorjs/list 2 data back to 1.x checklist data. Nested items are
 * flattened in document order, so nothing typed is lost.
 * @param {{ items?: Array }} data - List data.
 * @returns {{ items: Array<{ text: string, checked: boolean }> }} Checklist data.
 */
export const listToChecklist = (data) => {
  const out = [];
  const walk = (items, depth) => {
    if (!Array.isArray(items) || depth > 12) return;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      out.push({ text: str(item.content), checked: Boolean(item.meta && item.meta.checked) });
      walk(item.items, depth + 1);
    }
  };
  walk(data && data.items, 0);
  return { items: out };
};

/**
 * Normalises toggle block data (editorjs-toggle-block shape).
 * @param {unknown} data - Stored data.
 * @param {string} fallbackKey - Key used when `fk` is missing (the block id).
 * @returns {{ text: string, status: 'open'|'closed', fk: string, items: number }} Data.
 */
export const normalizeToggle = (data, fallbackKey) => {
  const d = data && typeof data === 'object' ? data : {};
  const items = Number(d.items);
  return {
    text: str(d.text),
    status: d.status === 'closed' ? 'closed' : 'open',
    fk: str(d.fk) || str(fallbackKey),
    items: Number.isInteger(items) && items > 0 ? Math.min(items, 5000) : 0,
  };
};

/**
 * Indexes of the child blocks of a toggle: the `items` blocks right after it,
 * clamped to the document end.
 * @param {number} toggleIndex - Index of the toggle block.
 * @param {number} items - Stored child count.
 * @param {number} total - Number of blocks in the document.
 * @returns {number[]} Child indexes.
 */
export const toggleChildIndexes = (toggleIndex, items, total) => {
  if (!Number.isInteger(toggleIndex) || toggleIndex < 0) return [];
  const count = Math.max(0, Math.min(Number(items) || 0, total - toggleIndex - 1));
  return Array.from({ length: count }, (_, i) => toggleIndex + 1 + i);
};

/**
 * New child count after "include next block" / "release last block".
 * @param {number} toggleIndex - Index of the toggle block.
 * @param {number} items - Current child count.
 * @param {number} total - Number of blocks.
 * @param {'include'|'release'} action - Action.
 * @returns {number} New count.
 */
export const nextToggleItems = (toggleIndex, items, total, action) => {
  const current = toggleChildIndexes(toggleIndex, items, total).length;
  if (action === 'include') return Math.min(current + 1, Math.max(0, total - toggleIndex - 1));
  return Math.max(0, current - 1);
};

/**
 * Normalises button block data.
 * @param {unknown} data - Stored data.
 * @returns {{ text: string, link: string, style: string, openInNewTab: boolean }} Data.
 */
export const normalizeButton = (data) => {
  const d = data && typeof data === 'object' ? data : {};
  return {
    text: str(d.text),
    link: str(d.link),
    style: pick(d.style, BUTTON_STYLES, 'primary'),
    openInNewTab: d.openInNewTab === true,
  };
};

/**
 * Normalises simple image data.
 * @param {unknown} data - Stored data.
 * @returns {{ url: string, caption: string, withBorder: boolean, withBackground: boolean, stretched: boolean }} Data.
 */
export const normalizeSimpleImage = (data) => {
  const d = data && typeof data === 'object' ? data : {};
  return {
    url: str(d.url),
    caption: str(d.caption),
    withBorder: d.withBorder === true,
    withBackground: d.withBackground === true,
    stretched: d.stretched === true,
  };
};

/**
 * Normalises personality data.
 * @param {unknown} data - Stored data.
 * @returns {{ name: string, description: string, link: string, photo: string }} Data.
 */
export const normalizePersonality = (data) => {
  const d = data && typeof data === 'object' ? data : {};
  return { name: str(d.name), description: str(d.description), link: str(d.link), photo: str(d.photo) };
};

/**
 * Normalises link preview data.
 * @param {unknown} data - Stored data.
 * @returns {{ link: string, meta: object }} Data.
 */
export const normalizeLinkTool = (data) => {
  const d = data && typeof data === 'object' ? data : {};
  const meta = d.meta && typeof d.meta === 'object' ? d.meta : {};
  const out = { title: str(meta.title), description: str(meta.description) };
  if (str(meta.site_name)) out.site_name = str(meta.site_name);
  if (meta.image && typeof meta.image === 'object' && str(meta.image.url))
    out.image = { url: str(meta.image.url) };
  return { link: str(d.link), meta: out };
};

/**
 * Normalises embedded entry data.
 * @param {unknown} data - Stored data.
 * @param {{ contentType?: string|null }} [config] - Tool config.
 * @returns {{ entry: object|null, contentType: string|null, displayMode: string }} Data.
 */
export const normalizeEmbeddedEntry = (data, config = {}) => {
  const d = data && typeof data === 'object' ? data : {};
  return {
    entry: d.entry && typeof d.entry === 'object' ? d.entry : null,
    contentType: str(d.contentType) || config.contentType || null,
    displayMode: pick(d.displayMode, ['card', 'inline', 'minimal'], 'card'),
  };
};

/**
 * Builds the stored entry summary: id, documentId, title and the configured
 * display fields with scalar values only.
 * @param {object} entry - Content Manager entry.
 * @param {{ titleField?: string, displayFields?: string[] }} config - Block config.
 * @returns {object} Entry summary.
 */
export const summarizeEntry = (entry, config = {}) => {
  const titleField = config.titleField || 'title';
  const title = [entry[titleField], entry.title, entry.name, entry.label, entry.slug].find(
    (v) => typeof v === 'string' && v.trim()
  );
  const out = {
    id: entry.id,
    documentId: entry.documentId,
    title: title || String(entry.documentId || entry.id || ''),
  };
  for (const field of config.displayFields || []) {
    const value = entry[field];
    if (['string', 'number', 'boolean'].includes(typeof value)) out[field] = value;
  }
  return out;
};

/**
 * Replaces `{{field}}` placeholders of a custom block template with escaped values.
 * Only names made of letters, digits and underscores are replaced; values are
 * HTML-escaped, the result is sanitised again by the caller.
 * @param {string} template - Template HTML (already sanitised on the server).
 * @param {object} data - Block data.
 * @returns {string} HTML.
 */
export const fillTemplate = (template, data) =>
  String(template || '').replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*\}\}/g, (_match, name) => {
    const value = data && Object.prototype.hasOwnProperty.call(data, name) ? data[name] : '';
    let text = '';
    if (value && typeof value === 'object') text = typeof value.url === 'string' ? value.url : '';
    else if (value !== null && value !== undefined) text = String(value);
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  });

/**
 * Bounded undo/redo history of serialised states.
 * @param {{ maxSteps?: number }} [options] - Limit of kept states.
 * @returns {{ init: Function, push: Function, undo: Function, redo: Function, replacePresent: Function, canUndo: Function, canRedo: Function, current: Function, clear: Function }} Stack.
 */
export const createHistoryStack = ({ maxSteps = 50 } = {}) => {
  let past = [];
  let present = null;
  let future = [];
  return {
    /** Sets the starting state without an undo step. */
    init(state) {
      past = [];
      future = [];
      present = state;
    },
    /** Records a new state; identical consecutive states are ignored. @returns {boolean} Recorded. */
    push(state) {
      if (state === present) return false;
      if (present !== null) past.push(present);
      if (past.length > maxSteps) past = past.slice(past.length - maxSteps);
      present = state;
      future = [];
      return true;
    },
    /** @returns {string|null} State to show after undo. */
    undo() {
      if (past.length === 0) return null;
      future.push(present);
      present = past.pop();
      return present;
    },
    /** @returns {string|null} State to show after redo. */
    redo() {
      if (future.length === 0) return null;
      past.push(present);
      present = future.pop();
      return present;
    },
    /** Replaces the current state without touching undo/redo (re-serialised after a render). */
    replacePresent(state) {
      present = state;
    },
    canUndo: () => past.length > 0,
    canRedo: () => future.length > 0,
    current: () => present,
    clear() {
      past = [];
      future = [];
      present = null;
    },
  };
};

/**
 * Serialises editor data for the undo history (time stamps ignored).
 * @param {{ blocks?: Array }} data - Editor.js output.
 * @returns {string} Key.
 */
export const historyKey = (data) => JSON.stringify((data && data.blocks) || []);

/**
 * Index where a dragged block lands, given the pointer position over block rects.
 * @param {Array<{ top: number, bottom: number }>} rects - Block rectangles in order.
 * @param {number} y - Pointer y.
 * @param {number} fromIndex - Index of the dragged block.
 * @returns {number} Target index for `blocks.move(to, from)`.
 */
export const dropIndex = (rects, y, fromIndex) => {
  if (rects.length === 0) return fromIndex;
  let insertBefore = rects.length;
  for (let i = 0; i < rects.length; i += 1) {
    const middle = (rects[i].top + rects[i].bottom) / 2;
    if (y < middle) {
      insertBefore = i;
      break;
    }
  }
  const to = insertBefore > fromIndex ? insertBefore - 1 : insertBefore;
  return Math.max(0, Math.min(rects.length - 1, to));
};

/**
 * Next active option of a listbox for arrow-key navigation (wraps around).
 * @param {number} current - Active index (-1 for none).
 * @param {number} delta - +1 (down) or -1 (up).
 * @param {number} length - Number of options.
 * @returns {number} New index, -1 when the list is empty.
 */
export const moveActiveIndex = (current, delta, length) => {
  if (!Number.isInteger(length) || length <= 0) return -1;
  if (!Number.isInteger(current) || current < 0 || current >= length) return delta < 0 ? length - 1 : 0;
  return (current + delta + length) % length;
};

/**
 * Reads the internal-link reference of an `<a>` element.
 * @param {{ getAttribute: (name: string) => string|null }|null} node - Link element.
 * @returns {{ href: string, uid: string, documentId: string, locale: string|null }|null} Reference or null.
 */
export const readInternalLink = (node) => {
  if (!node || typeof node.getAttribute !== 'function') return null;
  const uid = node.getAttribute('data-mex-uid');
  const documentId = node.getAttribute('data-mex-document-id');
  if (!uid || !documentId) return null;
  return {
    href: node.getAttribute('href') || '',
    uid,
    documentId,
    locale: node.getAttribute('data-mex-locale') || null,
  };
};

/**
 * Data attributes to write for a link. They are kept only while the href is
 * the one the picker produced; a hand-edited address turns it into a plain link.
 * @param {{ href: string, uid: string, documentId: string, locale?: string|null }|null} internal - Picked entry.
 * @param {string} href - The href that is written.
 * @returns {Record<string, string|null>} Attribute values (null removes the attribute).
 */
export const internalLinkAttributes = (internal, href) => {
  const keep = Boolean(internal && internal.uid && internal.documentId && internal.href === href);
  return {
    'data-mex-uid': keep ? internal.uid : null,
    'data-mex-document-id': keep ? internal.documentId : null,
    'data-mex-locale': keep && internal.locale ? internal.locale : null,
  };
};
