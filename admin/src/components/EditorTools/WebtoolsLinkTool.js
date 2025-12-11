/**
 * Webtools Link Inline Tool for Editor.js
 * Integration with @pluginpal/webtools-addon-links
 * 
 * This tool provides a link button that opens the Webtools Link Picker
 * for selecting internal content links or external URLs.
 */

/**
 * WebtoolsLinkTool - Inline tool for creating links via Webtools
 */
class WebtoolsLinkTool {
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
    return 'ce-inline-tool--webtools-link';
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
   * Tool title for tooltip
   */
  static get title() {
    return 'Webtools Link';
  }

  /**
   * Creates an instance of WebtoolsLinkTool
   * @param {object} params - Constructor params
   * @param {object} params.api - Editor.js API
   * @param {object} params.config - Tool configuration
   */
  constructor({ api, config }) {
    this.api = api;
    this.config = config || {};
    
    // The openLinkPicker function is injected via config
    this.openLinkPicker = this.config.openLinkPicker || null;
    
    this.button = null;
    this.state = false;
    this.selectedRange = null;
  }

  /**
   * Renders the toolbar button
   * @returns {HTMLElement} Button element
   */
  render() {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.classList.add(this.api.styles.inlineToolButton);
    this.button.classList.add(WebtoolsLinkTool.CSS);
    this.button.innerHTML = this._getIcon();
    this.button.title = 'Webtools Link';
    
    return this.button;
  }

  /**
   * Returns the Webtools link icon SVG
   * A link icon with a small "W" badge
   * @returns {string} SVG icon
   */
  _getIcon() {
    return `<svg width="16" height="14" viewBox="0 0 16 14" xmlns="http://www.w3.org/2000/svg">
      <!-- Link chain icon -->
      <path d="M6 2.25H3.25C2.14543 2.25 1.25 3.14543 1.25 4.25V7.75C1.25 8.85457 2.14543 9.75 3.25 9.75H6" stroke="currentColor" stroke-width="1.5" fill="none"/>
      <path d="M10 9.75H12.75C13.8546 9.75 14.75 8.85457 14.75 7.75V4.25C14.75 3.14543 13.8546 2.25 12.75 2.25H10" stroke="currentColor" stroke-width="1.5" fill="none"/>
      <path d="M5 6H11" stroke="currentColor" stroke-width="1.5"/>
      <!-- Webtools indicator dot -->
      <circle cx="13.5" cy="11.5" r="2" fill="#7C3AED" stroke="white" stroke-width="0.5"/>
    </svg>`;
  }

  /**
   * Handles click/activation of the tool
   * @param {Range} range - Current selection range
   */
  async surround(range) {
    // Check if openLinkPicker is available
    if (!this.openLinkPicker) {
      console.error('[WebtoolsLinkTool] openLinkPicker not available');
      return;
    }

    // Check if selection is inside existing link
    const parentAnchor = this.api.selection.findParentTag('A');
    
    // Save the current selection
    this.selectedRange = range.cloneRange();
    
    // Get text - if existing link, use its text content
    const selectedText = parentAnchor 
      ? parentAnchor.textContent 
      : range.toString();
    
    // Get existing href if editing
    const existingHref = parentAnchor?.href || '';

    try {
      // Open the Webtools Link Picker
      // For existing links: pre-fill with current href and text
      // For new links: pre-fill with selected text
      const result = await this.openLinkPicker({
        initialHref: existingHref,
        initialText: selectedText,
      });

      if (result && result.href) {
        // Restore selection
        this._restoreSelection();

        if (parentAnchor) {
          // Update existing link
          parentAnchor.href = result.href;
          // Update text if label changed
          if (result.label && result.label !== parentAnchor.textContent) {
            parentAnchor.textContent = result.label;
          }
        } else {
          // Create new link
          this._wrap(result.href, result.label || selectedText);
        }
      } else if (result === null && parentAnchor) {
        // User cancelled or cleared - if editing existing link, offer to remove
        // (result is null when picker is dismissed without saving)
        // Keep the link as-is (don't remove on cancel)
      }
    } catch (error) {
      console.error('[WebtoolsLinkTool] Error:', error);
    }
  }

  /**
   * Renders additional actions when link is active
   * @returns {HTMLElement|undefined} Actions element or undefined
   */
  renderActions() {
    // Show unlink button when inside a link
    if (!this.state) return undefined;

    const actionsWrapper = document.createElement('div');
    actionsWrapper.classList.add('ce-inline-tool-input');
    actionsWrapper.style.cssText = 'display: flex; align-items: center; gap: 8px; padding: 4px 8px;';

    // Show current link
    const parentAnchor = this.api.selection.findParentTag('A');
    if (parentAnchor) {
      const linkInfo = document.createElement('span');
      linkInfo.style.cssText = 'font-size: 12px; color: #666; max-width: 200px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;';
      linkInfo.textContent = parentAnchor.href;
      linkInfo.title = parentAnchor.href;
      actionsWrapper.appendChild(linkInfo);
    }

    // Unlink button
    const unlinkBtn = document.createElement('button');
    unlinkBtn.type = 'button';
    unlinkBtn.innerHTML = '✕';
    unlinkBtn.title = 'Remove link';
    unlinkBtn.style.cssText = 'background: #ef4444; color: white; border: none; border-radius: 4px; padding: 2px 8px; cursor: pointer; font-size: 12px;';
    unlinkBtn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this._unwrap();
      this.api.inlineToolbar.close();
    });
    actionsWrapper.appendChild(unlinkBtn);

    return actionsWrapper;
  }

  /**
   * Restores the saved selection
   */
  _restoreSelection() {
    if (!this.selectedRange) return;

    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(this.selectedRange);
  }

  /**
   * Wraps selection in anchor tag
   * @param {string} href - Link URL
   * @param {string} label - Link text (optional)
   */
  _wrap(href, label) {
    const selection = window.getSelection();
    if (!selection.rangeCount) return;

    const range = selection.getRangeAt(0);
    const selectedText = range.toString();

    // If label differs from selected text, replace content
    if (label && label !== selectedText) {
      range.deleteContents();
      const textNode = document.createTextNode(label);
      range.insertNode(textNode);
      range.selectNode(textNode);
    }

    const selectedContents = range.extractContents();

    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    anchor.appendChild(selectedContents);

    range.insertNode(anchor);

    // Update selection to include the new anchor
    selection.removeAllRanges();
    const newRange = document.createRange();
    newRange.selectNode(anchor);
    selection.addRange(newRange);
  }

  /**
   * Unwraps anchor tag from selection
   */
  _unwrap() {
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
    
    // Update state
    this.state = false;
  }

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
   * Shortcut key (Cmd/Ctrl + Shift + K to differentiate from regular link)
   */
  get shortcut() {
    return this.config.shortcut || 'CMD+SHIFT+K';
  }
}

export default WebtoolsLinkTool;
