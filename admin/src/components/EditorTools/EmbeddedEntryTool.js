/**
 * EmbeddedEntryTool - Embed Strapi entries into Editor.js content
 * Similar to Contentful's embedded entries feature
 * @see https://editorjs.io/creating-a-block-tool
 */

/**
 * SVG Icons for the tool
 */
const ICONS = {
  toolbox: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8V16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 12H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  linked: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  unlink: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M18.84 12.25l1.72-1.71h-.02a5.004 5.004 0 00-.12-7.07 5.006 5.006 0 00-6.95 0l-1.72 1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5.17 11.75l-1.71 1.71a5.004 5.004 0 00.12 7.07 5.006 5.006 0 006.95 0l1.71-1.71" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 2v3M2 8h3M16 22v-3M19 16h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  refresh: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M23 4v6h-6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M1 20v-6h6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};

/**
 * CSS Styles for the embedded entry block
 */
const STYLES = `
  .embedded-entry-block {
    border: 2px dashed #e2e8f0;
    border-radius: 8px;
    padding: 16px;
    margin: 8px 0;
    background: #f8fafc;
    transition: all 0.2s ease;
  }
  
  .embedded-entry-block:hover {
    border-color: #4945FF;
    background: #f1f5f9;
  }
  
  .embedded-entry-block--selected {
    border-color: #4945FF;
    border-style: solid;
    background: #eef2ff;
  }
  
  .embedded-entry-block__placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 100px;
    cursor: pointer;
    color: #64748b;
  }
  
  .embedded-entry-block__placeholder:hover {
    color: #4945FF;
  }
  
  .embedded-entry-block__placeholder-icon {
    margin-bottom: 8px;
    opacity: 0.7;
  }
  
  .embedded-entry-block__placeholder-text {
    font-size: 14px;
    font-weight: 500;
  }
  
  .embedded-entry-block__placeholder-hint {
    font-size: 12px;
    margin-top: 4px;
    opacity: 0.7;
  }
  
  .embedded-entry-block__preview {
    display: flex;
    align-items: flex-start;
    gap: 12px;
  }
  
  .embedded-entry-block__preview-icon {
    flex-shrink: 0;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: #4945FF;
    color: white;
    border-radius: 8px;
  }
  
  .embedded-entry-block__preview-content {
    flex: 1;
    min-width: 0;
  }
  
  .embedded-entry-block__preview-type {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    color: #4945FF;
    letter-spacing: 0.5px;
    margin-bottom: 4px;
  }
  
  .embedded-entry-block__preview-title {
    font-size: 16px;
    font-weight: 600;
    color: #1e293b;
    margin-bottom: 4px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .embedded-entry-block__preview-fields {
    font-size: 13px;
    color: #64748b;
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  
  .embedded-entry-block__preview-field {
    background: #e2e8f0;
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 12px;
  }
  
  .embedded-entry-block__preview-field-label {
    font-weight: 600;
    margin-right: 4px;
  }
  
  .embedded-entry-block__actions {
    display: flex;
    gap: 4px;
    margin-left: 12px;
  }
  
  .embedded-entry-block__action {
    padding: 6px;
    background: #fff;
    border: 1px solid #e2e8f0;
    border-radius: 4px;
    cursor: pointer;
    color: #64748b;
    transition: all 0.15s ease;
  }
  
  .embedded-entry-block__action:hover {
    background: #f1f5f9;
    color: #4945FF;
    border-color: #4945FF;
  }
  
  .embedded-entry-block__action--danger:hover {
    color: #ef4444;
    border-color: #ef4444;
    background: #fef2f2;
  }
  
  /* Picker Modal Styles */
  .embedded-entry-picker {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0,0,0,0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 999999;
  }
  
  .embedded-entry-picker__modal {
    background: white;
    border-radius: 12px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.2);
    width: 90%;
    max-width: 600px;
    max-height: 80vh;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }
  
  .embedded-entry-picker__header {
    padding: 16px 20px;
    border-bottom: 1px solid #e2e8f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
  }
  
  .embedded-entry-picker__title {
    font-size: 18px;
    font-weight: 600;
    color: #1e293b;
  }
  
  .embedded-entry-picker__close {
    padding: 4px;
    cursor: pointer;
    color: #64748b;
    background: none;
    border: none;
    font-size: 24px;
    line-height: 1;
  }
  
  .embedded-entry-picker__search {
    padding: 12px 20px;
    border-bottom: 1px solid #e2e8f0;
  }
  
  .embedded-entry-picker__search-input {
    width: 100%;
    padding: 10px 14px;
    border: 1px solid #e2e8f0;
    border-radius: 8px;
    font-size: 14px;
    outline: none;
  }
  
  .embedded-entry-picker__search-input:focus {
    border-color: #4945FF;
    box-shadow: 0 0 0 3px rgba(73, 69, 255, 0.1);
  }
  
  .embedded-entry-picker__list {
    flex: 1;
    overflow-y: auto;
    padding: 8px;
  }
  
  .embedded-entry-picker__item {
    padding: 12px 16px;
    border-radius: 8px;
    cursor: pointer;
    display: flex;
    align-items: center;
    gap: 12px;
    transition: background 0.15s ease;
  }
  
  .embedded-entry-picker__item:hover {
    background: #f1f5f9;
  }
  
  .embedded-entry-picker__item-icon {
    width: 36px;
    height: 36px;
    background: #4945FF;
    color: white;
    border-radius: 6px;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  
  .embedded-entry-picker__item-content {
    flex: 1;
    min-width: 0;
  }
  
  .embedded-entry-picker__item-title {
    font-weight: 500;
    color: #1e293b;
    margin-bottom: 2px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  
  .embedded-entry-picker__item-meta {
    font-size: 12px;
    color: #64748b;
  }
  
  .embedded-entry-picker__empty {
    padding: 40px 20px;
    text-align: center;
    color: #64748b;
  }
  
  .embedded-entry-picker__loading {
    padding: 40px 20px;
    text-align: center;
    color: #64748b;
  }
  
  .embedded-entry-picker__error {
    padding: 20px;
    text-align: center;
    color: #ef4444;
    background: #fef2f2;
    margin: 8px;
    border-radius: 8px;
  }
`;

/**
 * EmbeddedEntryTool class
 * Allows embedding Strapi entries (any content type) into Editor.js content
 */
class EmbeddedEntryTool {
  /**
   * Toolbox configuration
   */
  static get toolbox() {
    return {
      title: 'Embedded Entry',
      icon: ICONS.toolbox,
    };
  }

  /**
   * Enable read-only mode support
   */
  static get isReadOnlySupported() {
    return true;
  }

  /**
   * Paste configuration (disabled)
   */
  static get pasteConfig() {
    return false;
  }

  /**
   * Constructor
   * @param {object} params - Editor.js tool params
   * @param {object} params.data - Saved block data
   * @param {object} params.api - Editor.js API
   * @param {object} params.config - Tool configuration
   * @param {boolean} params.readOnly - Read-only mode flag
   */
  constructor({ data, api, config, readOnly }) {
    this.api = api;
    this.readOnly = readOnly;
    this.config = config || {};
    
    // Default configuration
    this.contentType = this.config.contentType || null; // null = any content type
    this.displayFields = this.config.displayFields || ['id', 'title', 'name'];
    this.allowedTypes = this.config.allowedTypes || null; // null = all types
    this.titleField = this.config.titleField || 'title';
    this.previewFields = this.config.previewFields || [];
    
    // Block data
    this.data = {
      entry: data?.entry || null,
      contentType: data?.contentType || this.contentType,
      displayMode: data?.displayMode || 'card', // card, inline, minimal
    };
    
    // DOM elements
    this.wrapper = null;
    this.picker = null;
    
    // Inject styles once
    this._injectStyles();
  }

  /**
   * Inject CSS styles into document
   */
  _injectStyles() {
    const styleId = 'embedded-entry-tool-styles';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = STYLES;
      document.head.appendChild(style);
    }
  }

  /**
   * Render the block
   * @returns {HTMLElement}
   */
  render() {
    this.wrapper = document.createElement('div');
    this.wrapper.classList.add('embedded-entry-block');
    
    if (this.data.entry) {
      this._renderPreview();
    } else {
      this._renderPlaceholder();
    }
    
    return this.wrapper;
  }

  /**
   * Render placeholder (no entry selected)
   */
  _renderPlaceholder() {
    if (this.readOnly) {
      this.wrapper.innerHTML = `
        <div class="embedded-entry-block__placeholder">
          <span class="embedded-entry-block__placeholder-text">No entry selected</span>
        </div>
      `;
      return;
    }
    
    const placeholder = document.createElement('div');
    placeholder.classList.add('embedded-entry-block__placeholder');
    placeholder.innerHTML = `
      <div class="embedded-entry-block__placeholder-icon">${ICONS.toolbox}</div>
      <span class="embedded-entry-block__placeholder-text">Click to embed an entry</span>
      <span class="embedded-entry-block__placeholder-hint">${this.contentType ? this.contentType : 'Select any content type'}</span>
    `;
    
    placeholder.addEventListener('click', () => this._openPicker());
    
    this.wrapper.innerHTML = '';
    this.wrapper.appendChild(placeholder);
  }

  /**
   * Render entry preview
   */
  _renderPreview() {
    const entry = this.data.entry;
    const typeDisplay = this._formatContentType(this.data.contentType || entry.contentType);
    const title = entry[this.titleField] || entry.title || entry.name || `Entry #${entry.id}`;
    
    // Build preview fields HTML
    let fieldsHtml = '';
    const fieldsToShow = this.previewFields.length > 0 ? this.previewFields : this.displayFields;
    fieldsToShow.forEach((field) => {
      if (entry[field] !== undefined && field !== this.titleField) {
        const value = typeof entry[field] === 'object' 
          ? JSON.stringify(entry[field]).substring(0, 50) 
          : String(entry[field]).substring(0, 100);
        fieldsHtml += `
          <span class="embedded-entry-block__preview-field">
            <span class="embedded-entry-block__preview-field-label">${field}:</span>
            ${value}
          </span>
        `;
      }
    });
    
    // Actions HTML (only in edit mode)
    const actionsHtml = this.readOnly ? '' : `
      <div class="embedded-entry-block__actions">
        <button class="embedded-entry-block__action" data-action="change" title="Change entry">
          ${ICONS.refresh}
        </button>
        <button class="embedded-entry-block__action embedded-entry-block__action--danger" data-action="remove" title="Remove entry">
          ${ICONS.unlink}
        </button>
      </div>
    `;
    
    this.wrapper.innerHTML = `
      <div class="embedded-entry-block__preview">
        <div class="embedded-entry-block__preview-icon">
          ${ICONS.linked}
        </div>
        <div class="embedded-entry-block__preview-content">
          <div class="embedded-entry-block__preview-type">${typeDisplay}</div>
          <div class="embedded-entry-block__preview-title">${this._escapeHtml(title)}</div>
          ${fieldsHtml ? `<div class="embedded-entry-block__preview-fields">${fieldsHtml}</div>` : ''}
        </div>
        ${actionsHtml}
      </div>
    `;
    
    // Add event listeners
    if (!this.readOnly) {
      const changeBtn = this.wrapper.querySelector('[data-action="change"]');
      const removeBtn = this.wrapper.querySelector('[data-action="remove"]');
      
      if (changeBtn) {
        changeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._openPicker();
        });
      }
      
      if (removeBtn) {
        removeBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          this._removeEntry();
        });
      }
    }
    
    this.wrapper.classList.add('embedded-entry-block--selected');
  }

  /**
   * Open the entry picker modal
   */
  async _openPicker() {
    if (this.readOnly) return;
    
    this.picker = document.createElement('div');
    this.picker.classList.add('embedded-entry-picker');
    this.picker.innerHTML = `
      <div class="embedded-entry-picker__modal">
        <div class="embedded-entry-picker__header">
          <span class="embedded-entry-picker__title">Select Entry</span>
          <button class="embedded-entry-picker__close">&times;</button>
        </div>
        <div class="embedded-entry-picker__search">
          <input type="text" class="embedded-entry-picker__search-input" placeholder="Search entries...">
        </div>
        <div class="embedded-entry-picker__list">
          <div class="embedded-entry-picker__loading">Loading entries...</div>
        </div>
      </div>
    `;
    
    document.body.appendChild(this.picker);
    
    // Event listeners
    const closeBtn = this.picker.querySelector('.embedded-entry-picker__close');
    const searchInput = this.picker.querySelector('.embedded-entry-picker__search-input');
    
    closeBtn.addEventListener('click', () => this._closePicker());
    this.picker.addEventListener('click', (e) => {
      if (e.target === this.picker) this._closePicker();
    });
    
    // Debounced search
    let searchTimeout;
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        this._loadEntries(searchInput.value);
      }, 300);
    });
    
    // Focus search input
    setTimeout(() => searchInput.focus(), 100);
    
    // Load entries
    await this._loadEntries();
  }

  /**
   * Close the picker modal
   */
  _closePicker() {
    if (this.picker) {
      this.picker.remove();
      this.picker = null;
    }
  }

  /**
   * Load entries from Strapi API
   * @param {string} search - Search query
   */
  async _loadEntries(search = '') {
    const listContainer = this.picker?.querySelector('.embedded-entry-picker__list');
    if (!listContainer) return;
    
    listContainer.innerHTML = '<div class="embedded-entry-picker__loading">Loading entries...</div>';
    
    try {
      // Get authentication token
      const token = this._getAuthToken();
      if (!token) {
        throw new Error('Not authenticated');
      }
      
      // If specific content type is configured, fetch from that API
      // Otherwise, fetch available content types first
      let entries = [];
      
      if (this.contentType) {
        entries = await this._fetchContentTypeEntries(this.contentType, search, token);
      } else {
        // Fetch all available content types
        const contentTypes = await this._fetchContentTypes(token);
        
        // For each allowed content type, fetch a few entries
        for (const ct of contentTypes) {
          if (this.allowedTypes && !this.allowedTypes.includes(ct.uid)) continue;
          
          const ctEntries = await this._fetchContentTypeEntries(ct.uid, search, token, 5);
          entries = entries.concat(ctEntries.map((e) => ({ ...e, contentType: ct.uid })));
        }
      }
      
      // Render entries
      if (entries.length === 0) {
        listContainer.innerHTML = '<div class="embedded-entry-picker__empty">No entries found</div>';
        return;
      }
      
      listContainer.innerHTML = '';
      entries.forEach((entry) => {
        const item = this._createEntryItem(entry);
        listContainer.appendChild(item);
      });
      
    } catch (error) {
      console.error('[EmbeddedEntryTool] Error loading entries:', error);
      listContainer.innerHTML = `<div class="embedded-entry-picker__error">Error: ${error.message}</div>`;
    }
  }

  /**
   * Fetch content types from Strapi
   * @param {string} token - Auth token
   * @returns {Array}
   */
  async _fetchContentTypes(token) {
    try {
      const response = await fetch('/api/magic-editor-x/content-types', {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (!response.ok) throw new Error('Failed to fetch content types');
      
      const data = await response.json();
      return data.contentTypes || [];
    } catch (error) {
      console.error('[EmbeddedEntryTool] Error fetching content types:', error);
      return [];
    }
  }

  /**
   * Fetch entries from a specific content type
   * @param {string} contentType - Content type UID
   * @param {string} search - Search query
   * @param {string} token - Auth token
   * @param {number} limit - Max entries to fetch
   * @returns {Array}
   */
  async _fetchContentTypeEntries(contentType, search, token, limit = 20) {
    try {
      // Build query params
      const params = new URLSearchParams({
        'pagination[pageSize]': limit.toString(),
      });
      
      if (search) {
        params.append('filters[$or][0][title][$containsi]', search);
        params.append('filters[$or][1][name][$containsi]', search);
      }
      
      // Convert content type UID to API endpoint
      const apiPath = this._contentTypeToApiPath(contentType);
      
      const response = await fetch(`/api/${apiPath}?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      });
      
      if (!response.ok) {
        // Skip this content type if not accessible
        return [];
      }
      
      const data = await response.json();
      
      // Handle both array and object responses
      let entries = [];
      if (Array.isArray(data)) {
        entries = data;
      } else if (data.data) {
        entries = Array.isArray(data.data) ? data.data : [data.data];
      }
      
      return entries.map((entry) => ({
        ...entry,
        contentType: contentType,
      }));
      
    } catch (error) {
      console.error(`[EmbeddedEntryTool] Error fetching ${contentType}:`, error);
      return [];
    }
  }

  /**
   * Convert content type UID to API path
   * @param {string} uid - Content type UID (e.g., api::article.article)
   * @returns {string} API path (e.g., articles)
   */
  _contentTypeToApiPath(uid) {
    // api::article.article -> article -> articles
    const parts = uid.split('::');
    if (parts.length > 1) {
      const name = parts[1].split('.')[0];
      // Pluralize (simple version)
      return name.endsWith('s') ? name : `${name}s`;
    }
    return uid;
  }

  /**
   * Create entry list item element
   * @param {object} entry - Entry data
   * @returns {HTMLElement}
   */
  _createEntryItem(entry) {
    const item = document.createElement('div');
    item.classList.add('embedded-entry-picker__item');
    
    const title = entry.title || entry.name || entry.label || `Entry #${entry.id}`;
    const type = this._formatContentType(entry.contentType);
    
    item.innerHTML = `
      <div class="embedded-entry-picker__item-icon">${ICONS.linked}</div>
      <div class="embedded-entry-picker__item-content">
        <div class="embedded-entry-picker__item-title">${this._escapeHtml(title)}</div>
        <div class="embedded-entry-picker__item-meta">${type} · ID: ${entry.documentId || entry.id}</div>
      </div>
    `;
    
    item.addEventListener('click', () => {
      this._selectEntry(entry);
    });
    
    return item;
  }

  /**
   * Select an entry
   * @param {object} entry - Entry data
   */
  _selectEntry(entry) {
    this.data.entry = entry;
    this.data.contentType = entry.contentType;
    
    this._closePicker();
    this._renderPreview();
    
    // Trigger block change
    this.api.blocks.update(this.api.blocks.getCurrentBlockIndex(), this.data);
  }

  /**
   * Remove selected entry
   */
  _removeEntry() {
    this.data.entry = null;
    this.wrapper.classList.remove('embedded-entry-block--selected');
    this._renderPlaceholder();
  }

  /**
   * Format content type UID to display name
   * @param {string} uid - Content type UID
   * @returns {string}
   */
  _formatContentType(uid) {
    if (!uid) return 'Unknown Type';
    
    // api::article.article -> Article
    const parts = uid.split('::');
    if (parts.length > 1) {
      const name = parts[1].split('.')[0];
      return name.charAt(0).toUpperCase() + name.slice(1);
    }
    return uid;
  }

  /**
   * Escape HTML special characters
   * @param {string} text - Text to escape
   * @returns {string}
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Get authentication token from storage
   * @returns {string|null}
   */
  _getAuthToken() {
    try {
      const token = sessionStorage.getItem('jwtToken');
      if (token) return JSON.parse(token);
      
      const localToken = localStorage.getItem('jwtToken');
      if (localToken) return JSON.parse(localToken);
      
      return null;
    } catch (e) {
      return null;
    }
  }

  /**
   * Save block data
   * @returns {object}
   */
  save() {
    return {
      entry: this.data.entry ? {
        id: this.data.entry.id,
        documentId: this.data.entry.documentId,
        title: this.data.entry.title || this.data.entry.name,
        ...this._extractDisplayFields(this.data.entry),
      } : null,
      contentType: this.data.contentType,
      displayMode: this.data.displayMode,
    };
  }

  /**
   * Extract configured display fields from entry
   * @param {object} entry - Entry data
   * @returns {object}
   */
  _extractDisplayFields(entry) {
    const result = {};
    this.displayFields.forEach((field) => {
      if (entry[field] !== undefined) {
        result[field] = entry[field];
      }
    });
    return result;
  }

  /**
   * Validate saved data
   * @param {object} savedData - Data to validate
   * @returns {boolean}
   */
  validate(savedData) {
    // Allow empty blocks (placeholder shown)
    return true;
  }
}

export default EmbeddedEntryTool;

