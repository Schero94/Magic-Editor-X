/**
 * jsdom has no layout: every element measures 0 x 0. editorjs-indent-tune 1.4.4 (the latest
 * release) re-queues `applyStylesToWrapper` as a microtask until the Editor.js block or redactor
 * has a width, so under jsdom it never stops and the event loop starves. Editor.js blocks and the
 * redactor get the width of a typical admin column here; nothing else is measured differently.
 * Import this module before rendering an editor.
 */
const EDITOR_CLASSES = ['ce-block', 'codex-editor__redactor'];
const WIDTH = 720;
const native = window.HTMLElement.prototype.getBoundingClientRect;

window.HTMLElement.prototype.getBoundingClientRect = function getBoundingClientRect() {
  const rect = native.call(this);
  if (!EDITOR_CLASSES.some((name) => this.classList.contains(name))) return rect;
  return {
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    width: WIDTH,
    height: 32,
    right: WIDTH,
    bottom: 32,
    toJSON: () => ({}),
  };
};
