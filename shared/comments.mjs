/**
 * Block comments (2.3): pure helpers shared by the server and the admin.
 *
 * A thread is anchored to one block id of one editor field of one document
 * locale (the room key of versions and live collaboration). Comments are plain
 * text; they are never part of the field value, the version history or the
 * Content API output.
 */

/** Longest comment body (characters after normalisation). */
export const MAX_COMMENT_LENGTH = 4000;

/** Longest stored block excerpt (plain text, one line). */
export const MAX_EXCERPT_LENGTH = 200;

/** Comments (threads and replies) one field of one document locale may hold. */
export const MAX_COMMENTS_PER_FIELD = 1000;

/** Replies one thread may hold. */
export const MAX_REPLIES_PER_THREAD = 200;

/** Editor.js block id (same rule as shared/editor-data.mjs). */
export const BLOCK_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;

// C0/C1 control characters except tab, line feed and carriage return (handled separately).
// eslint-disable-next-line no-control-regex -- control characters are removed from comments
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
// Bidirectional overrides and isolates ("Trojan Source"), plus zero-width marks that hide text.
const BIDI = /[\u061c\u200b-\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g;

/**
 * Normalises a comment body: plain text, CRLF to LF, tabs to spaces, control
 * and bidi-override characters removed, at most two blank lines in a row,
 * trimmed and bounded.
 * @param {unknown} value - Untrusted input.
 * @returns {string} Clean text ('' when nothing is left).
 */
export const normalizeCommentBody = (value) => {
  if (typeof value !== 'string') return '';
  return value
    .slice(0, MAX_COMMENT_LENGTH * 2)
    .replace(/\r\n?/g, '\n')
    .replace(/\t/g, ' ')
    .replace(CONTROL, '')
    .replace(BIDI, '')
    .replace(/[ \u00a0]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MAX_COMMENT_LENGTH)
    .trim();
};

/**
 * Normalises a block excerpt: one line of plain text, bounded.
 * @param {unknown} value - Untrusted input.
 * @returns {string|null} Excerpt or null.
 */
export const normalizeExcerpt = (value) => {
  if (typeof value !== 'string') return null;
  const text = value
    .slice(0, MAX_EXCERPT_LENGTH * 4)
    .replace(CONTROL, ' ')
    .replace(BIDI, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return null;
  return text.length > MAX_EXCERPT_LENGTH ? `${text.slice(0, MAX_EXCERPT_LENGTH - 1).trimEnd()}…` : text;
};

/**
 * Plain-text excerpt of an Editor.js block (for new threads and detached ones).
 * Inline HTML is reduced to its text without a DOM: tags are dropped and the
 * common entities decoded. The result is only ever rendered as text.
 * @param {{ type?: string, data?: object }|null} block - Block.
 * @returns {string|null} Excerpt.
 */
export const blockExcerpt = (block) => {
  if (!block || typeof block !== 'object' || !block.data || typeof block.data !== 'object') return null;
  const parts = [];
  const visit = (value, depth) => {
    if (parts.join(' ').length > MAX_EXCERPT_LENGTH * 2 || depth > 6) return;
    // Each string is cut first, so the tag-stripping pass below stays linear.
    if (typeof value === 'string') parts.push(value.slice(0, MAX_EXCERPT_LENGTH * 4));
    else if (Array.isArray(value)) value.forEach((item) => visit(item, depth + 1));
    else if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) {
        if (
          ['url', 'href', 'link', 'src', 'file', 'id', 'documentId', 'mime', 'style', 'level'].includes(key)
        )
          continue;
        visit(item, depth + 1);
      }
    }
  };
  visit(block.data, 0);
  const text = parts
    .join(' ')
    .replace(/<[^>]{0,500}>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
  return normalizeExcerpt(text);
};

/**
 * Counts open threads per block id.
 * @param {Array<{ blockId: string, status: 'open'|'resolved' }>} threads - Threads.
 * @returns {Map<string, number>} Open threads per block.
 */
export const openThreadsByBlock = (threads) => {
  const counts = new Map();
  for (const thread of Array.isArray(threads) ? threads : []) {
    if (!thread || thread.status !== 'open' || typeof thread.blockId !== 'string') continue;
    counts.set(thread.blockId, (counts.get(thread.blockId) || 0) + 1);
  }
  return counts;
};

/**
 * Summary counts of a thread list.
 * @param {Array<{ status: 'open'|'resolved', comments?: Array<unknown> }>} threads - Threads.
 * @returns {{ open: number, resolved: number, comments: number }} Counts.
 */
export const countThreads = (threads) => {
  const counts = { open: 0, resolved: 0, comments: 0 };
  for (const thread of Array.isArray(threads) ? threads : []) {
    if (!thread) continue;
    if (thread.status === 'resolved') counts.resolved += 1;
    else counts.open += 1;
    counts.comments += Array.isArray(thread.comments) ? thread.comments.length : 0;
  }
  return counts;
};

/**
 * Marks threads whose block is no longer in the document as detached and
 * orders them: open before resolved, then document order, detached last,
 * newest activity first inside a group.
 * @param {Array<object>} threads - Threads from the API.
 * @param {string[]|null} blockIds - Block ids of the current document (null: unknown, nothing is detached).
 * @returns {Array<object>} New array of `{ ...thread, detached, position }`.
 */
export const arrangeThreads = (threads, blockIds) => {
  const index = new Map((blockIds || []).map((id, position) => [id, position]));
  return (Array.isArray(threads) ? threads : [])
    .map((thread) => {
      const position = index.has(thread.blockId) ? index.get(thread.blockId) : null;
      return { ...thread, detached: Boolean(blockIds) && position === null, position };
    })
    .sort((a, b) => {
      if ((a.status === 'resolved') !== (b.status === 'resolved')) return a.status === 'resolved' ? 1 : -1;
      if (a.detached !== b.detached) return a.detached ? 1 : -1;
      if (a.position !== null && b.position !== null && a.position !== b.position)
        return a.position - b.position;
      return String(b.updatedAt || '').localeCompare(String(a.updatedAt || ''));
    });
};

/**
 * Groups stored comment rows into threads (root first, replies oldest first).
 * Rows of a reply whose root is missing are dropped.
 * @param {Array<object>} rows - DTO rows `{ id, threadId|null, blockId, ... }`.
 * @returns {Array<object>} Threads.
 */
export const groupThreads = (rows) => {
  const roots = new Map();
  const replies = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    if (!row) continue;
    if (row.threadId) replies.push(row);
    else roots.set(row.id, { root: row, replies: [] });
  }
  for (const reply of replies) {
    const entry = roots.get(reply.threadId);
    if (entry) entry.replies.push(reply);
  }
  const byTime = (a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  return Array.from(roots.values()).map(({ root, replies: list }) => {
    list.sort(byTime);
    const comments = [root, ...list];
    const last = comments.reduce(
      (latest, item) => (String(item.updatedAt || '') > latest ? String(item.updatedAt || '') : latest),
      String(root.updatedAt || '')
    );
    return {
      id: root.id,
      blockId: root.blockId,
      excerpt: root.excerpt || null,
      // 2.4: range comments carry the anchor of the text they are on (shared/comment-anchor.mjs).
      anchor: root.anchor || null,
      status: root.status,
      resolvedAt: root.resolvedAt || null,
      resolvedBy: root.resolvedBy || null,
      createdAt: root.createdAt,
      updatedAt: last,
      comments: comments.map(
        ({
          blockId: _b,
          excerpt: _e,
          status: _s,
          resolvedAt: _r,
          resolvedBy: _rb,
          threadId: _t,
          anchor: _a,
          ...comment
        }) => comment
      ),
    };
  });
};

const UNITS = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/**
 * Value and unit for `Intl.RelativeTimeFormat` (react-intl `formatRelativeTime`).
 * Under a minute counts as "now" (0 seconds).
 * @param {string|number|Date} when - Past or future time.
 * @param {number} [now=Date.now()] - Reference time in ms.
 * @returns {{ value: number, unit: 'second'|'minute'|'hour'|'day'|'week'|'month'|'year' }} Parts.
 */
export const relativeTimeParts = (when, now = Date.now()) => {
  const time = new Date(when).getTime();
  if (!Number.isFinite(time)) return { value: 0, unit: 'second' };
  const seconds = Math.round((time - now) / 1000);
  const abs = Math.abs(seconds);
  for (const [unit, size] of UNITS) {
    if (abs >= size) return { value: Math.trunc(seconds / size), unit };
  }
  return { value: 0, unit: 'second' };
};
