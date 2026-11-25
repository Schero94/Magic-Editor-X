/**
 * Field tool registry (2.4).
 *
 * Every secondary tool of an editor field (history, quality, comments, AI,
 * grammar, find and replace, templates, preview, focus mode, shortcuts, and
 * whatever a later feature adds) is one entry of a declarative list. The
 * toolbar keeps only what editors use constantly (undo, redo, the "More
 * tools" menu, full screen, presence and counts) and renders every entry in
 * that one menu, grouped and ordered here. Pure functions only, so `node
 * --test` covers them without a bundler.
 *
 * Entry contract:
 * - `id` (string, unique per field): stable name, also the `data-testid`
 *   suffix (`mex-tool-<id>`).
 * - `group` ('write' | 'review' | 'file' | 'view'): menu section. Sections are
 *   ordered by how often editors need them: writing tools first, then review,
 *   then import and export, then view options.
 * - `label` (string): translated plain-language name.
 * - `icon` (React node, optional): decorative start icon.
 * - `shortcut` (string, optional): key combination in ShortcutsDialog form,
 *   for example `CMD+SHIFT+F`; shown in the item and exposed as
 *   `aria-keyshortcuts`. The tool's own key handler stays where it is.
 * - `badge` ({ count, tone, label }, optional): a count shown in the item
 *   (`label` is the full accessible name with the count, for example
 *   "Comments (3 open threads)"). Hidden when `count` is 0.
 * - `pressed` (boolean, optional): the tool is a toggle (panel, preview,
 *   focus mode) and is on. Toggles render as `menuitemcheckbox`.
 * - `exitLabel` (string, optional): for a toggle that changes the whole
 *   field view, the label of the visible "way back" button shown in the bar
 *   while `pressed` is true (preview: "Back to editing").
 * - `visible` (boolean, default true): false removes the entry (permission,
 *   config, field option, read-only). Never render a tool that cannot work.
 * - `disabled` (boolean, optional): shown but not selectable (editor not
 *   ready yet).
 * - `description` (string, optional, 2.12): a short second line under the
 *   label, for example why a disabled entry cannot be used yet ("This entry
 *   has not been published yet").
 * - `order` (number, optional): position inside the group; entries without
 *   it keep the order in which they were given.
 * - `onSelect` (function): runs the tool.
 * - `movesFocus` (boolean, optional): the tool puts focus somewhere itself
 *   (a panel input, a dialog); the menu then does not return focus to its
 *   trigger on close.
 */

/**
 * Menu sections in display order (2.12.3: frequent tasks first; import and export got their own
 * section instead of being split across Write and View).
 */
export const TOOL_GROUPS = Object.freeze(['write', 'review', 'file', 'view']);

/**
 * Validates and groups the registry for the menu.
 * @param {Array<object>} entries - Tool entries (see the contract above).
 * @returns {Array<{ group: string, items: Array<object> }>} Non-empty groups in `TOOL_GROUPS` order.
 * @throws {Error} When an entry has no id, a duplicate id, an unknown group or no onSelect.
 */
export const groupFieldTools = (entries) => {
  const seen = new Set();
  const byGroup = new Map(TOOL_GROUPS.map((group) => [group, []]));
  (Array.isArray(entries) ? entries : []).forEach((entry, index) => {
    if (!entry || typeof entry.id !== 'string' || !entry.id) throw new Error('field tool without id');
    if (seen.has(entry.id)) throw new Error(`duplicate field tool ${entry.id}`);
    seen.add(entry.id);
    if (!byGroup.has(entry.group)) throw new Error(`unknown group ${entry.group} for ${entry.id}`);
    if (typeof entry.onSelect !== 'function') throw new Error(`field tool ${entry.id} without onSelect`);
    if (entry.visible === false) return;
    byGroup.get(entry.group).push({ entry, index });
  });
  return TOOL_GROUPS.map((group) => ({
    group,
    items: byGroup
      .get(group)
      .sort((a, b) => {
        const oa = Number.isFinite(a.entry.order) ? a.entry.order : Infinity;
        const ob = Number.isFinite(b.entry.order) ? b.entry.order : Infinity;
        return oa === ob ? a.index - b.index : oa - ob;
      })
      .map(({ entry }) => entry),
  })).filter((section) => section.items.length > 0);
};

/**
 * Toggles that are on and change the whole field view: they get a visible way back in the bar.
 * @param {Array<object>} entries - Tool entries.
 * @returns {Array<object>} Entries with `pressed` and `exitLabel`, visible only.
 */
export const exitTools = (entries) =>
  (Array.isArray(entries) ? entries : []).filter(
    (entry) => entry && entry.visible !== false && entry.pressed === true && entry.exitLabel
  );

/**
 * Whether the platform uses Cmd as the main modifier.
 * @param {{ platform?: string, userAgent?: string }} [nav] - Navigator-like object (defaults to `navigator`).
 * @returns {boolean} True on Apple platforms.
 */
export const isApplePlatform = (nav = typeof navigator !== 'undefined' ? navigator : undefined) =>
  Boolean(nav) && /Mac|iPhone|iPad/.test(nav.platform || nav.userAgent || '');

/**
 * Name of the main modifier key.
 * @param {boolean} [apple] - Apple platform (defaults to detection).
 * @returns {'Cmd'|'Ctrl'} Key name.
 */
export const modKeyName = (apple = isApplePlatform()) => (apple ? 'Cmd' : 'Ctrl');

/**
 * Display name of one key of a combination (2.7.4, c1). Same notation as the Editor.js 2.31
 * block menu and inline toolbar hints (`beautifyShortcut`), so every shortcut in the field reads the
 * same: on Apple platforms ⌘ ⇧ ⌥, elsewhere Ctrl ⇧ Alt.
 * @param {string} key - Key as written in a combination (`CMD`, `SHIFT`, `ALT`, `F`, ...).
 * @param {boolean} [apple] - Apple platform (defaults to detection).
 * @returns {string} Display name.
 */
export const shortcutKeyName = (key, apple = isApplePlatform()) => {
  const names = apple ? { CMD: '⌘', SHIFT: '⇧', ALT: '⌥' } : { CMD: 'Ctrl', SHIFT: '⇧', ALT: 'Alt' };
  return names[String(key).toUpperCase()] || key;
};

/**
 * Shows a ShortcutsDialog-style combination (`CMD+SHIFT+F`) as text in the Editor.js notation:
 * `⌘ + ⇧ + F` on Apple platforms, `Ctrl + ⇧ + F` elsewhere.
 * @param {string} combo - Combination with `+` between keys.
 * @param {boolean} [apple] - Apple platform (defaults to detection).
 * @returns {string} Display text, empty without a combination.
 */
export const formatShortcut = (combo, apple = isApplePlatform()) => {
  if (typeof combo !== 'string' || !combo) return '';
  return combo
    .split('+')
    .map((key) => shortcutKeyName(key, apple))
    .join(' + ');
};

/**
 * The same combination as an `aria-keyshortcuts` value (WAI-ARIA key names).
 * @param {string} combo - Combination with `+` between keys.
 * @param {boolean} [apple] - Apple platform (defaults to detection).
 * @returns {string|undefined} Attribute value.
 */
export const ariaShortcut = (combo, apple = isApplePlatform()) => {
  if (typeof combo !== 'string' || !combo) return undefined;
  const names = { CMD: apple ? 'Meta' : 'Control', SHIFT: 'Shift', ALT: 'Alt' };
  return combo
    .split('+')
    .map((key) => names[key] || key)
    .join('+');
};

/**
 * Count text for a badge.
 * @param {number} count - Count.
 * @returns {string} The count, or "99+" above 99.
 */
export const badgeText = (count) => (count > 99 ? '99+' : String(count));
