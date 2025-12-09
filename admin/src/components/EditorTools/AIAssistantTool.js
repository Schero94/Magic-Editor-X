/**
 * AI Assistant Inline Tool for Editor.js
 * Smart toolbar with AI-powered text actions
 */

import { MagicEditorAPI } from '../../hooks/useAIAssistant';
import { createRoot } from 'react-dom/client';
import React from 'react';
import AIInlineToolbar from '../AIInlineToolbar';
import { toastManager } from '../AIToast';

/**
 * AIAssistantTool - Inline tool with smart toolbar
 */
class AIAssistantTool {
  static get isInline() {
    return true;
  }

  static get CSS() {
    return 'ce-inline-tool--ai-assistant';
  }

  static get sanitize() {
    return {
      span: {
        class: 'ai-suggestion',
        'data-original': true,
        'data-corrected': true,
        'data-type': true,
      }
    };
  }

  static get title() {
    return 'KI-Assistent';
  }

  constructor({ api, config }) {
    this.api = api;
    this.config = config || {};
    
    this.getLicenseKey = this.config.getLicenseKey || (() => window.__MAGIC_EDITOR_LICENSE_KEY__);
    
    this.button = null;
    this.toolbar = null;
    this.toolbarRoot = null;
    this.state = false;
    this.selectedRange = null;
    this.selectedText = '';
    this.currentBlockIndex = null;
    this.apiClient = null;
    this.isLoading = false;
    this.lastAction = null; // For undo support
  }

  _initAPIClient() {
    const licenseKey = this.getLicenseKey();
    if (licenseKey && !this.apiClient) {
      this.apiClient = new MagicEditorAPI(licenseKey);
    }
    return this.apiClient;
  }

  render() {
    this.button = document.createElement('button');
    this.button.type = 'button';
    this.button.classList.add(this.api.styles.inlineToolButton);
    this.button.classList.add(AIAssistantTool.CSS);
    this.button.innerHTML = this._getIcon();
    this.button.title = 'KI-Assistent (⌘+Shift+G)';
    
    return this.button;
  }

  _getIcon() {
    return `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
      <path d="M5 3v4"/>
      <path d="M3 5h4"/>
      <path d="M19 17v4"/>
      <path d="M17 19h4"/>
    </svg>`;
  }

  surround(range) {
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
        const blockElement = currentBlock.holder?.querySelector('[contenteditable]') || 
                            currentBlock.holder?.querySelector('.ce-paragraph') ||
                            currentBlock.holder?.querySelector('.ce-header');
        if (blockElement) {
          text = blockElement.textContent?.trim() || '';
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
      toastManager.warning('Bitte Text auswählen');
      return;
    }
    
    this._showInlineToolbar();
  }

  async _showInlineToolbar() {
    if (!this._initAPIClient()) {
      toastManager.error('Keine Lizenz verfügbar');
      return;
    }
    
    // Get toolbar position
    const selection = window.getSelection();
    if (!selection.rangeCount) return;
    
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    const position = {
      left: rect.left + (rect.width / 2) - 200, // Center toolbar (approximate width)
      top: rect.bottom + 8,
    };
    
    // Keep in viewport
    if (position.left < 10) position.left = 10;
    if (position.left + 400 > window.innerWidth - 10) {
      position.left = window.innerWidth - 410;
    }
    
    // Create toolbar container
    this.toolbar = document.createElement('div');
    this.toolbar.classList.add('ai-inline-toolbar-container');
    document.body.appendChild(this.toolbar);
    
    // Render React toolbar
    this.toolbarRoot = createRoot(this.toolbar);
    this.toolbarRoot.render(
      React.createElement(AIInlineToolbar, {
        position,
        onAction: this._handleAction.bind(this),
        loading: this.isLoading,
        onClose: this._closeToolbar.bind(this),
      })
    );
  }

  async _handleAction(action, options = {}) {
    if (!this.apiClient || !this.selectedText) return;
    
    this.isLoading = true;
    this._updateToolbar();
    
    try {
      let result;
      let originalText = this.selectedText;
      
      switch (action) {
        case 'fix':
          result = await this.apiClient.correct(this.selectedText, 'grammar');
          if (result.data.hasChanges) {
            this._replaceText(result.data.corrected);
            toastManager.success(`✓ ${result.data.changes.length} Korrekturen angewendet`, {
              description: `${result.usage?.remaining || 0} Credits übrig`,
              onUndo: () => this._replaceText(originalText),
              duration: 5000,
            });
          } else {
            toastManager.info('Text ist bereits korrekt');
          }
          break;
          
        case 'rewrite':
          result = await this.apiClient.rewrite(this.selectedText, options);
          if (result.data.rewritten) {
            this._replaceText(result.data.rewritten);
            toastManager.success(`✨ Text umgeschrieben (${options.tone || 'standard'})`, {
              onUndo: () => this._replaceText(originalText),
              duration: 5000,
            });
          }
          break;
          
        case 'expand':
          result = await this.apiClient.expand(this.selectedText);
          if (result.data.expanded) {
            this._replaceText(result.data.expanded);
            toastManager.success('📈 Text erweitert', {
              onUndo: () => this._replaceText(originalText),
              duration: 5000,
            });
          }
          break;
          
        case 'summarize':
          result = await this.apiClient.summarize(this.selectedText);
          if (result.data.summary) {
            this._replaceText(result.data.summary);
            toastManager.success('📉 Text zusammengefasst', {
              onUndo: () => this._replaceText(originalText),
              duration: 5000,
            });
          }
          break;
          
        case 'continue':
          result = await this.apiClient.continueWriting(this.selectedText);
          if (result.data.continuation) {
            // Append continuation instead of replacing
            this._appendText(' ' + result.data.continuation);
            toastManager.success('✍️ Text fortgesetzt', {
              onUndo: () => this._replaceText(originalText),
              duration: 5000,
            });
          }
          break;
          
        case 'translate':
          const langNames = { en: 'Englisch', de: 'Deutsch', fr: 'Französisch', es: 'Spanisch' };
          result = await this.apiClient.translate(this.selectedText, options.language);
          if (result.data.translated) {
            this._replaceText(result.data.translated);
            toastManager.success(`🌍 Übersetzt zu ${langNames[options.language] || options.language}`, {
              onUndo: () => this._replaceText(originalText),
              duration: 5000,
            });
          }
          break;
          
        default:
          console.warn('Unknown action:', action);
      }
      
      this._closeToolbar();
      
    } catch (err) {
      console.error('[AI Assistant] Action failed:', err);
      
      const isLimitError = err.code === 'DAILY_LIMIT_EXCEEDED' || err.code === 'MONTHLY_LIMIT_EXCEEDED';
      
      if (isLimitError) {
        toastManager.warning('Limit erreicht', {
          description: err.message,
          duration: 5000,
        });
      } else {
        toastManager.error('Fehler', {
          description: err.message || 'Aktion fehlgeschlagen',
          duration: 4000,
        });
      }
    } finally {
      this.isLoading = false;
      this._updateToolbar();
    }
  }

  _replaceText(newText) {
    if (!this.selectedRange) return;
    
    try {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(this.selectedRange);
      
      // Use document.execCommand for better undo support in Editor.js
      document.execCommand('insertText', false, newText);
      
      // Trigger Editor.js change event
      this.api.blocks.getBlockByIndex(this.api.blocks.getCurrentBlockIndex())?.dispatchChange?.();
    } catch (err) {
      console.error('[AI Assistant] Failed to replace text:', err);
    }
  }

  _appendText(additionalText) {
    if (!this.selectedRange) return;
    
    try {
      const selection = window.getSelection();
      
      // Move cursor to end of selection
      const range = this.selectedRange.cloneRange();
      range.collapse(false); // Collapse to end
      
      selection.removeAllRanges();
      selection.addRange(range);
      
      // Insert additional text
      document.execCommand('insertText', false, additionalText);
      
      // Trigger Editor.js change event
      this.api.blocks.getBlockByIndex(this.api.blocks.getCurrentBlockIndex())?.dispatchChange?.();
    } catch (err) {
      console.error('[AI Assistant] Failed to append text:', err);
    }
  }

  _updateToolbar() {
    if (this.toolbarRoot && this.toolbar) {
      const selection = window.getSelection();
      const rect = selection.rangeCount > 0 
        ? selection.getRangeAt(0).getBoundingClientRect()
        : { left: 0, bottom: 0, width: 0 };
      
      const position = {
        left: rect.left + (rect.width / 2) - 200,
        top: rect.bottom + 8,
      };
      
      this.toolbarRoot.render(
        React.createElement(AIInlineToolbar, {
          position,
          onAction: this._handleAction.bind(this),
          loading: this.isLoading,
          onClose: this._closeToolbar.bind(this),
        })
      );
    }
  }

  _closeToolbar() {
    if (this.toolbarRoot) {
      this.toolbarRoot.unmount();
      this.toolbarRoot = null;
    }
    if (this.toolbar) {
      this.toolbar.remove();
      this.toolbar = null;
    }
    this.isLoading = false;
    this.selectedRange = null;
    this.selectedText = '';
    this.currentBlockIndex = null;
  }

  checkState(selection) {
    this.state = selection && !selection.isCollapsed;
    return this.state;
  }

  get shortcut() {
    return 'CMD+SHIFT+G';
  }

  destroy() {
    this._closeToolbar();
  }
}

export default AIAssistantTool;
