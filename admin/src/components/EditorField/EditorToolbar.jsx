import {
  Avatar,
  Badge,
  Box,
  Flex,
  IconButton,
  Tooltip,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import {
  ArrowClockwise,
  ArrowsCounterClockwise,
  ClockCounterClockwise,
  Collapse,
  Expand,
} from '@strapi/icons';
import styled from 'styled-components';
import { peerFamily } from './RemoteCarets';

/**
 * Toolbar above the editor: undo/redo, version history, fullscreen, live
 * collaboration status with the people in the room, and word/block counts.
 */

const Bar = styled(Flex)`
  min-width: 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  flex-wrap: wrap;
`;

const Peer = styled(Avatar.Item)`
  outline: 2px solid ${({ theme, $family }) => theme.colors[`${$family}600`] || theme.colors.neutral600};
  outline-offset: 1px;
  opacity: ${({ $idle }) => ($idle ? 0.55 : 1)};
`;

const STATUS = {
  connecting: {
    key: 'editor.collab.status.connecting',
    text: 'Connecting',
    bg: 'neutral150',
    fg: 'neutral800',
  },
  syncing: { key: 'editor.collab.status.syncing', text: 'Syncing', bg: 'neutral150', fg: 'neutral800' },
  live: { key: 'editor.collab.status.live', text: 'Live', bg: 'success100', fg: 'success700' },
  reconnecting: {
    key: 'editor.collab.status.reconnecting',
    text: 'Reconnecting',
    bg: 'warning100',
    fg: 'warning700',
  },
  offline: { key: 'editor.collab.status.offline', text: 'Offline', bg: 'danger100', fg: 'danger700' },
  denied: {
    key: 'editor.collab.status.denied',
    text: 'Live editing unavailable',
    bg: 'neutral150',
    fg: 'neutral800',
  },
  error: {
    key: 'editor.collab.status.error',
    text: 'Live editing unavailable',
    bg: 'neutral150',
    fg: 'neutral800',
  },
};

/**
 * Initials for an avatar.
 * @param {string} name - Display name.
 * @returns {string} One or two letters.
 */
const initials = (name) =>
  String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toUpperCase())
    .join('');

/**
 * @param {object} props - Props.
 * @returns {JSX.Element} Toolbar.
 */
export const EditorToolbar = ({
  t,
  ready,
  readOnly,
  fullscreen,
  onToggleFullscreen,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  historyAvailable,
  onOpenHistory,
  historyButtonRef,
  collaboration,
  stats,
}) => {
  const status = STATUS[collaboration.status];
  const peers = collaboration.peers || [];
  const upgrade = collaboration.status === 'error' && collaboration.error === 'UPGRADE_REQUIRED';
  const peerLabel = (peer) => {
    const base = peer.canEdit
      ? peer.name
      : t('editor.collab.viewer', '{name} (viewing)', { name: peer.name });
    return peer.idle ? t('editor.collab.away', '{name} (away)', { name: base }) : base;
  };
  return (
    <Bar
      gap={2}
      paddingTop={2}
      paddingBottom={2}
      paddingLeft={3}
      paddingRight={3}
      justifyContent="space-between"
    >
      <Flex gap={1} wrap="wrap">
        <IconButton
          label={t('editor.toolbar.undo', 'Undo')}
          variant="ghost"
          onClick={onUndo}
          disabled={!ready || readOnly || !canUndo}
        >
          <ArrowsCounterClockwise />
        </IconButton>
        <IconButton
          label={t('editor.toolbar.redo', 'Redo')}
          variant="ghost"
          onClick={onRedo}
          disabled={!ready || readOnly || !canRedo}
        >
          <ArrowClockwise />
        </IconButton>
        {historyAvailable ? (
          <IconButton
            ref={historyButtonRef}
            label={t('editor.toolbar.history', 'Version history')}
            variant="ghost"
            onClick={onOpenHistory}
            disabled={!ready}
          >
            <ClockCounterClockwise />
          </IconButton>
        ) : null}
        <IconButton
          label={
            fullscreen
              ? t('editor.toolbar.exitFullscreen', 'Exit full screen')
              : t('editor.toolbar.fullscreen', 'Full screen')
          }
          variant="ghost"
          onClick={onToggleFullscreen}
          aria-pressed={fullscreen}
        >
          {fullscreen ? <Collapse /> : <Expand />}
        </IconButton>
      </Flex>
      <Flex gap={3} wrap="wrap" justifyContent="flex-end" minWidth={0}>
        {status ? (
          <Flex gap={2} wrap="wrap">
            {peers.length > 0 ? (
              <Avatar.Group>
                {peers.slice(0, 4).map((peer) => (
                  <Tooltip key={peer.id} label={peerLabel(peer)}>
                    <Peer
                      $family={peerFamily(peer.color)}
                      $idle={peer.idle}
                      fallback={initials(peer.name)}
                      aria-label={peerLabel(peer)}
                    />
                  </Tooltip>
                ))}
              </Avatar.Group>
            ) : null}
            <Box aria-live="polite" data-testid="mex-collab-status" data-status={collaboration.status}>
              <Badge backgroundColor={status.bg} textColor={status.fg}>
                {t(status.key, status.text)}
              </Badge>
            </Box>
            {peers.length > 4 ? (
              <Typography variant="pi" textColor="neutral600">
                {t('editor.collab.more', '+{count}', { count: peers.length - 4 })}
              </Typography>
            ) : null}
            {collaboration.status === 'live' && !collaboration.canEdit ? (
              <Badge backgroundColor="neutral150" textColor="neutral800">
                {t('editor.collab.readOnly', 'View only')}
              </Badge>
            ) : null}
            {collaboration.pending && collaboration.status !== 'live' ? (
              <Typography variant="pi" textColor="neutral600">
                {t('editor.collab.unsent', 'Changes are kept and sent when the connection is back')}
              </Typography>
            ) : null}
            {upgrade ? (
              <Typography variant="pi" textColor="neutral600">
                {t('editor.collab.upgrade', 'Reload the page to keep editing live')}
              </Typography>
            ) : null}
            <VisuallyHidden>
              {peers.length > 0 ? `${peers.map(peerLabel).join(', ')}. ` : ''}
              {t(
                'editor.collab.peers',
                '{count, plural, =0 {Nobody else is editing} one {# other person is editing} other {# other people are editing}}',
                {
                  count: peers.length,
                }
              )}
            </VisuallyHidden>
          </Flex>
        ) : null}
        <Box>
          <Typography variant="pi" textColor="neutral600">
            {t(
              'editor.stats',
              '{blocks, plural, one {# block} other {# blocks}} · {words, plural, one {# word} other {# words}}',
              {
                blocks: stats.blocks,
                words: stats.words,
              }
            )}
          </Typography>
        </Box>
      </Flex>
    </Bar>
  );
};
