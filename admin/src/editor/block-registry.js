import { registerBlockDefinition } from '../../../shared/blocks/registry.mjs';
import { BlockDefinitionError } from '../../../shared/blocks/define.mjs';
import { isObject, localized, sanitizeRulesFor } from './block-registry-logic.mjs';
import { sanitizeInline, sanitizeSvg } from './sanitize';
import { ICONS } from './tools/dom';

export { localized, sanitizeRulesFor };

/**
 * Admin side of the custom block SDK: editor tools registered by the host app
 * through the plugin's admin API
 * (`app.getPlugin('magic-editor-x').apis.registerBlock(...)`).
 *
 * The definition goes into the admin bundle's block registry, so every place
 * that prepares editor content (`prepareEditorValue`, collaboration, history
 * restore, find and replace, quality, diff) cleans the block with its schema,
 * exactly like the server does on save.
 */

/** @type {Map<string, object>} */
const tools = new Map();

/**
 * Registers a code-defined block with its editor tool. Call it in the host
 * app's `src/admin/app.js` `register(app)` (or `bootstrap(app)`).
 *
 * @param {object} options - Registration.
 * @param {object} options.definition - Definition from `defineBlock` (`magic-editor-x/blocks`); register the same one on the server.
 * @param {Function} options.tool - Editor.js block tool class (vanilla, or from `createReactTool`).
 * @param {string|Record<string, string>} [options.title] - Toolbox title, or titles by admin locale (default: definition title or name).
 * @param {string} [options.icon] - SVG icon for the toolbox (sanitised).
 * @param {Record<string, Record<string, string>>} [options.i18n] - Messages by admin locale, read by the tool through `config.translate(key, fallback)`.
 * @param {boolean} [options.inlineToolbar] - Offer the inline tools (bold, links, ...) in the tool's editable inline fields.
 * @param {string} [options.shortcut] - Editor.js shortcut (`CMD+SHIFT+K`).
 * @returns {Readonly<object>} The compiled definition.
 * @throws {BlockDefinitionError} Invalid registration or taken name.
 */
export const registerBlock = (options) => {
  if (!isObject(options))
    throw new BlockDefinitionError('Magic Editor X registerBlock: pass { definition, tool }');
  const { definition, tool, title, icon, i18n, inlineToolbar, shortcut } = options;
  if (typeof tool !== 'function')
    throw new BlockDefinitionError(
      'Magic Editor X registerBlock: "tool" must be an Editor.js block tool class'
    );
  if (shortcut !== undefined && (typeof shortcut !== 'string' || !/^[A-Z0-9+]{1,40}$/.test(shortcut)))
    throw new BlockDefinitionError('Magic Editor X registerBlock: "shortcut" must look like CMD+SHIFT+K');
  const existing = tools.get(definition && definition.name);
  if (existing && existing.tool === tool && existing.source === definition) return existing.definition;
  const compiled = registerBlockDefinition(definition);
  tools.set(compiled.name, {
    source: definition,
    definition: compiled,
    tool,
    title: title === undefined ? compiled.title || compiled.name : title,
    icon: typeof icon === 'string' ? sanitizeSvg(icon) : '',
    i18n: isObject(i18n) ? i18n : {},
    inlineToolbar: inlineToolbar === true,
    shortcut,
  });
  return compiled;
};

/**
 * Registered code blocks.
 * @returns {Array<{ definition: object, tool: Function, title: unknown, icon: string, i18n: object, inlineToolbar: boolean, shortcut?: string }>} Entries.
 */
export const codeBlocks = () => [...tools.values()];

/**
 * Editor.js tool settings of every registered code block.
 * @param {{ t: Function, locale?: string, inline: string[], shared: object }} ctx - Tool context from `buildTools`.
 * @returns {Record<string, object>} Tools by block name.
 */
export const buildCodeBlockTools = (ctx) => {
  const out = {};
  for (const entry of tools.values()) {
    const { definition, tool: Tool } = entry;
    const messages = isObject(entry.i18n[ctx.locale])
      ? entry.i18n[ctx.locale]
      : isObject(entry.i18n[String(ctx.locale || '').split('-')[0]])
        ? entry.i18n[String(ctx.locale).split('-')[0]]
        : isObject(entry.i18n.en)
          ? entry.i18n.en
          : {};
    const rules = sanitizeRulesFor(definition.schema);
    // Editor.js strips every tag from strings of a tool without sanitize rules; derive them from the schema.
    const ToolClass =
      Tool.sanitize && typeof Tool.sanitize === 'object'
        ? Tool
        : class CodeBlockTool extends Tool {
            static get sanitize() {
              return rules;
            }
          };
    out[definition.name] = {
      class: ToolClass,
      ...(entry.inlineToolbar ? { inlineToolbar: ctx.inline } : {}),
      ...(entry.shortcut ? { shortcut: entry.shortcut } : {}),
      toolbox: {
        title: localized(entry.title, ctx.locale) || definition.name,
        icon: entry.icon || ICONS.block,
      },
      config: {
        ...ctx.shared,
        t: ctx.t,
        locale: ctx.locale || 'en',
        definition,
        /** Message of the registration's `i18n` for the admin locale. */
        translate: (key, fallback) => (typeof messages[key] === 'string' ? messages[key] : fallback),
        /** Cleans data with the definition (inline HTML through the admin sanitiser). */
        clean: (data) => definition.clean(data, sanitizeInline),
      },
    };
  }
  return out;
};
