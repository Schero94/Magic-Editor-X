/**
 * Registry of code-registered blocks for the current bundle (server bundle,
 * admin bundle). Leaf module without imports, so every shared module
 * (sanitising policy, presets, quality, diff, find and replace, statistics)
 * can look a registered block up without import cycles.
 *
 * Entries are compiled definitions (see `define.mjs` `compileBlock`). The
 * framework-free renderers used by frontends start with an empty registry and
 * take definitions through the `blocks` render option instead.
 */

/** @type {Map<string, object>} exact name -> compiled definition */
const registry = new Map();

/**
 * Compiled definition registered under exactly this block type, or null.
 * @param {unknown} type - Block type.
 * @returns {object|null} Compiled definition.
 */
export const activeBlock = (type) =>
  typeof type === 'string' && registry.has(type) ? registry.get(type) : null;

/**
 * Every registered compiled definition in registration order.
 * @returns {object[]} Definitions.
 */
export const activeBlocks = () => [...registry.values()];

/**
 * Registered definition whose name equals `name` ignoring case, or null.
 * @param {string} name - Name.
 * @returns {object|null} Compiled definition.
 */
export const activeBlockIgnoringCase = (name) => {
  const lower = String(name).toLowerCase();
  for (const definition of registry.values()) if (definition.name.toLowerCase() === lower) return definition;
  return null;
};

/**
 * Adds a compiled definition. The caller (`registry.mjs`) checks names.
 * @param {object} compiled - Compiled definition.
 */
export const setActiveBlock = (compiled) => {
  registry.set(compiled.name, compiled);
};

/**
 * Removes every registered definition (tests, plugin destroy).
 */
export const clearActiveBlocks = () => {
  registry.clear();
};
