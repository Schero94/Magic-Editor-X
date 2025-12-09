/**
 * AI Toast Component
 * Quick feedback messages for AI actions
 */
import React, { useState, useEffect } from 'react';
import styled, { keyframes } from 'styled-components';

const slideIn = keyframes`
  from {
    opacity: 0;
    transform: translateY(-20px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
`;

const slideOut = keyframes`
  from {
    opacity: 1;
    transform: translateY(0);
  }
  to {
    opacity: 0;
    transform: translateY(-20px);
  }
`;

const ToastContainer = styled.div`
  position: fixed;
  top: 20px;
  right: 20px;
  z-index: 99999;
  display: flex;
  flex-direction: column;
  gap: 10px;
  pointer-events: none;
`;

const ToastItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 14px;
  color: #334155;
  min-width: 280px;
  max-width: 400px;
  pointer-events: auto;
  animation: ${props => props.$closing ? slideOut : slideIn} 0.3s ease-out;
  
  &.success {
    border-left: 3px solid #10b981;
  }
  
  &.error {
    border-left: 3px solid #ef4444;
  }
  
  &.info {
    border-left: 3px solid #3b82f6;
  }
  
  &.warning {
    border-left: 3px solid #f59e0b;
  }
`;

const Icon = styled.div`
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
`;

const Message = styled.div`
  flex: 1;
  line-height: 1.4;
  
  strong {
    font-weight: 600;
    display: block;
    margin-bottom: 2px;
  }
  
  span {
    font-size: 13px;
    color: #64748b;
  }
`;

const CloseButton = styled.button`
  flex-shrink: 0;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: #94a3b8;
  cursor: pointer;
  border-radius: 4px;
  transition: all 0.15s ease;
  
  &:hover {
    background: #f1f5f9;
    color: #334155;
  }
  
  svg {
    width: 14px;
    height: 14px;
  }
`;

const UndoButton = styled.button`
  flex-shrink: 0;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  border: 1px solid #e2e8f0;
  background: white;
  color: #7C3AED;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  
  &:hover {
    background: #f5f3ff;
    border-color: #7C3AED;
  }
  
  &:active {
    transform: scale(0.98);
  }
`;

/**
 * Toast Manager - Singleton to manage toast notifications
 */
class ToastManager {
  constructor() {
    this.toasts = [];
    this.listeners = [];
  }
  
  subscribe(listener) {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }
  
  notify() {
    this.listeners.forEach(listener => listener(this.toasts));
  }
  
  show(options) {
    const id = Date.now() + Math.random();
    const toast = {
      id,
      type: options.type || 'info',
      icon: options.icon,
      message: options.message,
      description: options.description,
      duration: options.duration || 3000,
      onUndo: options.onUndo,
      closeable: options.closeable !== false,
    };
    
    this.toasts.push(toast);
    this.notify();
    
    // Auto remove after duration
    if (toast.duration > 0) {
      setTimeout(() => {
        this.remove(id);
      }, toast.duration);
    }
    
    return id;
  }
  
  remove(id) {
    this.toasts = this.toasts.filter(t => t.id !== id);
    this.notify();
  }
  
  success(message, options = {}) {
    return this.show({
      type: 'success',
      icon: '✓',
      message,
      ...options,
    });
  }
  
  error(message, options = {}) {
    return this.show({
      type: 'error',
      icon: '✕',
      message,
      ...options,
    });
  }
  
  info(message, options = {}) {
    return this.show({
      type: 'info',
      icon: 'ℹ',
      message,
      ...options,
    });
  }
  
  warning(message, options = {}) {
    return this.show({
      type: 'warning',
      icon: '⚠',
      message,
      ...options,
    });
  }
}

export const toastManager = new ToastManager();

/**
 * Toast Component
 */
const Toast = ({ toast, onClose }) => {
  const [closing, setClosing] = useState(false);
  
  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      onClose();
    }, 300);
  };
  
  const handleUndo = () => {
    toast.onUndo?.();
    handleClose();
  };
  
  return (
    <ToastItem className={toast.type} $closing={closing}>
      {toast.icon && <Icon>{toast.icon}</Icon>}
      
      <Message>
        {typeof toast.message === 'string' ? (
          toast.message
        ) : (
          <>
            <strong>{toast.message}</strong>
            {toast.description && <span>{toast.description}</span>}
          </>
        )}
      </Message>
      
      {toast.onUndo && (
        <UndoButton onClick={handleUndo}>
          Undo
        </UndoButton>
      )}
      
      {toast.closeable && (
        <CloseButton onClick={handleClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </CloseButton>
      )}
    </ToastItem>
  );
};

/**
 * AIToast Container Component
 */
export const AIToast = () => {
  const [toasts, setToasts] = useState([]);
  
  useEffect(() => {
    const unsubscribe = toastManager.subscribe(setToasts);
    return unsubscribe;
  }, []);
  
  if (toasts.length === 0) {
    return null;
  }
  
  return (
    <ToastContainer>
      {toasts.map(toast => (
        <Toast
          key={toast.id}
          toast={toast}
          onClose={() => toastManager.remove(toast.id)}
        />
      ))}
    </ToastContainer>
  );
};

export default AIToast;
