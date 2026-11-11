import { PLUGIN_ID } from './pluginId';
import { PluginIcon } from './components/PluginIcon';
import { PERMISSIONS } from './permissions';
import { getTranslation } from './utils/getTranslation';

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
    app.registerPlugin({ id: PLUGIN_ID, name: PLUGIN_ID });

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
            ],
          },
        ],
        advanced: [
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
