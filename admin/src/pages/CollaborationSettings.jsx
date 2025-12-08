/**
 * Magic Editor X - Collaboration Settings Page
 * Manage user permissions for realtime editing
 */
import React, { useState, useEffect } from 'react';
import { useFetchClient } from '@strapi/strapi/admin';
import { useIntl } from 'react-intl';
import { getTranslation } from '../utils/getTranslation';
import styled from 'styled-components';
import {
  UserGroupIcon,
  UserPlusIcon,
  CheckCircleIcon,
  TrashIcon,
} from '@heroicons/react/24/outline';
import { Loader } from '@strapi/design-system';

/* ============================================
   STYLED COMPONENTS - FULLY RESPONSIVE
   ============================================ */

const Container = styled.div`
  padding: clamp(16px, 4vw, 40px);
  max-width: 1400px;
  margin: 0 auto;
  min-height: 100vh;
  box-sizing: border-box;
`;

const Header = styled.div`
  margin-bottom: clamp(20px, 4vw, 32px);
`;

const Title = styled.h1`
  font-size: clamp(22px, 4vw, 32px);
  font-weight: 700;
  color: ${props => props.theme.colors.neutral800};
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  flex-wrap: wrap;

  svg {
    width: clamp(24px, 4vw, 32px);
    height: clamp(24px, 4vw, 32px);
    color: #7C3AED;
    flex-shrink: 0;
  }
`;

const Subtitle = styled.p`
  font-size: clamp(13px, 2vw, 15px);
  color: ${props => props.theme.colors.neutral600};
  margin: 0;
`;

const Card = styled.div`
  background: ${props => props.theme.colors.neutral0};
  border: 1px solid ${props => props.theme.colors.neutral200};
  border-radius: clamp(12px, 2vw, 16px);
  padding: clamp(16px, 3vw, 24px);
  margin-bottom: 24px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
  overflow-x: auto;
`;

const CardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 20px;
  gap: 12px;
  flex-wrap: wrap;

  @media (max-width: 480px) {
    flex-direction: column;
    align-items: stretch;
  }
`;

const CardTitle = styled.h2`
  font-size: clamp(16px, 2.5vw, 18px);
  font-weight: 600;
  color: ${props => props.theme.colors.neutral800};
  margin: 0;
`;

const Button = styled.button`
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  padding: clamp(8px, 1.5vw, 10px) clamp(14px, 2vw, 20px);
  background: ${props => props.$danger ? '#ef4444' : props.$secondary ? props.theme.colors.neutral0 : 'linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%)'};
  border: 1px solid ${props => props.$danger ? '#ef4444' : props.$secondary ? props.theme.colors.neutral200 : 'transparent'};
  border-radius: 10px;
  color: ${props => props.$secondary ? props.theme.colors.neutral600 : 'white'};
  font-size: clamp(13px, 2vw, 14px);
  font-weight: 500;
  cursor: pointer;
  transition: all 0.2s ease;
  white-space: nowrap;
  flex-shrink: 0;

  svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }

  &:hover {
    transform: translateY(-1px);
    box-shadow: 0 4px 12px ${props => props.$danger ? 'rgba(239, 68, 68, 0.3)' : props.$secondary ? 'rgba(0,0,0,0.1)' : 'rgba(124, 58, 237, 0.3)'};
  }

  &:active {
    transform: translateY(0);
  }

  &:disabled {
    opacity: 0.5;
    cursor: not-allowed;
    transform: none;
  }

  @media (max-width: 480px) {
    width: 100%;
  }
`;

/* Mobile Card Layout for Permissions */
const PermissionsList = styled.div`
  display: none;

  @media (max-width: 768px) {
    display: flex;
    flex-direction: column;
    gap: 12px;
  }
`;

const PermissionCard = styled.div`
  background: ${props => props.theme.colors.neutral100};
  border: 1px solid ${props => props.theme.colors.neutral200};
  border-radius: 12px;
  padding: 16px;
`;

const PermissionCardHeader = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
`;

const PermissionCardBody = styled.div`
  display: flex;
  flex-direction: column;
  gap: 12px;
`;

const PermissionRow = styled.div`
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
`;

const PermissionLabel = styled.span`
  font-size: 12px;
  font-weight: 600;
  color: ${props => props.theme.colors.neutral600};
  text-transform: uppercase;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  min-width: 600px;

  @media (max-width: 768px) {
    display: none;
  }
`;

const Th = styled.th`
  text-align: left;
  padding: 12px 16px;
  font-size: 13px;
  font-weight: 600;
  color: ${props => props.theme.colors.neutral600};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  border-bottom: 2px solid ${props => props.theme.colors.neutral150};
  white-space: nowrap;
`;

const Td = styled.td`
  padding: 16px;
  border-bottom: 1px solid ${props => props.theme.colors.neutral150};
  font-size: 14px;
  color: ${props => props.theme.colors.neutral800};
`;

const UserInfo = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
`;

const Avatar = styled.div`
  width: clamp(36px, 5vw, 40px);
  height: clamp(36px, 5vw, 40px);
  border-radius: 50%;
  background: linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-weight: 600;
  font-size: clamp(12px, 2vw, 14px);
  flex-shrink: 0;
`;

const UserDetails = styled.div`
  display: flex;
  flex-direction: column;
  min-width: 0;
`;

const UserName = styled.div`
  font-weight: 600;
  color: ${props => props.theme.colors.neutral800};
  font-size: clamp(13px, 2vw, 14px);
`;

const UserEmail = styled.div`
  font-size: clamp(11px, 1.5vw, 13px);
  color: ${props => props.theme.colors.neutral600};
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 200px;

  @media (max-width: 480px) {
    max-width: 150px;
  }
`;

const Badge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  background: ${props => 
    props.$role === 'owner' ? '#7C3AED' :
    props.$role === 'editor' ? '#10B981' :
    '#64748b'
  };
  color: white;

  svg {
    width: 14px;
    height: 14px;
  }
`;

const Select = styled.select`
  padding: clamp(6px, 1vw, 8px) clamp(10px, 1.5vw, 12px);
  border: 1px solid ${props => props.theme.colors.neutral200};
  border-radius: 8px;
  font-size: clamp(12px, 2vw, 14px);
  color: ${props => props.theme.colors.neutral800};
  background: ${props => props.theme.colors.neutral0};
  cursor: pointer;
  max-width: 100%;

  &:focus {
    outline: none;
    border-color: #7C3AED;
  }
`;

const EmptyState = styled.div`
  text-align: center;
  padding: clamp(40px, 6vw, 60px) 20px;
  color: ${props => props.theme.colors.neutral500};

  h3 {
    font-size: clamp(16px, 2.5vw, 18px);
    margin: 0 0 8px;
    color: ${props => props.theme.colors.neutral600};
  }

  p {
    font-size: clamp(13px, 2vw, 14px);
    margin: 0;
  }
`;

const EmptyIcon = styled.div`
  width: clamp(60px, 10vw, 80px);
  height: clamp(60px, 10vw, 80px);
  margin: 0 auto 20px;
  background: ${props => props.theme.colors.neutral100};
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;

  svg {
    width: clamp(30px, 5vw, 40px);
    height: clamp(30px, 5vw, 40px);
    color: ${props => props.theme.colors.neutral400};
  }
`;

const Modal = styled.div`
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(15, 23, 42, 0.75);
  backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
  padding: 16px;
  animation: fadeIn 0.2s ease;
  overflow-y: auto;

  @keyframes fadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }

  @media (max-width: 600px) {
    align-items: flex-start;
    padding-top: 20px;
    padding-bottom: 20px;
  }
`;

const ModalContent = styled.div`
  background: ${props => props.theme.colors.neutral0};
  border-radius: clamp(16px, 3vw, 24px);
  padding: 0;
  max-width: 580px;
  width: 100%;
  max-height: calc(100vh - 40px);
  overflow-y: auto;
  box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.25);
  animation: slideUp 0.3s ease;

  @keyframes slideUp {
    from { 
      opacity: 0;
      transform: translateY(20px);
    }
    to { 
      opacity: 1;
      transform: translateY(0);
    }
  }

  @media (max-width: 600px) {
    max-height: none;
    border-radius: 16px;
  }
`;

const ModalHeader = styled.div`
  background: linear-gradient(135deg, #7C3AED 0%, #6d28d9 100%);
  padding: clamp(20px, 4vw, 32px);
  color: white;
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -10%;
    width: 200px;
    height: 200px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 50%;
    filter: blur(40px);
  }
`;

const ModalBody = styled.div`
  padding: clamp(20px, 4vw, 32px);
`;

const ModalTitle = styled.h3`
  font-size: clamp(18px, 3vw, 24px);
  font-weight: 700;
  margin: 0 0 8px 0;
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;

  svg {
    width: clamp(22px, 3vw, 28px);
    height: clamp(22px, 3vw, 28px);
    flex-shrink: 0;
  }
`;

const ModalSubtitle = styled.p`
  font-size: clamp(13px, 2vw, 15px);
  margin: 0;
  opacity: 0.95;
  position: relative;
`;

const FormGroup = styled.div`
  margin-bottom: clamp(16px, 3vw, 24px);
`;

const Label = styled.label`
  display: block;
  font-size: clamp(13px, 2vw, 14px);
  font-weight: 600;
  color: ${props => props.theme.colors.neutral800};
  margin-bottom: 10px;
`;

const SelectWrapper = styled.div`
  position: relative;
`;

const StyledSelect = styled.select`
  width: 100%;
  padding: clamp(12px, 2vw, 14px) clamp(14px, 2vw, 16px);
  border: 2px solid ${props => props.theme.colors.neutral200};
  border-radius: 12px;
  font-size: clamp(14px, 2vw, 15px);
  color: ${props => props.theme.colors.neutral800};
  background: ${props => props.theme.colors.neutral0};
  cursor: pointer;
  transition: all 0.2s ease;
  appearance: none;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%2364748b'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' stroke-width='2' d='M19 9l-7 7-7-7'%3E%3C/path%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 12px center;
  background-size: 20px;
  padding-right: 40px;

  &:hover {
    border-color: #a78bfa;
  }

  &:focus {
    outline: none;
    border-color: #7C3AED;
    box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.1);
  }

  option {
    padding: 12px;
  }
`;

const Input = styled.input`
  width: 100%;
  padding: clamp(12px, 2vw, 14px) clamp(14px, 2vw, 16px);
  border: 2px solid ${props => props.theme.colors.neutral200};
  border-radius: 12px;
  font-size: clamp(14px, 2vw, 15px);
  color: ${props => props.theme.colors.neutral800};
  background: ${props => props.theme.colors.neutral0};
  transition: all 0.2s ease;
  box-sizing: border-box;

  &:hover {
    border-color: #a78bfa;
  }

  &:focus {
    outline: none;
    border-color: #7C3AED;
    box-shadow: 0 0 0 4px rgba(124, 58, 237, 0.1);
  }

  &::placeholder {
    color: ${props => props.theme.colors.neutral500};
  }
`;

const RoleOption = styled.div`
  display: flex;
  align-items: center;
  gap: clamp(10px, 2vw, 12px);
  padding: clamp(12px, 2vw, 16px);
  border: 2px solid ${props => props.$selected ? '#7C3AED' : props.theme.colors.neutral200};
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s ease;
  background: ${props => props.$selected ? 'rgba(124, 58, 237, 0.05)' : props.theme.colors.neutral0};

  &:hover {
    border-color: #7C3AED;
    background: rgba(124, 58, 237, 0.03);
  }

  &:active {
    transform: scale(0.99);
  }
`;

const RoleIcon = styled.div`
  font-size: clamp(18px, 3vw, 24px);
  width: clamp(40px, 6vw, 48px);
  height: clamp(40px, 6vw, 48px);
  display: flex;
  align-items: center;
  justify-content: center;
  background: ${props => 
    props.$role === 'owner' ? 'linear-gradient(135deg, #FFD700 0%, #FFA500 100%)' :
    props.$role === 'editor' ? 'linear-gradient(135deg, #10B981 0%, #059669 100%)' :
    'linear-gradient(135deg, #64748b 0%, #475569 100%)'
  };
  border-radius: 12px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
  flex-shrink: 0;
`;

const RoleInfo = styled.div`
  flex: 1;
  min-width: 0;
`;

const RoleName = styled.div`
  font-weight: 600;
  color: ${props => props.theme.colors.neutral800};
  font-size: clamp(14px, 2vw, 16px);
  margin-bottom: 4px;
`;

const RoleDescription = styled.div`
  font-size: clamp(11px, 1.5vw, 13px);
  color: ${props => props.theme.colors.neutral600};
  line-height: 1.4;
`;

const RoleGrid = styled.div`
  display: grid;
  gap: 12px;
  margin-bottom: clamp(16px, 3vw, 24px);
`;

const ModalActions = styled.div`
  display: flex;
  gap: 12px;
  margin-top: clamp(16px, 3vw, 24px);
  flex-wrap: wrap;

  @media (max-width: 400px) {
    flex-direction: column;
    
    button {
      width: 100%;
    }
  }
`;

const LoadingContainer = styled.div`
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(40px, 6vw, 60px);
`;

const HelpText = styled.small`
  display: block;
  margin-top: 8px;
  font-size: clamp(11px, 1.5vw, 12px);
  color: ${props => props.$warning ? '#f59e0b' : props.theme.colors.neutral600};
  line-height: 1.4;
`;

const ContentTypeTag = styled.span`
  display: inline-block;
  background: ${props => props.theme.colors.neutral100};
  color: #7C3AED;
  padding: 4px 10px;
  border-radius: 6px;
  font-size: clamp(11px, 1.5vw, 13px);
  font-weight: 500;
  max-width: 180px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;

  @media (max-width: 480px) {
    max-width: 120px;
  }
`;

/* ============================================
   MAIN COMPONENT
   ============================================ */

const CollaborationSettings = () => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  const { get, post, put, del } = useFetchClient();
  const [loading, setLoading] = useState(true);
  const [permissions, setPermissions] = useState([]);
  const [users, setUsers] = useState([]);
  const [contentTypes, setContentTypes] = useState([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState('editor');
  const [contentType, setContentType] = useState('');
  const [saving, setSaving] = useState(false);
  const [limits, setLimits] = useState({ current: 0, max: 2, unlimited: false, canAdd: true });

  // Load permissions, users and content types
  useEffect(() => {
    loadData();
    loadLimits();
  }, []);

  /**
   * Load collaborator limits
   */
  const loadLimits = async () => {
    try {
      const response = await get('/magic-editor-x/license/limits');
      if (response.data?.limits?.collaborators) {
        setLimits(response.data.limits.collaborators);
      }
    } catch (error) {
      console.error('[Collab Settings] Error loading limits:', error);
    }
  };

  const loadData = async () => {
    setLoading(true);
    try {
      const [permsRes, usersRes, typesRes] = await Promise.all([
        get('/magic-editor-x/collaboration/permissions'),
        get('/magic-editor-x/collaboration/users'),
        get('/content-type-builder/content-types'),
      ]);

      setPermissions(permsRes.data?.data || permsRes.data || []);
      setUsers(usersRes.data?.data || usersRes.data || []);
      
      // Extract content types that have the magic-editor-x custom field
      const allTypes = typesRes.data?.data || typesRes.data || [];
      
      console.log('[Collab] All content types from API:', allTypes);
      
      const filteredTypes = allTypes
        .filter(type => {
          // Only show API content types (not admin, plugins, etc.)
          const uid = type.uid || '';
          if (!uid.startsWith('api::')) {
            return false;
          }
          
          // Check schema attributes for magic-editor-x custom field
          const schema = type.schema || type;
          const attributes = schema.attributes || type.attributes || {};
          
          const hasMagicEditorField = Object.entries(attributes).some(([fieldName, attr]) => {
            // Check for magic-editor-x custom field
            // In Strapi v5, type can be 'text' with customField property
            const customFieldValue = attr.customField || '';
            const isMagicEditor = customFieldValue.includes('magic-editor-x');
            
            if (isMagicEditor) {
              console.log(`[Collab] ✅ Found Magic Editor field: ${uid}.${fieldName}`, attr);
            }
            
            return isMagicEditor;
          });
          
          return hasMagicEditorField;
        })
        .map(type => {
          const schema = type.schema || type;
          const attributes = schema.attributes || type.attributes || {};
          
          return {
            uid: type.uid,
            displayName: schema.info?.displayName || schema.info?.singularName || type.uid,
            singularName: schema.info?.singularName,
            pluralName: schema.info?.pluralName,
            kind: schema.kind || type.kind,
            // Find the magic editor field names
            magicEditorFields: Object.entries(attributes)
              .filter(([_, attr]) => 
                (attr.customField || '').includes('magic-editor-x')
              )
              .map(([name]) => name),
          };
        })
        .sort((a, b) => a.displayName.localeCompare(b.displayName));
      
      setContentTypes(filteredTypes);
      
      console.log('[Collab] Content types with Magic Editor X:', filteredTypes);
      
      console.log('[Collab] Loaded users:', usersRes.data);
      console.log('[Collab] Loaded permissions:', permsRes.data);
      console.log('[Collab] Loaded content types:', filteredTypes);
    } catch (error) {
      console.error('[Collab Settings] Load error:', error);
      alert(t('collaboration.errorLoading', 'Error loading: {error}', { error: error.message || 'Unknown error' }));
    } finally {
      setLoading(false);
    }
  };

  const handleAddPermission = async () => {
    if (!selectedUser || !selectedRole) return;

    setSaving(true);
    try {
      await post('/magic-editor-x/collaboration/permissions', {
        userId: selectedUser,
        role: selectedRole,
        contentType: contentType || '*',
        entryId: null,
        fieldName: null,
      });

      await loadData();
      await loadLimits(); // Refresh limits after adding
      setShowAddModal(false);
      setSelectedUser('');
      setSelectedRole('editor');
      setContentType('');
    } catch (error) {
      console.error('[Collab Settings] Add error:', error);
      // Check if it's a limit error
      if (error.response?.data?.upgradeRequired) {
        alert(t('collaboration.limitReachedAlert', 'Collaborator limit reached.\n\nUpgrade at https://store.magicdx.dev/ for more collaborators.'));
      } else {
        alert(t('collaboration.errorAdding', 'Error adding permission'));
      }
    } finally {
      setSaving(false);
    }
  };

  /**
   * Handle opening add modal - check limits first
   */
  const handleOpenAddModal = () => {
    if (!limits.canAdd && !limits.unlimited) {
      alert(t('collaboration.limitReachedAlert', 'Collaborator limit reached ({current}/{max}).\n\nUpgrade at https://store.magicdx.dev/ for more collaborators.', { current: limits.current, max: limits.max }));
      return;
    }
    setShowAddModal(true);
  };

  const handleUpdateRole = async (permissionId, newRole) => {
    try {
      await put(`/magic-editor-x/collaboration/permissions/${permissionId}`, {
        role: newRole,
      });

      await loadData();
    } catch (error) {
      console.error('[Collab Settings] Update error:', error);
      alert(t('collaboration.errorUpdating', 'Error updating role'));
    }
  };

  const handleUpdateContentType = async (permissionId, newContentType) => {
    try {
      await put(`/magic-editor-x/collaboration/permissions/${permissionId}`, {
        contentType: newContentType === '*' ? null : newContentType,
      });

      await loadData();
    } catch (error) {
      console.error('[Collab Settings] Update content type error:', error);
      alert(t('collaboration.errorUpdating', 'Error updating role'));
    }
  };

  const handleDeletePermission = async (permissionId) => {
    if (!confirm(t('collaboration.confirmDelete', 'Really remove permission?'))) return;

    try {
      await del(`/magic-editor-x/collaboration/permissions/${permissionId}`);
      await loadData();
      await loadLimits(); // Refresh limits after deleting
    } catch (error) {
      console.error('[Collab Settings] Delete error:', error);
      alert(t('collaboration.errorDeleting', 'Error deleting permission'));
    }
  };

  const getUserInitials = (user) => {
    if (!user) return '?';
    const first = (user.firstname?.[0] || user.email?.[0] || '?').toUpperCase();
    const last = (user.lastname?.[0] || '').toUpperCase();
    return `${first}${last}`.trim();
  };

  if (loading) {
    return (
      <Container>
        <LoadingContainer>
          <Loader />
        </LoadingContainer>
      </Container>
    );
  }

  return (
    <Container>
      <Header>
        <Title>
          <UserGroupIcon />
          {t('collaboration.title', 'Collaboration')}
        </Title>
        <Subtitle>
          {t('collaboration.subtitle', 'Manage permissions for real-time editing')}
        </Subtitle>
      </Header>

      {/* Limit Info Banner */}
      {!limits.unlimited && (
        <Card style={{ marginBottom: '16px', background: limits.canAdd ? '#f0fdf4' : '#fef2f2', borderColor: limits.canAdd ? '#bbf7d0' : '#fecaca' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '12px' }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '4px' }}>
                {t('collaboration.limitInfo', 'Collaborators: {current} / {max}', { current: limits.current, max: limits.max })}
              </div>
              <div style={{ fontSize: '13px', color: '#6b7280' }}>
                {limits.canAdd 
                  ? t('collaboration.limitCanAdd', 'You can add {remaining} more collaborator(s).', { remaining: limits.max - limits.current })
                  : t('collaboration.limitReached', 'Limit reached. Upgrade for more collaborators.')}
              </div>
            </div>
            {!limits.canAdd && (
              <Button 
                onClick={() => window.open('https://store.magicdx.dev/', '_blank')}
                style={{ background: 'linear-gradient(135deg, #7C3AED, #6d28d9)', color: 'white' }}
              >
                {t('collaboration.upgrade', 'Upgrade')}
              </Button>
            )}
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t('collaboration.authorizedUsers', 'Authorized Users ({count})', { count: permissions.length })}</CardTitle>
          <Button onClick={handleOpenAddModal} disabled={!limits.canAdd && !limits.unlimited}>
            <UserPlusIcon />
            {t('collaboration.addUser', 'Add User')}
          </Button>
        </CardHeader>

        {permissions.length === 0 ? (
          <EmptyState>
            <EmptyIcon>
              <UserGroupIcon />
            </EmptyIcon>
            <h3>{t('collaboration.noPermissions', 'No Permissions')}</h3>
            <p>{t('collaboration.noPermissions.description', 'Add users to enable collaboration')}</p>
          </EmptyState>
        ) : (
          <>
            {/* Desktop Table View */}
          <Table>
            <thead>
              <tr>
                <Th>{t('collaboration.user', 'User')}</Th>
                <Th>{t('collaboration.role', 'Role')}</Th>
                <Th>{t('collaboration.contentType', 'Content Type')}</Th>
                <Th>{t('collaboration.actions', 'Actions')}</Th>
              </tr>
            </thead>
            <tbody>
              {permissions.map((perm) => (
                  <tr key={perm.documentId}>
                  <Td>
                    <UserInfo>
                      <Avatar>{getUserInitials(perm.user)}</Avatar>
                      <UserDetails>
                        <UserName>
                          {perm.user?.firstname} {perm.user?.lastname}
                        </UserName>
                        <UserEmail>{perm.user?.email}</UserEmail>
                      </UserDetails>
                    </UserInfo>
                  </Td>
                  <Td>
                    <Select
                      value={perm.role}
                        onChange={(e) => handleUpdateRole(perm.documentId, e.target.value)}
                    >
                      <option value="viewer">👁️ {t('role.viewer', 'Viewer')}</option>
                      <option value="editor">✏️ {t('role.editor', 'Editor')}</option>
                      <option value="owner">👑 {t('role.owner', 'Owner')}</option>
                    </Select>
                  </Td>
                    <Td>
                      <Select
                        value={perm.contentType || '*'}
                        onChange={(e) => handleUpdateContentType(perm.documentId, e.target.value)}
                        style={{ minWidth: '160px' }}
                      >
                        <option value="*">🌐 {t('collaboration.allContentTypes', 'All Content Types with Magic Editor')}</option>
                        {contentTypes.map((type) => (
                          <option key={type.uid} value={type.uid}>
                            {type.kind === 'singleType' ? '📄' : '📚'} {type.displayName}
                          </option>
                        ))}
                      </Select>
                    </Td>
                  <Td>
                    <Button
                      $danger
                        onClick={() => handleDeletePermission(perm.documentId)}
                        style={{ padding: '8px 12px' }}
                    >
                      <TrashIcon />
                    </Button>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>

            {/* Mobile Card View */}
            <PermissionsList>
              {permissions.map((perm) => (
                <PermissionCard key={perm.documentId}>
                  <PermissionCardHeader>
                    <UserInfo>
                      <Avatar>{getUserInitials(perm.user)}</Avatar>
                      <UserDetails>
                        <UserName>
                          {perm.user?.firstname} {perm.user?.lastname}
                        </UserName>
                        <UserEmail>{perm.user?.email}</UserEmail>
                      </UserDetails>
                    </UserInfo>
                    <Button
                      $danger
                      onClick={() => handleDeletePermission(perm.documentId)}
                      style={{ padding: '8px 12px' }}
                    >
                      <TrashIcon />
                    </Button>
                  </PermissionCardHeader>
                  <PermissionCardBody>
                    <PermissionRow>
                      <PermissionLabel>{t('collaboration.role', 'Role')}</PermissionLabel>
                      <Select
                        value={perm.role}
                        onChange={(e) => handleUpdateRole(perm.documentId, e.target.value)}
                      >
                        <option value="viewer">👁️ {t('role.viewer', 'Viewer')}</option>
                        <option value="editor">✏️ {t('role.editor', 'Editor')}</option>
                        <option value="owner">👑 {t('role.owner', 'Owner')}</option>
                      </Select>
                    </PermissionRow>
                    <PermissionRow>
                      <PermissionLabel>{t('collaboration.contentType', 'Content Type')}</PermissionLabel>
                      <Select
                        value={perm.contentType || '*'}
                        onChange={(e) => handleUpdateContentType(perm.documentId, e.target.value)}
                      >
                        <option value="*">🌐 {t('collaboration.allContentTypes', 'All Content Types with Magic Editor')}</option>
                        {contentTypes.map((type) => (
                          <option key={type.uid} value={type.uid}>
                            {type.kind === 'singleType' ? '📄' : '📚'} {type.displayName}
                          </option>
                        ))}
                      </Select>
                    </PermissionRow>
                  </PermissionCardBody>
                </PermissionCard>
              ))}
            </PermissionsList>
          </>
        )}
      </Card>

      {showAddModal && (
        <Modal onClick={() => setShowAddModal(false)}>
          <ModalContent onClick={(e) => e.stopPropagation()}>
            <ModalHeader>
              <ModalTitle>
                <UserPlusIcon />
                {t('collaboration.inviteUser', 'Invite User')}
              </ModalTitle>
              <ModalSubtitle>
                {t('collaboration.inviteUser.subtitle', 'Grant access to real-time editing')}
              </ModalSubtitle>
            </ModalHeader>

            <ModalBody>
              <FormGroup>
                <Label>{t('collaboration.selectUser', 'Select User')}</Label>
                <SelectWrapper>
                  <StyledSelect
                    value={selectedUser}
                    onChange={(e) => setSelectedUser(e.target.value)}
                  >
                    <option value="">{t('collaboration.selectUser.placeholder', 'Choose a user...')}</option>
                    {users.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.firstname} {user.lastname} • {user.email}
                      </option>
                    ))}
                  </StyledSelect>
                </SelectWrapper>
              </FormGroup>

              <FormGroup>
                <Label>{t('collaboration.rolePermissions', 'Role & Permissions')}</Label>
                <RoleGrid>
                  <RoleOption
                    $selected={selectedRole === 'viewer'}
                    onClick={() => setSelectedRole('viewer')}
                  >
                    <RoleIcon $role="viewer">👁️</RoleIcon>
                    <RoleInfo>
                      <RoleName>{t('role.viewer', 'Viewer')}</RoleName>
                      <RoleDescription>{t('role.viewer.description', 'Can view changes but not edit')}</RoleDescription>
                    </RoleInfo>
                  </RoleOption>

                  <RoleOption
                    $selected={selectedRole === 'editor'}
                    onClick={() => setSelectedRole('editor')}
                  >
                    <RoleIcon $role="editor">✏️</RoleIcon>
                    <RoleInfo>
                      <RoleName>{t('role.editor', 'Editor')}</RoleName>
                      <RoleDescription>{t('role.editor.description', 'Can edit content and collaborate with others')}</RoleDescription>
                    </RoleInfo>
                  </RoleOption>

                  <RoleOption
                    $selected={selectedRole === 'owner'}
                    onClick={() => setSelectedRole('owner')}
                  >
                    <RoleIcon $role="owner">👑</RoleIcon>
                    <RoleInfo>
                      <RoleName>{t('role.owner', 'Owner')}</RoleName>
                      <RoleDescription>{t('role.owner.description', 'Full access including managing permissions')}</RoleDescription>
                    </RoleInfo>
                  </RoleOption>
                </RoleGrid>
              </FormGroup>

              <FormGroup>
                <Label>{t('collaboration.contentTypeOptional', 'Content Type (optional)')}</Label>
                <SelectWrapper>
                  <StyledSelect
                  value={contentType}
                  onChange={(e) => setContentType(e.target.value)}
                  >
                    <option value="">🌐 {t('collaboration.allContentTypes', 'All Content Types with Magic Editor')}</option>
                    {contentTypes.map((type) => (
                      <option key={type.uid} value={type.uid}>
                        {type.kind === 'singleType' ? '📄' : '📚'} {type.displayName}
                        {type.magicEditorFields?.length > 0 && ` (${type.magicEditorFields.join(', ')})`}
                      </option>
                    ))}
                  </StyledSelect>
                </SelectWrapper>
                {contentTypes.length === 0 ? (
                  <HelpText $warning>
                    {t('collaboration.contentTypeWarning', '⚠️ No content type currently uses the Magic Editor X field. Add the custom field to a content type.')}
                  </HelpText>
                ) : (
                  <HelpText>
                    {t('collaboration.contentTypeHelp', 'Shows only content types with Magic Editor X field • Empty = access to all')}
                  </HelpText>
                )}
              </FormGroup>

              <ModalActions>
                <Button $secondary onClick={() => setShowAddModal(false)}>
                  {t('collaboration.cancel', 'Cancel')}
                </Button>
                <Button onClick={handleAddPermission} disabled={!selectedUser || saving}>
                  <CheckCircleIcon />
                  {saving ? t('collaboration.saving', 'Saving...') : t('collaboration.invite', 'Invite')}
                </Button>
              </ModalActions>
            </ModalBody>
          </ModalContent>
        </Modal>
      )}
    </Container>
  );
};

export default CollaborationSettings;

