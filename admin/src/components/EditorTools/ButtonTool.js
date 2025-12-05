/**
 * Custom Button Tool for Editor.js
 * Secure implementation without eval()
 * Creates CTA buttons with customizable text, link and style
 */

/**
 * Button Tool - Creates call-to-action buttons
 */
class ButtonTool {
  /**
   * Enable paragraph-like behavior
   */
  static get pasteConfig() {
    return { tags: ['BUTTON', 'A'] };
  }

  /**
   * Tool icon in the toolbox
   */
  static get toolbox() {
    return {
      title: 'Button',
      icon: '<svg width="17" height="15" viewBox="0 0 17 15" xmlns="http://www.w3.org/2000/svg"><path d="M1 2.5C1 1.67157 1.67157 1 2.5 1H14.5C15.3284 1 16 1.67157 16 2.5V12.5C16 13.3284 15.3284 14 14.5 14H2.5C1.67157 14 1 13.3284 1 12.5V2.5ZM3.5 5C3.22386 5 3 5.22386 3 5.5V9.5C3 9.77614 3.22386 10 3.5 10H13.5C13.7761 10 14 9.77614 14 9.5V5.5C14 5.22386 13.7761 5 13.5 5H3.5Z" fill="currentColor"/></svg>',
    };
  }

  /**
   * Creates an instance of ButtonTool
   * @param {object} params - Constructor params
   * @param {object} params.data - Previously saved data
   * @param {object} params.config - Tool configuration
   * @param {object} params.api - Editor.js API
   */
  constructor({ data, config, api }) {
    this.api = api;
    this.config = config || {};
    this.data = {
      text: data.text || '',
      link: data.link || '',
      style: data.style || 'primary',
      openInNewTab: data.openInNewTab !== false,
    };
    
    this.wrapper = null;
    this.styles = this._getDefaultStyles();
  }

  /**
   * Returns default button styles
   * @returns {object} Style configuration
   */
  _getDefaultStyles() {
    return {
      primary: {
        background: '#3b82f6',
        color: '#ffffff',
        border: 'none',
        hoverBackground: '#2563eb',
      },
      secondary: {
        background: '#64748b',
        color: '#ffffff',
        border: 'none',
        hoverBackground: '#475569',
      },
      outline: {
        background: 'transparent',
        color: '#3b82f6',
        border: '2px solid #3b82f6',
        hoverBackground: '#eff6ff',
      },
      success: {
        background: '#22c55e',
        color: '#ffffff',
        border: 'none',
        hoverBackground: '#16a34a',
      },
      danger: {
        background: '#ef4444',
        color: '#ffffff',
        border: 'none',
        hoverBackground: '#dc2626',
      },
    };
  }

  /**
   * Renders the tool UI
   * @returns {HTMLElement} The tool wrapper element
   */
  render() {
    this.wrapper = document.createElement('div');
    this.wrapper.classList.add('cdx-button-tool');
    this.wrapper.style.cssText = `
      padding: 12px;
      background: #f8fafc;
      border-radius: 8px;
      margin: 8px 0;
    `;

    // Button Preview
    const preview = document.createElement('div');
    preview.style.cssText = 'text-align: center; margin-bottom: 12px;';
    
    const button = this._createButton();
    preview.appendChild(button);
    
    // Settings Form
    const form = document.createElement('div');
    form.style.cssText = 'display: flex; flex-direction: column; gap: 8px;';
    
    // Text Input
    const textInput = this._createInput('Button Text', this.data.text, (value) => {
      this.data.text = value;
      button.textContent = value || 'Click Me';
    });
    
    // Link Input
    const linkInput = this._createInput('Link URL', this.data.link, (value) => {
      this.data.link = value;
    });
    
    // Style Select
    const styleSelect = this._createStyleSelect((value) => {
      this.data.style = value;
      this._updateButtonStyle(button, value);
    });
    
    // New Tab Checkbox
    const newTabCheckbox = this._createCheckbox('Open in new tab', this.data.openInNewTab, (checked) => {
      this.data.openInNewTab = checked;
    });
    
    form.appendChild(textInput);
    form.appendChild(linkInput);
    form.appendChild(styleSelect);
    form.appendChild(newTabCheckbox);
    
    this.wrapper.appendChild(preview);
    this.wrapper.appendChild(form);

    return this.wrapper;
  }

  /**
   * Creates the button element
   * @returns {HTMLElement} Button element
   */
  _createButton() {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = this.data.text || 'Click Me';
    button.style.cssText = `
      padding: 10px 24px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.2s ease;
      outline: none;
    `;
    this._updateButtonStyle(button, this.data.style);
    
    // Prevent button click from triggering editor actions
    button.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
    });
    
    return button;
  }

  /**
   * Updates button styling
   * @param {HTMLElement} button - Button element
   * @param {string} style - Style name
   */
  _updateButtonStyle(button, style) {
    const styleConfig = this.styles[style] || this.styles.primary;
    button.style.backgroundColor = styleConfig.background;
    button.style.color = styleConfig.color;
    button.style.border = styleConfig.border;
  }

  /**
   * Creates an input field with label
   * @param {string} label - Input label
   * @param {string} value - Initial value
   * @param {Function} onChange - Change handler
   * @returns {HTMLElement} Input container
   */
  _createInput(label, value, onChange) {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
    
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = 'font-size: 12px; color: #64748b; font-weight: 500;';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = label;
    input.style.cssText = `
      padding: 8px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
      transition: border-color 0.2s;
    `;
    
    input.addEventListener('focus', () => {
      input.style.borderColor = '#3b82f6';
    });
    
    input.addEventListener('blur', () => {
      input.style.borderColor = '#e2e8f0';
    });
    
    input.addEventListener('input', (e) => {
      onChange(e.target.value);
    });
    
    container.appendChild(labelEl);
    container.appendChild(input);
    return container;
  }

  /**
   * Creates style select dropdown
   * @param {Function} onChange - Change handler
   * @returns {HTMLElement} Select container
   */
  _createStyleSelect(onChange) {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; flex-direction: column; gap: 4px;';
    
    const label = document.createElement('label');
    label.textContent = 'Button Style';
    label.style.cssText = 'font-size: 12px; color: #64748b; font-weight: 500;';
    
    const select = document.createElement('select');
    select.style.cssText = `
      padding: 8px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
      cursor: pointer;
      background: white;
    `;
    
    const options = [
      { value: 'primary', label: 'Primary (Blue)' },
      { value: 'secondary', label: 'Secondary (Gray)' },
      { value: 'outline', label: 'Outline' },
      { value: 'success', label: 'Success (Green)' },
      { value: 'danger', label: 'Danger (Red)' },
    ];
    
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      option.selected = this.data.style === opt.value;
      select.appendChild(option);
    });
    
    select.addEventListener('change', (e) => {
      onChange(e.target.value);
    });
    
    container.appendChild(label);
    container.appendChild(select);
    return container;
  }

  /**
   * Creates checkbox with label
   * @param {string} label - Checkbox label
   * @param {boolean} checked - Initial state
   * @param {Function} onChange - Change handler
   * @returns {HTMLElement} Checkbox container
   */
  _createCheckbox(label, checked, onChange) {
    const container = document.createElement('div');
    container.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-top: 4px;';
    
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.checked = checked;
    checkbox.style.cssText = 'width: 16px; height: 16px; cursor: pointer;';
    
    checkbox.addEventListener('change', (e) => {
      onChange(e.target.checked);
    });
    
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = 'font-size: 14px; color: #334155; cursor: pointer;';
    labelEl.addEventListener('click', () => {
      checkbox.checked = !checkbox.checked;
      onChange(checkbox.checked);
    });
    
    container.appendChild(checkbox);
    container.appendChild(labelEl);
    return container;
  }

  /**
   * Extracts data from the tool
   * @returns {object} Saved data
   */
  save() {
    return {
      text: this.data.text,
      link: this.data.link,
      style: this.data.style,
      openInNewTab: this.data.openInNewTab,
    };
  }

  /**
   * Validates block data
   * @param {object} savedData - Saved data to validate
   * @returns {boolean} True if valid
   */
  validate(savedData) {
    return savedData.text && savedData.text.trim().length > 0;
  }
}

export default ButtonTool;

