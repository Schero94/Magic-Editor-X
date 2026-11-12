/**
 * Field paths of the Content Manager form.
 *
 * An editor field inside a repeatable component or a dynamic zone has a
 * positional path (`sections.0.body`, `zone.1.body`): the index says where
 * the entry is in the form, not which entry it is. Removing, adding or
 * reordering entries before the next save gives the same path to another
 * entry, while a live collaboration room keyed by that path keeps the content
 * of the entry that used it before. Live collaboration is therefore used only
 * for fields with a stable path (top level and single components).
 */

/**
 * Whether a field path contains a repeatable component or dynamic zone index.
 * @param {unknown} path - Field path from the Content Manager (`body`, `seo.text`, `sections.0.body`).
 * @returns {boolean} True for positional paths.
 */
export const isPositionalFieldPath = (path) =>
  typeof path === 'string' && path.split('.').some((part) => /^\d+$/.test(part));
