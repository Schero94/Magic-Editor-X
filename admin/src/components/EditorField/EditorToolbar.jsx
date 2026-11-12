import {
  Avatar,
  Badge,
  Box,
  Button,
  Flex,
  IconButton,
  Tooltip,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { ArrowClockwise, ArrowsCounterClockwise, Collapse, Expand } from '@strapi/icons';
import styled from 'styled-components';
import { FieldToolsMenu } from './FieldToolsMenu';
import { exitTools } from '../../editor/field-tools.mjs';
import { peerFamily } from './RemoteCarets';

/**
 * Toolbar above the editor (2.4 layout). It stays short: undo and redo (not
 * for read-only fields), the "More tools" menu with every secondary tool from
 * the field tool registry (`editor/field-tools.mjs`), full screen, a visible
 * way back while a view-changing tool is on (preview, focus mode), the live
 * collaboration status with the people in the room, and counts (blocks,
 * words, characters, reading time) with the limits of the field preset.
 */

/** Words per minute used for the reading time. */
const WORDS_PER_MINUTE = 200;

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
  identityHint = null,
  collaboration,
  stats,
  limits = {},
  tools = [],
  moreButtonRef,
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
      <Flex gap={1} wrap="wrap" alignItems="center">
        {readOnly ? null : (
          <>
            <IconButton
              label={t('editor.toolbar.undo', 'Undo')}
              variant="ghost"
              onClick={onUndo}
              disabled={!ready || !canUndo}
            >
              <ArrowsCounterClockwise />
            </IconButton>
            <IconButton
              label={t('editor.toolbar.redo', 'Redo')}
              variant="ghost"
              onClick={onRedo}
              disabled={!ready || !canRedo}
            >
              <ArrowClockwise />
            </IconButton>
          </>
        )}
        <FieldToolsMenu ref={moreButtonRef} t={t} tools={tools} disabled={!ready} />
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
        {exitTools(tools).map((entry) => (
          <Button
            key={entry.id}
            size="S"
            variant="secondary"
            onClick={entry.onSelect}
            data-testid={`mex-tool-exit-${entry.id}`}
          >
            {entry.exitLabel}
          </Button>
        ))}
        {identityHint ? (
          <Flex alignItems="center" paddingLeft={1} paddingRight={1} minHeight="3.2rem">
            <Typography variant="pi" textColor="neutral600" data-testid="mex-identity-hint">
              {identityHint}
            </Typography>
          </Flex>
        ) : null}
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
        <Box data-testid="mex-stats">
          <Typography
            variant="pi"
            textColor={
              (limits.maxBlocks && stats.blocks > limits.maxBlocks) ||
              (limits.maxCharacters && stats.characters > limits.maxCharacters)
                ? 'danger600'
                : 'neutral600'
            }
          >
            {limits.maxBlocks
              ? t('editor.stats.blocksLimit', '{blocks} / {max} blocks', {
                  blocks: stats.blocks,
                  max: limits.maxBlocks,
                })
              : t('editor.stats.blocks', '{blocks, plural, one {# block} other {# blocks}}', {
                  blocks: stats.blocks,
                })}
            {' · '}
            {t('editor.stats.words', '{words, plural, one {# word} other {# words}}', { words: stats.words })}
            {' · '}
            {limits.maxCharacters
              ? t('editor.stats.charactersLimit', '{characters} / {max} characters', {
                  characters: stats.characters,
                  max: limits.maxCharacters,
                })
              : t('editor.stats.characters', '{characters, plural, one {# character} other {# characters}}', {
                  characters: stats.characters,
                })}
            {' · '}
            {t('editor.stats.reading', '{minutes, plural, one {# min read} other {# min read}}', {
              minutes: stats.words ? Math.max(1, Math.ceil(stats.words / WORDS_PER_MINUTE)) : 0,
            })}
          </Typography>
        </Box>
      </Flex>
    </Bar>
  );
};
