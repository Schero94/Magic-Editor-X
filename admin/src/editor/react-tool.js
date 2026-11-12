import { createElement } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Turns a React component into an Editor.js block tool for the custom block
 * SDK (`apis.createReactTool`). The component is mounted with
 * `react-dom/client` `createRoot` into the block's element and receives
 * `{ data, onChange, readOnly, translate, definition }`; `onChange(next)`
 * stores the cleaned data and tells Editor.js that the block changed (undo,
 * history, collaboration and the form follow from that).
 *
 * The component runs in its own React root: admin providers (theme, intl,
 * router) are not available inside it, so it renders plain elements or wraps
 * itself in the providers it needs. Never render untrusted strings as HTML in
 * it; inline HTML fields hold sanitised HTML that React should show as text or
 * through your own trusted renderer.
 *
 * @param {Function} Component - React component.
 * @param {{ className?: string }} [options] - Class name of the block element.
 * @returns {Function} Editor.js block tool class.
 */
export const createReactTool = (Component, options = {}) => {
  if (typeof Component !== 'function' && !(Component && typeof Component === 'object'))
    throw new TypeError('Magic Editor X createReactTool: pass a React component');
  const className = typeof options.className === 'string' ? options.className : 'mex-code-block-tool';

  return class ReactBlockTool {
    static get isReadOnlySupported() {
      return true;
    }

    /**
     * @param {{ data: object, config: object, readOnly: boolean, block: object }} params - Editor.js tool parameters.
     */
    constructor({ data, config, readOnly, block }) {
      this.config = config || {};
      this.readOnly = Boolean(readOnly);
      this.blockApi = block;
      this.clean = typeof this.config.clean === 'function' ? this.config.clean : (value) => value || {};
      this.data = this.clean(data);
      this.root = null;
      this.element = null;
    }

    /** @returns {HTMLElement} Block element with the mounted component. */
    render() {
      this.element = document.createElement('div');
      this.element.className = className;
      this.root = createRoot(this.element);
      this.paint();
      return this.element;
    }

    /** Renders the component with the current data. */
    paint() {
      if (!this.root) return;
      this.root.render(
        createElement(Component, {
          data: this.data,
          readOnly: this.readOnly,
          definition: this.config.definition,
          translate: this.config.translate || ((_key, fallback) => fallback),
          onChange: (next) => {
            if (this.readOnly) return;
            this.data = this.clean(next);
            this.paint();
            if (this.blockApi && typeof this.blockApi.dispatchChange === 'function')
              this.blockApi.dispatchChange();
          },
        })
      );
    }

    /** @returns {object} Current data (cleaned again by the editor and the server). */
    save() {
      return this.data;
    }

    /** Unmounts the React root (deferred: Editor.js may call this while React renders). */
    destroy() {
      const root = this.root;
      this.root = null;
      if (root) setTimeout(() => root.unmount(), 0);
    }

    removed() {
      this.destroy();
    }
  };
};
