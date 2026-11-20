/**
 * Accessible block toolbar (2.7.8, re-audit major 1).
 *
 * Editor.js 2.31 renders the "+" (add a block) control as a `div` and the
 * "⋮⋮" (block menu) control as a `span`, without a role, a name or a tab stop.
 * Both get `role="button"`, `tabindex="0"`, a translated name and
 * Enter/Space activation here. Editor.js opens the toolbox on `click` of "+"
 * and the block menu on `mousedown` of "⋮⋮" (editorjs.mjs, Toolbar module), so
 * the keys dispatch the same events. Ctrl/Cmd+/ (Editor.js' own block menu
 * shortcut) and "/" or Tab in an empty block (block types) stay the keyboard
 * shortcuts; these buttons serve Tab and screen reader users.
 */

/**
 * Decorates the toolbar controls of one editor.
 * @param {Element|null} holder - Editor holder.
 * @param {{ add: string, menu: string }} labels - Translated names.
 * @returns {() => void} Cleanup (removes the key handlers; the attributes stay with the nodes).
 */
export const decorateToolbar = (holder, labels) => {
  if (!holder) return () => {};
  const plus = holder.querySelector('.ce-toolbar__plus');
  const menu = holder.querySelector('.ce-toolbar__settings-btn');
  const cleanups = [];
  const decorate = (node, label, activate) => {
    if (!node) return;
    node.setAttribute('role', 'button');
    node.setAttribute('tabindex', '0');
    node.setAttribute('aria-label', label);
    node.setAttribute('aria-haspopup', 'menu');
    const onKeyDown = (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      activate(node);
    };
    node.addEventListener('keydown', onKeyDown);
    cleanups.push(() => node.removeEventListener('keydown', onKeyDown));
  };
  decorate(plus, labels.add, (node) => node.click());
  decorate(menu, labels.menu, (node) => {
    const view = node.ownerDocument.defaultView;
    node.dispatchEvent(new view.MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  });
  return () => cleanups.forEach((cleanup) => cleanup());
};
