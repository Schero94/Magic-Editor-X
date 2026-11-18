/**
 * Counting wrapper of Editor.js 2.31 for the StrictMode tests. The real editor runs in jsdom;
 * this only records every instance and whether `destroy()` ran. Editor.js copies its public API
 * (including `destroy`) onto the instance when it is ready (`isReady`), so `destroy` is wrapped
 * after that (https://editorjs.io/api: `isReady`, `destroy()`).
 */
import RealEditorJS from '@editorjs/editorjs';

/** Live editors with the holder they render into. */
export const liveEditors = new Set();
export const editorCounts = { created: 0, destroyed: 0 };

/**
 * Same constructor signature as Editor.js; returns the real instance.
 * @param {object} config - Editor.js configuration.
 * @returns {object} Editor.js instance.
 */
function EditorJS(config) {
  const editor = new RealEditorJS(config);
  editorCounts.created += 1;
  liveEditors.add(editor);
  editor.isReady
    .then(() => {
      const destroy = editor.destroy;
      editor.destroy = (...args) => {
        if (liveEditors.delete(editor)) editorCounts.destroyed += 1;
        return destroy.apply(editor, args);
      };
    })
    .catch(() => {
      // An editor that failed to start holds nothing.
      liveEditors.delete(editor);
    });
  return editor;
}
Object.setPrototypeOf(EditorJS, RealEditorJS);
EditorJS.prototype = RealEditorJS.prototype;

export default EditorJS;
