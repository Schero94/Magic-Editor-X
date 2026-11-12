/**
 * One client's copy of a live collaboration room, independent of the network.
 *
 * A replica holds two Yjs documents:
 * - `doc`, the shared state: remote updates are applied here and local
 *   changes leave from here to the server;
 * - `shadow`, exactly what the editor shows.
 *
 * A local edit is diffed against the shadow (which matches the editor
 * exactly, so the diff is precise), and the resulting Yjs update is applied
 * to `doc`. Yjs then merges it with remote changes the editor has not shown
 * yet using item identities instead of positions, so concurrent edits keep
 * their intent. After the editor has shown a new state, `markShown` brings
 * the shadow up to the state that was rendered.
 *
 * Undo/redo use a Yjs UndoManager that tracks only this replica's own
 * changes, so undo never reverts what other people typed.
 *
 * Used by the admin collaboration client and by the convergence tests.
 */

import * as Y from 'yjs';
import { applyLocalChanges, createDocReader, docToEditorData, epochOf } from './ydoc.mjs';

/** Transaction origin of local edits applied to `doc` (tracked by undo). */
export const LOCAL_ORIGIN = Object.freeze({ name: 'magic-editor-x-local' });
/** Transaction origin of updates received from the server. */
export const REMOTE_ORIGIN = Object.freeze({ name: 'magic-editor-x-remote' });
const SHADOW_EDIT = Object.freeze({ name: 'magic-editor-x-shadow-edit' });
const SHADOW_SYNC = Object.freeze({ name: 'magic-editor-x-shadow-sync' });

/**
 * Creates a replica.
 * @param {object} [options] - Options.
 * @param {(update: Uint8Array) => void} [options.onLocalUpdate] - Called with every update that must reach the server (local edits, undo, redo).
 * @param {() => void} [options.onShouldRender] - Called when `doc` changed in a way the editor does not show yet (remote, undo, redo).
 * @param {number} [options.captureTimeout=500] - Undo grouping window in ms.
 * @param {number} [options.maxUndoSteps=200] - Undo steps kept; older ones are dropped so long sessions do not keep every deleted item alive.
 * @returns {object} Replica API.
 */
export const createReplica = ({
  onLocalUpdate = () => {},
  onShouldRender = () => {},
  captureTimeout = 500,
  maxUndoSteps = 200,
} = {}) => {
  const doc = new Y.Doc();
  const shadow = new Y.Doc();
  const reader = createDocReader(doc);
  let base = { blocks: [] };
  const undo = new Y.UndoManager([doc.getArray('order'), doc.getMap('blocks')], {
    trackedOrigins: new Set([LOCAL_ORIGIN]),
    captureTimeout,
  });

  undo.on('stack-item-added', () => {
    while (undo.undoStack.length > maxUndoSteps) undo.undoStack.shift();
  });

  shadow.on('update', (update, origin) => {
    if (origin === SHADOW_EDIT) Y.applyUpdate(doc, update, LOCAL_ORIGIN);
  });
  doc.on('update', (update, origin) => {
    if (origin !== REMOTE_ORIGIN) onLocalUpdate(update);
    if (origin === REMOTE_ORIGIN || origin === undo) onShouldRender();
  });

  return {
    doc,
    shadow,
    undoManager: undo,

    /** Applies an update from the server. */
    applyRemote(update) {
      Y.applyUpdate(doc, update, REMOTE_ORIGIN);
    },

    /**
     * Applies the editor's content: only the difference to what the editor
     * showed before is written.
     * @param {object} data - Editor content now.
     * @returns {boolean} True when something changed.
     */
    pushLocal(data) {
      const changed = applyLocalChanges(shadow, base, data, SHADOW_EDIT);
      base = data;
      return changed;
    },

    /**
     * Applies an edit made against an older state (`from` -> `data`) to the
     * current one, for example unsent edits after the room was replaced.
     * @param {object} from - State the edit started from.
     * @param {object} data - Edited state.
     * @returns {boolean} True when something changed.
     */
    rebase(from, data) {
      const changed = applyLocalChanges(shadow, from, data, SHADOW_EDIT);
      base = docToEditorData(shadow);
      return changed;
    },

    /**
     * Reads the state the editor should show, with a token for `markShown`.
     * @returns {{ data: object, catchUp: Uint8Array }} Data and catch-up update.
     */
    snapshot() {
      return { data: reader.read(), catchUp: Y.encodeStateAsUpdate(doc, Y.encodeStateVector(shadow)) };
    },

    /**
     * Records that the editor now shows the snapshot.
     * @param {Uint8Array} catchUp - Token from `snapshot()`.
     * @param {object} [shown] - What the editor reports after rendering (its own normalised form); defaults to the shadow content.
     */
    markShown(catchUp, shown) {
      Y.applyUpdate(shadow, catchUp, SHADOW_SYNC);
      base = shown || docToEditorData(shadow);
    },

    /** What the editor showed last (the base of the next local diff). */
    view: () => base,

    /**
     * Sets what the editor shows without changing the documents (after the
     * replica was replaced while the editor kept its content).
     * @param {object} data - Editor content.
     */
    setView(data) {
      base = data;
    },

    /** Content of the shared state. */
    read: () => reader.read(),
    /** Room generation. */
    epoch: () => epochOf(doc),
    /** Starts a new undo step (next change is not merged with the previous one). */
    stopCapturing: () => undo.stopCapturing(),
    undo: () => undo.undo() !== null,
    redo: () => undo.redo() !== null,
    canUndo: () => undo.undoStack.length > 0,
    canRedo: () => undo.redoStack.length > 0,

    /** Frees both documents. */
    destroy() {
      undo.destroy();
      reader.destroy();
      doc.destroy();
      shadow.destroy();
    },
  };
};
