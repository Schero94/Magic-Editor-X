/**
 * Custom Hyperlink Inline Tool for Editor.js
 * Secure implementation without eval()
 * Adds links with target and rel attribute support
 */

/**
 * Hyperlink Tool - Inline tool for creating links
 */
class HyperlinkTool {
  /**
   * Specifies this is an inline tool
   */
  static get isInline() {
    return true;
  }

  /**
   * CSS class for the tool icon
   */
  static get CSS() {
    return 'ce-inline-tool--hyperlink';
  }

  /**
   * Sanitize config for Editor.js
   */
  static get sanitize() {
    return {
      a: {
        href: true,
        target: true,
        rel: true,
      },
    };
  }

  /**
   * Creates an instance of HyperlinkTool
   * @param {object} params - Constructor params
   * @param {object} params.api - Editor.js API
   * @param {object} params.config - Tool configuration
   */
  constructor({ api, config }) {
    this.api = api;
    this.config = config || {};
    
    // Default configuration
    this.defaultTarget = this.config.target || '_blank';
    this.defaultRel = this.config.rel || 'noopener noreferrer';
    this.availableTargets = this.config.availableTargets || ['_blank', '_self', '_parent', '_top'];
    this.availableRels = this.config.availableRels || ['nofollow', 'noreferrer', 'noopener', 'sponsored', 'ugc'];
    
    this.button = null;
    this.popup = null;
    this.state = false;
    this.selectedRange = null;
    this.existingLink = null;
  }

  /**
   * Renders the toolbar button
   * @returns {HTMLElement} Button element
   */
  render() {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.classList.add(this.api.styles.inlineToolButton);
    this.button.classList.add(HyperlinkTool.CSS);
    this.button.innerHTML = this._getIcon();
    
    return this.button;
  }

  /**
   * Returns the link icon SVG
   * @returns {string} SVG icon
   */
  _getIcon() {
    return `<svg width="14" height="10" viewBox="0 0 14 10" xmlns="http://www.w3.org/2000/svg">
      <path d="M6 1.25H2.75C1.64543 1.25 0.75 2.14543 0.75 3.25V6.75C0.75 7.85457 1.64543 8.75 2.75 8.75H6" stroke="currentColor" stroke-width="1.5" fill="none"/>
      <path d="M8 8.75H11.25C12.3546 8.75 13.25 7.85457 13.25 6.75V3.25C13.25 2.14543 12.3546 1.25 11.25 1.25H8" stroke="currentColor" stroke-width="1.5" fill="none"/>
      <path d="M4 5H10" stroke="currentColor" stroke-width="1.5"/>
    </svg>`;
  }

  /**
   * Handles click/activation of the tool
   * @param {Range} range - Current selection range
   */
  surround(range) {
    if (this.state) {
      this._unwrap(range);
    } else {
      this._showPopup(range);
    }
  }

  /**
   * Shows the link input popup
   * @param {Range} range - Current selection range
   */
  _showPopup(range) {
    this.selectedRange = range;
    
    // Check if selection is inside existing link
    const parentAnchor = this.api.selection.findParentTag('A');
    this.existingLink = parentAnchor;
    
    // Create popup
    this.popup = document.createElement('div');
    this.popup.classList.add('ce-inline-tool-hyperlink-popup');
    this.popup.style.cssText = `
      position: fixed;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      padding: 16px;
      z-index: 999999;
      min-width: 360px;
      max-width: 420px;
    `;
    
    // URL Input
    const urlContainer = this._createInputContainer('URL', 'url', parentAnchor?.href || '');
    
    // Target Select
    const targetContainer = this._createSelectContainer(
      'Target', 
      'target',
      this.availableTargets.map(t => ({ value: t, label: t })),
      parentAnchor?.target || this.defaultTarget
    );
    
    // Rel checkboxes
    const relContainer = this._createRelContainer(parentAnchor?.rel || this.defaultRel);
    
    // Buttons
    const buttonsContainer = document.createElement('div');
    buttonsContainer.style.cssText = 'display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end;';
    
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = `
      padding: 6px 12px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      background: white;
      cursor: pointer;
      font-size: 13px;
    `;
    cancelBtn.addEventListener('click', () => this._closePopup());
    
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.textContent = parentAnchor ? 'Update' : 'Add Link';
    saveBtn.style.cssText = `
      padding: 6px 12px;
      border: none;
      border-radius: 6px;
      background: #3b82f6;
      color: white;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
    `;
    saveBtn.addEventListener('click', () => this._saveLink());
    
    if (parentAnchor) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.textContent = 'Remove';
      removeBtn.style.cssText = `
        padding: 6px 12px;
        border: 1px solid #ef4444;
        border-radius: 6px;
        background: white;
        color: #ef4444;
        cursor: pointer;
        font-size: 13px;
      `;
      removeBtn.addEventListener('click', () => {
        this._unwrap(range);
        this._closePopup();
      });
      buttonsContainer.appendChild(removeBtn);
    }
    
    buttonsContainer.appendChild(cancelBtn);
    buttonsContainer.appendChild(saveBtn);
    
    this.popup.appendChild(urlContainer);
    this.popup.appendChild(targetContainer);
    this.popup.appendChild(relContainer);
    this.popup.appendChild(buttonsContainer);
    
    // Position popup near selection
    document.body.appendChild(this.popup);
    this._positionPopup();
    
    // Focus URL input
    setTimeout(() => {
      const urlInput = this.popup.querySelector('input[name="url"]');
      if (urlInput) urlInput.focus();
    }, 50);
    
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', this._handleOutsideClick);
    }, 100);
  }

  /**
   * Creates an input container
   * @param {string} label - Input label
   * @param {string} name - Input name
   * @param {string} value - Initial value
   * @returns {HTMLElement} Input container
   */
  _createInputContainer(label, name, value) {
    const container = document.createElement('div');
    container.style.cssText = 'margin-bottom: 10px;';
    
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = 'display: block; font-size: 12px; color: #64748b; margin-bottom: 4px; font-weight: 500;';
    
    const input = document.createElement('input');
    input.type = 'text';
    input.name = name;
    input.value = value;
    input.placeholder = 'https://example.com';
    input.style.cssText = `
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
      box-sizing: border-box;
    `;
    
    input.addEventListener('focus', () => {
      input.style.borderColor = '#3b82f6';
    });
    input.addEventListener('blur', () => {
      input.style.borderColor = '#e2e8f0';
    });
    
    container.appendChild(labelEl);
    container.appendChild(input);
    return container;
  }

  /**
   * Creates a select container
   * @param {string} label - Select label
   * @param {string} name - Select name
   * @param {Array} options - Select options
   * @param {string} value - Initial value
   * @returns {HTMLElement} Select container
   */
  _createSelectContainer(label, name, options, value) {
    const container = document.createElement('div');
    container.style.cssText = 'margin-bottom: 10px;';
    
    const labelEl = document.createElement('label');
    labelEl.textContent = label;
    labelEl.style.cssText = 'display: block; font-size: 12px; color: #64748b; margin-bottom: 4px; font-weight: 500;';
    
    const select = document.createElement('select');
    select.name = name;
    select.style.cssText = `
      width: 100%;
      padding: 8px 10px;
      border: 1px solid #e2e8f0;
      border-radius: 6px;
      font-size: 14px;
      outline: none;
      background: white;
      cursor: pointer;
      box-sizing: border-box;
    `;
    
    options.forEach(opt => {
      const option = document.createElement('option');
      option.value = opt.value;
      option.textContent = opt.label;
      option.selected = value === opt.value;
      select.appendChild(option);
    });
    
    container.appendChild(labelEl);
    container.appendChild(select);
    return container;
  }

  /**
   * Creates rel attribute checkboxes
   * @param {string} currentRel - Current rel value
   * @returns {HTMLElement} Rel container
   */
  _createRelContainer(currentRel) {
    const container = document.createElement('div');
    container.style.cssText = 'margin-bottom: 8px;';
    
    const label = document.createElement('label');
    label.textContent = 'Rel Attributes';
    label.style.cssText = 'display: block; font-size: 12px; color: #64748b; margin-bottom: 6px; font-weight: 500;';
    container.appendChild(label);
    
    const checkboxContainer = document.createElement('div');
    checkboxContainer.style.cssText = 'display: flex; flex-wrap: wrap; gap: 12px;';
    
    const currentRels = currentRel ? currentRel.split(' ') : [];
    
    this.availableRels.forEach(rel => {
      const wrapper = document.createElement('label');
      wrapper.style.cssText = 'display: flex; align-items: center; gap: 4px; cursor: pointer; font-size: 13px;';
      
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.name = 'rel';
      checkbox.value = rel;
      checkbox.checked = currentRels.includes(rel);
      checkbox.style.cssText = 'cursor: pointer;';
      
      wrapper.appendChild(checkbox);
      wrapper.appendChild(document.createTextNode(rel));
      checkboxContainer.appendChild(wrapper);
    });
    
    container.appendChild(checkboxContainer);
    return container;
  }

  /**
   * Positions the popup centered on screen
   */
  _positionPopup() {
    if (!this.popup) return;
    
    const popupRect = this.popup.getBoundingClientRect();
    
    // Center horizontally and vertically
    const left = (window.innerWidth - popupRect.width) / 2;
    const top = (window.innerHeight - popupRect.height) / 2;
    
    this.popup.style.left = `${Math.max(10, left)}px`;
    this.popup.style.top = `${Math.max(10, top)}px`;
  }

  /**
   * Saves the link with user-entered values
   */
  _saveLink() {
    if (!this.popup) return;
    
    const urlInput = this.popup.querySelector('input[name="url"]');
    const targetSelect = this.popup.querySelector('select[name="target"]');
    const relCheckboxes = this.popup.querySelectorAll('input[name="rel"]:checked');
    
    const url = urlInput?.value?.trim();
    if (!url) {
      urlInput.style.borderColor = '#ef4444';
      return;
    }
    
    const target = targetSelect?.value || this.defaultTarget;
    const rel = Array.from(relCheckboxes).map(cb => cb.value).join(' ') || this.defaultRel;
    
    this._closePopup();
    
    // Restore selection
    if (this.selectedRange) {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(this.selectedRange);
    }
    
    // If updating existing link
    if (this.existingLink) {
      this.existingLink.href = url;
      this.existingLink.target = target;
      this.existingLink.rel = rel;
    } else {
      // Create new link
      this._wrap(url, target, rel);
    }
  }

  /**
   * Wraps selection in anchor tag
   * @param {string} href - Link URL
   * @param {string} target - Link target
   * @param {string} rel - Link rel
   */
  _wrap(href, target, rel) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const selectedText = range.extractContents();
    
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = target;
    anchor.rel = rel;
    anchor.appendChild(selectedText);
    
    range.insertNode(anchor);
    
    // Update selection to include the new anchor
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNode(anchor);
    selection.addRange(newRange);
  }

  /**
   * Unwraps anchor tag from selection
   * @param {Range} range - Selection range
   */
  _unwrap(range) {
    const anchor = this.api.selection.findParentTag('A');
    if (!anchor) return;
    
    const text = anchor.textContent;
    const textNode = document.createTextNode(text);
    anchor.parentNode.replaceChild(textNode, anchor);
    
    // Update selection
    const selection = window.getSelection();
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNode(textNode);
    selection.addRange(newRange);
  }

  /**
   * Closes the popup
   */
  _closePopup() {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
    document.removeEventListener('click', this._handleOutsideClick);
  }

  /**
   * Handles clicks outside the popup
   * @param {Event} e - Click event
   */
  _handleOutsideClick = (e) => {
    if (this.popup && !this.popup.contains(e.target) && !this.button.contains(e.target)) {
      this._closePopup();
    }
  };

  /**
   * Checks if current selection is inside a link
   * @param {Selection} selection - Current selection
   * @returns {boolean} True if inside link
   */
  checkState(selection) {
    const anchor = this.api.selection.findParentTag('A');
    this.state = !!anchor;
    this.button.classList.toggle(this.api.styles.inlineToolButtonActive, this.state);
    return this.state;
  }

  /**
   * Shortcut key
   */
  get shortcut() {
    return this.config.shortcut || 'CMD+K';
  }

  /**
   * Clean up on destroy
   */
  destroy() {
    this._closePopup();
  }
}

export default HyperlinkTool;

