/**
 * Magic Editor X fakes for the admin StrictMode harness (read by harness/setup.mjs). Each alias
 * wraps the real package and only counts instances, so the editor, the shared documents and the
 * collaboration code run unchanged:
 * - `yjs`: every `new Y.Doc()` and its `destroy()` (fakes/yjs.mjs).
 * - `@editorjs/editorjs`: every Editor.js instance and its `destroy()` (fakes/editorjs.mjs).
 * `socket.io-client` is replaced by the generic counting fake of the harness.
 */
export const aliases = {
  yjs: 'tests/admin/fakes/yjs.mjs',
  '@editorjs/editorjs': 'tests/admin/fakes/editorjs.mjs',
};
