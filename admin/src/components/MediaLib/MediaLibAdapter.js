/**
 * Magic Editor X - Media Library Adapter
 * Custom EditorJS tool that opens Strapi's Media Library
 * 
 * IMPORTANT: This is a "trigger" tool - it opens the media library
 * and should be deleted after an image is selected.
 * It should NOT be saved in the document.
 */

export default class MediaLibAdapter {
  // Track if we're currently opening from user action vs restore
  static _isUserAction = false;
  
  /**
   * Toolbox configuration
   */
  static get toolbox() {
    return {
      title: 'Image (Media Library)',
      icon: `<svg xmlns="http://www.w3.org/2000/svg" width="17" height="15" viewBox="0 0 336 276">
        <path d="M291 150.242V79c0-18.778-15.222-34-34-34H79c-18.778 0-34 15.222-34 34v42.264l67.179-44.192 80.398 71.614 56.686-29.14L291 150.242zm-.345 51.622l-42.3-30.246-56.3 29.884-80.773-66.925L45 174.187V197c0 18.778 15.222 34 34 34h178c17.126 0 31.295-12.663 33.655-29.136zM79 0h178c43.63 0 79 35.37 79 79v118c0 43.63-35.37 79-79 79H79c-43.63 0-79-35.37-79-79V79C0 35.37 35.37 0 79 0z"/>
      </svg>`,
    };
  }

  /**
   * Tool is not inline
   */
  static get isInline() {
    return false;
  }

  /**
   * Constructor
   * @param {object} params - Tool parameters
   * @param {object} params.api - EditorJS API
   * @param {object} params.config - Tool config
   * @param {object} params.data - Block data (when restoring from saved state)
   */
  constructor({ api, config, data }) {
    this.api = api;
    this.config = config || {};
    this.data = data || {};
    
    // If we have saved data, this is a restore - don't open media library
    this._isRestore = !!(data && data.type === 'mediaLibraryStrapi');
  }

  /**
   * Render tool
   * Opens Media Library dialog only when user clicks the toolbox
   */
  render() {
    const wrapper = document.createElement('div');
    wrapper.classList.add('media-lib-placeholder');
    
    // Only open media library if this is NOT a restore from saved data
    if (!this._isRestore) {
    const currentIndex = this.api.blocks.getCurrentBlockIndex();

    // Trigger media library open
    if (this.config.mediaLibToggleFunc) {
        // Use setTimeout to ensure the block is fully rendered first
        setTimeout(() => {
      this.config.mediaLibToggleFunc(currentIndex);
        }, 50);
      }
      
      wrapper.innerHTML = '<p style="color: #7C3AED; text-align: center; padding: 20px; font-size: 14px;">📷 Media Library wird geöffnet...</p>';
    } else {
      // This is a restored block that shouldn't exist - delete it
      wrapper.innerHTML = '<p style="color: #999; text-align: center; padding: 10px; font-size: 12px;">⚠️ Ungültiger Block wird entfernt...</p>';
      
      // Auto-delete this invalid block
      setTimeout(() => {
        try {
          const currentIndex = this.api.blocks.getCurrentBlockIndex();
          this.api.blocks.delete(currentIndex);
        } catch (e) {
          console.warn('[Magic Editor X] Could not auto-delete mediaLib block:', e);
        }
      }, 100);
    }
    
    return wrapper;
  }

  /**
   * Save data
   * Returns undefined to prevent saving this placeholder block
   */
  save() {
    // Return undefined/null so this block is NOT saved
    // The actual image block replaces this
    return undefined;
  }

  /**
   * Validate saved data
   * Always return false so this block type is never persisted
   */
  validate(savedData) {
    // Never valid - this is a temporary trigger block
    return false;
  }

  /**
   * Sanitizer config
   */
  static get sanitize() {
    return {
      type: false,
    };
  }
}

