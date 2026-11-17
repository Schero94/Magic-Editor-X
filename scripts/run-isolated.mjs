/**
 * Runs a Node.js check in its own process and fails on a duplicate Yjs.
 *
 * Yjs sets a global marker on import and prints "Yjs was already imported"
 * (console.error) when a second copy loads in the same process, for example
 * its CommonJS and its ES module build (https://github.com/yjs/yjs/issues/438).
 * Two copies break Yjs constructor checks, so the runtime check loads each
 * server bundle format in a separate process and treats that message as an
 * error instead of noise.
 */
import { spawnSync } from 'node:child_process';

export const YJS_DUPLICATE = 'Yjs was already imported';

/**
 * Runs `node <args>` and returns its standard output.
 * @param {string[]} args Arguments for the Node.js binary that runs this script.
 * @param {{ cwd?: string }} [options] Working directory of the child process.
 * @returns {string} Standard output of the child process.
 * @throws {Error} When the process exits with a non-zero status or prints the Yjs duplicate warning.
 */
export function runIsolated(args, { cwd } = {}) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  const output = `${result.stdout || ''}${result.stderr || ''}`;
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`node ${args.join(' ')} failed (${result.status}):\n${output}`);
  if (output.includes(YJS_DUPLICATE))
    throw new Error(`node ${args.join(' ')} loaded two copies of Yjs:\n${output}`);
  return result.stdout;
}
