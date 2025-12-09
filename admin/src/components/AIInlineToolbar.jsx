/**
 * AI Inline Toolbar Component
 * Smart toolbar that appears below text selection with AI action buttons
 */
import React, { useState, useEffect, useRef } from 'react';
import styled from 'styled-components';

const ToolbarContainer = styled.div`
  position: fixed;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1), 0 0 0 1px rgba(0, 0, 0, 0.05);
  padding: 4px;
  display: flex;
  gap: 2px;
  z-index: 9999;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  animation: slideUp 0.2s ease-out;
  
  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  &::before {
    content: '';
    position: absolute;
    top: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 12px;
    height: 12px;
    background: white;
    border-left: 1px solid #e2e8f0;
    border-top: 1px solid #e2e8f0;
    transform: translateX(-50%) rotate(45deg);
  }
`;

const ActionButton = styled.button`
  padding: 6px 12px;
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 500;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: #334155;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  position: relative;
  
  &:hover:not(:disabled) {
    background: #f8fafc;
    color: #7C3AED;
  }
  
  &:active:not(:disabled) {
    transform: scale(0.98);
  }
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  
  svg {
    width: 16px;
    height: 16px;
    flex-shrink: 0;
  }
`;

const Divider = styled.div`
  width: 1px;
  height: 24px;
  background: #e2e8f0;
  margin: 0 4px;
  align-self: center;
`;

const Submenu = styled.div`
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  padding: 4px;
  min-width: 160px;
  z-index: 10000;
  animation: slideDown 0.15s ease-out;
  
  @keyframes slideDown {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
`;

const SubmenuItem = styled.button`
  width: 100%;
  padding: 8px 12px;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  border: none;
  border-radius: 4px;
  background: transparent;
  color: #334155;
  cursor: pointer;
  text-align: left;
  transition: all 0.1s ease;
  
  &:hover {
    background: #f8fafc;
    color: #7C3AED;
  }
  
  svg {
    width: 14px;
    height: 14px;
  }
`;

const LoadingSpinner = styled.div`
  width: 14px;
  height: 14px;
  border: 2px solid #e2e8f0;
  border-top-color: #7C3AED;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

/**
 * AIInlineToolbar Component
 */
export const AIInlineToolbar = ({
  position,
  onAction,
  loading = false,
  disabled = false,
  onClose
}) => {
  const [activeSubmenu, setActiveSubmenu] = useState(null);
  const toolbarRef = useRef(null);
  
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (toolbarRef.current && !toolbarRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    
    const handleEscape = (e) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);
  
  const handleAction = (action, options = {}) => {
    setActiveSubmenu(null);
    onAction?.(action, options);
  };
  
  const toggleSubmenu = (menu) => {
    setActiveSubmenu(activeSubmenu === menu ? null : menu);
  };
  
  return (
    <ToolbarContainer
      ref={toolbarRef}
      style={{
        left: `${position.left}px`,
        top: `${position.top}px`,
      }}
    >
      {/* Fix All Button */}
      <ActionButton
        onClick={() => handleAction('fix')}
        disabled={disabled || loading}
        title="Fix grammar and spelling"
      >
        {loading ? (
          <LoadingSpinner />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}
        <span>Fix</span>
      </ActionButton>
      
      {/* Rewrite Button with Submenu */}
      <ActionButton
        onClick={() => toggleSubmenu('rewrite')}
        disabled={disabled || loading}
        title="Rewrite text with different style"
        style={{ position: 'relative' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 3l1.912 5.813a2 2 0 001.275 1.275L21 12l-5.813 1.912a2 2 0 00-1.275 1.275L12 21l-1.912-5.813a2 2 0 00-1.275-1.275L3 12l5.813-1.912a2 2 0 001.275-1.275L12 3z"/>
        </svg>
        <span>Rewrite</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '12px', height: '12px' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
        
        {activeSubmenu === 'rewrite' && (
          <Submenu>
            <SubmenuItem onClick={() => handleAction('rewrite', { tone: 'professional' })}>
              <span>💼</span>
              <span>Professional</span>
            </SubmenuItem>
            <SubmenuItem onClick={() => handleAction('rewrite', { tone: 'casual' })}>
              <span>😊</span>
              <span>Casual</span>
            </SubmenuItem>
            <SubmenuItem onClick={() => handleAction('rewrite', { tone: 'friendly' })}>
              <span>👋</span>
              <span>Friendly</span>
            </SubmenuItem>
          </Submenu>
        )}
      </ActionButton>
      
      <Divider />
      
      {/* Expand Button */}
      <ActionButton
        onClick={() => handleAction('expand')}
        disabled={disabled || loading}
        title="Make text longer and more detailed"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="7 13 12 18 17 13" />
          <polyline points="7 6 12 11 17 6" />
        </svg>
        <span>Expand</span>
      </ActionButton>
      
      {/* Summarize Button */}
      <ActionButton
        onClick={() => handleAction('summarize')}
        disabled={disabled || loading}
        title="Make text shorter and concise"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <polyline points="17 11 12 6 7 11" />
          <polyline points="17 18 12 13 7 18" />
        </svg>
        <span>Shorten</span>
      </ActionButton>
      
      <Divider />
      
      {/* Continue Writing Button */}
      <ActionButton
        onClick={() => handleAction('continue')}
        disabled={disabled || loading}
        title="Continue writing from here"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12l7 7 7-7" />
        </svg>
        <span>Continue</span>
      </ActionButton>
      
      {/* Translate Button with Submenu */}
      <ActionButton
        onClick={() => toggleSubmenu('translate')}
        disabled={disabled || loading}
        title="Translate to another language"
        style={{ position: 'relative' }}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 8l6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14.5 17h6" />
        </svg>
        <span>Translate</span>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: '12px', height: '12px' }}>
          <polyline points="6 9 12 15 18 9" />
        </svg>
        
        {activeSubmenu === 'translate' && (
          <Submenu>
            <SubmenuItem onClick={() => handleAction('translate', { language: 'en' })}>
              <span>🇬🇧</span>
              <span>English</span>
            </SubmenuItem>
            <SubmenuItem onClick={() => handleAction('translate', { language: 'de' })}>
              <span>🇩🇪</span>
              <span>German</span>
            </SubmenuItem>
            <SubmenuItem onClick={() => handleAction('translate', { language: 'fr' })}>
              <span>🇫🇷</span>
              <span>French</span>
            </SubmenuItem>
            <SubmenuItem onClick={() => handleAction('translate', { language: 'es' })}>
              <span>🇪🇸</span>
              <span>Spanish</span>
            </SubmenuItem>
          </Submenu>
        )}
      </ActionButton>
    </ToolbarContainer>
  );
};

export default AIInlineToolbar;
