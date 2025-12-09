import React, { useCallback } from 'react';
import { MagicEditorAPI } from './useAIAssistant';
import { toastManager } from '../components/AIToast';

/**
 * AI Action Handler for Custom Field
 * Handles all AI actions from the inline toolbar
 */
export const useAIActions = ({ licenseKey, editorInstanceRef, isReady, onNoCredits }) => {
  const apiClientRef = React.useRef(null);
  
  // Initialize API client
  React.useEffect(() => {
    if (licenseKey && !apiClientRef.current) {
      apiClientRef.current = new MagicEditorAPI(licenseKey);
    }
  }, [licenseKey]);
  
  const replaceText = useCallback((range, newText) => {
    if (!range) return false;
    
    try {
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      
      // Use document.execCommand for better undo support
      const success = document.execCommand('insertText', false, newText);
      
      // Trigger Editor.js change event
      if (editorInstanceRef.current && isReady) {
        const currentBlock = editorInstanceRef.current.blocks.getBlockByIndex(
          editorInstanceRef.current.blocks.getCurrentBlockIndex()
        );
        currentBlock?.dispatchChange?.();
      }
      
      return success;
    } catch (err) {
      console.error('[AI Actions] Failed to replace text:', err);
      return false;
    }
  }, [editorInstanceRef, isReady]);
  
  const appendText = useCallback((range, additionalText) => {
    if (!range) return false;
    
    try {
      const selection = window.getSelection();
      
      // Move cursor to end of selection
      const newRange = range.cloneRange();
      newRange.collapse(false);
      
      selection.removeAllRanges();
      selection.addRange(newRange);
      
      // Insert additional text
      const success = document.execCommand('insertText', false, additionalText);
      
      // Trigger Editor.js change event
      if (editorInstanceRef.current && isReady) {
        const currentBlock = editorInstanceRef.current.blocks.getBlockByIndex(
          editorInstanceRef.current.blocks.getCurrentBlockIndex()
        );
        currentBlock?.dispatchChange?.();
      }
      
      return success;
    } catch (err) {
      console.error('[AI Actions] Failed to append text:', err);
      return false;
    }
  }, [editorInstanceRef, isReady]);
  
  const handleAIAction = useCallback(async (action, options, { text, range }) => {
    if (!apiClientRef.current || !text) return;
    
    const originalText = text;
    const langNames = { en: 'Englisch', de: 'Deutsch', fr: 'Französisch', es: 'Spanisch' };
    
    try {
      let result;
      let type;
      let apiOptions = {};
      
      // Map action to API type
      switch (action) {
        case 'fix':
          type = 'grammar';
          break;
        case 'rewrite':
          type = 'rewrite';
          apiOptions = { tone: options.tone };
          break;
        case 'expand':
          type = 'expand';
          break;
        case 'summarize':
          type = 'summarize';
          break;
        case 'continue':
          type = 'continue';
          break;
        case 'translate':
          type = 'translate';
          apiOptions = { language: options.language };
          break;
        default:
          console.warn('Unknown AI action:', action);
          return false;
      }
      
      // All actions use /correct endpoint with different type
      result = await apiClientRef.current.correct(text, type, apiOptions);
      
      // Check if there are changes
      if (result.data.hasChanges && result.data.corrected) {
        // For 'continue' action, append text instead of replace
        if (action === 'continue') {
          appendText(range, ' ' + result.data.corrected);
        } else {
          replaceText(range, result.data.corrected);
        }
        
        // Show success message based on action
        const messages = {
          fix: `✓ ${result.data.changes?.length || 1} Korrekturen angewendet`,
          rewrite: `✨ Text umgeschrieben (${options.tone || 'standard'})`,
          expand: '📈 Text erweitert',
          summarize: '📉 Text zusammengefasst',
          continue: '✍️ Text fortgesetzt',
          translate: `🌍 Übersetzt zu ${langNames[options.language] || options.language}`,
        };
        
        toastManager.success(messages[action], {
          description: `${result.credits?.remaining ?? 0} Credits übrig`,
          onUndo: () => replaceText(range, originalText),
          duration: 5000,
        });
      } else {
        toastManager.info('Text ist bereits korrekt');
      }
      
      return true;
    } catch (err) {
      console.error('[AI Actions] Action failed:', err);
      
      // Handle all API error codes
      switch (err.code) {
        case 'NO_CREDITS':
          if (onNoCredits) {
            onNoCredits(err.upgrade);
          } else {
            toastManager.warning('Keine Credits', {
              description: err.message || 'Bitte Credits kaufen',
              duration: 5000,
            });
          }
          break;
          
        case 'TYPE_NOT_ALLOWED':
          toastManager.warning('Funktion nicht verfügbar', {
            description: 'Diese Funktion ist in deinem Tier nicht enthalten',
            duration: 5000,
          });
          break;
          
        case 'LICENSE_NOT_FOUND':
        case 'LICENSE_INACTIVE':
        case 'WRONG_PLUGIN':
          toastManager.error('Lizenz ungültig', {
            description: err.message || 'Bitte prüfe deine Lizenz',
            duration: 5000,
          });
          break;
          
        case 'DAILY_LIMIT_EXCEEDED':
        case 'MONTHLY_LIMIT_EXCEEDED':
          toastManager.warning('Limit erreicht', {
            description: err.message,
            duration: 5000,
          });
          break;
          
        case 'CORRECTION_FAILED':
          toastManager.error('AI Fehler', {
            description: 'Die KI konnte die Anfrage nicht verarbeiten',
            duration: 4000,
          });
          break;
          
        default:
          toastManager.error('Fehler', {
            description: err.message || 'Aktion fehlgeschlagen',
            duration: 4000,
          });
      }
      
      return false;
    }
  }, [replaceText, appendText, onNoCredits]);
  
  return { handleAIAction };
};

export default useAIActions;
