/**
 * @mentions in comments (2.4): pure helpers shared by the server and the admin.
 *
 * A comment body stays plain text. Picking a person in the `@` picker inserts
 * `@<name>` into the text and adds the person to the comment's mention list
 * (opaque ids from the picker). The server checks every mentioned person's
 * access again and stores their admin ids; the API returns the list as
 * `{ id (opaque), name, you }` and the admin renders `@<name>` occurrences of
 * listed people as chips. Names that were removed from the text are dropped
 * from the list before posting (`mentionsInText`).
 */

/** People one comment may mention. */
export const MAX_MENTIONS = 20;

/** Longest search text of the picker. */
export const MAX_MENTION_QUERY = 50;

/** Opaque id of a mentionable admin (the admin user's documentId). */
export const MENTION_ID_PATTERN = /^[A-Za-z0-9]{1,64}$/;

/** Characters that may come right before an `@` that starts a mention. */
const BOUNDARY = /[\s([{"'\u00a0]/;

/**
 * The `@query` the caret is in, if any: an `@` at the start or after a space
 * or opening bracket, followed by up to MAX_MENTION_QUERY characters without a
 * line break (a space ends the query only after two words, so "@Anna B" still
 * searches).
 * @param {string} text - Textarea value.
 * @param {number} caret - Caret position.
 * @returns {{ start: number, query: string }|null} Position of the `@` and the query.
 */
export const mentionQueryAt = (text, caret) => {
  if (typeof text !== 'string' || !Number.isInteger(caret) || caret < 1 || caret > text.length) return null;
  const from = Math.max(0, caret - MAX_MENTION_QUERY - 1);
  const before = text.slice(from, caret);
  const at = before.lastIndexOf('@');
  if (at === -1) return null;
  const start = from + at;
  if (start > 0 && !BOUNDARY.test(text[start - 1])) return null;
  const query = text.slice(start + 1, caret);
  if (/[\n\r@]/.test(query) || /^\s/.test(query) || (query.match(/\s/g) || []).length > 2) return null;
  return { start, query };
};

/**
 * Replaces the `@query` at `start..caret` with `@<name> `.
 * @param {string} text - Textarea value.
 * @param {number} start - Position of the `@`.
 * @param {number} caret - Caret position (end of the query).
 * @param {string} name - Display name.
 * @returns {{ text: string, caret: number }} New value and caret.
 */
export const insertMention = (text, start, caret, name) => {
  const label = `@${String(name)} `;
  const next = `${text.slice(0, start)}${label}${text.slice(caret).replace(/^ /, '')}`;
  return { text: next, caret: start + label.length };
};

/**
 * Mentions whose `@<name>` is still in the text (deduplicated, bounded).
 * @param {string} text - Comment body.
 * @param {Array<{ id: string, name: string }>} mentions - Picked mentions.
 * @returns {Array<{ id: string, name: string }>} Mentions to send.
 */
export const mentionsInText = (text, mentions) => {
  const body = typeof text === 'string' ? text : '';
  const seen = new Set();
  const out = [];
  for (const mention of Array.isArray(mentions) ? mentions : []) {
    if (!mention || typeof mention.id !== 'string' || typeof mention.name !== 'string') continue;
    if (seen.has(mention.id) || !body.includes(`@${mention.name}`)) continue;
    seen.add(mention.id);
    out.push({ id: mention.id, name: mention.name });
    if (out.length >= MAX_MENTIONS) break;
  }
  return out;
};

/**
 * Splits a body into text and mention segments for rendering. Longer names
 * win when two names start at the same place ("@Anna" vs "@Anna Beispiel").
 * Linear in the body length times the number of mentions (both bounded).
 * @param {string} body - Comment body.
 * @param {Array<{ name: string, you?: boolean }>} mentions - Mentions of the comment.
 * @returns {Array<{ type: 'text', text: string } | { type: 'mention', text: string, you: boolean }>} Segments.
 */
export const mentionSegments = (body, mentions) => {
  const text = typeof body === 'string' ? body : '';
  const names = (Array.isArray(mentions) ? mentions : [])
    .filter((mention) => mention && typeof mention.name === 'string' && mention.name)
    .slice(0, MAX_MENTIONS)
    .sort((a, b) => b.name.length - a.name.length);
  if (!names.length) return text ? [{ type: 'text', text }] : [];
  const segments = [];
  let buffer = '';
  let index = 0;
  while (index < text.length) {
    if (text[index] === '@' && (index === 0 || BOUNDARY.test(text[index - 1]))) {
      const match = names.find((mention) => text.startsWith(mention.name, index + 1));
      if (match) {
        if (buffer) segments.push({ type: 'text', text: buffer });
        buffer = '';
        segments.push({ type: 'mention', text: `@${match.name}`, you: Boolean(match.you) });
        index += match.name.length + 1;
        continue;
      }
    }
    buffer += text[index];
    index += 1;
  }
  if (buffer) segments.push({ type: 'text', text: buffer });
  return segments;
};

/**
 * Distinct, valid opaque mention ids (bounded).
 * @param {unknown} ids - Untrusted list.
 * @returns {string[]} Ids.
 */
export const cleanMentionIds = (ids) =>
  Array.from(
    new Set(
      (Array.isArray(ids) ? ids : []).filter((id) => typeof id === 'string' && MENTION_ID_PATTERN.test(id))
    )
  ).slice(0, MAX_MENTIONS);
