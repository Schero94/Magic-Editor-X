/**
 * Live Collaboration Panel - Strapi Edit View Side Panel
 * Uses the same API as Session Manager to appear below PREVIEW
 */
import { useState, useEffect, useMemo } from 'react';
import { Box, Typography, Flex, Divider } from '@strapi/design-system';
import styled, { css, keyframes } from 'styled-components';

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
  background: white;
  border: 1px solid ${({ $status }) => 
    $status === 'connected' ? 'rgba(34, 197, 94, 0.3)' : 
    $status === 'denied' ? 'rgba(239, 68, 68, 0.3)' : 
    '#eaeaea'};
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
  color: ${({ $status }) => 
    $status === 'connected' ? '#166534' : 
    $status === 'connecting' || $status === 'requesting' ? '#92400e' :
    $status === 'denied' ? '#991b1b' : 
    '#475569'};
`;

const StatusSubtext = styled.span`
  font-size: 12px;
  color: #94a3b8;
`;

const SectionTitle = styled.div`
  font-size: 11px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 10px;
`;

const PeerItem = styled.div`
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 14px;
  background: white;
  border-radius: 10px;
  border: 1px solid #f1f5f9;
  transition: all 0.2s ease;
  
  &:hover {
    border-color: rgba(124, 58, 237, 0.3);
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
  color: #334155;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
`;

const PeerEmail = styled.span`
  font-size: 11px;
  color: #94a3b8;
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
  background: #f8fafc;
  border-radius: 10px;
  border: 1px dashed #e2e8f0;
`;

const EmptyText = styled.span`
  font-size: 13px;
  color: #94a3b8;
`;

/* ============================================
   HELPER FUNCTIONS
   ============================================ */

const getPeerInitials = (user = {}) => {
  const first = (user.firstname?.[0] || user.email?.[0] || '?').toUpperCase();
  const last = (user.lastname?.[0] || '').toUpperCase();
  return `${first}${last}`.trim();
};

const getPeerName = (user = {}) => {
  if (user.firstname) {
    return `${user.firstname} ${user.lastname || ''}`.trim();
  }
  return user.email || 'Unbekannt';
};

/* ============================================
   MAIN COMPONENT
   ============================================ */

const LiveCollaborationPanel = ({ documentId, model, document }) => {
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
      case 'connected': return 'Live';
      case 'connecting': return 'Verbinde...';
      case 'requesting': return 'Prüfe Berechtigung';
      case 'denied': return 'Keine Berechtigung';
      case 'disconnected': return 'Getrennt';
      case 'disabled': return 'Deaktiviert';
      default: return 'Bereit';
    }
  }, [status]);

  // Don't render if disabled or idle
  if (status === 'disabled' || status === 'idle') {
    return null;
  }

  const isConnected = status === 'connected';

  // Return object format required by addEditViewSidePanel
  return {
    title: 'Live Collaboration',
    content: (
      <Flex direction="column" gap={4} alignItems="stretch" style={{ width: '100%' }}>
        {/* Status Card */}
        <StatusCard $status={status}>
          <StatusDot $status={status} />
          <StatusText>
            <StatusLabel $status={status}>{statusLabel}</StatusLabel>
            <StatusSubtext>
              {isConnected ? 'Echtzeit-Sync aktiv' : error || 'Verbindung wird hergestellt...'}
            </StatusSubtext>
          </StatusText>
        </StatusCard>

        {/* Peers List */}
        {isConnected && peers.length > 0 && (
          <div>
            <SectionTitle>Aktive Mitarbeiter ({peers.length})</SectionTitle>
            <Flex direction="column" gap={2} alignItems="stretch">
              {peers.map((peer, idx) => (
                <PeerItem key={peer.id}>
                  <PeerAvatar $color={PEER_COLORS[idx % PEER_COLORS.length]}>
                    {getPeerInitials(peer)}
                  </PeerAvatar>
                  <PeerInfo>
                    <PeerName>{getPeerName(peer)}</PeerName>
                    {peer.email && peer.firstname && (
                      <PeerEmail>{peer.email}</PeerEmail>
                    )}
                  </PeerInfo>
                  <OnlineBadge>Online</OnlineBadge>
                </PeerItem>
              ))}
            </Flex>
          </div>
        )}

        {/* Empty State */}
        {isConnected && peers.length === 0 && (
          <EmptyState>
            <EmptyText>Du arbeitest alleine</EmptyText>
          </EmptyState>
        )}
      </Flex>
    ),
  };
};

export default LiveCollaborationPanel;

