import { ICONS, el } from './dom';
import { COMPONENT_UID, cleanValuesShape } from '../../../../shared/components.mjs';

/**
 * Component block (`component`, 2.5): a Content-Type Builder component with
 * scalar attributes. Stores `{ uid, values }` (the built-in marker is added
 * by `markedTool`).
 *
 * The form is a React view (Design System inputs, inline validation) that the
 * field renders through a portal into the element this tool returns
 * (`config.mount(element, info)`), like the synced block, so it has the admin
 * theme and translations. The element is `data-mutation-free`: the view's own
 * DOM updates are not taken for edits; the view reports changes through
 * `info.onChange`, which stores the values and tells Editor.js.
 *
 * Toolbox: one entry per component the field allows (`config.components`),
 * each with `data: { uid }`, so editors pick "Call to action" in the (+) menu
 * and the slash menu like any block. Fields without allowed components show
 * no entry; stored blocks still render (with a notice when their component is
 * not available).
 */

/** Element and focus of the last view that went away, so a re-render (undo) keeps the caret. */
const lastFocus = new Map();

/** Rendered component block tools by block id (for collaborators' changes, see `applyComponentValues`). */
const instances = new Map();

/**
 * Applies a collaborator's change of a component block's values to the block
 * the editor shows, in place (2.5): the form keeps its DOM, so the local
 * editor keeps focus and caret while someone else edits another attribute.
 * Used by `apply-remote.js` instead of `blocks.update` (which re-creates the
 * block). Only for the same component; a new uid re-renders the block.
 * @param {string} blockId - Block id.
 * @param {{ uid?: unknown, values?: unknown }} data - New block data.
 * @returns {boolean} True when the change was applied in place.
 */
export const applyComponentValues = (blockId, data) => {
  const tool = instances.get(blockId);
  if (!tool || !data || data.uid !== tool.data.uid || !tool.remote) return false;
  tool.data = { ...tool.data, values: cleanValuesShape(data.values) };
  tool.remote(tool.data.values);
  return true;
};

/**
 * Builds the tool class of one field: the toolbox lists the field's components.
 * @param {Array<{ uid: string, displayName: string }>} components - Allowed, supported components.
 * @returns {Function} Editor.js block tool class.
 */
export const createComponentTool = (components) => {
  const entries = (Array.isArray(components) ? components : []).map((component) => ({
    title: component.displayName,
    icon: ICONS.component,
    data: { uid: component.uid },
  }));

  return class ComponentTool {
    static get toolbox() {
      return entries.length ? entries : undefined;
    }

    static get isReadOnlySupported() {
      return true;
    }

    /** Enter inside the form must not create a block. */
    static get enableLineBreaks() {
      return true;
    }

    /** Values are plain text, never HTML: Editor.js keeps them as they are. */
    static get sanitize() {
      return { uid: true, values: true };
    }

    /**
     * @param {{ data: object, config: object, readOnly: boolean, block: object }} params - Editor.js tool parameters.
     */
    constructor({ data, config, readOnly, block }) {
      this.config = config || {};
      this.readOnly = Boolean(readOnly);
      this.block = block;
      const source = data && typeof data === 'object' ? data : {};
      const uid = typeof source.uid === 'string' && COMPONENT_UID.test(source.uid) ? source.uid : '';
      // A new block from the toolbox has no values yet: the view fills in the defaults.
      this.fresh = !source.values;
      this.data = { uid, values: cleanValuesShape(source.values) };
      this.wrapper = null;
      this.unmount = null;
    }

    render() {
      const blockId = this.block && this.block.id;
      const wrapper = el('div', {
        className: 'mex-component-block',
        attrs: { 'data-mutation-free': 'true', 'data-mex-component': this.data.uid || 'none' },
      });
      // Keys, paste and drops in the form belong to the form, not to Editor.js (no new or removed blocks).
      const own = (event) => {
        const target = event.target;
        if (
          target &&
          target !== wrapper &&
          target.closest &&
          target.closest('input, textarea, button, [role]')
        ) {
          event.stopPropagation();
          // Enter in a one-line input must not submit the Content Manager form (implicit submission).
          if (event.type === 'keydown' && event.key === 'Enter' && target.tagName === 'INPUT')
            event.preventDefault();
        }
      };
      for (const type of ['keydown', 'paste', 'cut', 'copy', 'drop']) wrapper.addEventListener(type, own);
      this.wrapper = wrapper;
      this.remote = null;
      if (blockId && this.data.uid) instances.set(blockId, this);
      // Editor.js composes the default data of a toolbox entry with an instance without a uid: no view.
      if (typeof this.config.mount === 'function' && this.data.uid) {
        const focus = blockId ? lastFocus.get(blockId) : null;
        if (blockId) lastFocus.delete(blockId);
        this.unmount = this.config.mount(wrapper, {
          blockId,
          uid: this.data.uid,
          values: this.data.values,
          fresh: this.fresh,
          readOnly: this.readOnly,
          focus: focus && Date.now() - focus.at < 2000 ? focus : null,
          // The view registers how it takes a collaborator's values (`applyComponentValues`).
          subscribe: (listener) => {
            this.remote = typeof listener === 'function' ? listener : null;
            return () => {
              if (this.remote === listener) this.remote = null;
            };
          },
          onChange: (values) => {
            if (this.readOnly) return;
            this.data = { ...this.data, values: cleanValuesShape(values) };
            if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
            // Selects and switches fire no input event (their popovers live outside the editor):
            // report the change like typing, so the field saves it before a collaborator's change is shown.
            wrapper.dispatchEvent(new Event('input', { bubbles: true }));
          },
        });
      }
      return wrapper;
    }

    /** @returns {{ uid: string, values: object }} Stored data. */
    save() {
      // Without a uid (the instance Editor.js uses to compose toolbox data) no values: a new block from
      // the toolbox then arrives without values and the view fills in the defaults.
      if (!this.data.uid) return { uid: '' };
      return { uid: this.data.uid, values: { ...this.data.values } };
    }

    /** A block without a component is not kept. */
    validate(data) {
      return Boolean(data && typeof data.uid === 'string' && data.uid);
    }

    destroy() {
      if (this.block && instances.get(this.block.id) === this) instances.delete(this.block.id);
      const wrapper = this.wrapper;
      const active = typeof document !== 'undefined' ? document.activeElement : null;
      if (wrapper && active && wrapper.contains(active) && this.block && active.name) {
        lastFocus.set(this.block.id, {
          name: active.name,
          start: typeof active.selectionStart === 'number' ? active.selectionStart : null,
          end: typeof active.selectionEnd === 'number' ? active.selectionEnd : null,
          at: Date.now(),
        });
      }
      const unmount = this.unmount;
      this.unmount = null;
      if (typeof unmount === 'function') unmount();
    }

    removed() {
      this.destroy();
    }
  };
};

export default createComponentTool;
