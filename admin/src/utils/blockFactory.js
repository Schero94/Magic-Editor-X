/**
 * Block Factory - Dynamically generates Editor.js block classes from configuration
 * Supports both simple text/HTML blocks and embedded Strapi entries
 */

import EmbeddedEntryTool from '../components/EditorTools/EmbeddedEntryTool';

/**
 * Default icons for different block types
 */
const DEFAULT_ICONS = {
  simple: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M7 8h10M7 12h6M7 16h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  'embedded-entry': '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M19 3H5C3.89543 3 3 3.89543 3 5V19C3 20.1046 3.89543 21 5 21H19C20.1046 21 21 20.1046 21 19V5C21 3.89543 20.1046 3 19 3Z" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8V16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 12H16" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  html: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M16 18L22 12L16 6" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M8 6L2 12L8 18" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  card: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 10h18" stroke="currentColor" stroke-width="2"/></svg>',
};

/**
 * Create a block class from configuration stored in database
 * @param {object} blockConfig - Block configuration from database
 * @returns {object} - Editor.js tool configuration object
 */
export function createBlockClass(blockConfig) {
  if (!blockConfig || !blockConfig.name) {
    console.warn('[BlockFactory] Invalid block configuration:', blockConfig);
    return null;
  }

  switch (blockConfig.blockType) {
    case 'embedded-entry':
      return createEmbeddedEntryBlock(blockConfig);
    case 'simple':
    default:
      return createSimpleBlock(blockConfig);
  }
}

/**
 * Create an embedded entry block class
 * Uses the base EmbeddedEntryTool with custom configuration
 * @param {object} config - Block configuration
 * @returns {object} - Editor.js tool configuration
 */
export function createEmbeddedEntryBlock(config) {
  // Create a subclass with custom toolbox
  class CustomEmbeddedEntryTool extends EmbeddedEntryTool {
    static get toolbox() {
      return {
        title: config.label || config.name,
        icon: config.icon || DEFAULT_ICONS['embedded-entry'],
      };
    }
  }

  return {
    name: config.name,
    class: CustomEmbeddedEntryTool,
    config: {
      contentType: config.contentType,
      displayFields: config.displayFields || ['title', 'name', 'id'],
      titleField: config.titleField || 'title',
      previewFields: config.previewFields || [],
      allowedTypes: config.allowedTypes || null,
    },
    inlineToolbar: false,
    tunes: config.tunes || [],
    shortcut: config.shortcut || null,
  };
}

/**
 * Create a simple text/HTML block class
 * @param {object} config - Block configuration
 * @returns {object} - Editor.js tool configuration
 */
export function createSimpleBlock(config) {
  /**
   * Simple Block Tool class
   * Renders a configurable text/HTML block
   */
  class SimpleBlockTool {
    /**
     * Toolbox configuration
     */
    static get toolbox() {
      return {
        title: config.label || config.name,
        icon: config.icon || DEFAULT_ICONS.simple,
      };
    }

    /**
     * Enable read-only mode
     */
    static get isReadOnlySupported() {
      return true;
    }

    /**
     * Constructor
     * @param {object} params - Editor.js tool params
     */
    constructor({ data, api, readOnly }) {
      this.api = api;
      this.readOnly = readOnly;
      this.config = config;
      
      // Initialize data with defaults from config
      this.data = {
        content: data?.content || '',
        ...this._getDefaultFieldValues(),
        ...data,
      };
      
      this.wrapper = null;
    }

    /**
     * Get default values for configured fields
     * @returns {object}
     */
    _getDefaultFieldValues() {
      const defaults = {};
      if (config.fields) {
        config.fields.forEach((field) => {
          if (field.default !== undefined) {
            defaults[field.name] = field.default;
          }
        });
      }
      return defaults;
    }

    /**
     * Render the block
     * @returns {HTMLElement}
     */
    render() {
      this.wrapper = document.createElement('div');
      this.wrapper.classList.add('simple-block', `simple-block--${config.name}`);
      
      // Apply custom styles if defined
      if (config.styles) {
        Object.assign(this.wrapper.style, config.styles);
      }

      // Render based on template or default
      if (config.template) {
        this._renderFromTemplate();
      } else {
        this._renderDefault();
      }

      return this.wrapper;
    }

    /**
     * Render from HTML template
     */
    _renderFromTemplate() {
      // Replace placeholders in template with data values
      let html = config.template;
      
      // Replace {{fieldName}} placeholders
      Object.keys(this.data).forEach((key) => {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, 'g');
        html = html.replace(regex, this._escapeHtml(String(this.data[key])));
      });
      
      this.wrapper.innerHTML = html;
      
      // Make editable fields contenteditable
      if (!this.readOnly && config.fields) {
        config.fields.forEach((field) => {
          const el = this.wrapper.querySelector(`[data-field="${field.name}"]`);
          if (el && field.editable !== false) {
            el.contentEditable = true;
            el.addEventListener('blur', () => {
              this.data[field.name] = el.textContent;
            });
          }
        });
      }
    }

    /**
     * Render default layout
     */
    _renderDefault() {
      // Default styles
      this.wrapper.style.cssText = `
        border: 2px dashed #e2e8f0;
        border-radius: 8px;
        padding: 16px;
        margin: 8px 0;
        background: #f8fafc;
      `;
      
      // Create header with block name
      const header = document.createElement('div');
      header.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        text-transform: uppercase;
        color: #4945FF;
        margin-bottom: 8px;
        letter-spacing: 0.5px;
      `;
      header.textContent = config.label || config.name;
      this.wrapper.appendChild(header);
      
      // Create content area
      const content = document.createElement('div');
      content.className = 'simple-block__content';
      content.contentEditable = !this.readOnly;
      content.style.cssText = `
        min-height: 40px;
        outline: none;
        font-size: 14px;
        color: #1e293b;
      `;
      content.textContent = this.data.content || '';
      content.dataset.placeholder = config.placeholder || 'Enter content...';
      
      // Handle empty state
      if (!this.data.content) {
        content.style.color = '#94a3b8';
        content.textContent = config.placeholder || 'Enter content...';
      }
      
      // Event listeners
      content.addEventListener('focus', () => {
        if (!this.data.content) {
          content.textContent = '';
          content.style.color = '#1e293b';
        }
      });
      
      content.addEventListener('blur', () => {
        this.data.content = content.textContent;
        if (!this.data.content) {
          content.style.color = '#94a3b8';
          content.textContent = config.placeholder || 'Enter content...';
        }
      });
      
      this.wrapper.appendChild(content);
      
      // Render additional fields
      if (config.fields) {
        config.fields.forEach((field) => {
          this.wrapper.appendChild(this._createFieldInput(field));
        });
      }
    }

    /**
     * Create input for a field
     * @param {object} field - Field configuration
     * @returns {HTMLElement}
     */
    _createFieldInput(field) {
      const container = document.createElement('div');
      container.style.cssText = 'margin-top: 12px;';
      
      const label = document.createElement('label');
      label.style.cssText = `
        display: block;
        font-size: 12px;
        font-weight: 500;
        color: #64748b;
        margin-bottom: 4px;
      `;
      label.textContent = field.label || field.name;
      container.appendChild(label);
      
      let input;
      
      switch (field.type) {
        case 'select':
          input = document.createElement('select');
          input.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            font-size: 14px;
            background: white;
          `;
          (field.options || []).forEach((opt) => {
            const option = document.createElement('option');
            option.value = typeof opt === 'object' ? opt.value : opt;
            option.textContent = typeof opt === 'object' ? opt.label : opt;
            if (option.value === this.data[field.name]) {
              option.selected = true;
            }
            input.appendChild(option);
          });
          input.addEventListener('change', () => {
            this.data[field.name] = input.value;
          });
          break;
          
        case 'color':
          input = document.createElement('input');
          input.type = 'color';
          input.value = this.data[field.name] || '#4945FF';
          input.style.cssText = `
            width: 100%;
            height: 40px;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            cursor: pointer;
          `;
          input.addEventListener('change', () => {
            this.data[field.name] = input.value;
          });
          break;
          
        case 'checkbox':
          input = document.createElement('input');
          input.type = 'checkbox';
          input.checked = this.data[field.name] || false;
          input.style.cssText = `
            width: 18px;
            height: 18px;
            cursor: pointer;
          `;
          input.addEventListener('change', () => {
            this.data[field.name] = input.checked;
          });
          break;
          
        case 'textarea':
          input = document.createElement('textarea');
          input.value = this.data[field.name] || '';
          input.rows = 3;
          input.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            font-size: 14px;
            resize: vertical;
            font-family: inherit;
          `;
          input.addEventListener('blur', () => {
            this.data[field.name] = input.value;
          });
          break;
          
        case 'image':
          input = this._createImageField(field);
          break;
          
        default: // text input
          input = document.createElement('input');
          input.type = field.type || 'text';
          input.value = this.data[field.name] || '';
          input.placeholder = field.placeholder || '';
          input.style.cssText = `
            width: 100%;
            padding: 8px 12px;
            border: 1px solid #e2e8f0;
            border-radius: 6px;
            font-size: 14px;
          `;
          input.addEventListener('blur', () => {
            this.data[field.name] = input.value;
          });
      }
      
      if (this.readOnly && input) {
        input.disabled = true;
      }
      
      container.appendChild(input);
      return container;
    }

    /**
     * Create image field with Media Library integration
     * @param {object} field - Field configuration
     * @returns {HTMLElement}
     */
    _createImageField(field) {
      const wrapper = document.createElement('div');
      wrapper.style.cssText = `
        border: 2px dashed #e2e8f0;
        border-radius: 8px;
        padding: 16px;
        text-align: center;
        background: #fafbfc;
        transition: all 0.2s ease;
      `;
      
      // Image preview
      const preview = document.createElement('div');
      preview.className = 'image-preview';
      preview.style.cssText = `
        margin-bottom: 12px;
        min-height: 60px;
        display: flex;
        align-items: center;
        justify-content: center;
      `;
      
      const img = document.createElement('img');
      img.style.cssText = `
        max-width: 100%;
        max-height: 150px;
        border-radius: 6px;
        display: none;
      `;
      
      const placeholder = document.createElement('div');
      placeholder.innerHTML = `
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="1.5">
          <rect x="3" y="3" width="18" height="18" rx="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <path d="M21 15l-5-5L5 21"/>
        </svg>
        <p style="margin: 8px 0 0; color: #94a3b8; font-size: 13px;">No image selected</p>
      `;
      placeholder.style.cssText = 'text-align: center;';
      
      preview.appendChild(img);
      preview.appendChild(placeholder);
      
      // Update preview based on current data
      const updatePreview = (url) => {
        if (url) {
          img.src = url;
          img.style.display = 'block';
          placeholder.style.display = 'none';
          wrapper.style.borderStyle = 'solid';
          wrapper.style.borderColor = '#c4b5fd';
        } else {
          img.style.display = 'none';
          placeholder.style.display = 'block';
          wrapper.style.borderStyle = 'dashed';
          wrapper.style.borderColor = '#e2e8f0';
        }
      };
      
      // Initial state
      const currentValue = this.data[field.name];
      if (currentValue && typeof currentValue === 'object') {
        updatePreview(currentValue.url);
      } else if (typeof currentValue === 'string' && currentValue) {
        updatePreview(currentValue);
      }
      
      // Buttons container
      const buttons = document.createElement('div');
      buttons.style.cssText = 'display: flex; gap: 8px; justify-content: center;';
      
      // Select button
      const selectBtn = document.createElement('button');
      selectBtn.type = 'button';
      selectBtn.textContent = 'Select Image';
      selectBtn.style.cssText = `
        padding: 8px 16px;
        background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
        color: white;
        border: none;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
      `;
      selectBtn.addEventListener('mouseenter', () => {
        selectBtn.style.transform = 'translateY(-1px)';
        selectBtn.style.boxShadow = '0 4px 12px rgba(124, 58, 237, 0.35)';
      });
      selectBtn.addEventListener('mouseleave', () => {
        selectBtn.style.transform = 'translateY(0)';
        selectBtn.style.boxShadow = 'none';
      });
      
      // Remove button
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.style.cssText = `
        padding: 8px 16px;
        background: transparent;
        color: #ef4444;
        border: 1px solid #fecaca;
        border-radius: 6px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.2s ease;
        display: ${this.data[field.name] ? 'inline-block' : 'none'};
      `;
      removeBtn.addEventListener('click', () => {
        this.data[field.name] = null;
        updatePreview(null);
        removeBtn.style.display = 'none';
      });
      
      // Handle select button click - dispatch custom event
      selectBtn.addEventListener('click', () => {
        if (this.readOnly) return;
        
        // Create a unique callback ID
        const callbackId = `image_field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        // Store callback globally for Media Library to call
        window.__MAGIC_EDITOR_IMAGE_CALLBACKS__ = window.__MAGIC_EDITOR_IMAGE_CALLBACKS__ || {};
        window.__MAGIC_EDITOR_IMAGE_CALLBACKS__[callbackId] = (files) => {
          if (files && files.length > 0) {
            const file = files[0];
            const imageData = {
              url: file.url,
              alt: file.alt || file.name || '',
              width: file.width,
              height: file.height,
              id: file.id,
              documentId: file.documentId,
            };
            this.data[field.name] = imageData;
            updatePreview(imageData.url);
            removeBtn.style.display = 'inline-block';
          }
          // Cleanup
          delete window.__MAGIC_EDITOR_IMAGE_CALLBACKS__[callbackId];
        };
        
        // Dispatch event to open Media Library
        window.dispatchEvent(new CustomEvent('magic-editor-open-media-lib', {
          detail: { callbackId, fieldName: field.name, allowedTypes: ['images'] }
        }));
      });
      
      buttons.appendChild(selectBtn);
      buttons.appendChild(removeBtn);
      
      wrapper.appendChild(preview);
      if (!this.readOnly) {
        wrapper.appendChild(buttons);
      }
      
      return wrapper;
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
     * Save block data
     * @returns {object}
     */
    save() {
      return {
        ...this.data,
        blockType: 'simple',
        blockName: config.name,
      };
    }

    /**
     * Validate block data
     * @returns {boolean}
     */
    validate() {
      // Check required fields
      if (config.fields) {
        for (const field of config.fields) {
          if (field.required && !this.data[field.name]) {
            return false;
          }
        }
      }
      return true;
    }
  }

  return {
    name: config.name,
    class: SimpleBlockTool,
    config: {},
    inlineToolbar: config.inlineToolbar !== false,
    tunes: config.tunes || [],
    shortcut: config.shortcut || null,
  };
}

/**
 * Create multiple block classes from configurations
 * @param {Array} blockConfigs - Array of block configurations
 * @returns {Array} - Array of Editor.js tool configurations
 */
export function createBlockClasses(blockConfigs) {
  if (!Array.isArray(blockConfigs)) {
    return [];
  }
  
  return blockConfigs
    .map(createBlockClass)
    .filter(Boolean);
}

/**
 * Merge custom blocks with existing tools
 * @param {object} tools - Existing Editor.js tools
 * @param {Array} customBlocks - Array of custom block configurations
 * @returns {object} - Merged tools object
 */
export function mergeCustomBlocks(tools, customBlocks) {
  const mergedTools = { ...tools };
  
  const blockClasses = createBlockClasses(customBlocks);
  blockClasses.forEach((block) => {
    if (block && block.name) {
      mergedTools[block.name] = {
        class: block.class,
        config: block.config || {},
        inlineToolbar: block.inlineToolbar,
        tunes: block.tunes,
        shortcut: block.shortcut,
      };
    }
  });
  
  return mergedTools;
}

export default {
  createBlockClass,
  createSimpleBlock,
  createEmbeddedEntryBlock,
  createBlockClasses,
  mergeCustomBlocks,
};

