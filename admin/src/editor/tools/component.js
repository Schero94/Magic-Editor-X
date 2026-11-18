import { ICONS, el } from './dom';
import {
  COMPONENT_UID,
  cleanValuesShape,
  mergeComponentPatch,
  mergePendingValues,
} from '../../../../shared/components.mjs';

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
 * the editor shows, in place (2.6): the form keeps its DOM, so the local
 * editor keeps focus and caret while someone else edits another attribute.
 * Used by `apply-remote.js` instead of `blocks.update` (which re-creates the
 * block). Only for the same component; a new uid re-renders the block.
 *
 * 2.6, `keepPending` (live room snapshots): attributes edited locally since
 * the last push (`markComponentsPushed`) are not in the snapshot yet. They are
 * merged onto it (`mergePendingValues`) instead of being overwritten; the
 * field then takes the room state as its diff base (`componentRoomView`) and
 * pushes them (`reportUnpushedComponents`). Without it (history restore, form
 * reset) the new values win.
 * @param {string} blockId - Block id.
 * @param {{ uid?: unknown, values?: unknown }} data - New block data.
 * @param {{ keepPending?: boolean }} [options] - Options.
 * @returns {boolean} True when the change was applied in place.
 */
export const applyComponentValues = (blockId, data, { keepPending = false } = {}) => {
  const tool = instances.get(blockId);
  if (!tool || !data || data.uid !== tool.data.uid || !tool.remote) return false;
  const remote = cleanValuesShape(data.values);
  const values = keepPending ? mergePendingValues(tool.synced, tool.data.values, remote).values : remote;
  if (keepPending) tool.synced = remote;
  tool.data = { ...tool.data, values };
  tool.remote(values);
  return true;
};

/**
 * Records what reached the live room (2.6): call with the exact data passed
 * to the collaboration client's `pushLocal`.
 * @param {{ blocks?: Array<{ id?: string, type?: string, data?: object }> }} data - Pushed editor data.
 */
export const markComponentsPushed = (data) => {
  if (!data || !Array.isArray(data.blocks)) return;
  for (const block of data.blocks) {
    if (!block || block.type !== 'component' || !block.data) continue;
    const tool = instances.get(block.id);
    if (tool && block.data.uid === tool.data.uid) tool.synced = cleanValuesShape(block.data.values);
  }
};

/**
 * The editor data with each component block's values replaced by what the
 * live room has (2.6). The field records this as what it shows after a
 * snapshot, so local edits that are not in the room yet (typed while the
 * snapshot was applied) stay a difference and are pushed next time.
 * @param {{ blocks?: object[] }} data - Editor data (`editor.save()`).
 * @returns {object} Data to record as the diff base.
 */
export const componentRoomView = (data) => {
  if (!data || !Array.isArray(data.blocks)) return data;
  return {
    ...data,
    blocks: data.blocks.map((block) => {
      const tool = block && block.type === 'component' ? instances.get(block.id) : null;
      if (!tool || !block.data || block.data.uid !== tool.data.uid) return block;
      return { ...block, data: { ...block.data, values: { ...tool.synced } } };
    }),
  };
};

/**
 * Reports every component block whose values differ from the room's as
 * changed (2.6), so the field pushes them. Call after the field recorded the
 * diff base of a snapshot (changes reported while it applies one are ignored).
 * @returns {number} Number of blocks reported.
 */
export const reportUnpushedComponents = () => {
  let count = 0;
  for (const tool of instances.values()) {
    if (tool.readOnly || sameValues(tool.data.values, tool.synced)) continue;
    tool.reportChange();
    count += 1;
  }
  return count;
};

/**
 * Compares two cleaned value maps.
 * @param {Record<string, unknown>} a - Values.
 * @param {Record<string, unknown>} b - Values.
 * @returns {boolean} True when equal.
 */
const sameValues = (a, b) => {
  const keys = Object.keys(a || {});
  if (keys.length !== Object.keys(b || {}).length) return false;
  return keys.every((key) => b[key] === a[key]);
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
      // 2.6: values the live room has (the base of local edits that are not pushed yet).
      this.synced = this.data.values;
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
          onChange: (values, options = {}) => {
            if (this.readOnly) return;
            // A patch (one attribute) is merged into the block's current values, which also hold
            // collaborators' changes the form may not have rendered yet; undefined removes the key.
            const next = options.patch
              ? mergeComponentPatch(this.data.values, values)
              : cleanValuesShape(values);
            this.data = { ...this.data, values: next };
            this.reportChange();
          },
        });
      }
      return wrapper;
    }

    /**
     * Tells Editor.js and the field that the block changed. Selects and switches fire no input
     * event (their popovers live outside the editor): the change is reported like typing, so the
     * field saves it before a collaborator's change is shown.
     */
    reportChange() {
      if (this.block && typeof this.block.dispatchChange === 'function') this.block.dispatchChange();
      if (this.wrapper) this.wrapper.dispatchEvent(new Event('input', { bubbles: true }));
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
