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
    if (this.state) {
      // Already has a link - remove it
      this._unwrap(range);
      return;
    }

    // Check if openLinkPicker is available
    if (!this.openLinkPicker) {
      console.error('[WebtoolsLinkTool] openLinkPicker not available');
      return;
    }

    // Save the current selection
    this.selectedRange = range.cloneRange();
    const selectedText = range.toString();

    // Check if selection is inside existing link
    const parentAnchor = this.api.selection.findParentTag('A');
    const existingHref = parentAnchor?.href || '';

    try {
      // Open the Webtools Link Picker
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
          // Optionally update text if label changed
          if (result.label && result.label !== parentAnchor.textContent) {
            parentAnchor.textContent = result.label;
          }
        } else {
          // Create new link
          this._wrap(result.href, result.label || selectedText);
        }
      }
    } catch (error) {
      console.error('[WebtoolsLinkTool] Error:', error);
    }
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
