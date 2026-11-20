import { MAX_RECENT_INSTRUCTIONS, rememberInstruction } from '../../../shared/ai-actions.mjs';

/**
 * Recent "Ask AI…" instructions (2.9), offered as quick picks. Kept in this
 * browser's localStorage per admin user (`magic-editor-x:ai-recent:<user id>`),
 * never sent anywhere. Storage that is full, blocked or holds something else
 * is treated as empty; failures never reach the editor.
 */

const PREFIX = 'magic-editor-x:ai-recent:';

/**
 * Storage key for an admin user.
 * @param {number|string|null|undefined} owner - Admin user id.
 * @returns {string|null} Key, or null without a user.
 */
const keyOf = (owner) =>
  owner === null || owner === undefined || owner === '' ? null : `${PREFIX}${String(owner).slice(0, 40)}`;

/**
 * Reads the recent instructions of an admin user.
 * @param {number|string|null|undefined} owner - Admin user id.
 * @returns {string[]} Instructions, newest first.
 */
export const readRecentInstructions = (owner) => {
  const key = keyOf(owner);
  if (!key) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(key) || '[]');
    return rememberInstruction(parsed, '').slice(0, MAX_RECENT_INSTRUCTIONS);
  } catch {
    return [];
  }
};

/**
 * Adds an instruction to the recent list of an admin user.
 * @param {number|string|null|undefined} owner - Admin user id.
 * @param {string} instruction - Instruction just sent.
 * @returns {string[]} New list.
 */
export const saveRecentInstruction = (owner, instruction) => {
  const next = rememberInstruction(readRecentInstructions(owner), instruction);
  const key = keyOf(owner);
  if (!key) return next;
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Storage full or blocked: the quick picks stay as they are.
  }
  return next;
};
