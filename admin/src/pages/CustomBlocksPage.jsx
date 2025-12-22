/**
 * Magic Editor X - Custom Blocks Page
 * Modern admin UI for creating and managing custom editor blocks
 */
import { useState, useEffect, useCallback } from 'react';
import { useFetchClient, useNotification } from '@strapi/strapi/admin';
import styled, { keyframes } from 'styled-components';
import {
  PlusIcon,
  PencilSquareIcon,
  TrashIcon,
  DocumentDuplicateIcon,
  ArrowDownTrayIcon,
  ArrowUpTrayIcon,
  CubeIcon,
  CodeBracketIcon,
  LinkIcon,
  CheckCircleIcon,
  XCircleIcon,
  SparklesIcon,
  Squares2X2Icon,
  CommandLineIcon,
  EyeIcon,
  XMarkIcon,
  ChevronRightIcon,
} from '@heroicons/react/24/outline';
import {
  CubeIcon as CubeIconSolid,
  SparklesIcon as SparklesIconSolid,
} from '@heroicons/react/24/solid';

const PLUGIN_ID = 'magic-editor-x';

/* ============================================
   ANIMATIONS
   ============================================ */

const fadeIn = keyframes`
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: translateY(0); }
`;

const slideIn = keyframes`
  from { opacity: 0; transform: translateX(-20px); }
  to { opacity: 1; transform: translateX(0); }
`;

const pulse = keyframes`
  0%, 100% { transform: scale(1); }
  50% { transform: scale(1.05); }
`;

const shimmer = keyframes`
  0% { background-position: -200% 0; }
  100% { background-position: 200% 0; }
`;

/* ============================================
   STYLED COMPONENTS - LAYOUT
   ============================================ */

const PageWrapper = styled.div`
  min-height: 100vh;
  background: linear-gradient(135deg, #f8fafc 0%, #f1f5f9 50%, #e2e8f0 100%);
  padding: 32px;
`;

const Container = styled.div`
  max-width: 1400px;
  margin: 0 auto;
  animation: ${fadeIn} 0.4s ease-out;
`;

const Header = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 32px;
  gap: 24px;
  flex-wrap: wrap;
`;

const HeaderLeft = styled.div`
  flex: 1;
  min-width: 300px;
`;

const HeaderRight = styled.div`
  display: flex;
  gap: 12px;
  flex-wrap: wrap;
`;

const PageTitle = styled.h1`
  font-size: 2rem;
  font-weight: 800;
  color: #0f172a;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  
  svg {
    width: 32px;
    height: 32px;
    color: #7c3aed;
  }
`;

const PageSubtitle = styled.p`
  font-size: 1rem;
  color: #64748b;
  margin: 0;
  line-height: 1.5;
`;

/* ============================================
   STYLED COMPONENTS - BUTTONS
   ============================================ */

const Button = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: ${props => props.$size === 'small' ? '8px 14px' : '12px 20px'};
  font-size: ${props => props.$size === 'small' ? '13px' : '14px'};
  font-weight: 600;
  border-radius: 12px;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  
  svg {
    width: ${props => props.$size === 'small' ? '16px' : '18px'};
    height: ${props => props.$size === 'small' ? '16px' : '18px'};
  }
  
  ${props => props.$variant === 'primary' && `
    background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
    color: white;
    box-shadow: 0 4px 14px rgba(124, 58, 237, 0.35);
    
    &:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(124, 58, 237, 0.45);
    }
    
    &:active {
      transform: translateY(0);
    }
  `}
  
  ${props => props.$variant === 'secondary' && `
    background: white;
    color: #475569;
    border: 1px solid #e2e8f0;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
    
    &:hover {
      background: #f8fafc;
      border-color: #cbd5e1;
      color: #1e293b;
    }
  `}
  
  ${props => props.$variant === 'ghost' && `
    background: transparent;
    color: #64748b;
    
    &:hover {
      background: rgba(124, 58, 237, 0.08);
      color: #7c3aed;
    }
  `}
  
  ${props => props.$variant === 'danger' && `
    background: transparent;
    color: #ef4444;
    
    &:hover {
      background: rgba(239, 68, 68, 0.08);
    }
  `}
  
  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none !important;
  }
`;

const IconButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  border: none;
  cursor: pointer;
  transition: all 0.2s ease;
  background: transparent;
  color: #64748b;
  
  svg {
    width: 18px;
    height: 18px;
  }
  
  &:hover {
    background: ${props => props.$danger ? 'rgba(239, 68, 68, 0.1)' : 'rgba(124, 58, 237, 0.1)'};
    color: ${props => props.$danger ? '#ef4444' : '#7c3aed'};
    transform: scale(1.05);
  }
  
  &:active {
    transform: scale(0.95);
  }
`;

/* ============================================
   STYLED COMPONENTS - CARDS & GRID
   ============================================ */

const BlocksGrid = styled.div`
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(380px, 1fr));
  gap: 20px;
`;

const BlockCard = styled.div`
  background: white;
  border-radius: 16px;
  border: 1px solid #e2e8f0;
  overflow: hidden;
  transition: all 0.25s ease;
  animation: ${slideIn} 0.3s ease-out;
  animation-delay: ${props => props.$index * 0.05}s;
  animation-fill-mode: both;
  
  &:hover {
    border-color: #c4b5fd;
    box-shadow: 0 12px 32px rgba(124, 58, 237, 0.12);
    transform: translateY(-4px);
  }
  
  ${props => !props.$enabled && `
    opacity: 0.6;
    
    &:hover {
      opacity: 0.8;
    }
  `}
`;

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 20px;
  border-bottom: 1px solid #f1f5f9;
`;

const BlockIconWrapper = styled.div`
  width: 52px;
  height: 52px;
  border-radius: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${props => props.$type === 'embedded-entry' 
    ? 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)' 
    : 'linear-gradient(135deg, #10b981 0%, #059669 100%)'};
  color: white;
  box-shadow: ${props => props.$type === 'embedded-entry'
    ? '0 4px 14px rgba(124, 58, 237, 0.35)'
    : '0 4px 14px rgba(16, 185, 129, 0.35)'};
  flex-shrink: 0;
  
  svg {
    width: 26px;
    height: 26px;
  }
`;

const BlockInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const BlockName = styled.h3`
  font-size: 1.1rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 4px 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const BlockSlug = styled.span`
  font-size: 0.8rem;
  color: #94a3b8;
  font-family: 'SF Mono', Monaco, monospace;
  background: #f8fafc;
  padding: 2px 8px;
  border-radius: 6px;
`;

const CardBody = styled.div`
  padding: 20px;
`;

const BlockDescription = styled.p`
  font-size: 0.9rem;
  color: #64748b;
  margin: 0 0 16px 0;
  line-height: 1.5;
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
`;

const MetaRow = styled.div`
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 16px;
`;

const MetaTag = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  font-size: 0.8rem;
  font-weight: 500;
  border-radius: 8px;
  
  svg {
    width: 14px;
    height: 14px;
  }
  
  ${props => props.$type === 'type' && `
    background: ${props.$value === 'embedded-entry' 
      ? 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)' 
      : 'linear-gradient(135deg, #d1fae5 0%, #a7f3d0 100%)'};
    color: ${props.$value === 'embedded-entry' ? '#6d28d9' : '#047857'};
  `}
  
  ${props => props.$type === 'status' && `
    background: ${props.$enabled ? '#dcfce7' : '#fee2e2'};
    color: ${props.$enabled ? '#166534' : '#991b1b'};
  `}
  
  ${props => props.$type === 'shortcut' && `
    background: #f1f5f9;
    color: #475569;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 0.75rem;
  `}
  
  ${props => props.$type === 'content-type' && `
    background: #fef3c7;
    color: #92400e;
  `}
`;

const CardFooter = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px 20px;
  background: #fafbfc;
  border-top: 1px solid #f1f5f9;
`;

const ActionGroup = styled.div`
  display: flex;
  gap: 4px;
`;

const ToggleSwitch = styled.button`
  position: relative;
  width: 48px;
  height: 26px;
  border-radius: 13px;
  border: none;
  cursor: pointer;
  transition: all 0.25s ease;
  background: ${props => props.$enabled ? '#10b981' : '#cbd5e1'};
  
  &::after {
    content: '';
    position: absolute;
    top: 3px;
    left: ${props => props.$enabled ? '25px' : '3px'};
    width: 20px;
    height: 20px;
    border-radius: 50%;
    background: white;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.15);
    transition: all 0.25s ease;
  }
  
  &:hover {
    transform: scale(1.05);
  }
`;

/* ============================================
   STYLED COMPONENTS - EMPTY STATE
   ============================================ */

const EmptyState = styled.div`
  text-align: center;
  padding: 80px 40px;
  background: white;
  border-radius: 20px;
  border: 2px dashed #e2e8f0;
`;

const EmptyIcon = styled.div`
  width: 80px;
  height: 80px;
  margin: 0 auto 24px;
  background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%);
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  
  svg {
    width: 40px;
    height: 40px;
    color: #7c3aed;
  }
`;

const EmptyTitle = styled.h2`
  font-size: 1.5rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0 0 12px 0;
`;

const EmptyText = styled.p`
  font-size: 1rem;
  color: #64748b;
  margin: 0 0 32px 0;
  max-width: 400px;
  margin-left: auto;
  margin-right: auto;
  line-height: 1.6;
`;

/* ============================================
   STYLED COMPONENTS - MODAL
   ============================================ */

const ModalOverlay = styled.div`
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.6);
  backdrop-filter: blur(4px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 20px;
  animation: ${fadeIn} 0.2s ease-out;
`;

const ModalContent = styled.div`
  background: white;
  border-radius: 20px;
  width: 100%;
  max-width: 640px;
  max-height: 90vh;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  box-shadow: 0 25px 50px rgba(0, 0, 0, 0.25);
  animation: ${fadeIn} 0.3s ease-out;
`;

const ModalHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 24px;
  border-bottom: 1px solid #f1f5f9;
`;

const ModalTitle = styled.h2`
  font-size: 1.25rem;
  font-weight: 700;
  color: #0f172a;
  margin: 0;
  display: flex;
  align-items: center;
  gap: 12px;
  
  svg {
    width: 24px;
    height: 24px;
    color: #7c3aed;
  }
`;

const ModalBody = styled.div`
  padding: 24px;
  overflow-y: auto;
  flex: 1;
`;

const ModalFooter = styled.div`
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  padding: 20px 24px;
  background: #fafbfc;
  border-top: 1px solid #f1f5f9;
`;

/* ============================================
   STYLED COMPONENTS - FORM
   ============================================ */

const FormSection = styled.div`
  margin-bottom: 28px;
  
  &:last-child {
    margin-bottom: 0;
  }
`;

const SectionTitle = styled.h3`
  font-size: 0.85rem;
  font-weight: 700;
  color: #7c3aed;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin: 0 0 16px 0;
  display: flex;
  align-items: center;
  gap: 8px;
  
  svg {
    width: 16px;
    height: 16px;
  }
`;

const FormGrid = styled.div`
  display: grid;
  grid-template-columns: ${props => props.$columns || '1fr'};
  gap: 16px;
`;

const FormGroup = styled.div`
  display: flex;
  flex-direction: column;
  gap: 6px;
`;

const Label = styled.label`
  font-size: 0.875rem;
  font-weight: 600;
  color: #374151;
  display: flex;
  align-items: center;
  gap: 6px;
  
  span {
    color: #ef4444;
  }
`;

const Input = styled.input`
  padding: 12px 16px;
  font-size: 0.95rem;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fafbfc;
  color: #1e293b;
  transition: all 0.2s ease;
  
  &:focus {
    outline: none;
    border-color: #7c3aed;
    background: white;
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
  }
  
  &::placeholder {
    color: #94a3b8;
  }
  
  &:disabled {
    background: #f1f5f9;
    color: #94a3b8;
    cursor: not-allowed;
  }
`;

const TextArea = styled.textarea`
  padding: 12px 16px;
  font-size: 0.95rem;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fafbfc;
  color: #1e293b;
  resize: vertical;
  min-height: ${props => props.$rows ? `${props.$rows * 24 + 24}px` : '100px'};
  font-family: ${props => props.$mono ? "'SF Mono', Monaco, monospace" : 'inherit'};
  transition: all 0.2s ease;
  
  &:focus {
    outline: none;
    border-color: #7c3aed;
    background: white;
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
  }
  
  &::placeholder {
    color: #94a3b8;
  }
`;

const Select = styled.select`
  padding: 12px 16px;
  font-size: 0.95rem;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  background: #fafbfc;
  color: #1e293b;
  cursor: pointer;
  transition: all 0.2s ease;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2394a3b8'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 18px;
  padding-right: 40px;
  
  &:focus {
    outline: none;
    border-color: #7c3aed;
    background-color: white;
    box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
  }
`;

const Hint = styled.span`
  font-size: 0.8rem;
  color: #94a3b8;
`;

const CheckboxRow = styled.label`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 14px 16px;
  background: #fafbfc;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    background: #f1f5f9;
    border-color: #cbd5e1;
  }
`;

const Checkbox = styled.input.attrs({ type: 'checkbox' })`
  width: 20px;
  height: 20px;
  border-radius: 6px;
  accent-color: #7c3aed;
  cursor: pointer;
`;

const CheckboxLabel = styled.span`
  font-size: 0.95rem;
  color: #374151;
  font-weight: 500;
`;

/* ============================================
   STYLED COMPONENTS - FIELDS EDITOR
   ============================================ */

const FieldsContainer = styled.div`
  background: #f8fafc;
  border-radius: 12px;
  padding: 16px;
  margin-top: 8px;
`;

const FieldRow = styled.div`
  display: grid;
  grid-template-columns: 1fr 1fr 120px 40px;
  gap: 12px;
  padding: 12px;
  background: white;
  border: 1px solid #e2e8f0;
  border-radius: 10px;
  margin-bottom: 10px;
  align-items: center;
  
  &:last-child {
    margin-bottom: 0;
  }
`;

const FieldInput = styled(Input)`
  padding: 10px 12px;
  font-size: 0.875rem;
`;

const FieldSelect = styled(Select)`
  padding: 10px 12px;
  font-size: 0.875rem;
`;

const AddFieldButton = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  width: 100%;
  padding: 12px;
  background: transparent;
  border: 2px dashed #cbd5e1;
  border-radius: 10px;
  color: #64748b;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  margin-top: 12px;
  
  svg {
    width: 18px;
    height: 18px;
  }
  
  &:hover {
    border-color: #7c3aed;
    color: #7c3aed;
    background: rgba(124, 58, 237, 0.04);
  }
`;

/* ============================================
   STYLED COMPONENTS - LOADING
   ============================================ */

const LoadingWrapper = styled.div`
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 80px 40px;
`;

const LoadingSpinner = styled.div`
  width: 48px;
  height: 48px;
  border: 4px solid #e2e8f0;
  border-top-color: #7c3aed;
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
  margin-bottom: 16px;
  
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
`;

const LoadingText = styled.p`
  font-size: 1rem;
  color: #64748b;
`;

/* ============================================
   COMPONENT
   ============================================ */

/* ============================================
   STYLED COMPONENTS - LIMITS BANNER
   ============================================ */

const LimitsBanner = styled.div`
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 16px 20px;
  background: linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%);
  border: 1px solid #c4b5fd;
  border-radius: 14px;
  margin-bottom: 24px;
`;

const LimitsInfo = styled.div`
  flex: 1;
`;

const LimitsText = styled.div`
  font-size: 0.9rem;
  color: #5b21b6;
  font-weight: 500;
  
  strong {
    font-weight: 700;
  }
`;

const LimitsProgress = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  margin-top: 8px;
`;

const ProgressBar = styled.div`
  flex: 1;
  max-width: 200px;
  height: 8px;
  background: #ddd6fe;
  border-radius: 4px;
  overflow: hidden;
`;

const ProgressFill = styled.div`
  height: 100%;
  background: ${props => props.$percentage >= 100 ? '#ef4444' : props.$percentage >= 80 ? '#f59e0b' : '#7c3aed'};
  border-radius: 4px;
  width: ${props => Math.min(props.$percentage, 100)}%;
  transition: width 0.3s ease;
`;

const ProgressLabel = styled.span`
  font-size: 0.8rem;
  color: #6d28d9;
  font-weight: 600;
`;

const TierBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 14px;
  font-size: 0.75rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  border-radius: 20px;
  background: ${props => {
    switch(props.$tier) {
      case 'enterprise': return 'linear-gradient(135deg, #1e3a5f 0%, #0f172a 100%)';
      case 'advanced': return 'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)';
      case 'premium': return 'linear-gradient(135deg, #8b5cf6 0%, #7c3aed 100%)';
      default: return 'linear-gradient(135deg, #6b7280 0%, #4b5563 100%)';
    }
  }};
  color: white;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.15);
`;

const UpgradeButton = styled.button`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  font-size: 0.85rem;
  font-weight: 600;
  border-radius: 8px;
  border: none;
  background: linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%);
  color: white;
  cursor: pointer;
  transition: all 0.2s ease;
  
  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px rgba(124, 58, 237, 0.35);
  }
  
  svg {
    width: 16px;
    height: 16px;
  }
`;

const LimitWarning = styled.div`
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 12px 16px;
  background: #fef3c7;
  border: 1px solid #fcd34d;
  border-radius: 10px;
  margin-top: 16px;
  font-size: 0.85rem;
  color: #92400e;
  
  svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
`;

const FeatureLockedBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  font-size: 0.7rem;
  font-weight: 600;
  text-transform: uppercase;
  border-radius: 4px;
  background: #fee2e2;
  color: #991b1b;
  margin-left: 8px;
  
  svg {
    width: 12px;
    height: 12px;
  }
`;

/**
 * Custom Blocks Page Component
 * @returns {JSX.Element}
 */
const CustomBlocksPage = () => {
  const { toggleNotification } = useNotification();
  const { get, post, put, del } = useFetchClient();

  // State
  const [blocks, setBlocks] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState(null);
  const [formData, setFormData] = useState(getEmptyFormData());
  
  // Tier limits state
  const [limits, setLimits] = useState(null);

  /**
   * Get empty form data template
   * @returns {object}
   */
  function getEmptyFormData() {
    return {
      name: '',
      label: '',
      blockType: 'simple',
      description: '',
      icon: '',
      contentType: '',
      displayFields: ['title', 'name'],
      titleField: 'title',
      previewFields: [],
      fields: [],
      template: '',
      placeholder: 'Enter content...',
      styles: {},
      inlineToolbar: true,
      tunes: [],
      shortcut: '',
      sortOrder: 0,
      enabled: true,
    };
  }

  /**
   * Fetch custom blocks from API
   */
  const fetchBlocks = useCallback(async () => {
    try {
      setIsLoading(true);
      const response = await get(`/${PLUGIN_ID}/custom-blocks?enabledOnly=false`);
      setBlocks(response.data?.data || []);
    } catch (error) {
      console.error('[CustomBlocksPage] Error fetching blocks:', error);
      toggleNotification({
        type: 'danger',
        message: 'Failed to load custom blocks',
      });
    } finally {
      setIsLoading(false);
    }
  }, [get, toggleNotification]);

  /**
   * Fetch available content types
   */
  const fetchContentTypes = useCallback(async () => {
    try {
      const response = await get(`/${PLUGIN_ID}/content-types`);
      setContentTypes(response.data?.contentTypes || []);
    } catch (error) {
      console.error('[CustomBlocksPage] Error fetching content types:', error);
    }
  }, [get]);

  /**
   * Fetch tier limits
   */
  const fetchLimits = useCallback(async () => {
    try {
      const response = await get(`/${PLUGIN_ID}/custom-blocks/limits`);
      setLimits(response.data?.data || null);
    } catch (error) {
      console.error('[CustomBlocksPage] Error fetching limits:', error);
    }
  }, [get]);

  /**
   * Initial data load
   */
  useEffect(() => {
    fetchBlocks();
    fetchContentTypes();
    fetchLimits();
  }, [fetchBlocks, fetchContentTypes, fetchLimits]);

  /**
   * Calculate usage percentage
   * @returns {number}
   */
  const getUsagePercentage = () => {
    if (!limits || limits.limits.maxTotal === -1) return 0;
    return Math.round((limits.usage.total / limits.limits.maxTotal) * 100);
  };

  /**
   * Check if can create more blocks
   * @returns {boolean}
   */
  const canCreateMoreBlocks = () => {
    if (!limits) return true;
    return limits.canCreateSimple || limits.canCreateEmbedded;
  };

  /**
   * Check if embedded entry blocks are allowed
   * @returns {boolean}
   */
  const canCreateEmbeddedEntry = () => {
    if (!limits) return true;
    return limits.canCreateEmbedded;
  };

  /**
   * Check if export/import is allowed
   * @returns {boolean}
   */
  const canExportImport = () => {
    if (!limits) return true;
    return limits.limits.exportImport === true;
  };

  /**
   * Open create modal
   */
  const handleCreate = () => {
    // Check if limit reached
    if (!canCreateMoreBlocks()) {
      toggleNotification({
        type: 'warning',
        message: `Block limit reached (${limits?.usage?.total}/${limits?.limits?.maxTotal}). Upgrade to create more.`,
      });
      return;
    }
    
    setEditingBlock(null);
    setFormData(getEmptyFormData());
    setIsModalOpen(true);
  };

  /**
   * Open edit modal
   * @param {object} block - Block to edit
   */
  const handleEdit = (block) => {
    setEditingBlock(block);
    setFormData({
      name: block.name || '',
      label: block.label || '',
      blockType: block.blockType || 'simple',
      description: block.description || '',
      icon: block.icon || '',
      contentType: block.contentType || '',
      displayFields: block.displayFields || ['title', 'name'],
      titleField: block.titleField || 'title',
      previewFields: block.previewFields || [],
      fields: block.fields || [],
      template: block.template || '',
      placeholder: block.placeholder || 'Enter content...',
      styles: block.styles || {},
      inlineToolbar: block.inlineToolbar !== false,
      tunes: block.tunes || [],
      shortcut: block.shortcut || '',
      sortOrder: block.sortOrder || 0,
      enabled: block.enabled !== false,
    });
    setIsModalOpen(true);
  };

  /**
   * Save block (create or update)
   */
  const handleSave = async () => {
    try {
      if (!formData.name) {
        toggleNotification({ type: 'warning', message: 'Block name is required' });
        return;
      }
      if (!formData.label) {
        toggleNotification({ type: 'warning', message: 'Display label is required' });
        return;
      }

      if (editingBlock) {
        await put(`/${PLUGIN_ID}/custom-blocks/${editingBlock.documentId}`, formData);
        toggleNotification({ type: 'success', message: 'Block updated successfully' });
      } else {
        await post(`/${PLUGIN_ID}/custom-blocks`, formData);
        toggleNotification({ type: 'success', message: 'Block created successfully' });
      }

      setIsModalOpen(false);
      fetchBlocks();
      fetchLimits(); // Refresh limits after creating
    } catch (error) {
      console.error('[CustomBlocksPage] Error saving block:', error);
      
      // Handle tier limit errors
      const errorDetails = error.response?.data?.error?.details;
      if (errorDetails?.code === 'LIMIT_EXCEEDED') {
        toggleNotification({
          type: 'warning',
          message: error.response?.data?.error?.message || 'Block limit reached. Upgrade to create more.',
        });
        return;
      }
      
      toggleNotification({
        type: 'danger',
        message: error.response?.data?.error?.message || 'Failed to save block',
      });
    }
  };

  /**
   * Delete block
   * @param {object} block - Block to delete
   */
  const handleDelete = async (block) => {
    if (!window.confirm(`Delete block "${block.label || block.name}"? This cannot be undone.`)) {
      return;
    }

    try {
      await del(`/${PLUGIN_ID}/custom-blocks/${block.documentId}`);
      toggleNotification({ type: 'success', message: 'Block deleted successfully' });
      fetchBlocks();
      fetchLimits(); // Refresh limits after deleting
    } catch (error) {
      console.error('[CustomBlocksPage] Error deleting block:', error);
      toggleNotification({ type: 'danger', message: 'Failed to delete block' });
    }
  };

  /**
   * Toggle block enabled state
   * @param {object} block - Block to toggle
   */
  const handleToggle = async (block) => {
    try {
      await post(`/${PLUGIN_ID}/custom-blocks/${block.documentId}/toggle`);
      fetchBlocks();
    } catch (error) {
      console.error('[CustomBlocksPage] Error toggling block:', error);
      toggleNotification({ type: 'danger', message: 'Failed to toggle block' });
    }
  };

  /**
   * Duplicate block
   * @param {object} block - Block to duplicate
   */
  const handleDuplicate = async (block) => {
    // Check if limit reached
    if (!canCreateMoreBlocks()) {
      toggleNotification({
        type: 'warning',
        message: `Block limit reached (${limits?.usage?.total}/${limits?.limits?.maxTotal}). Upgrade to duplicate.`,
      });
      return;
    }
    
    const newName = prompt('Enter name for duplicated block:', `${block.name}_copy`);
    if (!newName) return;

    try {
      await post(`/${PLUGIN_ID}/custom-blocks/${block.documentId}/duplicate`, { newName });
      toggleNotification({ type: 'success', message: 'Block duplicated successfully' });
      fetchBlocks();
      fetchLimits(); // Refresh limits after duplicating
    } catch (error) {
      console.error('[CustomBlocksPage] Error duplicating block:', error);
      
      // Handle tier limit errors
      const errorDetails = error.response?.data?.error?.details;
      if (errorDetails?.code === 'LIMIT_EXCEEDED') {
        toggleNotification({
          type: 'warning',
          message: error.response?.data?.error?.message || 'Block limit reached. Upgrade to duplicate.',
        });
        return;
      }
      
      toggleNotification({
        type: 'danger',
        message: error.response?.data?.error?.message || 'Failed to duplicate block',
      });
    }
  };

  /**
   * Export blocks
   */
  const handleExport = async () => {
    // Check tier permission
    if (!canExportImport()) {
      toggleNotification({
        type: 'warning',
        message: 'Export requires Advanced or Enterprise tier.',
      });
      return;
    }
    
    try {
      const response = await get(`/${PLUGIN_ID}/custom-blocks/export`);
      const blob = new Blob([JSON.stringify(response.data, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'custom-blocks.json';
      a.click();
      URL.revokeObjectURL(url);
      toggleNotification({ type: 'success', message: 'Blocks exported successfully' });
    } catch (error) {
      console.error('[CustomBlocksPage] Error exporting blocks:', error);
      
      // Handle tier permission errors
      if (error.response?.data?.error?.details?.code === 'FEATURE_NOT_AVAILABLE') {
        toggleNotification({
          type: 'warning',
          message: 'Export requires Advanced or Enterprise tier.',
        });
        return;
      }
      
      toggleNotification({ type: 'danger', message: 'Failed to export blocks' });
    }
  };

  /**
   * Import blocks
   */
  const handleImport = () => {
    // Check tier permission
    if (!canExportImport()) {
      toggleNotification({
        type: 'warning',
        message: 'Import requires Advanced or Enterprise tier.',
      });
      return;
    }
    
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;

      try {
        const text = await file.text();
        const data = JSON.parse(text);
        const overwrite = window.confirm('Overwrite existing blocks with same name?');
        await post(`/${PLUGIN_ID}/custom-blocks/import?overwrite=${overwrite}`, data);
        toggleNotification({ type: 'success', message: 'Blocks imported successfully' });
        fetchBlocks();
        fetchLimits();
      } catch (error) {
        console.error('[CustomBlocksPage] Error importing blocks:', error);
        
        // Handle tier permission errors
        if (error.response?.data?.error?.details?.code === 'FEATURE_NOT_AVAILABLE') {
          toggleNotification({
            type: 'warning',
            message: 'Import requires Advanced or Enterprise tier.',
          });
          return;
        }
        
        toggleNotification({ type: 'danger', message: 'Failed to import blocks' });
      }
    };
    input.click();
  };

  /**
   * Update form field
   * @param {string} field - Field name
   * @param {any} value - Field value
   */
  const updateFormField = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  /**
   * Add field to simple block
   */
  const addField = () => {
    const newField = {
      name: `field_${formData.fields.length + 1}`,
      label: `Field ${formData.fields.length + 1}`,
      type: 'text',
      default: '',
      required: false,
    };
    updateFormField('fields', [...formData.fields, newField]);
  };

  /**
   * Update field in simple block
   * @param {number} index - Field index
   * @param {string} key - Field property key
   * @param {any} value - Field property value
   */
  const updateField = (index, key, value) => {
    const newFields = [...formData.fields];
    newFields[index] = { ...newFields[index], [key]: value };
    updateFormField('fields', newFields);
  };

  /**
   * Remove field from simple block
   * @param {number} index - Field index
   */
  const removeField = (index) => {
    updateFormField(
      'fields',
      formData.fields.filter((_, i) => i !== index)
    );
  };

  // Loading state
  if (isLoading) {
    return (
      <PageWrapper>
        <Container>
          <LoadingWrapper>
            <LoadingSpinner />
            <LoadingText>Loading custom blocks...</LoadingText>
          </LoadingWrapper>
        </Container>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <Container>
        {/* Header */}
        <Header>
          <HeaderLeft>
            <PageTitle>
              <Squares2X2Icon />
              Custom Blocks
            </PageTitle>
            <PageSubtitle>
              Create and manage custom editor blocks to extend Magic Editor X with your own content types.
            </PageSubtitle>
          </HeaderLeft>
          <HeaderRight>
            {canExportImport() && (
              <>
                <Button $variant="secondary" onClick={handleExport} disabled={blocks.length === 0}>
                  <ArrowDownTrayIcon />
                  Export
                </Button>
                <Button $variant="secondary" onClick={handleImport}>
                  <ArrowUpTrayIcon />
                  Import
                </Button>
              </>
            )}
            <Button 
              $variant="primary" 
              onClick={handleCreate}
              disabled={!canCreateMoreBlocks()}
              title={!canCreateMoreBlocks() ? 'Block limit reached. Upgrade to create more.' : ''}
            >
              <PlusIcon />
              Create Block
            </Button>
          </HeaderRight>
        </Header>

        {/* Limits Banner */}
        {limits && limits.limits.maxTotal !== -1 && (
          <LimitsBanner>
            <LimitsInfo>
              <LimitsText>
                <strong>Custom Blocks Usage</strong> - {limits.usage.total} of {limits.limits.maxTotal} blocks used
                {limits.tier === 'free' && limits.limits.maxEmbedded === 0 && (
                  <span style={{ marginLeft: 8, opacity: 0.8 }}>(Simple blocks only)</span>
                )}
              </LimitsText>
              <LimitsProgress>
                <ProgressBar>
                  <ProgressFill $percentage={getUsagePercentage()} />
                </ProgressBar>
                <ProgressLabel>{getUsagePercentage()}%</ProgressLabel>
              </LimitsProgress>
            </LimitsInfo>
            <TierBadge $tier={limits.tier}>{limits.tier}</TierBadge>
            {getUsagePercentage() >= 80 && (
              <UpgradeButton onClick={() => window.location.href = '/admin/settings/magic-editor-x/license'}>
                <SparklesIcon />
                Upgrade
              </UpgradeButton>
            )}
          </LimitsBanner>
        )}

        {/* Blocks Grid or Empty State */}
        {blocks.length === 0 ? (
          <EmptyState>
            <EmptyIcon>
              <CubeIcon />
            </EmptyIcon>
            <EmptyTitle>No Custom Blocks Yet</EmptyTitle>
            <EmptyText>
              Custom blocks allow you to extend the editor with your own content types,
              templates{limits?.tier !== 'free' && ', and embedded Strapi entries'}.
            </EmptyText>
            {limits && limits.tier === 'free' && (
              <div style={{ marginBottom: 16, padding: '12px 16px', background: '#fef3c7', borderRadius: 8, fontSize: '0.85rem', color: '#92400e' }}>
                Free tier: Up to {limits.limits.maxTotal} simple blocks. Upgrade for embedded entries.
              </div>
            )}
            <Button $variant="primary" onClick={handleCreate}>
              <PlusIcon />
              Create Your First Block
            </Button>
          </EmptyState>
        ) : (
          <BlocksGrid>
            {blocks.map((block, index) => (
              <BlockCard key={block.documentId} $index={index} $enabled={block.enabled}>
                <CardHeader>
                  <BlockIconWrapper $type={block.blockType}>
                    {block.blockType === 'embedded-entry' ? (
                      <LinkIcon />
                    ) : (
                      <CubeIconSolid />
                    )}
                  </BlockIconWrapper>
                  <BlockInfo>
                    <BlockName>{block.label || block.name}</BlockName>
                    <BlockSlug>{block.name}</BlockSlug>
                  </BlockInfo>
                </CardHeader>
                
                <CardBody>
                  <BlockDescription>
                    {block.description || 'No description provided.'}
                  </BlockDescription>
                  
                  <MetaRow>
                    <MetaTag $type="type" $value={block.blockType}>
                      {block.blockType === 'embedded-entry' ? (
                        <>
                          <LinkIcon />
                          Embedded Entry
                        </>
                      ) : (
                        <>
                          <CodeBracketIcon />
                          Simple Block
                        </>
                      )}
                    </MetaTag>
                    
                    <MetaTag $type="status" $enabled={block.enabled}>
                      {block.enabled ? (
                        <>
                          <CheckCircleIcon />
                          Enabled
                        </>
                      ) : (
                        <>
                          <XCircleIcon />
                          Disabled
                        </>
                      )}
                    </MetaTag>
                    
                    {block.shortcut && (
                      <MetaTag $type="shortcut">
                        <CommandLineIcon />
                        {block.shortcut}
                      </MetaTag>
                    )}
                    
                    {block.contentType && (
                      <MetaTag $type="content-type">
                        {block.contentType.split('::')[1]?.split('.')[0] || block.contentType}
                      </MetaTag>
                    )}
                  </MetaRow>
                </CardBody>
                
                <CardFooter>
                  <ToggleSwitch
                    $enabled={block.enabled}
                    onClick={() => handleToggle(block)}
                    title={block.enabled ? 'Disable block' : 'Enable block'}
                  />
                  <ActionGroup>
                    <IconButton onClick={() => handleEdit(block)} title="Edit block">
                      <PencilSquareIcon />
                    </IconButton>
                    <IconButton onClick={() => handleDuplicate(block)} title="Duplicate block">
                      <DocumentDuplicateIcon />
                    </IconButton>
                    <IconButton $danger onClick={() => handleDelete(block)} title="Delete block">
                      <TrashIcon />
                    </IconButton>
                  </ActionGroup>
                </CardFooter>
              </BlockCard>
            ))}
          </BlocksGrid>
        )}

        {/* Create/Edit Modal */}
        {isModalOpen && (
          <ModalOverlay onClick={() => setIsModalOpen(false)}>
            <ModalContent onClick={(e) => e.stopPropagation()}>
              <ModalHeader>
                <ModalTitle>
                  {editingBlock ? <PencilSquareIcon /> : <SparklesIconSolid />}
                  {editingBlock ? 'Edit Block' : 'Create Custom Block'}
                </ModalTitle>
                <IconButton onClick={() => setIsModalOpen(false)}>
                  <XMarkIcon />
                </IconButton>
              </ModalHeader>
              
              <ModalBody>
                {/* Basic Info Section */}
                <FormSection>
                  <SectionTitle>
                    <CubeIcon />
                    Basic Information
                  </SectionTitle>
                  
                  <FormGrid $columns="1fr 1fr">
                    <FormGroup>
                      <Label>Block Name <span>*</span></Label>
                      <Input
                        value={formData.name}
                        onChange={(e) => updateFormField('name', e.target.value)}
                        placeholder="myCustomBlock"
                        disabled={!!editingBlock}
                      />
                      <Hint>Unique identifier (letters, numbers, underscores)</Hint>
                    </FormGroup>
                    
                    <FormGroup>
                      <Label>Display Label <span>*</span></Label>
                      <Input
                        value={formData.label}
                        onChange={(e) => updateFormField('label', e.target.value)}
                        placeholder="My Custom Block"
                      />
                      <Hint>Shown in the editor toolbox</Hint>
                    </FormGroup>
                  </FormGrid>
                  
                  <FormGroup style={{ marginTop: 16 }}>
                    <Label>
                      Block Type <span>*</span>
                      {!canCreateEmbeddedEntry() && formData.blockType !== 'embedded-entry' && (
                        <FeatureLockedBadge>
                          <XCircleIcon />
                          Premium+
                        </FeatureLockedBadge>
                      )}
                    </Label>
                    <Select
                      value={formData.blockType}
                      onChange={(e) => {
                        // Prevent selecting embedded-entry if not allowed
                        if (e.target.value === 'embedded-entry' && !canCreateEmbeddedEntry()) {
                          toggleNotification({
                            type: 'warning',
                            message: 'Embedded Entry blocks require Premium or higher tier.',
                          });
                          return;
                        }
                        updateFormField('blockType', e.target.value);
                      }}
                    >
                      <option value="simple">Simple Block (Text/HTML)</option>
                      <option value="embedded-entry" disabled={!canCreateEmbeddedEntry() && !editingBlock}>
                        Embedded Entry (Strapi Content) {!canCreateEmbeddedEntry() ? '(Premium+)' : ''}
                      </option>
                    </Select>
                    {!canCreateEmbeddedEntry() && (
                      <Hint style={{ color: '#f59e0b' }}>
                        Embedded Entry blocks require Premium or higher tier.
                      </Hint>
                    )}
                  </FormGroup>
                  
                  <FormGroup style={{ marginTop: 16 }}>
                    <Label>Description</Label>
                    <TextArea
                      value={formData.description}
                      onChange={(e) => updateFormField('description', e.target.value)}
                      placeholder="Describe what this block does..."
                      $rows={2}
                    />
                  </FormGroup>
                </FormSection>

                {/* Embedded Entry Options */}
                {formData.blockType === 'embedded-entry' && (
                  <FormSection>
                    <SectionTitle>
                      <LinkIcon />
                      Embedded Entry Settings
                    </SectionTitle>
                    
                    <FormGroup>
                      <Label>Content Type</Label>
                      <Select
                        value={formData.contentType}
                        onChange={(e) => updateFormField('contentType', e.target.value)}
                      >
                        <option value="">Any Content Type</option>
                        {contentTypes.map((ct) => (
                          <option key={ct.uid} value={ct.uid}>
                            {ct.displayName} ({ct.uid})
                          </option>
                        ))}
                      </Select>
                      <Hint>Leave empty to allow any content type</Hint>
                    </FormGroup>
                    
                    <FormGrid $columns="1fr 1fr" style={{ marginTop: 16 }}>
                      <FormGroup>
                        <Label>Title Field</Label>
                        <Input
                          value={formData.titleField}
                          onChange={(e) => updateFormField('titleField', e.target.value)}
                          placeholder="title"
                        />
                      </FormGroup>
                      
                      <FormGroup>
                        <Label>Display Fields</Label>
                        <Input
                          value={formData.displayFields.join(', ')}
                          onChange={(e) =>
                            updateFormField(
                              'displayFields',
                              e.target.value.split(',').map((s) => s.trim())
                            )
                          }
                          placeholder="title, name, id"
                        />
                      </FormGroup>
                    </FormGrid>
                  </FormSection>
                )}

                {/* Simple Block Options */}
                {formData.blockType === 'simple' && (
                  <FormSection>
                    <SectionTitle>
                      <CodeBracketIcon />
                      Simple Block Settings
                    </SectionTitle>
                    
                    <FormGroup>
                      <Label>Placeholder Text</Label>
                      <Input
                        value={formData.placeholder}
                        onChange={(e) => updateFormField('placeholder', e.target.value)}
                        placeholder="Enter content..."
                      />
                    </FormGroup>
                    
                    <FormGroup style={{ marginTop: 16 }}>
                      <Label>HTML Template (Optional)</Label>
                      <TextArea
                        value={formData.template}
                        onChange={(e) => updateFormField('template', e.target.value)}
                        placeholder='<div class="my-block">{{content}}</div>'
                        $rows={4}
                        $mono
                      />
                      <Hint>Use {'{{fieldName}}'} for placeholders</Hint>
                    </FormGroup>
                    
                    <FormGroup style={{ marginTop: 16 }}>
                      <Label>Custom Fields</Label>
                      {formData.fields.length > 0 && (
                        <FieldsContainer>
                          {formData.fields.map((field, index) => (
                            <FieldRow key={index}>
                              <FieldInput
                                value={field.name}
                                onChange={(e) => updateField(index, 'name', e.target.value)}
                                placeholder="Field name"
                              />
                              <FieldInput
                                value={field.label}
                                onChange={(e) => updateField(index, 'label', e.target.value)}
                                placeholder="Label"
                              />
                              <FieldSelect
                                value={field.type}
                                onChange={(e) => updateField(index, 'type', e.target.value)}
                              >
                                <option value="text">Text</option>
                                <option value="textarea">Textarea</option>
                                <option value="select">Select</option>
                                <option value="color">Color</option>
                                <option value="checkbox">Checkbox</option>
                                <option value="image">Image</option>
                              </FieldSelect>
                              <IconButton $danger onClick={() => removeField(index)}>
                                <TrashIcon />
                              </IconButton>
                            </FieldRow>
                          ))}
                        </FieldsContainer>
                      )}
                      <AddFieldButton onClick={addField}>
                        <PlusIcon />
                        Add Field
                      </AddFieldButton>
                    </FormGroup>
                  </FormSection>
                )}

                {/* Advanced Options */}
                <FormSection>
                  <SectionTitle>
                    <SparklesIcon />
                    Advanced Options
                  </SectionTitle>
                  
                  <FormGroup>
                    <Label>Icon (SVG)</Label>
                    <TextArea
                      value={formData.icon}
                      onChange={(e) => updateFormField('icon', e.target.value)}
                      placeholder='<svg viewBox="0 0 24 24">...</svg>'
                      $rows={2}
                      $mono
                    />
                    <Hint>Custom SVG icon for the toolbox</Hint>
                  </FormGroup>
                  
                  <FormGroup style={{ marginTop: 16 }}>
                    <Label>Keyboard Shortcut</Label>
                    <Input
                      value={formData.shortcut}
                      onChange={(e) => updateFormField('shortcut', e.target.value)}
                      placeholder="CMD+SHIFT+X"
                    />
                  </FormGroup>
                  
                  <FormGrid $columns="1fr 1fr" style={{ marginTop: 16 }}>
                    <CheckboxRow>
                      <Checkbox
                        checked={formData.inlineToolbar}
                        onChange={(e) => updateFormField('inlineToolbar', e.target.checked)}
                      />
                      <CheckboxLabel>Enable Inline Toolbar</CheckboxLabel>
                    </CheckboxRow>
                    
                    <CheckboxRow>
                      <Checkbox
                        checked={formData.enabled}
                        onChange={(e) => updateFormField('enabled', e.target.checked)}
                      />
                      <CheckboxLabel>Block Enabled</CheckboxLabel>
                    </CheckboxRow>
                  </FormGrid>
                </FormSection>
              </ModalBody>
              
              <ModalFooter>
                <Button $variant="secondary" onClick={() => setIsModalOpen(false)}>
                  Cancel
                </Button>
                <Button $variant="primary" onClick={handleSave}>
                  {editingBlock ? 'Save Changes' : 'Create Block'}
                </Button>
              </ModalFooter>
            </ModalContent>
          </ModalOverlay>
        )}
      </Container>
    </PageWrapper>
  );
};

export default CustomBlocksPage;
