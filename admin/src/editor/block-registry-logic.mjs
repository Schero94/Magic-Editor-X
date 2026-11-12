/**
 * Pure helpers of the admin custom block SDK (unit-tested in node).
 */

import { INTERNAL_LINK_ATTRIBUTES } from '../../../shared/sanitize-policy.mjs';

/** Same rule as `tools/sanitize-config.js` `LINK_SANITIZE` (that file is not loadable in node tests). */
const LINK_SANITIZE = Object.freeze({
  href: true,
  target: true,
  rel: true,
  ...Object.fromEntries(INTERNAL_LINK_ATTRIBUTES.map((name) => [name, true])),
});

export const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Text in the admin locale from a string or a `{ locale: text }` map.
 * @param {unknown} value - Text or map.
 * @param {string} locale - Admin locale.
 * @returns {string} Text ('' when none).
 */
export const localized = (value, locale) => {
  if (typeof value === 'string') return value;
  if (!isObject(value)) return '';
  const lang = String(locale || 'en');
  const pick = value[lang] ?? value[lang.split('-')[0]] ?? value.en ?? Object.values(value)[0];
  return typeof pick === 'string' ? pick : '';
};

/**
 * Editor.js sanitize rules derived from the schema: inline fields keep the
 * inline tags (with the full link rule), every other string is kept as is
 * (the schema cleaning bounds and validates it afterwards).
 * @param {Record<string, object>} fields - Normalised schema fields.
 * @returns {object} Editor.js SanitizerConfig per field.
 */
export const sanitizeRulesFor = (fields) => {
  const rule = (field) => {
    if (field.type === 'inline')
      return {
        b: true,
        strong: true,
        i: true,
        em: true,
        u: { class: true },
        s: { class: true },
        mark: { class: true },
        code: { class: true },
        span: { class: true, 'data-tooltip': true },
        sub: true,
        sup: true,
        br: true,
        a: LINK_SANITIZE,
      };
    if (field.type === 'object') return sanitizeRulesFor(field.fields);
    if (field.type === 'array') return rule(field.items);
    return true;
  };
  const out = {};
  for (const [key, field] of Object.entries(fields)) out[key] = rule(field);
  return out;
};

/**
 * Merges the server's code-registered blocks (`GET /config` `codeBlocks`)
 * with the editor tools registered in this admin.
 * @param {Array<object>} server - Server summaries.
 * @param {Array<object>} admin - Admin registrations.
 * @param {string} locale - Admin locale.
 * @returns {Array<{ name: string, title: string, version: number, fields: Array<{ key: string, type: string }>, presets: string[], onServer: boolean, inAdmin: boolean }>} Rows sorted by name.
 */
export const mergeCodeBlocks = (server, admin, locale) => {
  const rows = new Map();
  for (const block of Array.isArray(server) ? server : []) {
    rows.set(block.name, {
      name: block.name,
      title: block.title || block.name,
      version: block.version,
      fields: Array.isArray(block.fields) ? block.fields : [],
      presets: Array.isArray(block.presets) ? block.presets : [],
      onServer: true,
      inAdmin: false,
    });
  }
  for (const entry of admin) {
    const { definition } = entry;
    const current = rows.get(definition.name);
    const title = localized(entry.title, locale) || definition.title || definition.name;
    if (current) rows.set(definition.name, { ...current, title, inAdmin: true });
    else
      rows.set(definition.name, {
        name: definition.name,
        title,
        version: definition.version,
        fields: Object.entries(definition.schema).map(([key, field]) => ({ key, type: field.type })),
        presets: [...definition.presets],
        onServer: false,
        inAdmin: true,
      });
  }
  return [...rows.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
};
