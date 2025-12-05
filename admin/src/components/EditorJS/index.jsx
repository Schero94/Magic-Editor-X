/**
 * Magic Editor X - Premium Block Editor
 * Fullscreen support, resizable, beautiful UI
 */
import React, { useState, useCallback, useRef, useEffect, useMemo, forwardRef } from 'react';
import { Field, Loader } from '@strapi/design-system';
import styled, { css, createGlobalStyle } from 'styled-components';
import { 
  Bars3BottomLeftIcon,
  PhotoIcon,
  LinkIcon,
  CodeBracketIcon,
  TableCellsIcon,
  ListBulletIcon,
  CheckCircleIcon,
  ChatBubbleBottomCenterTextIcon,
  ExclamationTriangleIcon,
  MinusIcon,
  SparklesIcon,
  PencilSquareIcon,
  ArrowsPointingOutIcon,
  ArrowsPointingInIcon,
  DocumentDuplicateIcon,
  TrashIcon,
  EyeIcon,
} from '@heroicons/react/24/outline';
import EditorJS from '@editorjs/editorjs';

import { getTools, initUndoRedo, initDragDrop } from '../../config/tools';
import MediaLibComponent from '../MediaLib/MediaLibComponent';
import { getToggleFunc, changeFunc } from '../MediaLib/utils';
import { PLUGIN_ID } from '../../pluginId';
import { useMagicCollaboration } from '../../hooks/useMagicCollaboration';

/* ============================================
   STYLED COMPONENTS
   ============================================ */

const FullscreenGlobalStyle = createGlobalStyle`
  body.editor-fullscreen {
    overflow: hidden !important;
  }
`;

/* Global z-index fixes for Editor.js popovers (may render at body level) */
const EditorJSGlobalStyles = createGlobalStyle`
  /* Popover rendered at document body */
  body > .ce-popover,
  body > .ce-popover--opened,
  body > .ce-popover__container,
  body > .ce-settings,
  body > .ce-conversion-toolbar,
  body > .ce-inline-toolbar {
    z-index: 99999 !important;
  }
  
  /* Ensure popovers are visible above Strapi modals */
  .ce-popover,
  .ce-popover--opened {
    z-index: 99999 !important;
  }
  
  /* ============================================
     READONLY MODE - Block all editing interactions
     ============================================ */
  .editor-readonly {
    /* Block all pointer events on editing elements */
    .ce-block__content,
    .ce-paragraph,
    .cdx-block,
    .ce-header,
    [contenteditable] {
      pointer-events: none !important;
      cursor: not-allowed !important;
      user-select: text !important; /* Allow text selection for copying */
    }
    
    /* Hide editing UI elements */
    .ce-toolbar,
    .ce-toolbar__plus,
    .ce-toolbar__actions,
    .ce-settings,
    .ce-block--selected::after,
    .ce-inline-toolbar,
    .ce-conversion-toolbar {
      display: none !important;
      visibility: hidden !important;
      pointer-events: none !important;
    }
    
    /* Visual indicator that editor is readonly */
    .codex-editor {
      opacity: 0.9;
    }
    
    /* Disable contenteditable */
    [contenteditable="true"] {
      pointer-events: none !important;
      -webkit-user-modify: read-only !important;
    }
  }
  
  /* ============================================
     STRAPI MEDIA LIBRARY - Higher z-index for fullscreen
     ============================================ */
  [data-react-portal],
  .ReactModalPortal,
  [role="dialog"],
  [data-strapi-modal="true"],
  .upload-dialog,
  [class*="Modal"],
  [class*="modal"],
  [class*="Dialog"],
  [class*="dialog"] {
    z-index: 100001 !important;
  }
  
  /* Strapi overlay */
  [data-strapi-modal-overlay="true"],
  [class*="Overlay"] {
    z-index: 100000 !important;
  }
  
  .ce-popover__container {
    z-index: 99999 !important;
    background: white;
    border-radius: 8px;
    box-shadow: 0 4px 20px rgba(0, 0, 0, 0.15) !important;
  }
  
  /* Settings popover */
  .ce-settings {
    z-index: 99999 !important;
  }
  
  /* Inline toolbar */
  .ce-inline-toolbar {
    z-index: 99998 !important;
  }
  
  /* Conversion toolbar */
  .ce-conversion-toolbar {
    z-index: 99999 !important;
  }
  
  /* Block tune popovers */
  .ce-block-tunes,
  .ce-block-tunes__buttons {
    z-index: 99999 !important;
  }
`;

const EditorContainer = styled.div`
  position: ${props => props.$isFullscreen ? 'fixed' : 'relative'};
  top: ${props => props.$isFullscreen ? '0' : 'auto'};
  left: ${props => props.$isFullscreen ? '0' : 'auto'};
  right: ${props => props.$isFullscreen ? '0' : 'auto'};
  bottom: ${props => props.$isFullscreen ? '0' : 'auto'};
  z-index: ${props => props.$isFullscreen ? '9999' : '1'};
  background: ${props => props.$isFullscreen ? '#f8fafc' : 'transparent'};
  display: flex;
  flex-direction: column;
  min-height: ${props => props.$isFullscreen ? '100vh' : `${props.$minHeight}px`};
  height: ${props => props.$isFullscreen ? '100vh' : 'auto'};
  margin-top: ${props => props.$isFullscreen ? '0' : '4px'};
  
  ${props => props.$isFullscreen && css`
    padding: 20px;
    
    @media (min-width: 1200px) {
      padding: 40px 80px;
    }
  `}
`;

const EditorCard = styled.div`
  background: white;
  border: 1px solid ${props => props.$hasError ? '#dc2626' : props.$isFocused ? '#7C3AED' : '#e2e8f0'};
  border-radius: 16px;
  display: flex;
  flex-direction: column;
  flex: 1;
  box-shadow: ${props => props.$isFocused 
    ? '0 0 0 3px rgba(124, 58, 237, 0.1), 0 4px 16px rgba(0, 0, 0, 0.08)' 
    : '0 1px 3px rgba(0, 0, 0, 0.04)'};
  transition: all 0.2s ease;
  resize: ${props => props.$isFullscreen ? 'none' : 'vertical'};
  min-height: ${props => props.$minHeight}px;
  overflow: visible; /* Allow dropdowns to escape container bounds */
  
  &:hover {
    border-color: ${props => props.$hasError ? '#dc2626' : '#a78bfa'};
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  }
  
  ${props => props.$disabled && css`
    opacity: 0.6;
    pointer-events: none;
    background: #f9fafb;
  `}
`;

const EditorHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  background: linear-gradient(180deg, #fafbff 0%, #f5f7ff 100%);
  border-bottom: 1px solid #eef0f6;
  flex-shrink: 0;
  border-radius: 16px 16px 0 0;
  gap: 8px;
  flex-wrap: wrap;
  
  @media (max-width: 640px) {
    padding: 10px 12px;
    gap: 6px;
  }
`;

const HeaderLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  flex-shrink: 0;
  
  @media (max-width: 640px) {
    gap: 8px;
  }
`;

const Logo = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  
  svg {
    width: 20px;
    height: 20px;
    color: #7C3AED;
  }
  
  @media (max-width: 480px) {
    gap: 4px;
    
    svg {
      width: 18px;
      height: 18px;
    }
  }
`;

const LogoText = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: #6366f1;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  
  @media (max-width: 768px) {
    font-size: 11px;
  }
  
  @media (max-width: 480px) {
    display: none;
  }
`;

const STATUS_TOKENS = {
  idle: { bg: '#e2e8f0', color: '#475569', dot: '#94a3b8' },
  requesting: { bg: '#fef3c7', color: '#92400e', dot: '#f59e0b' },
  connecting: { bg: '#ede9fe', color: '#5b21b6', dot: '#7C3AED' },
  connected: { bg: '#dcfce7', color: '#166534', dot: '#22c55e' },
  disconnected: { bg: '#fee2e2', color: '#991b1b', dot: '#ef4444' },
  denied: { bg: '#fee2e2', color: '#b91c1c', dot: '#dc2626' },
  disabled: { bg: '#e2e8f0', color: '#475569', dot: '#94a3b8' },
};

const getStatusToken = (status) => STATUS_TOKENS[status] || STATUS_TOKENS.idle;

const BlockCount = styled.span`
  font-size: 11px;
  font-weight: 600;
  color: #7C3AED;
  background: #ede9fe;
  padding: 4px 10px;
  border-radius: 20px;
  white-space: nowrap;
  
  @media (max-width: 480px) {
    font-size: 10px;
    padding: 3px 8px;
  }
`;

const CollabBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  padding: 4px 10px;
  border-radius: 999px;
  background: ${({ $status }) => getStatusToken($status).bg};
  color: ${({ $status }) => getStatusToken($status).color};
  border: 1px solid rgba(148, 163, 184, 0.25);
`;

const StatusDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${({ $status }) => getStatusToken($status).dot};
  box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.6);
`;

const PeerStack = styled.div`
  display: inline-flex;
  align-items: center;
  margin-left: 8px;
`;

const PeerAvatar = styled.span`
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: rgba(124, 58, 237, 0.08);
  border: 1px solid rgba(124, 58, 237, 0.25);
  color: #5b21b6;
  font-size: 10px;
  font-weight: 700;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-left: -6px;

  &:first-child {
    margin-left: 0;
  }
`;

const CollabNotice = styled.div`
  padding: 10px 16px;
  font-size: 12px;
  color: #b45309;
  background: #fffbeb;
  border-top: 1px solid #fde68a;
`;

const ViewerBanner = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  padding: 12px 20px;
  background: linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%);
  color: white;
  font-size: 14px;
  font-weight: 600;
  text-align: center;
  
  svg {
    width: 20px;
    height: 20px;
  }
  
  span {
    opacity: 0.9;
    font-weight: 400;
  }
  
  @media (max-width: 640px) {
    padding: 10px 16px;
    font-size: 13px;
    gap: 8px;
  }
`;

const RoleBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  background: ${props => 
    props.$role === 'viewer' ? 'rgba(59, 130, 246, 0.15)' :
    props.$role === 'owner' ? 'rgba(245, 158, 11, 0.15)' :
    'rgba(16, 185, 129, 0.15)'
  };
  color: ${props => 
    props.$role === 'viewer' ? '#1d4ed8' :
    props.$role === 'owner' ? '#b45309' :
    '#047857'
  };
  border: 1px solid ${props => 
    props.$role === 'viewer' ? 'rgba(59, 130, 246, 0.3)' :
    props.$role === 'owner' ? 'rgba(245, 158, 11, 0.3)' :
    'rgba(16, 185, 129, 0.3)'
  };
`;

/* ============================================
   FLOATING LIVE SESSION INDICATOR
   ============================================ */

const LiveSessionFloat = styled.div`
  position: absolute;
  top: 60px;
  right: 16px;
  z-index: 50;
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 8px;
  
  @media (max-width: 768px) {
    top: 50px;
    right: 12px;
    gap: 6px;
  }
  
  @media (max-width: 480px) {
    top: auto;
    bottom: 60px;
    right: 8px;
    gap: 4px;
  }
`;

const LiveSessionCard = styled.div`
  background: white;
  border: 1px solid ${({ $status }) => 
    $status === 'connected' ? 'rgba(34, 197, 94, 0.3)' : 
    $status === 'denied' ? 'rgba(239, 68, 68, 0.3)' : 
    'rgba(124, 58, 237, 0.2)'};
  border-radius: 12px;
  padding: 10px 14px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.08), 0 2px 8px rgba(0, 0, 0, 0.04);
  display: flex;
  align-items: center;
  gap: 10px;
  backdrop-filter: blur(8px);
  transition: all 0.3s ease;
  
  &:hover {
    transform: translateX(-4px);
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.12);
  }
  
  @media (max-width: 640px) {
    padding: 8px 12px;
    gap: 8px;
    border-radius: 10px;
  }
  
  @media (max-width: 480px) {
    padding: 6px 10px;
    gap: 6px;
    border-radius: 8px;
    
    &:hover {
      transform: none;
    }
  }
`;

const LiveDot = styled.div`
  width: 10px;
  height: 10px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${({ $status }) => getStatusToken($status).dot};
  box-shadow: ${({ $status }) => 
    $status === 'connected' ? '0 0 0 3px rgba(34, 197, 94, 0.2)' : 
    $status === 'denied' ? '0 0 0 3px rgba(239, 68, 68, 0.2)' : 
    '0 0 0 3px rgba(124, 58, 237, 0.15)'};
  
  ${({ $status }) => $status === 'connected' && css`
    animation: pulse 2s ease-in-out infinite;
    
    @keyframes pulse {
      0%, 100% { 
        box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
        transform: scale(1);
      }
      50% { 
        box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.1);
        transform: scale(1.1);
      }
    }
  `}
  
  @media (max-width: 480px) {
    width: 8px;
    height: 8px;
  }
`;

const LiveText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const LiveStatus = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${({ $status }) => getStatusToken($status).color};
  
  @media (max-width: 640px) {
    font-size: 11px;
  }
  
  @media (max-width: 480px) {
    font-size: 10px;
  }
`;

const LiveSubtext = styled.span`
  font-size: 10px;
  color: #94a3b8;
  
  @media (max-width: 480px) {
    display: none;
  }
`;

const PeersCard = styled.div`
  background: white;
  border: 1px solid rgba(124, 58, 237, 0.15);
  border-radius: 12px;
  padding: 8px 12px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.06);
  display: flex;
  align-items: center;
  gap: 8px;
  transition: all 0.3s ease;
  
  &:hover {
    transform: translateX(-4px);
    border-color: rgba(124, 58, 237, 0.3);
  }
  
  @media (max-width: 640px) {
    padding: 6px 10px;
    gap: 6px;
    border-radius: 10px;
  }
  
  @media (max-width: 480px) {
    padding: 4px 8px;
    border-radius: 8px;
    
    &:hover {
      transform: none;
    }
  }
`;

const PeersAvatarGroup = styled.div`
  display: flex;
  align-items: center;
`;

const PeerAvatarLive = styled.div`
  width: 28px;
  height: 28px;
  border-radius: 50%;
  background: ${({ $color }) => $color || 'linear-gradient(135deg, #7C3AED 0%, #a855f7 100%)'};
  border: 2px solid white;
  color: white;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  margin-left: -8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  transition: all 0.2s ease;
  cursor: default;
  position: relative;
  
  &:first-child {
    margin-left: 0;
  }
  
  &:hover {
    transform: translateY(-2px) scale(1.1);
    z-index: 10;
  }
  
  @media (max-width: 640px) {
    width: 24px;
    height: 24px;
    font-size: 9px;
    margin-left: -6px;
    
    &:first-child {
      margin-left: 0;
    }
  }
  
  @media (max-width: 480px) {
    width: 22px;
    height: 22px;
    font-size: 8px;
    border-width: 1.5px;
    margin-left: -5px;
    
    &:first-child {
      margin-left: 0;
    }
    
    &:hover {
      transform: none;
    }
    
    /* Hide tooltip on mobile */
    &::after {
      display: none;
    }
  }
  
  &::after {
    content: attr(data-name);
    position: absolute;
    bottom: calc(100% + 6px);
    left: 50%;
    transform: translateX(-50%);
    background: #1e293b;
    color: white;
    font-size: 10px;
    font-weight: 500;
    padding: 4px 8px;
    border-radius: 6px;
    white-space: nowrap;
    opacity: 0;
    visibility: hidden;
    transition: all 0.15s ease;
    pointer-events: none;
    z-index: 100;
  }
  
  &:hover::after {
    opacity: 1;
    visibility: visible;
  }
`;

const PeersLabel = styled.span`
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
  white-space: nowrap;
  
  @media (max-width: 640px) {
    font-size: 10px;
  }
  
  @media (max-width: 480px) {
    display: none;
  }
`;

const PEER_COLORS = [
  'linear-gradient(135deg, #7C3AED 0%, #a855f7 100%)',
  'linear-gradient(135deg, #3b82f6 0%, #60a5fa 100%)',
  'linear-gradient(135deg, #10b981 0%, #34d399 100%)',
  'linear-gradient(135deg, #f59e0b 0%, #fbbf24 100%)',
  'linear-gradient(135deg, #ef4444 0%, #f87171 100%)',
  'linear-gradient(135deg, #ec4899 0%, #f472b6 100%)',
];

const Toolbar = styled.div`
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  
  @media (max-width: 640px) {
    gap: 2px;
  }
`;

const ToolbarDivider = styled.div`
  width: 1px;
  height: 24px;
  background: #e2e8f0;
  margin: 0 8px;
  
  @media (max-width: 768px) {
    margin: 0 4px;
    height: 20px;
  }
  
  @media (max-width: 480px) {
    display: none;
  }
`;

const ToolButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 34px;
  height: 34px;
  border: none;
  background: ${props => props.$active ? '#7C3AED' : 'transparent'};
  color: ${props => props.$active ? 'white' : '#64748b'};
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
  position: relative;
  flex-shrink: 0;
  
  svg {
    width: 18px;
    height: 18px;
  }
  
  &:hover {
    background: ${props => props.$active ? '#6d28d9' : '#f1f5f9'};
    color: ${props => props.$active ? 'white' : '#7C3AED'};
    transform: translateY(-1px);
  }
  
  &:active {
    transform: translateY(0);
  }
  
  &::after {
    content: attr(data-tooltip);
    position: absolute;
    bottom: calc(100% + 8px);
    left: 50%;
    transform: translateX(-50%);
    background: #1e293b;
    color: white;
    font-size: 11px;
    font-weight: 500;
    padding: 6px 10px;
    border-radius: 6px;
    white-space: nowrap;
    opacity: 0;
    visibility: hidden;
    transition: all 0.15s ease;
    pointer-events: none;
    z-index: 100;
  }
  
  &:hover::after {
    opacity: 1;
    visibility: visible;
  }
  
  @media (max-width: 768px) {
    width: 32px;
    height: 32px;
    
    svg {
      width: 16px;
      height: 16px;
    }
  }
  
  @media (max-width: 480px) {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    
    svg {
      width: 14px;
      height: 14px;
    }
    
    /* Hide tooltips on mobile - use touch */
    &::after {
      display: none;
    }
  }
`;

const QuickActions = styled.div`
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 4px;
  background: white;
  border-radius: 10px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  flex-wrap: wrap;
  
  @media (max-width: 768px) {
    padding: 3px;
    gap: 1px;
  }
  
  @media (max-width: 480px) {
    padding: 2px;
    border-radius: 8px;
    
    /* Hide less essential buttons on mobile */
    & > button:nth-child(n+6) {
      display: none;
    }
  }
  
  @media (max-width: 360px) {
    /* Show only first 4 buttons on very small screens */
    & > button:nth-child(n+5) {
      display: none;
    }
  }
`;

const EditorContent = styled.div`
  flex: 1;
  overflow: visible; /* Allow toolbars/popovers to escape */
  position: relative;
  padding: 24px 24px 24px 16px; /* Less left padding since toolbar has its own space */
  min-height: 200px;
  
  ${props => props.$isFullscreen && css`
    padding: clamp(32px, 4vw, 60px);
    width: 100%;
    max-width: 100%;
    margin: 0;
    align-self: stretch;
  `}
`;

const EditorWrapper = styled.div`
  min-height: ${props => props.$minHeight - 120}px;
  font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
  font-size: 15px;
  line-height: 1.7;
  color: #1e293b;
  position: relative;
  
  /* ============================================
     Z-INDEX FIXES FOR DROPDOWNS/POPOVERS
     ============================================ */
  
  /* Main Editor.js container - ensure proper stacking context */
  .codex-editor {
    position: relative;
    z-index: 1;
  }
  
  /* Toolbar - needs to be above content */
  .ce-toolbar {
    z-index: 100 !important;
    position: absolute;
  }
  
  /* Toolbox (+ button dropdown) - keep position relative to toolbar */
  .ce-toolbox {
    z-index: 1000 !important;
  }
  
  /* Popover/Dropdown menus - high z-index but keep natural positioning */
  .ce-popover {
    z-index: 10000 !important;
  }
  
  .ce-popover--opened {
    z-index: 10000 !important;
  }
  
  .ce-popover__container {
    z-index: 10000 !important;
  }
  
  /* Block settings popover */
  .ce-settings {
    z-index: 10000 !important;
  }
  
  /* Inline toolbar (bold, italic, etc.) */
  .ce-inline-toolbar {
    z-index: 9000 !important;
  }
  
  /* Inline toolbar actions dropdown */
  .ce-inline-toolbar__dropdown {
    z-index: 9500 !important;
  }
  
  /* Conversion toolbar */
  .ce-conversion-toolbar {
    z-index: 10000 !important;
  }
  
  /* Search field in popovers */
  .cdx-search-field,
  .cdx-search-field__input {
    z-index: 10001 !important;
  }
  
  /* ============================================
     TOOLBAR INSIDE EDITOR - Position Fix
     ============================================ */
  
  /* Make the redactor (content area) have left padding for toolbar */
  .codex-editor__redactor {
    padding-bottom: 100px !important;
    padding-left: 50px !important; /* Space for toolbar */
    margin-left: 0 !important;
  }
  
  /* Content blocks - full width within padded area */
  .ce-block__content {
    max-width: 100%;
    margin-left: 0;
    margin-right: 0;
  }
  
  /* ============================================
     BLOCK HOVER EFFECT - Visual feedback
     ============================================ */
  .ce-block {
    position: relative;
    border-radius: 8px;
    transition: all 0.15s ease;
    margin: 2px 0;
    
    &::before {
      content: '';
      position: absolute;
      top: -2px;
      left: -8px;
      right: -8px;
      bottom: -2px;
      border: 2px solid transparent;
      border-radius: 8px;
      pointer-events: none;
      transition: all 0.15s ease;
    }
    
    &:hover::before {
      border-color: #e2e8f0;
      background: rgba(241, 245, 249, 0.3);
    }
    
    /* Selected block - stronger highlight */
    &--selected::before {
      border-color: #cbd5e1 !important;
      background: rgba(203, 213, 225, 0.15) !important;
    }
    
    /* Focused block */
    &--focused::before {
      border-color: #7C3AED !important;
      background: rgba(124, 58, 237, 0.05) !important;
    }
  }
  
  /* Block content hover - subtle background */
  .ce-block__content:hover {
    background: rgba(248, 250, 252, 0.5);
    border-radius: 6px;
  }
  
  /* Toolbar positioning - inside the editor */
  .ce-toolbar__content {
    max-width: 100%;
    margin-left: 0;
  }
  
  .ce-toolbar {
    left: 0 !important;
  }
  
  .ce-toolbar__plus {
    left: 0 !important;
    position: relative !important;
  }
  
  .ce-toolbar__actions {
    right: 0 !important;
    position: absolute !important;
  }
  
  /* Settings button (⋮⋮) */
  .ce-toolbar__settings-btn {
    margin-left: 4px;
  }
  
  /* ============================================
     POPOVER/DROPDOWN STYLING
     ============================================ */
  
  .ce-popover {
    border-radius: 12px !important;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12), 0 2px 8px rgba(0, 0, 0, 0.08) !important;
    border: 1px solid #e2e8f0 !important;
    overflow: hidden;
  }
  
  .ce-popover__container {
    background: white !important;
    border-radius: 12px !important;
  }
  
  .ce-popover__items {
    padding: 8px !important;
  }
  
  .ce-popover-item {
    border-radius: 8px !important;
    padding: 8px 12px !important;
    margin: 2px 0 !important;
    transition: all 0.15s ease !important;
    
    &:hover {
      background: #f1f5f9 !important;
    }
  }
  
  .ce-popover-item__icon {
    color: #64748b !important;
    width: 20px !important;
    height: 20px !important;
    margin-right: 10px !important;
  }
  
  .ce-popover-item__title {
    font-weight: 500 !important;
    color: #334155 !important;
  }
  
  .ce-popover-item--focused {
    background: #ede9fe !important;
    
    .ce-popover-item__icon {
      color: #7C3AED !important;
    }
    
    .ce-popover-item__title {
      color: #7C3AED !important;
    }
  }
  
  /* Search field in popover */
  .cdx-search-field {
    margin: 8px !important;
    border-radius: 8px !important;
    border: 1px solid #e2e8f0 !important;
    background: #f8fafc !important;
    
    &:focus-within {
      border-color: #7C3AED !important;
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1) !important;
    }
  }
  
  .cdx-search-field__input {
    font-size: 14px !important;
    color: #334155 !important;
    
    &::placeholder {
      color: #94a3b8 !important;
    }
  }
  
  /* Separator in popover */
  .ce-popover__item-separator {
    margin: 8px !important;
    background: #e2e8f0 !important;
  }
  
  /* ============================================
     INDENT TUNE FIX
     ============================================ */
  
  /* Indent tune container */
  .ce-popover-item[data-item-name="indentTune"],
  .ce-popover-item[data-item-name="indent"] {
    display: flex !important;
    align-items: center !important;
    gap: 8px !important;
    padding: 4px 8px !important;
  }
  
  /* Indent tune wrapper - force horizontal layout */
  .indent-tune,
  [class*="indent-tune"],
  .ce-popover-item__custom-html {
    display: flex !important;
    align-items: center !important;
    gap: 4px !important;
  }
  
  /* Indent buttons */
  .indent-tune__button,
  .indent-tune button,
  [class*="indent"] button {
    width: 32px !important;
    height: 32px !important;
    min-width: 32px !important;
    border: 1px solid #e2e8f0 !important;
    border-radius: 6px !important;
    background: white !important;
    cursor: pointer !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    transition: all 0.15s ease !important;
    pointer-events: auto !important;
    position: relative !important;
    z-index: 10 !important;
    
    &:hover {
      background: #f1f5f9 !important;
      border-color: #7C3AED !important;
    }
    
    &:active {
      background: #ede9fe !important;
      transform: scale(0.95) !important;
    }
  }
  
  /* Indent button icons */
  .indent-tune__button svg,
  .indent-tune button svg,
  [class*="indent"] button svg {
    width: 16px !important;
    height: 16px !important;
    color: #64748b !important;
  }
  
  /* Indent label */
  .indent-tune__label,
  .indent-tune span:not(:empty) {
    font-size: 13px !important;
    font-weight: 500 !important;
    color: #334155 !important;
    margin: 0 4px !important;
  }
  
  /* ============================================
     ALIGNMENT TUNE FIX  
     ============================================ */
  
  .ce-popover-item[data-item-name="alignmentTune"],
  .ce-popover-item[data-item-name="alignment"] {
    display: flex !important;
    align-items: center !important;
    gap: 4px !important;
    padding: 4px 8px !important;
  }
  
  .alignment-tune,
  [class*="alignment-tune"],
  [class*="text-alignment"] {
    display: flex !important;
    align-items: center !important;
    gap: 2px !important;
  }
  
  .alignment-tune button,
  [class*="alignment"] button,
  [class*="text-alignment"] button {
    width: 28px !important;
    height: 28px !important;
    min-width: 28px !important;
    border: 1px solid transparent !important;
    border-radius: 4px !important;
    background: transparent !important;
    cursor: pointer !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    transition: all 0.15s ease !important;
    pointer-events: auto !important;
    
    &:hover {
      background: #f1f5f9 !important;
    }
    
    &.active,
    &[class*="active"] {
      background: #ede9fe !important;
      border-color: #7C3AED !important;
    }
  }
  
  .alignment-tune button svg,
  [class*="alignment"] button svg {
    width: 16px !important;
    height: 16px !important;
    color: #64748b !important;
  }
  
  /* Remote user editing highlight - subtle background only, cursor shown separately */
  .ce-block--remote-editing {
    position: relative;
    background: rgba(59, 130, 246, 0.04);
    border-radius: 4px;
    transition: background 0.2s ease;
  }
  
  /* Typing indicator animation */
  .typing-indicator .dot {
    display: inline-block;
    width: 4px;
    height: 4px;
    border-radius: 50%;
    background: currentColor;
    opacity: 0.7;
    animation: typingBounce 1.4s ease-in-out infinite;
  }
  
  .typing-indicator .dot:nth-child(1) {
    animation-delay: 0s;
  }
  
  .typing-indicator .dot:nth-child(2) {
    animation-delay: 0.2s;
  }
  
  .typing-indicator .dot:nth-child(3) {
    animation-delay: 0.4s;
  }
  
  @keyframes typingBounce {
    0%, 60%, 100% {
      transform: translateY(0);
      opacity: 0.4;
    }
    30% {
      transform: translateY(-3px);
      opacity: 1;
    }
  }
  
  /* Remote cursor pulse animation */
  .remote-cursor-indicator {
    animation: cursorPulse 1.5s ease-in-out infinite;
  }
  
  @keyframes cursorPulse {
    0%, 100% {
      opacity: 1;
      box-shadow: 0 0 8px currentColor;
    }
    50% {
      opacity: 0.7;
      box-shadow: 0 0 12px currentColor;
    }
  }
`;

const EmptyState = styled.div`
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  pointer-events: none;
`;

const EmptyIcon = styled.div`
  width: 100px;
  height: 100px;
  margin: 0 auto 20px;
  background: linear-gradient(135deg, #f0f4ff 0%, #e8ecff 100%);
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  animation: float 4s ease-in-out infinite;
  
  svg {
    width: 48px;
    height: 48px;
    color: #a5b4fc;
  }
  
  @keyframes float {
    0%, 100% { transform: translateY(0); }
    50% { transform: translateY(-10px); }
  }
  
  @media (max-width: 480px) {
    width: 72px;
    height: 72px;
    margin: 0 auto 16px;
    
    svg {
      width: 32px;
      height: 32px;
    }
  }
`;

const EmptyTitle = styled.h3`
  font-size: 18px;
  font-weight: 600;
  color: #64748b;
  margin: 0 0 8px 0;
  
  @media (max-width: 480px) {
    font-size: 16px;
  }
`;

const EmptySubtitle = styled.p`
  font-size: 14px;
  color: #94a3b8;
  margin: 0 0 20px 0;
  
  @media (max-width: 480px) {
    font-size: 12px;
    margin: 0 0 16px 0;
    padding: 0 16px;
  }
`;

const KeyboardHints = styled.div`
  display: flex;
  gap: 16px;
  justify-content: center;
  flex-wrap: wrap;
  
  @media (max-width: 640px) {
    gap: 10px;
  }
  
  @media (max-width: 480px) {
    display: none; /* Hide keyboard hints on mobile - not useful for touch */
  }
`;

const KeyHint = styled.span`
  font-size: 12px;
  color: #94a3b8;
  
  kbd {
    display: inline-block;
    padding: 2px 8px;
    background: #f1f5f9;
    border: 1px solid #e2e8f0;
    border-radius: 6px;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 11px;
    color: #475569;
    margin-right: 4px;
    box-shadow: 0 1px 0 rgba(0,0,0,0.05);
  }
  
  @media (max-width: 640px) {
    font-size: 10px;
    
    kbd {
      padding: 2px 6px;
      font-size: 9px;
    }
  }
`;

const EditorFooter = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 10px 16px;
  background: #fafbfc;
  border-top: 1px solid #f1f5f9;
  flex-shrink: 0;
  border-radius: 0 0 16px 16px;
  gap: 8px;
  flex-wrap: wrap;
  
  @media (max-width: 640px) {
    padding: 8px 12px;
  }
  
  @media (max-width: 480px) {
    padding: 8px 10px;
    gap: 6px;
  }
`;

const FooterLeft = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  
  @media (max-width: 640px) {
    gap: 12px;
  }
  
  @media (max-width: 480px) {
    gap: 8px;
  }
`;

const FooterStat = styled.span`
  font-size: 12px;
  color: #94a3b8;
  white-space: nowrap;
  
  strong {
    color: #64748b;
    font-weight: 600;
  }
  
  @media (max-width: 640px) {
    font-size: 11px;
  }
  
  @media (max-width: 480px) {
    font-size: 10px;
  }
`;

const FooterRight = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  
  @media (max-width: 640px) {
    gap: 6px;
  }
`;

const FooterButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  background: ${props => props.$primary ? 'linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%)' : 'white'};
  border: 1px solid ${props => props.$primary ? 'transparent' : '#e2e8f0'};
  border-radius: 8px;
  font-size: 12px;
  font-weight: 500;
  color: ${props => props.$primary ? 'white' : '#64748b'};
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  
  svg {
    width: 14px;
    height: 14px;
  }
  
  &:hover {
    background: ${props => props.$primary ? 'linear-gradient(135deg, #6d28d9 0%, #5b21b6 100%)' : '#f8fafc'};
    border-color: ${props => props.$primary ? 'transparent' : '#7C3AED'};
    color: ${props => props.$primary ? 'white' : '#7C3AED'};
    transform: translateY(-1px);
    box-shadow: ${props => props.$primary ? '0 4px 12px rgba(124, 58, 237, 0.3)' : 'none'};
  }
  
  @media (max-width: 640px) {
    padding: 5px 10px;
    font-size: 11px;
    gap: 4px;
    
    svg {
      width: 12px;
      height: 12px;
    }
  }
  
  @media (max-width: 480px) {
    padding: 4px 8px;
    font-size: 10px;
    border-radius: 6px;
    
    /* Hide text on very small screens, show only icon */
    & > span {
      display: none;
    }
  }
`;

const LoadingOverlay = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(255, 255, 255, 0.9);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  z-index: 10;
`;

const LoadingText = styled.span`
  font-size: 13px;
  color: #64748b;
`;

const ResizeHandle = styled.div`
  position: absolute;
  bottom: 0;
  left: 50%;
  transform: translateX(-50%);
  width: 60px;
  height: 16px;
  cursor: ns-resize;
  display: flex;
  align-items: center;
  justify-content: center;
  
  &::before {
    content: '';
    width: 40px;
    height: 4px;
    background: #e2e8f0;
    border-radius: 2px;
    transition: background 0.15s ease;
  }
  
  &:hover::before {
    background: #7C3AED;
  }
`;

/* ============================================
   REMOTE CURSOR STYLES
   ============================================ */

const RemoteCursorsContainer = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  pointer-events: none;
  z-index: 100;
  overflow: hidden;
`;

const RemoteCursor = styled.div`
  position: absolute;
  pointer-events: none;
  transition: all 0.15s ease-out;
  z-index: 100;
`;

const CursorLine = styled.div`
  width: 2px;
  height: 20px;
  background: ${props => props.$color || '#3B82F6'};
  border-radius: 1px;
  box-shadow: 0 0 4px ${props => props.$color || '#3B82F6'}40;
  animation: cursorBlink 1s ease-in-out infinite;
  
  @keyframes cursorBlink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }
`;

const CursorLabel = styled.div`
  position: absolute;
  top: -22px;
  left: 0;
  background: ${props => props.$bgColor || '#3B82F6'};
  color: ${props => props.$textColor || '#FFFFFF'};
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 4px 4px 4px 0;
  white-space: nowrap;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
  transform-origin: bottom left;
  animation: cursorLabelFadeIn 0.2s ease-out;
  
  @keyframes cursorLabelFadeIn {
    from {
      opacity: 0;
      transform: scale(0.8);
    }
    to {
      opacity: 1;
      transform: scale(1);
    }
  }
`;

const CursorHighlight = styled.div`
  position: absolute;
  background: ${props => props.$color || '#3B82F6'}20;
  border: 1px solid ${props => props.$color || '#3B82F6'}40;
  border-radius: 2px;
  pointer-events: none;
`;

const ActiveEditorsBar = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: linear-gradient(90deg, #f8fafc 0%, #f1f5f9 100%);
  border-bottom: 1px solid #e2e8f0;
  flex-shrink: 0;
  flex-wrap: wrap;
  
  @media (max-width: 640px) {
    padding: 6px 12px;
    gap: 6px;
  }
  
  @media (max-width: 480px) {
    padding: 6px 10px;
    gap: 4px;
  }
`;

const ActiveEditorBadge = styled.div`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  background: white;
  border: 1px solid ${props => props.$color || '#e2e8f0'};
  border-radius: 20px;
  font-size: 11px;
  font-weight: 500;
  color: #374151;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.05);
  transition: all 0.2s ease;
  white-space: nowrap;
  
  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  }
  
  @media (max-width: 640px) {
    padding: 3px 8px;
    font-size: 10px;
    gap: 4px;
  }
  
  @media (max-width: 480px) {
    /* Hide "Block X" info on mobile */
    & > span:last-child {
      display: none;
    }
  }
`;

const ActiveEditorDot = styled.span`
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: ${props => props.$color || '#3B82F6'};
  box-shadow: 0 0 0 2px ${props => props.$color || '#3B82F6'}30;
  animation: pulse 2s ease-in-out infinite;
  flex-shrink: 0;
  
  @keyframes pulse {
    0%, 100% { box-shadow: 0 0 0 2px ${props => props.$color || '#3B82F6'}30; }
    50% { box-shadow: 0 0 0 4px ${props => props.$color || '#3B82F6'}20; }
  }
  
  @media (max-width: 480px) {
    width: 6px;
    height: 6px;
  }
`;

const ActiveEditorsLabel = styled.span`
  font-size: 11px;
  color: #64748b;
  font-weight: 500;
  white-space: nowrap;
  
  @media (max-width: 640px) {
    font-size: 10px;
  }
  
  @media (max-width: 480px) {
    display: none;
  }
`;

/**
 * Build a unique room ID for collaboration
 * Format: contentType|documentId|fieldName
 * 
 * @param {string} fieldName - The field name
 * @param {object} attribute - Field attribute with documentId info
 * @returns {string} Unique room ID
 */
const buildRoomId = (fieldName, documentId = null) => {
  if (typeof window === 'undefined') {
    return `ssr|${fieldName}`;
  }

  const path = window.location.pathname;
  
  // Match content-manager URLs: 
  // Collection: /content-manager/collection-types/api::article.article/documentId123
  // Single: /content-manager/single-types/api::homepage.homepage
  const matches = path.match(/content-manager\/(collection-types|single-types)\/([^/]+)(?:\/([^/?]+))?/);
  
  const contentType = matches?.[2] ? decodeURIComponent(matches[2]) : 'unknown';
  const urlDocumentId = matches?.[3] || null;
  
  // Use documentId from URL, or 'single' for single types, or 'new' for new entries
  let docId = documentId || urlDocumentId;
  if (!docId) {
    docId = matches?.[1] === 'single-types' ? 'single' : 'new';
  }
  
  // Clean roomId format: contentType|documentId|fieldName
  const roomId = `${contentType}|${docId}|${fieldName}`;
  
  console.log('[Magic Editor X] buildRoomId:', { contentType, documentId: docId, fieldName, roomId });

  return roomId;
};

const getPeerInitials = (user = {}) => {
  const first = (user.firstname?.[0] || user.email?.[0] || '?').toUpperCase();
  const last = (user.lastname?.[0] || '').toUpperCase();
  return `${first}${last}`.trim();
};

const getPeerName = (user = {}) => {
  if (user.firstname || user.lastname) {
    return `${user.firstname || ''} ${user.lastname || ''}`.trim();
  }
  return user.email?.split('@')[0] || 'Anonymous';
};

/* ============================================
   MAIN COMPONENT
   ============================================ */

const Editor = forwardRef(({ 
  name,
  value,
  onChange,
  attribute,
  disabled,
  error,
  required,
  hint,
  label,
  labelAction,
  placeholder,
  ...props
}, ref) => {
  const editorRef = useRef(null);
  const editorInstanceRef = useRef(null);
  const containerRef = useRef(null);
  
  const [isReady, setIsReady] = useState(false);
  const [blocksCount, setBlocksCount] = useState(0);
  const [wordCount, setWordCount] = useState(0);
  const [charCount, setCharCount] = useState(0);
  const [isFocused, setIsFocused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [editorHeight, setEditorHeight] = useState(400);
  const [mediaLibBlockIndex, setMediaLibBlockIndex] = useState(-1);
  const [isMediaLibOpen, setIsMediaLibOpen] = useState(false);

  const serializedInitialValue = useMemo(() => {
    if (!value) {
      return '';
    }
    return typeof value === 'string' ? value : JSON.stringify(value);
  }, [value]);

  const collabRoomId = useMemo(() => buildRoomId(name), [name]);
  const collabEnabled = (attribute?.options?.collaboration?.enabled ?? true) && !disabled;

  // Ref for renderFromYDoc callback (used by useMagicCollaboration)
  const renderFromYDocRef = useRef(null);

  const {
    doc: yDoc,
    blocksMap: yBlocksMap,
    metaMap: yMetaMap,
    status: collabStatus,
    error: collabError,
    peers: collabPeers,
    awareness: collabAwareness,
    emitAwareness,
    localUserColor,
    collabRole,
    canEdit: collabCanEdit,
  } = useMagicCollaboration({
    enabled: collabEnabled,
    roomId: collabRoomId,
    fieldName: name,
    initialValue: serializedInitialValue || '',
    onRemoteUpdate: () => {
      console.log('[Magic Editor X] [CALLBACK] onRemoteUpdate callback received');
      if (renderFromYDocRef.current) {
        renderFromYDocRef.current();
      }
    },
  });

  // Get human-readable role label
  const collabRoleLabel = useMemo(() => {
    switch (collabRole) {
      case 'viewer':
        return { icon: 'V', text: 'Viewer', color: '#3b82f6' };
      case 'editor':
        return { icon: 'E', text: 'Editor', color: '#10b981' };
      case 'owner':
        return { icon: 'O', text: 'Owner', color: '#f59e0b' };
      default:
        return null;
    }
  }, [collabRole]);

  const collabStatusLabel = useMemo(() => {
    switch (collabStatus) {
      case 'connected':
        // Show role indicator when connected
        if (collabRole === 'viewer') {
          return 'Nur Lesen';
        }
        if (collabRole === 'owner') {
          return 'Live Sync';
        }
        return 'Live Sync';
      case 'connecting':
        return 'Verbinde...';
      case 'requesting':
        return 'Freigabe pruefen';
      case 'denied':
        return 'Freigabe gesperrt';
      case 'disconnected':
        return 'Neu verbinden';
      case 'disabled':
        return 'Sync aus';
      default:
        return 'Bereit';
    }
  }, [collabStatus, collabRole]);

  const collabPeersPreview = useMemo(() => collabPeers.slice(0, 3), [collabPeers]);

  // Get active editors from awareness (users who are currently editing)
  const activeEditors = useMemo(() => {
    return Object.values(collabAwareness || {}).filter(
      (entry) => entry?.user && (Date.now() - entry.lastUpdate < 30000)
    );
  }, [collabAwareness]);

  // Track cursor position and emit awareness updates
  const lastCursorUpdateRef = useRef(0);
  
  /**
   * Calculate absolute character offset from start of container
   */
  const getAbsoluteOffset = useCallback((container, node, offset) => {
    if (!container || !node) return 0;
    
    let absoluteOffset = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let currentNode = walker.nextNode();
    
    while (currentNode) {
      if (currentNode === node) {
        return absoluteOffset + offset;
      }
      absoluteOffset += currentNode.textContent?.length || 0;
      currentNode = walker.nextNode();
    }
    
    return absoluteOffset + offset;
  }, []);
  
  const emitCursorPosition = useCallback(() => {
    if (!collabEnabled || !emitAwareness || collabStatus !== 'connected') {
      return;
    }

    // Throttle updates to max 20 per second for smoother streaming
    const now = Date.now();
    if (now - lastCursorUpdateRef.current < 50) {
      return;
    }
    lastCursorUpdateRef.current = now;

    if (!editorInstanceRef.current) {
      return;
    }

    try {
      const currentBlockIndex = editorInstanceRef.current.blocks.getCurrentBlockIndex();
      const currentBlock = editorInstanceRef.current.blocks.getBlockByIndex(currentBlockIndex);
      
      // Get selection info with absolute offset
      const selection = window.getSelection();
      let selectionInfo = null;
      
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        
        // Find the block's content container for absolute offset calculation
        const blocks = editorRef.current?.querySelectorAll('.ce-block');
        const targetBlock = blocks?.[currentBlockIndex];
        const contentContainer = targetBlock?.querySelector(
          '.ce-paragraph, .ce-header, [contenteditable="true"], .cdx-block'
        );
        
        // Calculate absolute offsets within the block content
        const absoluteStart = contentContainer 
          ? getAbsoluteOffset(contentContainer, range.startContainer, range.startOffset)
          : range.startOffset;
        const absoluteEnd = contentContainer
          ? getAbsoluteOffset(contentContainer, range.endContainer, range.endOffset)
          : range.endOffset;
        
        selectionInfo = {
          collapsed: selection.isCollapsed,
          startOffset: absoluteStart,
          endOffset: absoluteEnd,
        };
      }

      emitAwareness({
        blockIndex: currentBlockIndex,
        blockId: currentBlock?.id || null,
        selection: selectionInfo,
        timestamp: now,
      });
    } catch (err) {
      // Silently ignore cursor tracking errors
    }
  }, [collabEnabled, emitAwareness, collabStatus, getAbsoluteOffset]);

  // Emit cursor position on editor interactions
  useEffect(() => {
    if (!collabEnabled || !editorRef.current) {
      return undefined;
    }

    const editorElement = editorRef.current;

    const handleInteraction = () => {
      emitCursorPosition();
    };

    // Track various interactions - more events for better sync
    editorElement.addEventListener('click', handleInteraction);
    editorElement.addEventListener('keyup', handleInteraction);
    editorElement.addEventListener('keydown', handleInteraction);  // Added for better sync
    editorElement.addEventListener('input', handleInteraction);    // Added for text changes
    editorElement.addEventListener('mouseup', handleInteraction);
    editorElement.addEventListener('selectionchange', handleInteraction); // Track selection changes

    // Also emit position periodically while focused (very frequently for streaming effect)
    let intervalId = null;
    const handleFocus = () => {
      intervalId = setInterval(emitCursorPosition, 100); // Very frequent for real-time streaming
    };
    const handleBlur = () => {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
      }
    };

    editorElement.addEventListener('focusin', handleFocus);
    editorElement.addEventListener('focusout', handleBlur);

    return () => {
      editorElement.removeEventListener('click', handleInteraction);
      editorElement.removeEventListener('keyup', handleInteraction);
      editorElement.removeEventListener('keydown', handleInteraction);
      editorElement.removeEventListener('input', handleInteraction);
      editorElement.removeEventListener('mouseup', handleInteraction);
      editorElement.removeEventListener('selectionchange', handleInteraction);
      editorElement.removeEventListener('focusin', handleFocus);
      editorElement.removeEventListener('focusout', handleBlur);
      if (intervalId) {
        clearInterval(intervalId);
      }
    };
  }, [collabEnabled, emitCursorPosition]);

  /**
   * Finds the text node and offset for placing a cursor at a specific character position
   * @param {HTMLElement} container - The container element to search in
   * @param {number} targetOffset - The target character offset
   * @returns {object|null} Object with node and offset, or null if not found
   */
  const findTextPosition = useCallback((container, targetOffset) => {
    if (!container || targetOffset === null || targetOffset === undefined) {
      return null;
    }
    
    let currentOffset = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null, false);
    let node = walker.nextNode();
    
    while (node) {
      const nodeLength = node.textContent?.length || 0;
      if (currentOffset + nodeLength >= targetOffset) {
        return {
          node,
          offset: targetOffset - currentOffset,
          rect: (() => {
            try {
              const range = document.createRange();
              range.setStart(node, Math.min(targetOffset - currentOffset, nodeLength));
              range.setEnd(node, Math.min(targetOffset - currentOffset, nodeLength));
              return range.getBoundingClientRect();
            } catch {
              return null;
            }
          })(),
        };
      }
      currentOffset += nodeLength;
      node = walker.nextNode();
    }
    
    return null;
  }, []);

  // Container ref for remote cursors
  const remoteCursorsRef = useRef(null);

  // Highlight blocks being edited by remote users and show cursor position
  useEffect(() => {
    if (!collabEnabled || !editorRef.current || !isReady) {
      return undefined;
    }

    const editorElement = editorRef.current;
    
    // Remove all previous highlights
    const previousHighlights = editorElement.querySelectorAll('.ce-block--remote-editing');
    previousHighlights.forEach((el) => {
      el.classList.remove('ce-block--remote-editing');
      el.removeAttribute('data-remote-user');
      el.style.removeProperty('--remote-color');
    });
    
    // Remove all previous cursor elements
    const previousCursors = editorElement.querySelectorAll('.remote-cursor-indicator');
    previousCursors.forEach((el) => el.remove());

    // Add highlights and cursors for active editors
    activeEditors.forEach((editor) => {
      if (editor.blockIndex === null || editor.blockIndex === undefined) {
        return;
      }

      const blocks = editorElement.querySelectorAll('.ce-block');
      const targetBlock = blocks[editor.blockIndex];
      
      if (!targetBlock) {
        return;
      }
      
      targetBlock.classList.add('ce-block--remote-editing');
      targetBlock.setAttribute('data-remote-user', getPeerName(editor.user));
      targetBlock.style.setProperty('--remote-color', editor.color?.bg || '#3B82F6');
      
      // Find the content element for cursor positioning
      const contentElement = targetBlock.querySelector(
        '.ce-paragraph, .ce-header, [contenteditable="true"], .cdx-block'
      );
      
      if (!contentElement) {
        return;
      }
      
      // Try to get exact cursor position
      let position = null;
      if (editor.selection?.startOffset !== undefined && editor.selection.startOffset >= 0) {
        position = findTextPosition(contentElement, editor.selection.startOffset);
      }
      
      // Calculate cursor position
      const editorRect = editorElement.getBoundingClientRect();
      const contentRect = contentElement.getBoundingClientRect();
      let cursorLeft, cursorTop;
      
      if (position?.rect && position.rect.width !== undefined) {
        // Use exact position from text node
        cursorLeft = position.rect.left - editorRect.left;
        cursorTop = position.rect.top - editorRect.top;
      } else {
        // Fallback: position at start of content element
        cursorLeft = contentRect.left - editorRect.left;
        cursorTop = contentRect.top - editorRect.top;
      }
      
      // Ensure valid coordinates
      if (isNaN(cursorLeft) || isNaN(cursorTop) || cursorLeft < 0) {
        cursorLeft = contentRect.left - editorRect.left;
        cursorTop = contentRect.top - editorRect.top;
      }
        
      // Create cursor indicator
      const cursorIndicator = document.createElement('div');
      cursorIndicator.className = 'remote-cursor-indicator';
      cursorIndicator.dataset.userId = editor.user.id;
      cursorIndicator.style.cssText = `
        position: absolute;
        left: ${cursorLeft}px;
        top: ${cursorTop}px;
        width: 2px;
        height: 18px;
        background: ${editor.color?.bg || '#3B82F6'};
        border-radius: 1px;
        pointer-events: none;
        z-index: 1000;
        transition: left 0.05s linear, top 0.08s ease-out;
        box-shadow: 0 0 8px ${editor.color?.bg || '#3B82F6'}60;
      `;
      
      // Add user name label with typing indicator
      const cursorLabel = document.createElement('div');
      cursorLabel.className = 'remote-cursor-label';
      cursorLabel.style.cssText = `
        position: absolute;
        top: -20px;
        left: 0;
        background: ${editor.color?.bg || '#3B82F6'};
        color: ${editor.color?.text || '#FFFFFF'};
        font-size: 9px;
        font-weight: 600;
        padding: 3px 8px;
        border-radius: 4px 4px 4px 0;
        white-space: nowrap;
        box-shadow: 0 2px 6px rgba(0,0,0,0.15);
        display: flex;
        align-items: center;
        gap: 4px;
      `;
      
      // User name
      const nameSpan = document.createElement('span');
      nameSpan.textContent = getPeerName(editor.user);
      cursorLabel.appendChild(nameSpan);
      
      // Typing indicator dots
      const typingDots = document.createElement('span');
      typingDots.className = 'typing-indicator';
      typingDots.innerHTML = `
        <span class="dot"></span>
        <span class="dot"></span>
        <span class="dot"></span>
      `;
      typingDots.style.cssText = `
        display: inline-flex;
        align-items: center;
        gap: 2px;
        margin-left: 2px;
      `;
      cursorLabel.appendChild(typingDots);
      
      cursorIndicator.appendChild(cursorLabel);
      
      editorElement.appendChild(cursorIndicator);
    });

    return () => {
      // Cleanup cursor elements
      const cursors = editorElement?.querySelectorAll('.remote-cursor-indicator');
      cursors?.forEach((el) => el.remove());
    };
  }, [collabEnabled, activeEditors, isReady, findTextPosition]);

  // Dispatch collaboration state to sidebar component
  useEffect(() => {
    const state = {
      status: collabStatus,
      peers: collabPeers,
      error: collabError,
    };
    
    // Store in window for initial sidebar render
    window.__MAGIC_EDITOR_COLLAB_STATE__ = state;
    
    // Dispatch event for sidebar updates
    window.dispatchEvent(new CustomEvent('magic-editor-collab-update', {
      detail: state,
    }));
    
    return () => {
      // Clear state when component unmounts
      window.__MAGIC_EDITOR_COLLAB_STATE__ = { status: 'disabled', peers: [], error: null };
      window.dispatchEvent(new CustomEvent('magic-editor-collab-update', {
        detail: { status: 'disabled', peers: [], error: null },
      }));
    };
  }, [collabStatus, collabPeers, collabError]);

  const isApplyingRemoteRef = useRef(false);
  const pendingRenderRef = useRef(null);
  const lastSerializedValueRef = useRef(serializedInitialValue || null);

  useEffect(() => {
    lastSerializedValueRef.current = serializedInitialValue || null;
  }, [serializedInitialValue]);

  // Calculate word & character count (MOVED UP - before usage)
  const calculateStats = useCallback((data) => {
    if (!data?.blocks) {
      setWordCount(0);
      setCharCount(0);
      return;
    }
    
    let text = '';
    data.blocks.forEach(block => {
      if (block.data?.text) text += block.data.text + ' ';
      if (block.data?.items) {
        block.data.items.forEach(item => {
          if (typeof item === 'string') text += item + ' ';
          else if (item.content) text += item.content + ' ';
        });
      }
    });
    
    const plainText = text.replace(/<[^>]*>/g, '').trim();
    setCharCount(plainText.length);
    setWordCount(plainText.split(/\s+/).filter(w => w.length > 0).length);
  }, []);

  /**
   * Renders editor content from Y.Map (block-level sync)
   * Each block is stored by ID in the Y.Map, preventing JSON corruption
   */
  const renderFromYDoc = useCallback(async () => {
    console.log('[Magic Editor X] [RENDER] renderFromYDoc called');
    console.log('[Magic Editor X] [CHECK] collabEnabled:', collabEnabled, 'yBlocksMap:', !!yBlocksMap, 'yDoc:', !!yDoc);
    
    if (!collabEnabled || !yBlocksMap || !yDoc) {
      console.log('[Magic Editor X] [SKIP] Skipping - missing dependencies');
      return;
    }

    // Reconstruct EditorJS data from Y.Map
    const blockIds = Array.from(yBlocksMap.keys());
    console.log('[Magic Editor X] [DATA] Y.Map block count:', blockIds.length);
    
    if (blockIds.length === 0) {
      console.log('[Magic Editor X] [SKIP] Skipping - no blocks in Y.Map');
      return;
    }

    try {
      // Get metadata (time, version, blockOrder)
      const blockOrder = yMetaMap?.get('blockOrder') || blockIds;
      const time = yMetaMap?.get('time') || Date.now();
      
      // Reconstruct blocks array in correct order
      const blocks = [];
      for (const blockId of blockOrder) {
        const blockJson = yBlocksMap.get(blockId);
        if (blockJson) {
          try {
            const block = JSON.parse(blockJson);
            blocks.push(block);
          } catch (parseErr) {
            console.warn('[Magic Editor X] [WARNING] Could not parse block:', blockId, parseErr.message);
          }
        }
      }
      
      // Also add any blocks not in blockOrder (new blocks from other users)
      for (const blockId of blockIds) {
        if (!blockOrder.includes(blockId)) {
          const blockJson = yBlocksMap.get(blockId);
          if (blockJson) {
            try {
              blocks.push(JSON.parse(blockJson));
            } catch (parseErr) {
              console.warn('[Magic Editor X] [WARNING] Could not parse new block:', blockId);
            }
          }
        }
      }
      
      const parsed = { time, blocks };
      const serialized = JSON.stringify(parsed);
      
      console.log('[Magic Editor X] [SUCCESS] Reconstructed', blocks.length, 'blocks from Y.Map');

      // Check if this is the same content we already have
      if (serialized === lastSerializedValueRef.current) {
        console.log('[Magic Editor X] [SKIP] Skipping - content unchanged from last render');
        return;
      }

      if (!editorInstanceRef.current) {
        console.warn('[Magic Editor X] Editor instance not available, queuing update');
        pendingRenderRef.current = parsed;
        return;
      }

      console.log('[Magic Editor X] [APPLY] Applying remote update with', blocks.length, 'blocks');

      // Set flag BEFORE starting any async operations
      isApplyingRemoteRef.current = true;
      
      try {
        // Wait for editor to be ready
        await editorInstanceRef.current.isReady;
        console.log('[Magic Editor X] [SUCCESS] Editor is ready');
        
        // Get current state for comparison
        const currentBlockCount = editorInstanceRef.current.blocks.getBlocksCount();
        console.log('[Magic Editor X] [DATA] Current block count:', currentBlockCount);
        
        // Use editor.render() directly - it automatically replaces all content
        console.log('[Magic Editor X] [RENDER] Calling editor.render() with', blocks.length, 'blocks');
        await editorInstanceRef.current.render(parsed);
        
        // Verify what's in the editor after render
        const newBlockCount = editorInstanceRef.current.blocks.getBlocksCount();
        console.log('[Magic Editor X] [SUCCESS] Successfully rendered! New block count:', newBlockCount);
        
        // Update our tracking state
        setBlocksCount(blocks.length);
        calculateStats(parsed);
        lastSerializedValueRef.current = serialized;

        // Update Strapi form state
        if (blocks.length === 0) {
          onChange({ target: { name, value: null, type: 'text' } });
        } else {
          onChange({ target: { name, value: serialized, type: 'text' } });
        }
        
      } catch (renderError) {
        console.error('[Magic Editor X] [ERROR] Error rendering blocks:', renderError);
        console.error('[Magic Editor X] [ERROR] Error details:', renderError.message, renderError.stack);
        throw renderError;
      } finally {
        // Keep flag true for a short delay to catch any delayed onChange events
        setTimeout(() => {
          isApplyingRemoteRef.current = false;
          console.log('[Magic Editor X] [FLAG] isApplyingRemoteRef released');
        }, 100);
      }
      
    } catch (error) {
      console.error('[Magic Editor X] [ERROR] Could not apply realtime update:', error.message);
      isApplyingRemoteRef.current = false;
    }
  }, [calculateStats, collabEnabled, name, onChange, yBlocksMap, yMetaMap, yDoc]);

  // Keep the ref updated so the callback in useMagicCollaboration can call it
  useEffect(() => {
    renderFromYDocRef.current = renderFromYDoc;
  }, [renderFromYDoc]);

  /**
   * Pushes local editor content to Y.Map (block-level sync)
   * Each block is stored individually by ID, preventing JSON corruption during CRDT merge
   */
  const pushLocalToCollab = useCallback((payload) => {
    console.log('[Magic Editor X] [PUSH] pushLocalToCollab called, enabled:', collabEnabled, 'yDoc:', !!yDoc, 'yBlocksMap:', !!yBlocksMap);
    
    if (!collabEnabled || !yDoc || !yBlocksMap) {
      console.log('[Magic Editor X] [SKIP] Skipping push - not enabled or missing yDoc/yBlocksMap');
      return;
    }

    try {
      const data = JSON.parse(payload);
      const blocks = data?.blocks || [];
      const time = data?.time || Date.now();
      
      console.log('[Magic Editor X] [DOC] Pushing', blocks.length, 'blocks to Y.Map');

      yDoc.transact(() => {
        // Track which block IDs are in current content
        const currentBlockIds = new Set(blocks.map(b => b.id));
        
        // Remove blocks that no longer exist
        const existingIds = Array.from(yBlocksMap.keys());
        for (const existingId of existingIds) {
          if (!currentBlockIds.has(existingId)) {
            yBlocksMap.delete(existingId);
            console.log('[Magic Editor X] [DELETE] Removed block:', existingId);
          }
        }
        
        // Update or add blocks
        for (const block of blocks) {
          if (!block.id) {
            console.warn('[Magic Editor X] [WARNING] Block without ID, skipping');
            continue;
          }
          const blockJson = JSON.stringify(block);
          const existing = yBlocksMap.get(block.id);
          if (existing !== blockJson) {
            yBlocksMap.set(block.id, blockJson);
          }
        }
        
        // Update metadata
        if (yMetaMap) {
          yMetaMap.set('time', time);
          yMetaMap.set('blockOrder', blocks.map(b => b.id));
        }
      }, 'local');
      
      console.log('[Magic Editor X] [SUCCESS] Successfully pushed', blocks.length, 'blocks to Y.Map');
    } catch (error) {
      console.error('[Magic Editor X] Failed to push local update', error);
    }
  }, [collabEnabled, yDoc, yBlocksMap, yMetaMap]);

  const pushLocalToCollabRef = useRef(pushLocalToCollab);
  useEffect(() => {
    pushLocalToCollabRef.current = pushLocalToCollab;
  }, [pushLocalToCollab]);

  // Note: Remote updates are now handled via onRemoteUpdate callback in useMagicCollaboration

  const customPlaceholder = attribute?.options?.placeholder || placeholder || 'Start writing your amazing content...';
  const minHeight = attribute?.options?.minHeight || 400;

  // Media Library
  const mediaLibToggleFunc = useCallback(
    getToggleFunc({
      openStateSetter: setIsMediaLibOpen,
      indexStateSetter: setMediaLibBlockIndex,
    }),
    []
  );

  const handleMediaLibChange = useCallback(
    (data) => {
      changeFunc({
        indexStateSetter: setMediaLibBlockIndex,
        data,
        index: mediaLibBlockIndex,
        editor: editorInstanceRef.current,
      });
      mediaLibToggleFunc();
    },
    [mediaLibBlockIndex, mediaLibToggleFunc]
  );

  // Fullscreen toggle
  const toggleFullscreen = useCallback(() => {
    setIsFullscreen(prev => {
      if (!prev) {
        document.body.classList.add('editor-fullscreen');
      } else {
        document.body.classList.remove('editor-fullscreen');
      }
      return !prev;
    });
  }, []);

  // Keyboard shortcut for fullscreen
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && isFullscreen) {
        toggleFullscreen();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        toggleFullscreen();
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen, toggleFullscreen]);

  // Insert block
  const handleInsertBlock = useCallback((blockType) => {
    if (!editorInstanceRef.current || !isReady) return;
    
    // Block media library for viewers
    if (blockType === 'mediaLib') {
      if (collabEnabled && collabCanEdit === false) {
        console.log('[Magic Editor X] Viewer cannot open Media Library');
        return;
      }
      // Open media library instead of inserting a block
      setIsMediaLibOpen(true);
      return;
    }
    
    // Block all inserts for viewers
    if (collabEnabled && collabCanEdit === false) {
      console.log('[Magic Editor X] Viewer cannot insert blocks');
      return;
    }
    
    const editor = editorInstanceRef.current;
    const lastIndex = editor.blocks.getBlocksCount();
    
    editor.blocks.insert(blockType, {}, {}, lastIndex, true);
    editor.caret.setToBlock(lastIndex);
  }, [isReady, collabEnabled, collabCanEdit]);

  // Clear editor
  const handleClear = useCallback(async () => {
    if (!editorInstanceRef.current || !isReady) return;
    
    if (window.confirm('Clear all content? This cannot be undone.')) {
      await editorInstanceRef.current.clear();
      const emptyPayload = JSON.stringify({ blocks: [] });
      pushLocalToCollab(emptyPayload);
      onChange({ target: { name, value: null, type: 'text' } });
      setBlocksCount(0);
      setWordCount(0);
      setCharCount(0);
    }
  }, [isReady, name, onChange, pushLocalToCollab]);

  // Copy content
  const handleCopy = useCallback(async () => {
    if (!editorInstanceRef.current || !isReady) return;
    
    const data = await editorInstanceRef.current.save();
    await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
    // Could show a toast here
  }, [isReady]);

  // Initialize Editor.js
  useEffect(() => {
    if (editorRef.current && !editorInstanceRef.current) {
      const tools = getTools({ mediaLibToggleFunc, pluginId: PLUGIN_ID });

      let initialData = undefined;
      if (value) {
        try {
          initialData = typeof value === 'string' ? JSON.parse(value) : value;
          setBlocksCount(initialData?.blocks?.length || 0);
          calculateStats(initialData);
        } catch (e) {
          console.warn('[Magic Editor X] Could not parse initial value:', e);
        }
      }

      // Determine if editor should be readOnly:
      // - disabled prop from parent
      // - OR collaboration is enabled and user is explicitly a viewer (canEdit === false)
      // - Note: canEdit === null means "waiting for role" - we start as editable then toggle
      const isReadOnly = disabled || (collabEnabled && collabCanEdit === false);
      
      console.log('[Magic Editor X] [INIT] Initial readOnly:', isReadOnly, '| collabCanEdit:', collabCanEdit);
      
      if (isReadOnly && collabEnabled && !disabled) {
        console.log('[Magic Editor X] [VIEWER] Viewer mode - editor is read-only');
        // Add CSS class for extra readonly enforcement
        if (editorRef.current) {
          editorRef.current.classList.add('editor-readonly');
        }
      }

      const editor = new EditorJS({
        holder: editorRef.current,
        tools,
        data: initialData,
        readOnly: isReadOnly,
        placeholder: customPlaceholder,
        minHeight: 200,
        autofocus: false,
        
        onReady: async () => {
          setIsReady(true);
          console.log('[Magic Editor X] [READY] Editor onReady fired');
          
          // Initialize Undo/Redo plugin
          try {
            initUndoRedo(editor);
            console.log('[Magic Editor X] [SUCCESS] Undo/Redo initialized');
          } catch (e) {
            console.warn('[Magic Editor X] Could not initialize Undo/Redo:', e);
          }
          
          // Initialize Drag & Drop plugin
          try {
            initDragDrop(editor);
            console.log('[Magic Editor X] [SUCCESS] Drag & Drop initialized');
          } catch (e) {
            console.warn('[Magic Editor X] Could not initialize Drag & Drop:', e);
          }
          
          if (pendingRenderRef.current) {
            try {
              console.log('[Magic Editor X] [PENDING] Rendering pending data with', pendingRenderRef.current?.blocks?.length, 'blocks');
              isApplyingRemoteRef.current = true;
              // Use editor.render() directly - it handles clearing and rendering atomically
              await editor.render(pendingRenderRef.current);
              console.log('[Magic Editor X] [SUCCESS] Rendered pending blocks on ready');
              setTimeout(() => {
                isApplyingRemoteRef.current = false;
              }, 100);
            } catch (err) {
              console.error('[Magic Editor X] Error rendering pending blocks:', err);
              isApplyingRemoteRef.current = false;
            }
            pendingRenderRef.current = null;
          }
        },

        onChange: async (api) => {
          try {
            const outputData = await api.saver.save();
            const count = outputData.blocks?.length || 0;
            const serialized = JSON.stringify(outputData);
            
            console.log('[Magic Editor X] [CHANGE] onChange fired - blocks:', count, 'isApplyingRemote:', isApplyingRemoteRef.current);
            
            // Skip if this is from a remote update being applied
            if (isApplyingRemoteRef.current) {
              console.log('[Magic Editor X] [SKIP] Skipping onChange - remote update in progress');
              return;
            }
            
            // Skip if content hasn't actually changed
            if (serialized === lastSerializedValueRef.current) {
              console.log('[Magic Editor X] [SKIP] Skipping onChange - content unchanged');
              return;
            }
            
            setBlocksCount(count);
            calculateStats(outputData);
            
            const docPayload = count === 0 ? JSON.stringify({ blocks: [] }) : serialized;

            // Push to collaboration
            console.log('[Magic Editor X] [PUSH] Pushing local change to collaboration');
              pushLocalToCollabRef.current?.(docPayload);

            lastSerializedValueRef.current = serialized;
            
            if (count === 0) {
              onChange({ target: { name, value: null, type: 'text' } });
            } else {
              onChange({ target: { name, value: serialized, type: 'text' } });
            }
          } catch (error) {
            console.error('[Magic Editor X] Error in onChange:', error);
          }
        },
      });

      editorInstanceRef.current = editor;
    }

    return () => {
      if (editorInstanceRef.current && editorInstanceRef.current.destroy) {
        editorInstanceRef.current.destroy();
        editorInstanceRef.current = null;
      }
      document.body.classList.remove('editor-fullscreen');
    };
  }, []);

  // Dynamically toggle readOnly when collaboration role changes (viewer can't edit)
  useEffect(() => {
    const editor = editorInstanceRef.current;
    if (!editor || !isReady) return;
    
    // Determine if editor should be readOnly based on collaboration role
    // collabCanEdit: null = unknown (waiting), true = can edit, false = readonly
    const shouldBeReadOnly = disabled || (collabEnabled && collabCanEdit === false);
    
    console.log('[Magic Editor X] [READONLY] ReadOnly check:', {
      disabled,
      collabEnabled,
      collabCanEdit,
      collabRole,
      shouldBeReadOnly,
    });
    
    // EditorJS readOnly API
    if (typeof editor.readOnly?.toggle === 'function') {
      const currentReadOnly = editor.readOnly?.isEnabled;
      
      if (currentReadOnly !== shouldBeReadOnly) {
        console.log('[Magic Editor X] [TOGGLE] Toggling readOnly:', shouldBeReadOnly, '| Role:', collabRole);
        
        // Toggle readOnly mode
        editor.readOnly.toggle(shouldBeReadOnly);
        
        // Force UI update by adding/removing CSS class
        if (editorRef.current) {
          if (shouldBeReadOnly) {
            editorRef.current.classList.add('editor-readonly');
          } else {
            editorRef.current.classList.remove('editor-readonly');
          }
        }
      }
    }
  }, [disabled, collabEnabled, collabCanEdit, collabRole, isReady]);

  // Quick action buttons config
  const quickActions = [
    { icon: Bars3BottomLeftIcon, label: 'Heading', block: 'header' },
    { icon: ListBulletIcon, label: 'List', block: 'list' },
    { icon: CheckCircleIcon, label: 'Checklist', block: 'checklist' },
    { icon: PhotoIcon, label: 'Image', block: 'image' },
    { icon: LinkIcon, label: 'Link', block: 'linkTool' },
    { icon: CodeBracketIcon, label: 'Code', block: 'code' },
    { icon: TableCellsIcon, label: 'Table', block: 'table' },
    { icon: ChatBubbleBottomCenterTextIcon, label: 'Quote', block: 'quote' },
    { icon: ExclamationTriangleIcon, label: 'Warning', block: 'warning' },
    { icon: MinusIcon, label: 'Divider', block: 'delimiter' },
  ];

  return (
    <Field.Root name={name} id={name} error={error} required={required} hint={hint}>
      <FullscreenGlobalStyle />
      <EditorJSGlobalStyles />
      
      {label && !isFullscreen && (
        <Field.Label action={labelAction}>
          {label}
        </Field.Label>
      )}

      <EditorContainer 
        ref={containerRef}
        $isFullscreen={isFullscreen}
        $minHeight={editorHeight}
      >
        <EditorCard 
          $isFocused={isFocused}
          $hasError={!!error}
          $disabled={disabled}
          $isFullscreen={isFullscreen}
          $minHeight={editorHeight}
        >
          {/* Header */}
          <EditorHeader>
            <HeaderLeft>
              <Logo>
                <SparklesIcon />
                <LogoText>Magic Editor</LogoText>
              </Logo>
              {isReady && blocksCount > 0 && (
                <BlockCount>{blocksCount} {blocksCount === 1 ? 'Block' : 'Blocks'}</BlockCount>
              )}
            </HeaderLeft>
            
            <Toolbar>
              <QuickActions>
                {quickActions.map(({ icon: Icon, label, block }) => (
                  <ToolButton 
                    key={block}
                    type="button"
                    data-tooltip={label}
                    onClick={() => handleInsertBlock(block)}
                    disabled={collabEnabled && collabCanEdit === false}
                    style={collabEnabled && collabCanEdit === false ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
                  >
                    <Icon />
                  </ToolButton>
                ))}
              </QuickActions>
              
              <ToolbarDivider />
              
              <ToolButton
                type="button"
                data-tooltip="Copy JSON"
                onClick={handleCopy}
              >
                <DocumentDuplicateIcon />
              </ToolButton>
              
              <ToolButton
                type="button"
                data-tooltip="Clear All"
                onClick={handleClear}
                disabled={collabEnabled && collabCanEdit === false}
                style={collabEnabled && collabCanEdit === false ? { opacity: 0.4, cursor: 'not-allowed' } : {}}
              >
                <TrashIcon />
              </ToolButton>
              
              <ToolbarDivider />
              
              <ToolButton
                type="button"
                $active={isFullscreen}
                data-tooltip={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Fullscreen (⌘+Enter)'}
                onClick={toggleFullscreen}
              >
                {isFullscreen ? <ArrowsPointingInIcon /> : <ArrowsPointingOutIcon />}
              </ToolButton>
            </Toolbar>
          </EditorHeader>

          {collabError && collabEnabled && (
            <CollabNotice>{collabError}</CollabNotice>
          )}

          {/* Viewer Mode Banner - Shows when user can only view, not edit */}
          {collabEnabled && collabStatus === 'connected' && collabRole === 'viewer' && (
            <ViewerBanner>
              <EyeIcon />
              <strong>Nur-Lesen Modus</strong>
              <span>• Du kannst den Inhalt sehen, aber nicht bearbeiten</span>
            </ViewerBanner>
          )}

          {/* Active Editors Bar - Shows who is currently editing */}
          {collabEnabled && collabStatus === 'connected' && activeEditors.length > 0 && (
            <ActiveEditorsBar>
              <ActiveEditorsLabel>Aktive Bearbeiter:</ActiveEditorsLabel>
              {activeEditors.map((editor) => (
                <ActiveEditorBadge 
                  key={editor.user.id}
                  $color={editor.color?.bg}
                  title={`${getPeerName(editor.user)} bearbeitet Block ${editor.blockIndex !== null ? editor.blockIndex + 1 : '?'}`}
                >
                  <ActiveEditorDot $color={editor.color?.bg} />
                  <span>{getPeerName(editor.user)}</span>
                  {editor.blockIndex !== null && (
                    <span style={{ opacity: 0.6, fontSize: '10px' }}>
                      Block {editor.blockIndex + 1}
                    </span>
                  )}
                </ActiveEditorBadge>
              ))}
            </ActiveEditorsBar>
          )}
          
          {/* Content */}
          <EditorContent 
            $isFullscreen={isFullscreen}
            onFocus={() => setIsFocused(true)}
            onBlur={() => setIsFocused(false)}
          >
            {!isReady && (
              <LoadingOverlay>
                <Loader small />
                <LoadingText>Initializing editor...</LoadingText>
              </LoadingOverlay>
            )}
            
            <EditorWrapper 
              ref={editorRef}
              id={`editor-${name}`}
              $minHeight={editorHeight}
            />
            
            {isReady && blocksCount === 0 && (
              <EmptyState>
                <EmptyIcon>
                  <PencilSquareIcon />
                </EmptyIcon>
                <EmptyTitle>Start Writing</EmptyTitle>
                <EmptySubtitle>Click anywhere or use the toolbar to add content</EmptySubtitle>
                <KeyboardHints>
                  <KeyHint><kbd>/</kbd> Commands</KeyHint>
                  <KeyHint><kbd>⌘B</kbd> Bold</KeyHint>
                  <KeyHint><kbd>⌘I</kbd> Italic</KeyHint>
                  <KeyHint><kbd>Tab</kbd> Add Block</KeyHint>
                </KeyboardHints>
              </EmptyState>
            )}
          </EditorContent>
          
          {/* Footer */}
          <EditorFooter>
            <FooterLeft>
              <FooterStat><strong>{wordCount}</strong> words</FooterStat>
              <FooterStat><strong>{charCount}</strong> characters</FooterStat>
            </FooterLeft>
            
            <FooterRight>
              {/* Hide Media Library button for viewers */}
              {!(collabEnabled && collabCanEdit === false) && (
              <FooterButton type="button" onClick={() => handleInsertBlock('mediaLib')}>
                <PhotoIcon />
                Media Library
              </FooterButton>
              )}
              {isFullscreen && (
                <FooterButton type="button" $primary onClick={toggleFullscreen}>
                  <ArrowsPointingInIcon />
                  Exit Fullscreen
                </FooterButton>
              )}
            </FooterRight>
          </EditorFooter>
          
          {/* Resize Handle */}
          {!isFullscreen && <ResizeHandle />}
        </EditorCard>
      </EditorContainer>

      {!isFullscreen && (
        <>
          <Field.Hint />
          <Field.Error />
        </>
      )}

      <MediaLibComponent
        isOpen={isMediaLibOpen}
        onChange={handleMediaLibChange}
        onToggle={mediaLibToggleFunc}
      />
    </Field.Root>
  );
});

Editor.displayName = 'MagicEditorXInput';

export default Editor;
