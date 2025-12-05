/**
 * Magic Editor X - Admin Entry Point
 * Strapi v5 Custom Field Registration
 * @see https://docs.strapi.io/cms/features/custom-fields
 */
import { PLUGIN_ID } from './pluginId';
import { Initializer } from './components/Initializer';
import { PluginIcon } from './components/PluginIcon';

export default {
  /**
   * Register the plugin and custom field
   */
  register(app) {
    // Register the plugin
    app.registerPlugin({
      id: PLUGIN_ID,
      initializer: Initializer,
      isReady: false,
      name: PLUGIN_ID,
    });

    // Register the Custom Field
    // @see https://docs.strapi.io/cms/features/custom-fields
    app.customFields.register({
      name: 'richtext',
      pluginId: PLUGIN_ID, // Must match server-side plugin name
      type: 'text', // Data type - stores JSON as text
      
      intlLabel: {
        id: `${PLUGIN_ID}.richtext.label`,
        defaultMessage: 'Magic Editor X',
      },
      
      intlDescription: {
        id: `${PLUGIN_ID}.richtext.description`,
        defaultMessage: 'Advanced block-based rich text editor powered by Editor.js',
      },
      
      // Icon must be a React component, not a promise
      icon: PluginIcon,
      
      // Input component for Content Manager
      components: {
        Input: async () => 
          import('./components/EditorJS').then((module) => ({
            default: module.default,
          })),
      },
      
      // Options for Content-Type Builder
      options: {
        base: [
          {
            sectionTitle: {
              id: `${PLUGIN_ID}.richtext.section.editor`,
              defaultMessage: 'Editor Settings',
            },
            items: [
              {
                intlLabel: {
                  id: `${PLUGIN_ID}.richtext.placeholder.label`,
                  defaultMessage: 'Placeholder',
                },
                name: 'options.placeholder',
                type: 'text',
                defaultValue: 'Start writing your content...',
                description: {
                  id: `${PLUGIN_ID}.richtext.placeholder.description`,
                  defaultMessage: 'Placeholder text shown when editor is empty',
                },
              },
            ],
          },
        ],
        advanced: [
          {
            sectionTitle: {
              id: `${PLUGIN_ID}.richtext.section.advanced`,
              defaultMessage: 'Advanced Settings',
            },
            items: [
              {
                intlLabel: {
                  id: `${PLUGIN_ID}.richtext.minHeight.label`,
                  defaultMessage: 'Minimum Height',
                },
                name: 'options.minHeight',
                type: 'number',
                defaultValue: 300,
                description: {
                  id: `${PLUGIN_ID}.richtext.minHeight.description`,
                  defaultMessage: 'Minimum height of the editor in pixels',
                },
              },
            ],
          },
        ],
      },
    });

    // Optional: Add menu link for plugin settings/info page
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: PluginIcon,
      intlLabel: {
        id: `${PLUGIN_ID}.plugin.name`,
        defaultMessage: 'Magic Editor X',
      },
      Component: async () => {
        const { App } = await import('./pages/App');
        return App;
      },
      permissions: [],
    });

    console.log('[Magic Editor X] Custom field registered in admin panel');
  },

  /**
   * Bootstrap the plugin
   */
  async bootstrap(app) {
    // Inject Live Collaboration Panel into Content Manager sidebar (like Session Manager)
    const { default: LiveCollaborationPanel } = await import('./components/LiveCollaborationPanel');
    
    try {
      const contentManagerPlugin = app.getPlugin('content-manager');
      if (contentManagerPlugin && contentManagerPlugin.apis) {
        contentManagerPlugin.apis.addEditViewSidePanel([LiveCollaborationPanel]);
        console.log('[Magic Editor X] [SUCCESS] LiveCollaborationPanel injected into sidebar');
      }
    } catch (error) {
      console.error('[Magic Editor X] Error injecting panel:', error);
    }

    console.log('[Magic Editor X] Plugin bootstrapped');
  },

  /**
   * Register translations
   */
  async registerTrads({ locales }) {
    const importedTrads = await Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = await import(`./translations/${locale}.json`);
          return { data, locale };
        } catch {
          try {
            const { default: data } = await import('./translations/en.json');
          return { data, locale };
        } catch {
          return { data: {}, locale };
          }
        }
      })
    );

    return importedTrads;
  },
};
