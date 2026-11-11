/**
 * Must run before prismjs loads: stops Prism from highlighting every
 * `code[class*=language-]` on the admin page by itself.
 */
if (typeof window !== 'undefined') {
  window.Prism = window.Prism || {};
  window.Prism.manual = true;
}
