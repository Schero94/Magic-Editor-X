/**
 * Live Collaboration Panel - Strapi Edit View Side Panel
 * Uses the same API as Session Manager to appear below PREVIEW
 */
import { useState, useEffect, useMemo } from 'react';
import { useIntl } from 'react-intl';
import { Box, Typography, Flex, Divider } from '@strapi/design-system';
import styled, { css, keyframes } from 'styled-components';
import { getTranslation } from '../utils/getTranslation';

/* ============================================
   STYLED COMPONENTS
   ============================================ */

const pulse = keyframes`
  0%, 100% { 
    box-shadow: 0 0 0 3px rgba(34, 197, 94, 0.2);
    transform: scale(1);
  }
  50% { 
    box-shadow: 0 0 0 6px rgba(34, 197, 94, 0.1);
    transform: scale(1.1);
  }
`;

const StatusCard = styled.div`
  background: ${props => props.theme.colors.neutral0};
  border: 1px solid ${({ $status, theme }) => 
    $status === 'connected' ? 'rgba(34, 197, 94, 0.3)' : 
    $status === 'denied' ? 'rgba(239, 68, 68, 0.3)' : 
    theme.colors.neutral200};
  border-radius: 10px;
  padding: 14px 16px;
  display: flex;
  align-items: center;
  gap: 12px;
`;

const StatusDot = styled.div`
  width: 12px;
  height: 12px;
  border-radius: 50%;
  flex-shrink: 0;
  background: ${({ $status }) => 
    $status === 'connected' ? '#22c55e' : 
    $status === 'connecting' || $status === 'requesting' ? '#f59e0b' :
    $status === 'denied' ? '#ef4444' : 
    '#94a3b8'};
  
  ${({ $status }) => $status === 'connected' && css`
    animation: ${pulse} 2s ease-in-out infinite;
  `}
`;

const StatusText = styled.div`
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const StatusLabel = styled.span`
  font-size: 14px;
  font-weight: 600;
  color: ${({ $status, theme }) => 
    $status === 'connected' ? theme.colors.success600 : 
    $status === 'connecting' || $status === 'requesting' ? theme.colors.warning600 :
    $status === 'denied' ? theme.colors.danger600 : 
    theme.colors.neutral600};
`;

const StatusSubtext = styled.span`
  font-size: 12px;
  color: ${props => props.theme.colors.neutral500};
`;

const SectionTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: ${props => props.theme.colors.neutral600};
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
`;

const PeerItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: ${props => props.theme.colors.neutral0};
  border-radius: 10px;
  border: 1px solid ${props => props.theme.colors.neutral150};
  transition: all 0.2s ease;
  
  &:hover {
    border-color: ${props => props.theme.colors.primary200};
    box-shadow: 0 2px 8px rgba(124, 58, 237, 0.08);
    transform: translateY(-1px);
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

const PeerAvatar = styled.div`
  width: 36px;
  height: 36px;
  border-radius: 50%;
  background: ${({ $color }) => $color || PEER_COLORS[0]};
  color: white;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
`;

const PeerInfo = styled.div`
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
`;

const PeerName = styled.span`
  font-size: 13px;
  font-weight: 600;
  color: ${props => props.theme.colors.neutral800};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PeerEmail = styled.span`
  font-size: 11px;
  color: ${props => props.theme.colors.neutral500};
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const OnlineBadge = styled.span`
  font-size: 10px;
  font-weight: 600;
  color: #166534;
  background: #dcfce7;
  padding: 4px 8px;
  border-radius: 12px;
  flex-shrink: 0;
`;

const EmptyState = styled.div`
  text-align: center;
  padding: 16px;
  background: ${props => props.theme.colors.neutral100};
  border-radius: 10px;
  border: 1px dashed ${props => props.theme.colors.neutral300};
`;

const EmptyText = styled.span`
  font-size: 13px;
  color: ${props => props.theme.colors.neutral500};
`;

/* ============================================
   HELPER FUNCTIONS
   ============================================ */

const getPeerInitials = (user = {}) => {
  const first = (user.firstname?.[0] || user.email?.[0] || '?').toUpperCase();
  const last = (user.lastname?.[0] || '').toUpperCase();
  return `${first}${last}`.trim();
};

const getPeerName = (user = {}, t) => {
  if (user.firstname) {
    return `${user.firstname} ${user.lastname || ''}`.trim();
  }
  return user.email || t('collab.unknown', 'Unknown');
};

/* ============================================
   MAIN COMPONENT
   ============================================ */

const LiveCollaborationPanel = ({ documentId, model, document }) => {
  const { formatMessage } = useIntl();
  const t = (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values);
  
  const [collabState, setCollabState] = useState({
    status: 'disabled',
    peers: [],
    error: null,
  });

  // Listen for collaboration state updates from Editor
  useEffect(() => {
    const handleCollabUpdate = (event) => {
      if (event.detail) {
        setCollabState(event.detail);
      }
    };

    window.addEventListener('magic-editor-collab-update', handleCollabUpdate);
    
    // Check if there's already a state
    if (window.__MAGIC_EDITOR_COLLAB_STATE__) {
      setCollabState(window.__MAGIC_EDITOR_COLLAB_STATE__);
    }

    return () => {
      window.removeEventListener('magic-editor-collab-update', handleCollabUpdate);
    };
  }, []);

  const { status, peers, error } = collabState;

  const statusLabel = useMemo(() => {
    switch (status) {
      case 'connected': return t('collab.live', 'Live');
      case 'connecting': return t('collab.connecting', 'Connecting...');
      case 'requesting': return t('collab.checkingPermission', 'Checking permission');
      case 'denied': return t('collab.noPermission', 'No permission');
      case 'disconnected': return t('collab.disconnected', 'Disconnected');
      case 'disabled': return t('collab.disabled', 'Disabled');
      default: return t('collab.ready', 'Ready');
    }
  }, [status, t]);

  // Don't render if disabled or idle
  if (status === 'disabled' || status === 'idle') {
    return null;
  }

  const isConnected = status === 'connected';

  // Return object format required by addEditViewSidePanel
  return {
    title: t('collab.title', 'Live Collaboration'),
    content: (
      <Flex direction="column" gap={4} alignItems="stretch" style={{ width: '100%' }}>
        {/* Status Card */}
        <StatusCard $status={status}>
          <StatusDot $status={status} />
          <StatusText>
            <StatusLabel $status={status}>{statusLabel}</StatusLabel>
            <StatusSubtext>
              {isConnected ? t('collab.realtimeActive', 'Realtime sync active') : error || t('collab.connectionEstablishing', 'Connection is being established...')}
            </StatusSubtext>
          </StatusText>
        </StatusCard>

        {/* Peers List */}
        {isConnected && peers.length > 0 && (
          <div>
            <SectionTitle>{t('collab.activePeers', 'Active Collaborators ({count})', { count: peers.length })}</SectionTitle>
            <Flex direction="column" gap={2} alignItems="stretch">
              {peers.map((peer, idx) => (
                <PeerItem key={peer.id}>
                  <PeerAvatar $color={PEER_COLORS[idx % PEER_COLORS.length]}>
                    {getPeerInitials(peer)}
                  </PeerAvatar>
                  <PeerInfo>
                    <PeerName>{getPeerName(peer, t)}</PeerName>
                    {peer.email && peer.firstname && (
                      <PeerEmail>{peer.email}</PeerEmail>
                    )}
                  </PeerInfo>
                  <OnlineBadge>{t('collab.online', 'Online')}</OnlineBadge>
                </PeerItem>
              ))}
            </Flex>
          </div>
        )}

        {/* Empty State */}
        {isConnected && peers.length === 0 && (
          <EmptyState>
            <EmptyText>{t('collab.workingAlone', 'You are working alone')}</EmptyText>
          </EmptyState>
        )}
      </Flex>
    ),
  };
};

export default LiveCollaborationPanel;

