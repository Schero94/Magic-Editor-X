/**
 * AI Suggestion Marker Component
 * Renders underlined text with hover tooltip showing corrections
 */
import React, { useState, useRef, useEffect } from 'react';
import styled from 'styled-components';

const SuggestionSpan = styled.span`
  text-decoration: underline wavy;
  text-decoration-thickness: 2px;
  text-underline-offset: 2px;
  cursor: pointer;
  position: relative;
  transition: background 0.15s ease;
  
  &[data-type="grammar"],
  &[data-type="spelling"] {
    text-decoration-color: #ef4444;
  }
  
  &[data-type="style"] {
    text-decoration-color: #f59e0b;
  }
  
  &[data-type="suggestion"] {
    text-decoration-color: #3b82f6;
  }
  
  &:hover {
    background: rgba(124, 58, 237, 0.1);
  }
`;

const Tooltip = styled.div`
  position: fixed;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 8px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  padding: 0;
  z-index: 10000;
  min-width: 200px;
  max-width: 320px;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  animation: fadeIn 0.15s ease-out;
  
  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }
  
  &::before {
    content: '';
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 6px solid transparent;
    border-right: 6px solid transparent;
    border-bottom: 6px solid white;
  }
  
  &::after {
    content: '';
    position: absolute;
    bottom: 100%;
    left: 50%;
    transform: translateX(-50%);
    width: 0;
    height: 0;
    border-left: 7px solid transparent;
    border-right: 7px solid transparent;
    border-bottom: 7px solid #e2e8f0;
    margin-bottom: 1px;
  }
`;

const TooltipContent = styled.div`
  padding: 12px;
`;

const ComparisonRow = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 12px;
`;

const TextBox = styled.div`
  flex: 1;
  padding: 6px 10px;
  border-radius: 6px;
  font-size: 13px;
  line-height: 1.4;
  
  &.original {
    background: #fef2f2;
    color: #991b1b;
    text-decoration: line-through;
  }
  
  &.corrected {
    background: #f0fdf4;
    color: #166534;
    font-weight: 500;
  }
`;

const Arrow = styled.div`
  color: #94a3b8;
  font-size: 14px;
  font-weight: 600;
`;

const TypeBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  font-weight: 500;
  text-transform: capitalize;
  margin-bottom: 12px;
  
  &.grammar,
  &.spelling {
    background: #fee2e2;
    color: #991b1b;
  }
  
  &.style {
    background: #fef3c7;
    color: #92400e;
  }
  
  &.suggestion {
    background: #dbeafe;
    color: #1e40af;
  }
`;

const Actions = styled.div`
  display: flex;
  gap: 6px;
  border-top: 1px solid #e2e8f0;
  padding: 8px 12px;
  background: #f8fafc;
  border-radius: 0 0 8px 8px;
  margin: 0 -12px -12px -12px;
`;

const ActionButton = styled.button`
  flex: 1;
  padding: 6px 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  border: none;
  border-radius: 4px;
  cursor: pointer;
  transition: all 0.15s ease;
  
  &.accept {
    background: linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%);
    color: white;
    
    &:hover {
      transform: translateY(-1px);
      box-shadow: 0 2px 8px rgba(124, 58, 237, 0.3);
    }
  }
  
  &.reject {
    background: white;
    color: #64748b;
    border: 1px solid #e2e8f0;
    
    &:hover {
      background: #f8fafc;
      color: #334155;
    }
  }
  
  &:active {
    transform: scale(0.98);
  }
`;

/**
 * AISuggestionMarker Component
 */
export const AISuggestionMarker = ({
  original,
  corrected,
  type = 'grammar',
  onAccept,
  onReject,
  children
}) => {
  const [showTooltip, setShowTooltip] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 });
  const spanRef = useRef(null);
  const tooltipRef = useRef(null);
  const hideTimeoutRef = useRef(null);
  
  useEffect(() => {
    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, []);
  
  const handleMouseEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
    
    if (spanRef.current) {
      const rect = spanRef.current.getBoundingClientRect();
      const tooltipWidth = 280; // approximate width
      
      let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);
      let top = rect.bottom + 8;
      
      // Keep tooltip in viewport
      if (left < 10) left = 10;
      if (left + tooltipWidth > window.innerWidth - 10) {
        left = window.innerWidth - tooltipWidth - 10;
      }
      
      setTooltipPosition({ top, left });
      setShowTooltip(true);
    }
  };
  
  const handleMouseLeave = () => {
    hideTimeoutRef.current = setTimeout(() => {
      setShowTooltip(false);
    }, 150);
  };
  
  const handleTooltipMouseEnter = () => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
    }
  };
  
  const handleTooltipMouseLeave = () => {
    setShowTooltip(false);
  };
  
  const handleAccept = (e) => {
    e.stopPropagation();
    setShowTooltip(false);
    onAccept?.(corrected);
  };
  
  const handleReject = (e) => {
    e.stopPropagation();
    setShowTooltip(false);
    onReject?.();
  };
  
  return (
    <>
      <SuggestionSpan
        ref={spanRef}
        data-type={type}
        data-original={original}
        data-corrected={corrected}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      >
        {children || original}
      </SuggestionSpan>
      
      {showTooltip && (
        <Tooltip
          ref={tooltipRef}
          style={{
            top: `${tooltipPosition.top}px`,
            left: `${tooltipPosition.left}px`,
          }}
          onMouseEnter={handleTooltipMouseEnter}
          onMouseLeave={handleTooltipMouseLeave}
        >
          <TooltipContent>
            <TypeBadge className={type}>
              {type === 'grammar' && '✓'}
              {type === 'spelling' && '📝'}
              {type === 'style' && '✨'}
              {type === 'suggestion' && '💡'}
              {' '}
              {type}
            </TypeBadge>
            
            <ComparisonRow>
              <TextBox className="original">{original}</TextBox>
              <Arrow>→</Arrow>
              <TextBox className="corrected">{corrected}</TextBox>
            </ComparisonRow>
          </TooltipContent>
          
          <Actions>
            <ActionButton className="accept" onClick={handleAccept}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              Accept
            </ActionButton>
            <ActionButton className="reject" onClick={handleReject}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                <line x1="18" y1="6" x2="6" y2="18" />
                <line x1="6" y1="6" x2="18" y2="18" />
              </svg>
              Ignore
            </ActionButton>
          </Actions>
        </Tooltip>
      )}
    </>
  );
};

export default AISuggestionMarker;
