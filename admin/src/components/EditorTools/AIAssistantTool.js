/**
 * AI Assistant Inline Tool for Editor.js
 * Provides grammar, style, and rewrite corrections using AI
 */

import { MagicEditorAPI } from '../../hooks/useAIAssistant';

/**
 * AIAssistantTool - Inline tool for AI-powered text corrections
 */
class AIAssistantTool {
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
    return 'ce-inline-tool--ai-assistant';
  }

  /**
   * Sanitize config for Editor.js
   */
  static get sanitize() {
    return {};
  }

  /**
   * Title for the tool (shown in tooltip)
   */
  static get title() {
    return 'KI-Assistent';
  }

  /**
   * Creates an instance of AIAssistantTool
   * @param {object} params - Constructor params
   * @param {object} params.api - Editor.js API
   * @param {object} params.config - Tool configuration
   */
  constructor({ api, config }) {
    this.api = api;
    this.config = config || {};
    
    // Get license key from config or global
    this.getLicenseKey = this.config.getLicenseKey || (() => window.__MAGIC_EDITOR_LICENSE_KEY__);
    this.apiBaseUrl = this.config.apiBaseUrl || 'https://magicapi.fitlex.me/api/magic-editor';
    
    this.button = null;
    this.popup = null;
    this.state = false;
    this.selectedRange = null;
    this.selectedText = '';
    this.currentBlockIndex = null;
    
    // API client
    this.apiClient = null;
    
    // State
    this.isLoading = false;
    this.correctionResult = null;
    this.usageData = null;
  }

  /**
   * Initialize API client
   */
  _initAPIClient() {
    const licenseKey = this.getLicenseKey();
    if (licenseKey && !this.apiClient) {
      this.apiClient = new MagicEditorAPI(licenseKey);
    }
    return this.apiClient;
  }

  /**
   * Renders the toolbar button
   * @returns {HTMLElement} Button element
   */
  render() {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.classList.add(this.api.styles.inlineToolButton);
    this.button.classList.add(AIAssistantTool.CSS);
    this.button.innerHTML = this._getIcon();
    this.button.title = 'KI-Assistent (⌘+Shift+G)';
    this.button.style.display = 'flex';
    this.button.style.alignItems = 'center';
    this.button.style.justifyContent = 'center';
    
    return this.button;
  }

  /**
   * Returns the sparkles icon SVG
   * @returns {string} SVG icon
   */
  _getIcon() {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
      <path d="M5 3v4"/>
      <path d="M3 5h4"/>
      <path d="M19 17v4"/>
      <path d="M17 19h4"/>
    </svg>`;
  }

  /**
   * Handles click/activation of the tool
   * @param {Range} range - Current selection range
   */
  surround(range) {
    // Get selected text
    const selection = window.getSelection();
    let text = '';
    
    if (selection.rangeCount > 0) {
      this.selectedRange = selection.getRangeAt(0).cloneRange();
      text = selection.toString().trim();
    }
    
    // If no text selected, try to get current block's text
    if (!text) {
      const currentBlockIndex = this.api.blocks.getCurrentBlockIndex();
      const currentBlock = this.api.blocks.getBlockByIndex(currentBlockIndex);
      if (currentBlock) {
        this.currentBlockIndex = currentBlockIndex;
        // Get block content
        const blockElement = currentBlock.holder?.querySelector('[contenteditable]') || 
                            currentBlock.holder?.querySelector('.ce-paragraph') ||
                            currentBlock.holder?.querySelector('.ce-header');
        if (blockElement) {
          text = blockElement.textContent?.trim() || '';
          // Select the entire block text
          if (text) {
            const range = document.createRange();
            range.selectNodeContents(blockElement);
            selection.removeAllRanges();
            selection.addRange(range);
            this.selectedRange = range.cloneRange();
          }
        }
      }
    }
    
    this.selectedText = text;
    
    if (!text) {
      console.warn('[AI Assistant] No text selected');
      return;
    }
    
    this._showPopup();
  }

  /**
   * Shows the AI Assistant popup
   */
  async _showPopup() {
    // Initialize API client
    if (!this._initAPIClient()) {
      this._showError('Keine Lizenz verfügbar');
      return;
    }
    
    // Fetch usage data
    try {
      const usageResponse = await this.apiClient.getUsage();
      this.usageData = usageResponse.data;
    } catch (err) {
      console.error('[AI Assistant] Failed to fetch usage:', err);
    }
    
    // Create popup
    this.popup = document.createElement('div');
    this.popup.classList.add('ce-inline-tool-ai-popup');
    this.popup.style.cssText = `
      position: fixed;
      background: white;
      border: 1px solid #e2e8f0;
      border-radius: 12px;
      box-shadow: 0 8px 30px rgba(0,0,0,0.12);
      z-index: 999999;
      min-width: 360px;
      max-width: 480px;
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
      overflow: hidden;
    `;
    
    this._renderPopupContent();
    
    // Position popup
    document.body.appendChild(this.popup);
    this._positionPopup();
    
    // Close on outside click
    setTimeout(() => {
      document.addEventListener('click', this._handleOutsideClick);
      document.addEventListener('keydown', this._handleKeyDown);
    }, 100);
  }

  /**
   * Renders the popup content
   */
  _renderPopupContent() {
    const credits = this.usageData?.credits?.balance ?? 0;
    const tier = this.usageData?.tier || 'free';
    const allowedTypes = this.usageData?.allowedTypes || ['grammar'];
    const hasCredits = credits > 0;
    
    this.popup.innerHTML = `
      <div style="
        background: linear-gradient(135deg, #7C3AED 0%, #a855f7 100%);
        padding: 16px 20px;
        color: white;
      ">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <div style="display: flex; align-items: center; gap: 10px;">
            ${this._getIcon()}
            <span style="font-size: 15px; font-weight: 600;">KI-Assistent</span>
          </div>
          <div style="
            background: rgba(255,255,255,0.2);
            padding: 4px 10px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: 500;
          ">
            ${credits} Credits
          </div>
        </div>
      </div>
      
      <div style="padding: 16px 20px;">
        <!-- Selected text preview -->
        <div style="
          background: #f8fafc;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          padding: 12px;
          margin-bottom: 16px;
          max-height: 80px;
          overflow-y: auto;
          font-size: 13px;
          color: #64748b;
          line-height: 1.5;
        ">
          ${this._escapeHtml(this.selectedText.length > 200 ? this.selectedText.substring(0, 200) + '...' : this.selectedText)}
        </div>
        
        <!-- Correction type buttons -->
        <div style="display: flex; gap: 8px; margin-bottom: 16px;">
          ${this._renderTypeButton('grammar', 'Grammatik', '✓', true)}
          ${this._renderTypeButton('style', 'Stil', '✨', hasCredits || allowedTypes.includes('style'))}
          ${this._renderTypeButton('rewrite', 'Umschreiben', '↻', hasCredits || allowedTypes.includes('rewrite'))}
        </div>
        
        <!-- Result area -->
        <div id="ai-result-area" style="min-height: 60px;">
          <div style="
            text-align: center;
            color: #94a3b8;
            font-size: 13px;
            padding: 20px;
          ">
            Wähle einen Korrektur-Typ
          </div>
        </div>
      </div>
      
      <!-- Footer -->
      <div id="ai-footer" style="
        padding: 12px 20px;
        border-top: 1px solid #e2e8f0;
        display: none;
        justify-content: flex-end;
        gap: 8px;
      ">
        <button id="ai-cancel-btn" type="button" style="
          padding: 8px 16px;
          border: 1px solid #e2e8f0;
          border-radius: 8px;
          background: white;
          color: #64748b;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
        ">Abbrechen</button>
        <button id="ai-apply-btn" type="button" style="
          padding: 8px 16px;
          border: none;
          border-radius: 8px;
          background: linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%);
          color: white;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
        ">Übernehmen</button>
      </div>
    `;
    
    // Attach event listeners
    this._attachEventListeners();
  }

  /**
   * Renders a correction type button
   */
  _renderTypeButton(type, label, icon, enabled) {
    const disabledStyle = !enabled ? `
      opacity: 0.5;
      cursor: not-allowed;
      pointer-events: none;
    ` : '';
    
    return `
      <button type="button" data-type="${type}" class="ai-type-btn" style="
        flex: 1;
        padding: 10px 12px;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        background: white;
        color: #334155;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s ease;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        ${disabledStyle}
      " ${!enabled ? 'disabled' : ''}>
        <span>${icon}</span>
        <span>${label}</span>
      </button>
    `;
  }

  /**
   * Attaches event listeners to popup elements
   */
  _attachEventListeners() {
    // Type buttons
    const typeButtons = this.popup.querySelectorAll('.ai-type-btn');
    typeButtons.forEach(btn => {
      btn.addEventListener('click', (e) => {
        const type = e.currentTarget.dataset.type;
        this._performCorrection(type);
        
        // Update active state
        typeButtons.forEach(b => {
          b.style.borderColor = '#e2e8f0';
          b.style.background = 'white';
        });
        e.currentTarget.style.borderColor = '#7C3AED';
        e.currentTarget.style.background = '#f5f3ff';
      });
      
      // Hover effect
      btn.addEventListener('mouseenter', () => {
        if (!btn.disabled) {
          btn.style.borderColor = '#7C3AED';
        }
      });
      btn.addEventListener('mouseleave', () => {
        if (!btn.disabled && btn.style.background !== 'rgb(245, 243, 255)') {
          btn.style.borderColor = '#e2e8f0';
        }
      });
    });
    
    // Cancel button
    const cancelBtn = this.popup.querySelector('#ai-cancel-btn');
    if (cancelBtn) {
      cancelBtn.addEventListener('click', () => this._closePopup());
    }
    
    // Apply button
    const applyBtn = this.popup.querySelector('#ai-apply-btn');
    if (applyBtn) {
      applyBtn.addEventListener('click', () => this._applyCorrection());
    }
  }

  /**
   * Performs the AI correction
   * @param {string} type - Correction type
   */
  async _performCorrection(type) {
    const resultArea = this.popup.querySelector('#ai-result-area');
    const footer = this.popup.querySelector('#ai-footer');
    
    // Show loading
    resultArea.innerHTML = `
      <div style="
        text-align: center;
        padding: 30px;
      ">
        <div style="
          width: 32px;
          height: 32px;
          border: 3px solid #e2e8f0;
          border-top-color: #7C3AED;
          border-radius: 50%;
          margin: 0 auto 12px;
          animation: ai-spin 0.8s linear infinite;
        "></div>
        <div style="color: #64748b; font-size: 13px;">Korrigiere...</div>
        <style>
          @keyframes ai-spin {
            to { transform: rotate(360deg); }
          }
        </style>
      </div>
    `;
    footer.style.display = 'none';
    
    try {
      const result = await this.apiClient.correct(this.selectedText, type);
      this.correctionResult = result.data;
      
      if (!result.data.hasChanges) {
        // No changes needed
        resultArea.innerHTML = `
          <div style="
            text-align: center;
            padding: 24px;
            color: #10b981;
          ">
            <div style="font-size: 32px; margin-bottom: 8px;">✓</div>
            <div style="font-size: 14px; font-weight: 500;">Keine Änderungen nötig</div>
            <div style="font-size: 12px; color: #64748b; margin-top: 4px;">Der Text ist bereits korrekt</div>
          </div>
        `;
        return;
      }
      
      // Show result with diff
      resultArea.innerHTML = `
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px;">Original</div>
          <div style="
            background: #fef2f2;
            border: 1px solid #fecaca;
            border-radius: 6px;
            padding: 10px;
            font-size: 13px;
            color: #991b1b;
            text-decoration: line-through;
            line-height: 1.5;
          ">${this._escapeHtml(result.data.original)}</div>
        </div>
        
        <div style="margin-bottom: 12px;">
          <div style="font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px;">Korrigiert</div>
          <div style="
            background: #f0fdf4;
            border: 1px solid #bbf7d0;
            border-radius: 6px;
            padding: 10px;
            font-size: 13px;
            color: #166534;
            line-height: 1.5;
          ">${this._escapeHtml(result.data.corrected)}</div>
        </div>
        
        ${result.data.changes?.length > 0 ? `
          <div>
            <div style="font-size: 11px; font-weight: 600; color: #94a3b8; text-transform: uppercase; margin-bottom: 6px;">Änderungen (${result.data.changes.length})</div>
            <div style="display: flex; flex-wrap: wrap; gap: 6px;">
              ${result.data.changes.map(c => `
                <span style="
                  background: #ede9fe;
                  color: #5b21b6;
                  padding: 4px 8px;
                  border-radius: 4px;
                  font-size: 11px;
                ">
                  <span style="text-decoration: line-through; opacity: 0.7;">${this._escapeHtml(c.original)}</span>
                  →
                  <span style="font-weight: 500;">${this._escapeHtml(c.corrected)}</span>
                </span>
              `).join('')}
            </div>
          </div>
        ` : ''}
        
        ${result.credits ? `
          <div style="
            margin-top: 12px;
            padding-top: 12px;
            border-top: 1px dashed #e2e8f0;
            font-size: 11px;
            color: #94a3b8;
            text-align: right;
          ">
            ${result.credits.remaining} Credits übrig
          </div>
        ` : ''}
      `;
      
      // Show footer
      footer.style.display = 'flex';
      
    } catch (err) {
      console.error('[AI Assistant] Correction failed:', err);
      
      // Show error
      const isLimitError = err.code === 'DAILY_LIMIT_EXCEEDED' || err.code === 'MONTHLY_LIMIT_EXCEEDED';
      
      resultArea.innerHTML = `
        <div style="
          text-align: center;
          padding: 24px;
          color: ${isLimitError ? '#b45309' : '#dc2626'};
        ">
          <div style="font-size: 32px; margin-bottom: 8px;">${isLimitError ? '⚠️' : '✕'}</div>
          <div style="font-size: 14px; font-weight: 500;">${isLimitError ? 'Limit erreicht' : 'Fehler'}</div>
          <div style="font-size: 12px; color: #64748b; margin-top: 4px;">${err.message}</div>
          ${err.upgrade ? `
            <a href="https://store.magicdx.dev/" target="_blank" rel="noopener" style="
              display: inline-block;
              margin-top: 12px;
              padding: 8px 16px;
              background: linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%);
              color: white;
              border-radius: 6px;
              font-size: 12px;
              font-weight: 500;
              text-decoration: none;
            ">Credits kaufen</a>
          ` : ''}
        </div>
      `;
    }
  }

  /**
   * Applies the correction to the editor
   */
  _applyCorrection() {
    if (!this.correctionResult?.corrected) {
      this._closePopup();
      return;
    }
    
    // Restore selection and replace text
    try {
      const selection = window.getSelection();
      
      if (this.selectedRange) {
        selection.removeAllRanges();
        selection.addRange(this.selectedRange);
        
        // Delete old text and insert new
        document.execCommand('insertText', false, this.correctionResult.corrected);
      }
    } catch (err) {
      console.error('[AI Assistant] Failed to apply correction:', err);
    }
    
    this._closePopup();
  }

  /**
   * Positions the popup near the selection
   */
  _positionPopup() {
    if (!this.popup) return;
    
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    
    const popupRect = this.popup.getBoundingClientRect();
    let left = rect.left + (rect.width / 2) - (popupRect.width / 2);
    let top = rect.bottom + 10;
    
    // Keep popup in viewport
    if (left < 10) left = 10;
    if (left + popupRect.width > window.innerWidth - 10) {
      left = window.innerWidth - popupRect.width - 10;
    }
    if (top + popupRect.height > window.innerHeight - 10) {
      top = rect.top - popupRect.height - 10;
    }
    
    this.popup.style.left = `${left}px`;
    this.popup.style.top = `${top}px`;
  }

  /**
   * Shows an error message
   * @param {string} message - Error message
   */
  _showError(message) {
    alert(message);
  }

  /**
   * Escapes HTML special characters
   * @param {string} text - Text to escape
   * @returns {string} Escaped text
   */
  _escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  /**
   * Closes the popup
   */
  _closePopup() {
    if (this.popup) {
      this.popup.remove();
      this.popup = null;
    }
    this.correctionResult = null;
    document.removeEventListener('click', this._handleOutsideClick);
    document.removeEventListener('keydown', this._handleKeyDown);
  }

  /**
   * Handles clicks outside the popup
   * @param {Event} e - Click event
   */
  _handleOutsideClick = (e) => {
    if (this.popup && !this.popup.contains(e.target) && !this.button?.contains(e.target)) {
      this._closePopup();
    }
  };

  /**
   * Handles keyboard events
   * @param {KeyboardEvent} e - Keyboard event
   */
  _handleKeyDown = (e) => {
    if (e.key === 'Escape') {
      this._closePopup();
    }
  };

  /**
   * Checks if current selection has content (for tool state)
   * @param {Selection} selection - Current selection
   * @returns {boolean} True if has content
   */
  checkState(selection) {
    this.state = selection && !selection.isCollapsed;
    return this.state;
  }

  /**
   * Shortcut key
   */
  get shortcut() {
    return 'CMD+SHIFT+G';
  }

  /**
   * Clean up on destroy
   */
  destroy() {
    this._closePopup();
  }
}

export default AIAssistantTool;
