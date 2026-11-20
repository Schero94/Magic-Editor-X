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

/** Editor.js' own inline tools and their English names (translated through `toolNames`). */
const BUILT_IN_INLINE = { bold: 'Bold', italic: 'Italic', link: 'Link', 'convert-to': 'Convert to' };

/** Package tools without a `title` (@editorjs/inline-code 1.5 has none): the name Editor.js shows. */
const PACKAGE_TITLES = { inlineCode: 'Inline Code' };

/**
 * Translated names of the editor's tools by tool name (2.7.8). Editor.js shows the name only as a
 * hover tooltip; the inline toolbar buttons themselves had no accessible name.
 * @param {Record<string, { class?: { title?: string } }>} tools - Editor.js tools config.
 * @param {Record<string, string>} toolNames - Editor.js `i18n.messages.toolNames` (English -> translated).
 * @param {string} convertTo - Translated "Convert to".
 * @returns {Record<string, string>} Names.
 */
export const toolTitles = (tools, toolNames, convertTo) => {
  const out = {};
  for (const [name, english] of Object.entries(BUILT_IN_INLINE)) out[name] = toolNames[english] || english;
  out['convert-to'] = convertTo;
  for (const [name, definition] of Object.entries(tools || {})) {
    const tool = definition && (definition.class || definition);
    const title = tool && typeof tool.title === 'string' ? tool.title : PACKAGE_TITLES[name] || null;
    if (title) out[name] = toolNames[title] || title;
  }
  return out;
};

/**
 * Names the inline toolbar buttons from their tool (2.7.8): Editor.js renders them as icon-only
 * buttons; tools that render their own button sit inside an item with `data-item-name`.
 * Watches the holder, because Editor.js builds the toolbar again for every selection.
 * @param {Element|null} holder - Editor holder.
 * @param {(name: string) => string|undefined} titleOf - Name of a tool.
 * @returns {() => void} Cleanup.
 */
export const labelInlineToolbar = (holder, titleOf) => {
  if (!holder) return () => {};
  const label = () => {
    for (const toolbar of holder.querySelectorAll('.ce-inline-toolbar')) {
      for (const button of toolbar.querySelectorAll('button, [role="button"], .ce-popover-item')) {
        if (button.getAttribute('aria-label') || button.getAttribute('aria-labelledby')) continue;
        if (button.textContent.trim() && !button.matches('.ce-popover-item')) continue;
        const item = button.closest('[data-item-name]');
        const name = item ? item.getAttribute('data-item-name') : null;
        const title = name ? titleOf(name) : undefined;
        if (title) button.setAttribute('aria-label', title);
      }
    }
  };
  label();
  const View = holder.ownerDocument.defaultView;
  const observer = new View.MutationObserver(label);
  observer.observe(holder, { childList: true, subtree: true });
  return () => observer.disconnect();
};

/**
 * Focusable items of a shown inline toolbar (2.7.8, Alt+F10).
 * @param {Element|null} holder - Editor holder.
 * @returns {HTMLElement[]} Items in order.
 */
export const inlineToolbarItems = (holder) => {
  const toolbar = holder && holder.querySelector('.ce-inline-toolbar');
  if (!toolbar) return [];
  return Array.from(toolbar.querySelectorAll('button, [role="button"], input')).filter(
    (element) => !element.hasAttribute('disabled') && element.getClientRects().length > 0
  );
};

/** Package controls that are clickable `div`s (2.7.8): @editorjs/attaches' "Select a file". */
const DIV_BUTTONS = '.cdx-attaches__button';

/**
 * Makes clickable `div`s of package tools keyboard buttons (role, tab stop, Enter/Space), now and
 * for blocks added later. Their visible text names them.
 * @param {Element|null} holder - Editor holder.
 * @returns {() => void} Cleanup.
 */
export const decorateDivButtons = (holder) => {
  if (!holder) return () => {};
  const decorate = () => {
    for (const node of holder.querySelectorAll(`${DIV_BUTTONS}:not([role])`)) {
      node.setAttribute('role', 'button');
      node.setAttribute('tabindex', '0');
    }
  };
  const onKeyDown = (event) => {
    const node = event.target && event.target.closest ? event.target.closest(DIV_BUTTONS) : null;
    if (!node || (event.key !== 'Enter' && event.key !== ' ')) return;
    event.preventDefault();
    event.stopPropagation();
    node.click();
  };
  decorate();
  const View = holder.ownerDocument.defaultView;
  const observer = new View.MutationObserver(decorate);
  observer.observe(holder, { childList: true, subtree: true });
  holder.addEventListener('keydown', onKeyDown);
  return () => {
    observer.disconnect();
    holder.removeEventListener('keydown', onKeyDown);
  };
};
