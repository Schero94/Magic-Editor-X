/**
 * The one list of code languages of the highlighted code block (`codeFlask`).
 *
 * - the editor's language select offers exactly these ids (with `CODE_LANGUAGE_LABELS`),
 * - the admin loads one Prism grammar per id (`admin/src/editor/tools/prism/index.js`,
 *   checked by `tests/code-languages.test.mjs`),
 * - the renderers write the stored id as `language-<id>` on `<code>`
 *   (Prism, highlight.js and Shiki read that class).
 *
 * Stored values that are not in the list but are valid identifiers
 * (`/^[a-z0-9+#-]{1,32}$/i`, the sanitising policy) are kept as they are, so
 * content written by other tools keeps its language; the editor shows them
 * as an extra option and highlights them as plain text. 1.x aliases (`js`,
 * `html`, ...) become the canonical id when the block is edited.
 */

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

/** Display names of the languages (product names, not translated). */
export const CODE_LANGUAGE_LABELS = Object.freeze({
  plaintext: 'Plain text',
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  jsx: 'JSX',
  tsx: 'TSX',
  json: 'JSON',
  markup: 'HTML / XML',
  css: 'CSS',
  scss: 'SCSS',
  bash: 'Shell',
  python: 'Python',
  php: 'PHP',
  ruby: 'Ruby',
  java: 'Java',
  kotlin: 'Kotlin',
  swift: 'Swift',
  csharp: 'C#',
  c: 'C',
  cpp: 'C++',
  go: 'Go',
  rust: 'Rust',
  sql: 'SQL',
  graphql: 'GraphQL',
  yaml: 'YAML',
  markdown: 'Markdown',
  docker: 'Dockerfile',
  diff: 'Diff',
});

/** Aliases written by 1.x CodeFlask content and common short names. */
export const CODE_LANGUAGE_ALIASES = Object.freeze({
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
});

/** A language identifier the sanitising policy keeps (same rule as `BLOCK_POLICIES.codeFlask`). */
export const CODE_LANGUAGE_PATTERN = /^[a-z0-9+#-]{1,32}$/i;

/**
 * Language id for the editor: a known id or alias becomes the canonical id;
 * another valid identifier is kept (lower case); anything else is `plaintext`.
 * @param {unknown} language - Stored language.
 * @returns {string} Language id.
 */
export const normalizeCodeLanguage = (language) => {
  const raw = typeof language === 'string' ? language.trim().toLowerCase() : '';
  if (!raw) return 'plaintext';
  const mapped = Object.prototype.hasOwnProperty.call(CODE_LANGUAGE_ALIASES, raw)
    ? CODE_LANGUAGE_ALIASES[raw]
    : raw;
  if (CODE_LANGUAGES.includes(mapped)) return mapped;
  return CODE_LANGUAGE_PATTERN.test(mapped) ? mapped : 'plaintext';
};

/**
 * True for an id of `CODE_LANGUAGES`.
 * @param {unknown} language - Candidate.
 * @returns {boolean} Result.
 */
export const isKnownCodeLanguage = (language) =>
  typeof language === 'string' && CODE_LANGUAGES.includes(language);
