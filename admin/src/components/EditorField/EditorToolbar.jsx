import {
  Avatar,
  Badge,
  Box,
  Flex,
  IconButton,
  MenuItem,
  SimpleMenu,
  Tooltip,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import {
  ArrowClockwise,
  ArrowsCounterClockwise,
  ClockCounterClockwise,
  Collapse,
  Command,
  Discuss,
  Expand,
  Eye,
  EyeStriked,
  Feather,
  More,
  SealCheck,
  Search,
  Sparkle,
} from '@strapi/icons';
import styled from 'styled-components';
import { peerFamily } from './RemoteCarets';

/**
 * Toolbar above the editor: undo/redo, version history, find and replace,
 * quality checks, block comments, focus mode, keyboard shortcuts, fullscreen, live
 * collaboration status with the people in the room, and counts (blocks,
 * words, characters, reading time) with the limits of the field preset.
 */

/** Words per minute used for the reading time. */
const WORDS_PER_MINUTE = 200;

const CountBadge = styled.span`
  display: inline-flex;
  align-items: center;
  gap: ${({ theme }) => theme.spaces[1]};
`;

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
  limits = {},
  findOpen = false,
  onToggleFind,
  qualityOpen = false,
  onToggleQuality,
  qualityCount = { errors: 0, total: 0 },
  qualityButtonRef,
  findButtonRef,
  focusMode = false,
  onToggleFocus,
  onOpenShortcuts,
  commentsAvailable = false,
  commentsOpen = false,
  onToggleComments,
  commentsCount = 0,
  commentsButtonRef,
  grammarOpen = false,
  onToggleGrammar,
  grammarButtonRef,
  onOpenFieldAi,
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
        {onToggleFind ? (
          <IconButton
            ref={findButtonRef}
            label={t('editor.toolbar.find', 'Find and replace')}
            variant="ghost"
            onClick={onToggleFind}
            aria-pressed={findOpen}
            disabled={!ready}
          >
            <Search />
          </IconButton>
        ) : null}
        {onToggleQuality ? (
          <CountBadge>
            <IconButton
              ref={qualityButtonRef}
              label={
                qualityCount.total
                  ? t(
                      'editor.toolbar.qualityCount',
                      'Quality checks ({count, plural, one {# problem} other {# problems}})',
                      {
                        count: qualityCount.total,
                      }
                    )
                  : t('editor.toolbar.quality', 'Quality checks')
              }
              variant="ghost"
              onClick={onToggleQuality}
              aria-pressed={qualityOpen}
              disabled={!ready}
            >
              <SealCheck />
            </IconButton>
            {qualityCount.total ? (
              <Badge
                size="S"
                aria-hidden="true"
                backgroundColor={qualityCount.errors ? 'danger100' : 'warning100'}
                textColor={qualityCount.errors ? 'danger700' : 'neutral800'}
              >
                {qualityCount.total > 99 ? '99+' : qualityCount.total}
              </Badge>
            ) : null}
          </CountBadge>
        ) : null}
        {commentsAvailable && onToggleComments ? (
          <CountBadge>
            <IconButton
              ref={commentsButtonRef}
              label={
                commentsCount
                  ? t(
                      'editor.toolbar.commentsCount',
                      'Comments ({count, plural, one {# open thread} other {# open threads}})',
                      { count: commentsCount }
                    )
                  : t('editor.toolbar.comments', 'Comments')
              }
              variant="ghost"
              onClick={onToggleComments}
              aria-pressed={commentsOpen}
              disabled={!ready}
              data-testid="mex-comments-toggle"
            >
              <Discuss />
            </IconButton>
            {commentsCount ? (
              <Badge size="S" aria-hidden="true" backgroundColor="primary100" textColor="primary700">
                {commentsCount > 99 ? '99+' : commentsCount}
              </Badge>
            ) : null}
          </CountBadge>
        ) : null}
        {onToggleGrammar ? (
          <IconButton
            ref={grammarButtonRef}
            label={t('editor.toolbar.grammar', 'Check grammar')}
            variant="ghost"
            onClick={onToggleGrammar}
            aria-pressed={grammarOpen}
            disabled={!ready}
            data-testid="mex-grammar-toggle"
          >
            <Feather />
          </IconButton>
        ) : null}
        <SimpleMenu
          ref={moreButtonRef}
          tag={IconButton}
          icon={<More />}
          label={t('editor.toolbar.more', 'More editor actions')}
          variant="ghost"
          popoverPlacement="bottom-start"
        >
          {onToggleFocus ? (
            <MenuItem onSelect={onToggleFocus} startIcon={focusMode ? <EyeStriked /> : <Eye />}>
              {focusMode
                ? t('editor.toolbar.focusOff', 'Leave focus mode')
                : t('editor.toolbar.focusOn', 'Focus mode')}
            </MenuItem>
          ) : null}
          {onOpenFieldAi ? (
            <MenuItem onSelect={onOpenFieldAi} startIcon={<Sparkle />}>
              {t('editor.toolbar.fieldAi', 'AI for the whole field')}
            </MenuItem>
          ) : null}
          {onOpenShortcuts ? (
            <MenuItem onSelect={onOpenShortcuts} startIcon={<Command />}>
              {t('editor.toolbar.shortcuts', 'Keyboard shortcuts')}
            </MenuItem>
          ) : null}
        </SimpleMenu>
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
