/**
 * Loads the real admin collaboration client (admin/src/editor/collab-client.js)
 * in Node, so the cluster and soak runs exercise the same code as the browser.
 *
 * The admin source is ESM inside a CommonJS package, so it is copied into a
 * temporary .mjs file with its bare imports rewritten to absolute URLs of this
 * repository (one Yjs instance for the client and the shared modules).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Imports the collaboration client module.
 * @returns {Promise<{ createCollabClient: Function, backoffDelay: Function, PROTOCOL: number }>} Module.
 */
export const loadCollabClient = async () => {
  const source = fs.readFileSync(path.join(repo, 'admin/src/editor/collab-client.js'), 'utf8');
  const rewritten = source
    .replace(/from 'yjs'/g, `from '${import.meta.resolve('yjs')}'`)
    .replace(/from 'socket.io-client'/g, `from '${import.meta.resolve('socket.io-client')}'`)
    .replace(/from '\.\.\/\.\.\/\.\.\/shared\//g, `from '${pathToFileURL(path.join(repo, 'shared'))}/`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mex-client-'));
  const file = path.join(dir, 'collab-client.mjs');
  fs.writeFileSync(file, rewritten);
  const module = await import(pathToFileURL(file).href);
  fs.rmSync(dir, { recursive: true, force: true });
  return module;
};

/**
 * A simulated editor around the real client: the "editor" is the JSON the
 * user sees; remote changes are rendered like the field does (snapshot ->
 * show -> markShown).
 * @param {object} options - Options.
 * @param {string} options.name - Client name.
 * @param {Function} options.createCollabClient - From loadCollabClient().
 * @param {() => Promise<object>} options.requestSession - Session request.
 * @param {string} options.url - Socket base URL.
 * @param {(socket: object) => void} [options.onSocket] - Receives the socket (for network faults).
 * @param {number} [options.renderDelayMs=0] - Extra time the editor needs to render remote data (a slow
 *   browser under load); the editor keeps showing (and editing) the old content meanwhile.
 * @returns {object} Simulated editor.
 */
export const simulatedEditor = ({
  name,
  createCollabClient,
  requestSession,
  url,
  onSocket = () => {},
  renderDelayMs = 0,
}) => {
  const sim = {
    name,
    editor: { blocks: [] },
    state: { status: 'connecting' },
    renders: 0,
    editsBeforeFirstRender: 0,
  };
  const render = () => {
    const { data, catchUp } = client.snapshot();
    sim.editor = JSON.parse(JSON.stringify(data));
    client.markShown(catchUp, JSON.parse(JSON.stringify(data)));
    sim.renders += 1;
  };
  let client = null;
  client = createCollabClient({
    url,
    requestSession,
    win: null,
    socketFactory: (target, options) => {
      const socket = ioRef.io(target, options);
      onSocket(socket);
      return socket;
    },
    onState: (state) => {
      sim.state = state;
      if (state.status === 'live') sim.everLive = true;
    },
    onRemoteData: () => {
      if (renderDelayMs > 0)
        setTimeout(() => {
          try {
            render();
          } catch {
            // the client was destroyed while the render was pending
          }
        }, renderDelayMs);
      else render();
    },
    // What the editor shows before it rendered the room (the base of early edits).
    getInitialView: () => JSON.parse(JSON.stringify(sim.editor)),
  });
  sim.client = client;
  /** Applies an edit to what the user sees and pushes it. */
  sim.edit = (fn) => {
    if (!sim.everLive || sim.state.status === 'denied' || !sim.state.canEdit) return false;
    if (sim.renders === 0) sim.editsBeforeFirstRender += 1;
    const next = JSON.parse(JSON.stringify(sim.editor));
    fn(next);
    sim.editor = next;
    client.pushLocal(JSON.parse(JSON.stringify(next)));
    return true;
  };
  return sim;
};

/** socket.io-client, loaded once (set by the caller). */
export const ioRef = { io: null };
