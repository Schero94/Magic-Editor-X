/**
 * Magic Editor X - Webtools Links Integration Hook
 * Optional integration with @pluginpal/webtools-addon-links
 * 
 * This hook detects if the Webtools Links addon is installed and provides
 * access to the openLinkPicker API for selecting internal/external links.
 */
import { useStrapiApp } from '@strapi/strapi/admin';
import { useCallback, useMemo } from 'react';

/**
 * Hook to integrate with Webtools Link Picker
 * @returns {object} { isAvailable, openLinkPicker }
 */
export const useWebtoolsLinks = () => {
  // Access the Strapi plugin registry
  const getPlugin = useStrapiApp('WebtoolsLinks', (state) => state.getPlugin);
  
  // Try to get the webtools-addon-links plugin
  const linksPlugin = useMemo(() => {
    try {
      return getPlugin?.('webtools-addon-links');
    } catch (e) {
      // Plugin not installed - this is expected
      return null;
    }
  }, [getPlugin]);

  // Check if the openLinkPicker API is available
  const isAvailable = useMemo(() => {
    const available = !!(linksPlugin?.apis?.openLinkPicker);
    // Log status on first check for debugging
    if (typeof window !== 'undefined' && !window.__WEBTOOLS_LINKS_CHECKED__) {
      window.__WEBTOOLS_LINKS_CHECKED__ = true;
      if (available) {
        console.log('[Magic Editor X] [SUCCESS] Webtools Links addon detected - Link Picker enabled');
      } else {
        console.log('[Magic Editor X] [INFO] Webtools Links addon not installed - Link Picker disabled');
      }
    }
    return available;
  }, [linksPlugin]);

  /**
   * Open the Webtools Link Picker modal
   * @param {object} options - Picker options
   * @param {string} options.initialHref - Pre-fill the href field
   * @param {string} options.initialText - Pre-fill the link text
   * @returns {Promise<{href: string, label: string}|null>} Selected link or null if cancelled
   */
  const openLinkPicker = useCallback(async ({ initialHref = '', initialText = '' } = {}) => {
    if (!linksPlugin?.apis?.openLinkPicker) {
      console.warn('[Magic Editor X] Webtools Link Picker not available');
      return null;
    }

    // Debug: Log what we're passing to the picker
    console.log('[Magic Editor X] Opening Webtools Link Picker with:', {
      linkType: 'both',
      initialHref: initialHref || '(empty)',
      initialText: initialText || '(empty)',
    });

    try {
      const result = await linksPlugin.apis.openLinkPicker({
        linkType: 'both', // Allow both internal and external links
        initialHref: initialHref || '',
        initialText: initialText || '',
      });

      // Result contains { href, label } when submitted, or null/undefined when cancelled
      console.log('[Magic Editor X] Webtools picker result:', result);
      
      if (result && result.href) {
        console.log('[Magic Editor X] Webtools link selected:', result);
        return {
          href: result.href,
          label: result.label || initialText || '',
        };
      }

      return null;
    } catch (error) {
      console.error('[Magic Editor X] Error opening Webtools Link Picker:', error);
      return null;
    }
  }, [linksPlugin]);

  return {
    isAvailable,
    openLinkPicker,
  };
};

export default useWebtoolsLinks;
