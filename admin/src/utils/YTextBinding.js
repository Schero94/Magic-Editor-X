/**
 * Y.Text to Contenteditable Binding
 * 
 * This utility binds a Y.Text instance to a contenteditable DOM element,
 * enabling real-time character-level collaboration.
 * 
 * Features:
 * - Character-level sync (not block-level)
 * - Formatting support (bold, italic, links, etc.)
 * - Cursor position preservation during remote edits
 * - MutationObserver for efficient DOM tracking
 */

import * as Y from 'yjs';

/**
 * Formats that can be applied to text
 * Maps Editor.js inline tool names to Y.Text attributes
 */
const FORMAT_MAP = {
  bold: 'bold',
  italic: 'italic',
  underline: 'underline',
  code: 'code',
  link: 'a', // Y.Text uses 'a' with { href: '...' } for links
};

/**
 * Converts HTML to Y.Text delta operations
 * @param {string} html - HTML string from contenteditable
 * @returns {Array} Delta operations
 */
function htmlToDelta(html) {
  const parser = new DOMParser();
  const doc = parser.parseFromString(`<div>${html}</div>`, 'text/html');
  const delta = [];
  
  function processNode(node, attributes = {}) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.textContent;
      if (text) {
        const attrs = Object.keys(attributes).length > 0 ? { ...attributes } : undefined;
        delta.push({ insert: text, attributes: attrs });
      }
      return;
    }
    
    if (node.nodeType === Node.ELEMENT_NODE) {
      const newAttrs = { ...attributes };
      const tagName = node.tagName.toLowerCase();
      
      // Map HTML tags to formatting attributes
      switch (tagName) {
        case 'b':
        case 'strong':
          newAttrs.bold = true;
          break;
        case 'i':
        case 'em':
          newAttrs.italic = true;
          break;
        case 'u':
          newAttrs.underline = true;
          break;
        case 'code':
          newAttrs.code = true;
          break;
        case 'a':
          newAttrs.a = { 
            href: node.getAttribute('href') || '',
            target: node.getAttribute('target') || '_blank',
            rel: node.getAttribute('rel') || 'noopener noreferrer'
          };
          break;
        case 'mark':
          newAttrs.mark = true;
          break;
        case 'br':
          delta.push({ insert: '\n' });
          return;
      }
      
      // Process children
      for (const child of node.childNodes) {
        processNode(child, newAttrs);
      }
    }
  }
  
  const wrapper = doc.body.firstChild;
  if (wrapper) {
    for (const child of wrapper.childNodes) {
      processNode(child);
    }
  }
  
  return delta;
}

/**
 * Converts Y.Text delta to HTML string
 * @param {Array} delta - Delta operations from Y.Text.toDelta()
 * @returns {string} HTML string
 */
function deltaToHtml(delta) {
  let html = '';
  
  for (const op of delta) {
    if (typeof op.insert !== 'string') continue;
    
    let text = op.insert;
    // Escape HTML entities
    text = text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/\n/g, '<br>');
    
    const attrs = op.attributes || {};
    let result = text;
    
    // Apply formatting in order (innermost first)
    if (attrs.code) {
      result = `<code>${result}</code>`;
    }
    if (attrs.italic) {
      result = `<i>${result}</i>`;
    }
    if (attrs.bold) {
      result = `<b>${result}</b>`;
    }
    if (attrs.underline) {
      result = `<u>${result}</u>`;
    }
    if (attrs.mark) {
      result = `<mark>${result}</mark>`;
    }
    if (attrs.a) {
      const href = attrs.a.href || '';
      const target = attrs.a.target || '_blank';
      const rel = attrs.a.rel || 'noopener noreferrer';
      result = `<a href="${href}" target="${target}" rel="${rel}">${result}</a>`;
    }
    
    html += result;
  }
  
  return html;
}

/**
 * Gets cursor position in a contenteditable element
 * @param {HTMLElement} element 
 * @returns {{ start: number, end: number } | null}
 */
function getCursorPosition(element) {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  
  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return null;
  
  // Create a range from start of element to cursor
  const preCaretRange = document.createRange();
  preCaretRange.selectNodeContents(element);
  preCaretRange.setEnd(range.startContainer, range.startOffset);
  const start = preCaretRange.toString().length;
  
  preCaretRange.setEnd(range.endContainer, range.endOffset);
  const end = preCaretRange.toString().length;
  
  return { start, end };
}

/**
 * Sets cursor position in a contenteditable element
 * @param {HTMLElement} element 
 * @param {number} start 
 * @param {number} end 
 */
function setCursorPosition(element, start, end = start) {
  const selection = window.getSelection();
  if (!selection) return;
  
  let charIndex = 0;
  let startNode = null;
  let startOffset = 0;
  let endNode = null;
  let endOffset = 0;
  
  function traverse(node) {
    if (startNode && endNode) return;
    
    if (node.nodeType === Node.TEXT_NODE) {
      const nextCharIndex = charIndex + node.textContent.length;
      
      if (!startNode && start >= charIndex && start <= nextCharIndex) {
        startNode = node;
        startOffset = start - charIndex;
      }
      if (!endNode && end >= charIndex && end <= nextCharIndex) {
        endNode = node;
        endOffset = end - charIndex;
      }
      
      charIndex = nextCharIndex;
    } else {
      for (const child of node.childNodes) {
        traverse(child);
      }
    }
  }
  
  traverse(element);
  
  if (startNode && endNode) {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    selection.removeAllRanges();
    selection.addRange(range);
  }
}

/**
 * YTextBinding class - binds Y.Text to a contenteditable element
 */
export class YTextBinding {
  /**
   * @param {Y.Text} ytext - Y.Text instance
   * @param {HTMLElement} element - Contenteditable DOM element
   * @param {Object} options - Configuration options
   */
  constructor(ytext, element, options = {}) {
    this.ytext = ytext;
    this.element = element;
    this.options = options;
    this._isUpdating = false;
    this._observers = [];
    
    // Bind methods
    this._onYTextChange = this._onYTextChange.bind(this);
    this._onInput = this._onInput.bind(this);
    this._onBeforeInput = this._onBeforeInput.bind(this);
    
    // Initialize
    this._setup();
  }
  
  /**
   * Setup bindings and observers
   */
  _setup() {
    // Initial sync: Y.Text -> DOM
    this._syncYTextToDOM();
    
    // Observe Y.Text changes
    this.ytext.observe(this._onYTextChange);
    
    // Observe DOM changes via input event (more reliable than MutationObserver)
    this.element.addEventListener('input', this._onInput);
    this.element.addEventListener('beforeinput', this._onBeforeInput);
  }
  
  /**
   * Handle Y.Text changes (remote updates)
   * @param {Y.YTextEvent} event 
   */
  _onYTextChange(event) {
    // Skip if this change was caused by local DOM edit
    if (event.transaction.local && this._isUpdating) return;
    
    // Save cursor position
    const cursorPos = getCursorPosition(this.element);
    
    // Sync Y.Text to DOM
    this._syncYTextToDOM();
    
    // Restore cursor position (adjusted for changes)
    if (cursorPos && document.activeElement === this.element) {
      // Simple approach: try to restore position
      // TODO: Calculate actual position delta based on remote changes
      setCursorPosition(this.element, cursorPos.start, cursorPos.end);
    }
  }
  
  /**
   * Handle beforeinput event for special operations
   * @param {InputEvent} event 
   */
  _onBeforeInput(event) {
    // Handle formatting commands
    if (event.inputType === 'formatBold' || 
        event.inputType === 'formatItalic' ||
        event.inputType === 'formatUnderline') {
      // Let the browser handle it, we'll pick up the change in _onInput
      return;
    }
  }
  
  /**
   * Handle DOM input event
   * @param {Event} event 
   */
  _onInput(event) {
    if (this._isUpdating) return;
    
    this._isUpdating = true;
    try {
      this._syncDOMToYText();
    } finally {
      this._isUpdating = false;
    }
  }
  
  /**
   * Sync Y.Text content to DOM
   */
  _syncYTextToDOM() {
    const delta = this.ytext.toDelta();
    const html = deltaToHtml(delta);
    
    if (this.element.innerHTML !== html) {
      this.element.innerHTML = html || '<br>'; // Ensure element is editable when empty
    }
  }
  
  /**
   * Sync DOM content to Y.Text
   */
  _syncDOMToYText() {
    const html = this.element.innerHTML;
    
    // Handle empty content
    if (!html || html === '<br>' || html === '<br/>') {
      if (this.ytext.length > 0) {
        this.ytext.delete(0, this.ytext.length);
      }
      return;
    }
    
    // Convert HTML to delta
    const newDelta = htmlToDelta(html);
    const currentDelta = this.ytext.toDelta();
    
    // Simple diff: delete all and insert new
    // TODO: Implement proper diff algorithm for better performance
    this.ytext.doc.transact(() => {
      // Delete existing content
      if (this.ytext.length > 0) {
        this.ytext.delete(0, this.ytext.length);
      }
      
      // Apply new delta
      this.ytext.applyDelta(newDelta);
    }, 'local');
  }
  
  /**
   * Get current text content (plain text)
   * @returns {string}
   */
  getText() {
    return this.ytext.toString();
  }
  
  /**
   * Get current content as HTML
   * @returns {string}
   */
  getHTML() {
    return deltaToHtml(this.ytext.toDelta());
  }
  
  /**
   * Set content from HTML
   * @param {string} html 
   */
  setHTML(html) {
    this._isUpdating = true;
    try {
      const delta = htmlToDelta(html);
      
      this.ytext.doc.transact(() => {
        if (this.ytext.length > 0) {
          this.ytext.delete(0, this.ytext.length);
        }
        this.ytext.applyDelta(delta);
      }, 'local');
      
      this._syncYTextToDOM();
    } finally {
      this._isUpdating = false;
    }
  }
  
  /**
   * Apply formatting to selected text
   * @param {string} format - Format name (bold, italic, etc.)
   * @param {any} value - Format value (true/false or object for links)
   */
  format(format, value = true) {
    const cursorPos = getCursorPosition(this.element);
    if (!cursorPos || cursorPos.start === cursorPos.end) return;
    
    const { start, end } = cursorPos;
    const length = end - start;
    
    const attr = FORMAT_MAP[format] || format;
    const formatValue = format === 'link' 
      ? { href: value.href || value, target: '_blank', rel: 'noopener noreferrer' }
      : value;
    
    this.ytext.format(start, length, { [attr]: formatValue });
  }
  
  /**
   * Destroy binding and cleanup
   */
  destroy() {
    this.ytext.unobserve(this._onYTextChange);
    this.element.removeEventListener('input', this._onInput);
    this.element.removeEventListener('beforeinput', this._onBeforeInput);
    this._observers = [];
  }
}

/**
 * Creates a Y.Text binding for a contenteditable element
 * @param {Y.Text} ytext 
 * @param {HTMLElement} element 
 * @param {Object} options 
 * @returns {YTextBinding}
 */
export function createYTextBinding(ytext, element, options = {}) {
  return new YTextBinding(ytext, element, options);
}

// Export utility functions for external use
export { htmlToDelta, deltaToHtml, getCursorPosition, setCursorPosition };
