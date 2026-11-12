import { PLUGIN_ID } from './pluginId';
import { PluginIcon } from './components/PluginIcon';
import { PERMISSIONS } from './permissions';
import { getTranslation } from './utils/getTranslation';
import { registerBlock } from './editor/block-registry';
import { createReactTool } from './editor/react-tool';

/**
 * Translations are split by area (common, editor, tools, settings); each
 * locale loads and merges its four files. English is the fallback.
 */
const LOADERS = {
  en: () => [
    import('./translations/common/en.json'),
    import('./translations/editor/en.json'),
    import('./translations/tools/en.json'),
    import('./translations/settings/en.json'),
  ],
  de: () => [
    import('./translations/common/de.json'),
    import('./translations/editor/de.json'),
    import('./translations/tools/de.json'),
    import('./translations/settings/de.json'),
  ],
  fr: () => [
    import('./translations/common/fr.json'),
    import('./translations/editor/fr.json'),
    import('./translations/tools/fr.json'),
    import('./translations/settings/fr.json'),
  ],
  es: () => [
    import('./translations/common/es.json'),
    import('./translations/editor/es.json'),
    import('./translations/tools/es.json'),
    import('./translations/settings/es.json'),
  ],
  pt: () => [
    import('./translations/common/pt.json'),
    import('./translations/editor/pt.json'),
    import('./translations/tools/pt.json'),
    import('./translations/settings/pt.json'),
  ],
};

/** Field presets offered in the Content-Type Builder (shared/presets.mjs). */
const PRESET_OPTIONS = [
  { value: 'full', label: ['field.options.preset.full', 'Full: every block and formatting'] },
  { value: 'article', label: ['field.options.preset.article', 'Article: long-form text without raw HTML'] },
  { value: 'basic', label: ['field.options.preset.basic', 'Basic: headings 2-3, lists, quotes, images'] },
  {
    value: 'minimal',
    label: ['field.options.preset.minimal', 'Minimal: paragraphs, lists, bold, italic, links'],
  },
];

/** Allowed link targets offered in the Content-Type Builder. */
const LINK_OPTIONS = [
  { value: 'all', label: ['field.options.linkTargets.all', 'Entries and web addresses'] },
  { value: 'internal', label: ['field.options.linkTargets.internal', 'Only entries of this site'] },
  { value: 'external', label: ['field.options.linkTargets.external', 'Only web addresses'] },
  { value: 'none', label: ['field.options.linkTargets.none', 'No links'] },
];

/**
 * Loads and merges the translation files of one locale.
 * @param {string} locale - Admin locale.
 * @returns {Promise<Record<string, string>>} Messages with plugin-prefixed ids.
 */
const loadMessages = async (locale) => {
  const loader = LOADERS[locale] || LOADERS[locale.split('-')[0]] || LOADERS.en;
  const modules = await Promise.all(loader());
  const merged = Object.assign({}, ...modules.map((module) => module.default || module));
  return Object.fromEntries(Object.entries(merged).map(([key, value]) => [getTranslation(key), value]));
};

export default {
  /**
   * Registers the plugin, the custom field and the settings links.
   * @param {object} app - Strapi admin app.
   */
  register(app) {
    // `apis` (Strapi admin plugin API): the custom block SDK for the host app's
    // `src/admin/app.js`: `app.getPlugin('magic-editor-x').apis.registerBlock({ definition, tool })`.
    app.registerPlugin({ id: PLUGIN_ID, name: PLUGIN_ID, apis: { registerBlock, createReactTool } });

    app.customFields.register({
      name: 'richtext',
      pluginId: PLUGIN_ID,
      type: 'json',
      intlLabel: { id: getTranslation('field.label'), defaultMessage: 'Magic Editor X' },
      intlDescription: {
        id: getTranslation('field.description'),
        defaultMessage: 'Block editor with media, embeds, custom blocks, history and live collaboration',
      },
      icon: PluginIcon,
      components: {
        Input: () => import('./components/EditorField'),
      },
      options: {
        base: [
          {
            sectionTitle: { id: getTranslation('field.options.section'), defaultMessage: 'Editor' },
            items: [
              {
                intlLabel: {
                  id: getTranslation('field.options.placeholder.label'),
                  defaultMessage: 'Placeholder',
                },
                description: {
                  id: getTranslation('field.options.placeholder.description'),
                  defaultMessage: 'Text shown while the editor is empty',
                },
                name: 'options.placeholder',
                type: 'text',
              },
              {
                intlLabel: { id: getTranslation('field.options.preset.label'), defaultMessage: 'Preset' },
                description: {
                  id: getTranslation('field.options.preset.description'),
                  defaultMessage:
                    'Which blocks and formatting editors can use in this field. Enforced when saving.',
                },
                name: 'options.preset',
                type: 'select',
                options: PRESET_OPTIONS.map(({ value, label: [id, defaultMessage] }) => ({
                  key: value,
                  value,
                  metadatas: { intlLabel: { id: getTranslation(id), defaultMessage } },
                })),
              },
              {
                intlLabel: {
                  id: getTranslation('field.options.linkTargets.label'),
                  defaultMessage: 'Allowed links',
                },
                description: {
                  id: getTranslation('field.options.linkTargets.description'),
                  defaultMessage: 'Links to entries of this site, to web addresses, both or none',
                },
                name: 'options.linkTargets',
                type: 'select',
                options: LINK_OPTIONS.map(({ value, label: [id, defaultMessage] }) => ({
                  key: value,
                  value,
                  metadatas: { intlLabel: { id: getTranslation(id), defaultMessage } },
                })),
              },
              {
                intlLabel: {
                  id: getTranslation('field.options.requireAlt.label'),
                  defaultMessage: 'Require alternative text for images',
                },
                description: {
                  id: getTranslation('field.options.requireAlt.description'),
                  defaultMessage: 'Images need a text description or must be marked as decorative',
                },
                name: 'options.requireAlt',
                type: 'checkbox',
              },
            ],
          },
        ],
        advanced: [
          {
            sectionTitle: {
              id: getTranslation('field.options.content'),
              defaultMessage: 'Allowed content and limits',
            },
            items: [
              {
                intlLabel: {
                  id: getTranslation('field.options.allowedBlocks.label'),
                  defaultMessage: 'Allowed blocks',
                },
                description: {
                  id: getTranslation('field.options.allowedBlocks.description'),
                  defaultMessage:
                    'Comma-separated block names that replace the preset list, for example: paragraph, header, list, image, myCustomBlock',
                },
                name: 'options.allowedBlocks',
                type: 'text',
              },
              {
                intlLabel: {
                  id: getTranslation('field.options.headingLevels.label'),
                  defaultMessage: 'Heading levels',
                },
                description: {
                  id: getTranslation('field.options.headingLevels.description'),
                  defaultMessage: 'For example 2-4 or 2,3. Empty uses the preset.',
                },
                name: 'options.headingLevels',
                type: 'text',
              },
              {
                intlLabel: {
                  id: getTranslation('field.options.maxBlocks.label'),
                  defaultMessage: 'Maximum number of blocks',
                },
                description: {
                  id: getTranslation('field.options.maxBlocks.description'),
                  defaultMessage: 'Empty or 0 means no limit',
                },
                name: 'options.maxBlocks',
                type: 'number',
              },
              {
                intlLabel: {
                  id: getTranslation('field.options.maxCharacters.label'),
                  defaultMessage: 'Maximum number of characters',
                },
                description: {
                  id: getTranslation('field.options.maxCharacters.description'),
                  defaultMessage: 'Visible text, counted like the editor toolbar. Empty or 0 means no limit.',
                },
                name: 'options.maxCharacters',
                type: 'number',
              },
            ],
          },
          {
            sectionTitle: { id: getTranslation('field.options.features'), defaultMessage: 'Features' },
            items: [
              {
                intlLabel: {
                  id: getTranslation('field.options.disableAi.label'),
                  defaultMessage: 'Turn off the AI assistant for this field',
                },
                name: 'options.disableAi',
                type: 'checkbox',
              },
              {
                intlLabel: {
                  id: getTranslation('field.options.disableGrammar.label'),
                  defaultMessage: 'Turn off the grammar check for this field',
                },
                description: {
                  id: getTranslation('field.options.disableGrammar.description'),
                  defaultMessage: 'No text from this field is sent to LanguageTool',
                },
                name: 'options.disableGrammar',
                type: 'checkbox',
              },
              {
                intlLabel: {
                  id: getTranslation('field.options.disableCollaboration.label'),
                  defaultMessage: 'Turn off live collaboration for this field',
                },
                name: 'options.disableCollaboration',
                type: 'checkbox',
              },
              {
                intlLabel: {
                  id: getTranslation('field.options.publishGuard.label'),
                  defaultMessage: 'Block publishing while quality checks report errors',
                },
                description: {
                  id: getTranslation('field.options.publishGuard.description'),
                  defaultMessage: 'Errors are missing alternative texts (when required) and empty links',
                },
                name: 'options.publishGuard',
                type: 'checkbox',
              },
            ],
          },
          {
            sectionTitle: { id: getTranslation('field.options.advanced'), defaultMessage: 'Layout' },
            items: [
              {
                intlLabel: {
                  id: getTranslation('field.options.minHeight.label'),
                  defaultMessage: 'Minimum height (px)',
                },
                description: {
                  id: getTranslation('field.options.minHeight.description'),
                  defaultMessage: 'Height of the empty editor, between 120 and 2000 pixels',
                },
                name: 'options.minHeight',
                type: 'number',
              },
            ],
          },
        ],
      },
    });

    app.addSettingsLink(
      {
        id: PLUGIN_ID,
        intlLabel: { id: getTranslation('settings.section'), defaultMessage: 'Magic Editor X' },
      },
      [
        {
          id: `${PLUGIN_ID}-configuration`,
          intlLabel: { id: getTranslation('settings.link.configuration'), defaultMessage: 'Configuration' },
          to: `${PLUGIN_ID}/configuration`,
          permissions: PERMISSIONS.settingsRead,
          Component: () => import('./pages/ConfigurationPage'),
        },
        {
          id: `${PLUGIN_ID}-custom-blocks`,
          intlLabel: { id: getTranslation('settings.link.customBlocks'), defaultMessage: 'Custom blocks' },
          to: `${PLUGIN_ID}/custom-blocks`,
          permissions: PERMISSIONS.customBlocksManage,
          Component: () => import('./pages/CustomBlocksPage'),
        },
        {
          id: `${PLUGIN_ID}-templates`,
          intlLabel: { id: getTranslation('settings.link.templates'), defaultMessage: 'Templates' },
          to: `${PLUGIN_ID}/templates`,
          permissions: PERMISSIONS.templatesManage,
          Component: () => import('./pages/TemplatesPage'),
        },
      ]
    );
  },

  bootstrap() {},

  /**
   * @param {{ locales: string[] }} options - Admin locales.
   * @returns {Promise<Array<{ data: object, locale: string }>>} Translations.
   */
  async registerTrads({ locales }) {
    return Promise.all(
      locales.map(async (locale) => {
        try {
          return { data: await loadMessages(locale), locale };
        } catch {
          return { data: {}, locale };
        }
      })
    );
  },
};
