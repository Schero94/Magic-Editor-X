/**
 * Markdown shortcuts: what typing a Markdown marker at the start of a
 * paragraph turns into. Pure logic, used by markdown-shortcuts.js.
 *
 * Space after `#`..`######`, `-`/`*`/`+`, `1.`/`1)`, `[]`/`[ ]`/`[x]`, `>`;
 * Enter after ```` ``` ```` (optionally with a language) or `---`/`***`.
 */

import { isBlockAllowed } from '../../../shared/presets.mjs';

/**
 * Block for a marker typed at the start of an otherwise empty paragraph.
 * @param {string} marker - Paragraph text before the caret (the caret is at its end).
 * @param {'space'|'enter'} key - Key that completes the marker.
 * @returns {{ type: string, data: object }|null} Block to create, or null.
 */
export const matchBlockShortcut = (marker, key) => {
  if (typeof marker !== 'string' || marker.length > 40) return null;
  const text = marker.replace(/\u00a0/g, ' ');
  if (key === 'space') {
    const heading = /^(#{1,6})$/.exec(text);
    if (heading) return { type: 'header', data: { text: '', level: heading[1].length } };
    if (/^[-*+]$/.test(text))
      return { type: 'list', data: { style: 'unordered', items: [{ content: '', items: [] }] } };
    const ordered = /^(\d{1,6})[.)]$/.exec(text);
    if (ordered) {
      const start = Number(ordered[1]);
      const data = { style: 'ordered', items: [{ content: '', items: [] }] };
      if (start !== 1) data.meta = { start };
      return { type: 'list', data };
    }
    const task = /^\[( |x|X)?\]$/.exec(text);
    if (task)
      return {
        type: 'checklist',
        data: { items: [{ text: '', checked: Boolean(task[1] && task[1] !== ' ') }] },
      };
    if (text === '>') return { type: 'quote', data: { text: '', caption: '', alignment: 'left' } };
    return null;
  }
  if (key === 'enter') {
    const fence = /^```([A-Za-z0-9+#-]{0,32})$/.exec(text);
    if (fence) return { type: 'codeFlask', data: { code: '', language: fence[1] || 'plaintext' } };
    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(text)) return { type: 'delimiter', data: {} };
  }
  return null;
};

/**
 * Applies the field preset: the block must be allowed (a code fence falls back
 * to the plain code block, an ordered/unordered list needs `list`), heading
 * levels must be allowed.
 * @param {{ type: string, data: object }|null} block - Candidate block.
 * @param {import('../../../shared/presets.mjs').FieldPreset|null} preset - Field preset.
 * @param {(type: string) => boolean} [hasTool] - Whether the editor has the tool.
 * @returns {{ type: string, data: object }|null} Allowed block, or null.
 */
export const allowShortcut = (block, preset, hasTool = () => true) => {
  if (!block) return null;
  let candidate = block;
  const allowed = (type) => hasTool(type) && (!preset || isBlockAllowed(preset, type));
  if (candidate.type === 'codeFlask' && !allowed('codeFlask'))
    candidate = { type: 'code', data: { code: '' } };
  if (!allowed(candidate.type)) return null;
  if (candidate.type === 'header' && preset && !preset.headingLevels.includes(candidate.data.level))
    return null;
  return { type: candidate.type, data: candidate.data };
};

/**
 * Inline Markdown completed by the character just typed: `**bold**`,
 * `__bold__`, `*italic*`, `_italic_`, `~~strike~~`, `` `code` ``.
 * @param {string} before - Text of the current text node up to the caret.
 * @returns {{ start: number, end: number, text: string, tag: 'b'|'i'|'s'|'code' }|null} Range to replace (offsets in `before`) and the wrapping tag.
 */
export const matchInlineShortcut = (before) => {
  if (typeof before !== 'string' || before.length > 5000) return null;
  const rules = [
    [/(?:^|[^*\\])\*\*([^*\s](?:[^*]{0,498}[^*\s])?)\*\*$/, 'b', 2],
    [/(?:^|[^_\\\p{L}\p{N}])__([^_\s](?:[^_]{0,498}[^_\s])?)__$/u, 'b', 2],
    [/(?:^|[^~\\])~~([^~\s](?:[^~]{0,498}[^~\s])?)~~$/, 's', 2],
    [/(?:^|[^`\\])`([^`\s](?:[^`]{0,498}[^`\s])?)`$/, 'code', 1],
    [/(?:^|[^*\\])\*([^*\s](?:[^*]{0,498}[^*\s])?)\*$/, 'i', 1],
    [/(?:^|[^_\\\p{L}\p{N}])_([^_\s](?:[^_]{0,498}[^_\s])?)_$/u, 'i', 1],
  ];
  for (const [pattern, tag, size] of rules) {
    const match = pattern.exec(before);
    if (!match) continue;
    const text = match[1];
    const end = before.length;
    const start = end - text.length - size * 2;
    return { start, end, text, tag };
  }
  return null;
};
