import {
  startTransition,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import { useIntl } from 'react-intl';
import { useHref, useLocation, useNavigate } from 'react-router-dom';
import EditorJS from '@editorjs/editorjs';
import {
  Box,
  Button,
  Field,
  Flex,
  Loader,
  TextButton,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import {
  ClockCounterClockwise,
  Command,
  Discuss,
  Eye,
  Feather,
  Files,
  Layout,
  Monitor,
  SealCheck,
  Search,
  Sparkle,
} from '@strapi/icons';
import { useAuth, useNotification, useStrapiApp } from '@strapi/strapi/admin';
import { useFetchClient } from '../../utils/fetch-client';
import { Lightbulb, ListSearch, Pencil } from '@strapi/icons';
import styled, { createGlobalStyle, useTheme } from 'styled-components';
import { buildTools, disposeTools, editorI18n, createUndoManager, createDragDrop } from '../../editor/tools';
import { editorStyles } from '../../editor/tools/styles';
import { isDarkTheme, paletteEditorCss } from '../../editor/palette-style.mjs';
import { normalizePalette } from '../../../../shared/inline-format.mjs';
import { abbreviationAnnotation, annotationsFromSummaries } from '../../../../shared/blocks/annotations.mjs';
import { createCspGuard } from '../../editor/tools/csp-guard';
import { prepareEditorValue, prepareRemoteData, sanitizeInline } from '../../editor/sanitize';
import { roomDiffersFromStored, roomWasReset } from '../../editor/room-state.mjs';
import { createSubmitGuard } from '../../editor/submit-guard.mjs';
import { applyToEditor, blockKey, rememberBlocks } from '../../editor/apply-remote';
import { holdSelection } from '../../editor/selection-keeper.mjs';
import {
  componentRoomView,
  markComponentsPushed,
  reportUnpushedComponents,
} from '../../editor/tools/component';
import { computeStats } from '../../../../shared/editor-data.mjs';
import { stableStringify, stableStringifyBlocks } from '../../../../shared/ydoc.mjs';
import { useEditorConfig } from '../../hooks/useEditorConfig';
import { getTranslation } from '../../utils/getTranslation';
import { API, readApiError } from '../../utils/api';
import { useFieldTarget } from './useFieldTarget';
import { useSavedValues } from './useSavedValues';
import { useCollaboration } from './useCollaboration';
import { EditorToolbar } from './EditorToolbar';
import { HistoryModal } from './HistoryModal';
import { AiDialog } from './AiDialog';
import { RemoteCarets, offsetOf } from './RemoteCarets';
import { usePresenceAnnouncements } from './usePresenceAnnouncements';
import { QualityPanel } from './QualityPanel';
import { useQualityIssues } from './useQualityIssues';
import { useIdleValue } from './useIdleValue';
import { useVisualViewport } from './useVisualViewport';
import { touchTargets } from '../ui/touch';
import { fixedBlockData } from './quality-fixes.mjs';
import { normalizeLinkText } from '../../../../shared/quality.mjs';
import { FindReplacePanel } from './FindReplacePanel';
import { ShortcutsDialog } from './ShortcutsDialog';
import { BlockSelectionBar } from './BlockSelectionBar';
import { useComments } from './useComments';
import { CommentsPanel } from './CommentsPanel';
import { CommentMarkers } from './CommentMarkers';
import { useCommentAnchors } from './useCommentAnchors';
import { SelectionCommentButton } from './SelectionCommentButton';
import { anchorFromSelection } from '../../editor/comment-anchor-dom';
import { blockExcerpt, openThreadsByBlock } from '../../../../shared/comments.mjs';
import { FieldPreview } from './FieldPreview';
import { useSuggestions } from './useSuggestions';
import { SuggestEditor } from './SuggestEditor';
import { SuggestionsPanel } from './SuggestionsPanel';
import { SuggestionMarkers } from './SuggestionMarkers';
import {
  applySuggestions,
  openSuggestionsByBlock,
  pendingInsertsOf,
} from '../../../../shared/suggestions.mjs';
import { TemplateDialog } from './TemplateDialog';
import { SaveTemplateDialog } from './SaveTemplateDialog';
import {
  filterSyncedForField,
  insertBlocksAt,
  isEmptyDocument,
  newBlockId,
  prepareInsertion,
} from '../../../../shared/templates.mjs';
import { replaceBlocks, sourceBlocksOf, syncedRefOf, syncedRefsOf } from '../../../../shared/synced.mjs';
import { loadSynced, primeSynced, useSyncedSources } from '../../editor/synced-store';
import { SyncedBlockView } from './SyncedBlockView';
import { createPasteHandler } from '../../editor/paste';
import { writeBlocksToClipboard } from '../../editor/block-clipboard';
import { ReuseDialog } from './ReuseDialog';
import { Download, Upload } from '@strapi/icons';
import { ImportDialog } from './ImportDialog';
import { ExportDialog } from './ExportDialog';
import { planReuseInsertion, spliceReuse } from '../../../../shared/reuse.mjs';
import { createMarkdownShortcuts } from '../../editor/markdown-shortcuts';
import { MentionTool, createMentionKeys } from '../../editor/tools/mention';
import { createMentionTrigger } from '../../editor/mention-trigger';
import { createInlineMathKeys } from '../../editor/tools/inline-math';
import {
  FOOTNOTE_SELECTOR,
  createFootnoteKeys,
  notifyFootnoteInput,
  releaseFootnote,
} from '../../editor/tools/footnote';
import { FootnoteDialog } from './FootnoteDialog';
import { FootnotesPanel } from './FootnotesPanel';
import { restoreBlockInEditor } from '../../editor/restore-block.mjs';
import { OPEN_FIELD_PANEL_EVENT, matchesFieldRequest } from '../../editor/entry-panel-events.mjs';
import {
  parseLocateMessage,
  parseLocateQuery,
  LOCATED_MESSAGE_TYPE,
} from '../../../../shared/preview-locate.mjs';
import { isEmbeddedFrameWindow } from '../../editor/frame-source.mjs';
import { installEditorKeyGuard } from '../../editor/focus-guard.mjs';
import { restrictView } from '../../../../shared/collab-replica.mjs';
import { markInputReady, trackUserInput } from '../../editor/input-tracking.mjs';
import { createStyleOwners } from '../../editor/style-owners.mjs';
import { highlightMatch, clearHighlight } from '../../editor/find-highlight';
import { createAltTextSuggester } from '../../editor/ai-alt-text';
import { insertSuggestion } from '../../editor/ai-selection';
import { GrammarPanel } from './GrammarPanel';
import { ComponentBlockView } from './ComponentBlockView';
// 2.12: "Changes since last publish" and "Edit in Media Library".
import { usePublishedChanges } from './usePublishedChanges';
import { PublishedChangesBar } from './PublishedChangesBar';
import { PublishedChangeMarks } from './PublishedChangeMarks';
import { MediaEditControl } from './MediaEditControl';
import { canEditInMediaLibrary } from '../../../../shared/media-library.mjs';
import { setActiveComponents } from '../../../../shared/components.mjs';
import { FieldAiDialog } from './FieldAiDialog';
import { BlockAiDialog } from './BlockAiDialog';
import { useAiReview } from './useAiReview';
import { blockIdsOfRange } from '../../editor/ai-menu.mjs';
import { readRecentInstructions, saveRecentInstruction } from '../../editor/ai-recent';
import { MAX_AI_REVIEW_SUGGESTIONS } from '../../../../shared/ai-actions.mjs';
// 2.5: dropped files (Media Library drop zone) and signed URLs of private upload providers.
import { MediaDropArea } from './MediaDropArea';
import { droppedBlock, dropPosition, dropTypesFor, imageBlockData } from '../../editor/drop-insert.mjs';
import { createMediaSigner, createSignedMediaRefresher } from '../../editor/signed-media';
import { applySegments } from '../../../../shared/ai-fields.mjs';
import {
  isPositionalFieldPath,
  isValidFieldKey,
  createFieldKey,
  identityTarget,
} from '../../editor/field-path.mjs';
import { escapeHtml } from '../../../../shared/render/inline.mjs';
// 2.5: local draft buffer (protect unsaved work) and lazy start of fields (performance).
import { useDraftBuffer } from './useDraftBuffer';
import { DraftNotice } from './DraftNotice';
import { RoomNotice, RoomResetNotice } from './RoomNotice';
import {
  focusTabStop,
  insertedBlockControl,
  isTextStop,
  nextTabStop,
  skippedControl,
} from '../../editor/block-tab-stops.mjs';
import {
  decorateDivButtons,
  decorateToolbar,
  inlineToolbarItems,
  labelInlineToolbar,
  toolTitles,
} from '../../editor/toolbar-a11y.mjs';
import { SessionBanner } from './SessionBanner';
import { useLazyActivation } from './useLazyActivation';
import { LazyPlaceholder } from './LazyPlaceholder';
import { savedValueOf } from '../../editor/drafts-logic.mjs';
import { lazyMarginOf } from '../../editor/lazy-init.mjs';
import { saveDelay } from '../../editor/save-timing.mjs';
import { markFootnoteBlocks } from '../../editor/footnote-blocks.mjs';
import {
  resolveFieldPreset,
  enabledAnnotations,
  checkPreset,
  fixPresetViolations,
  isBlockAllowed,
  allowedInlineTags,
} from '../../../../shared/presets.mjs';

/**
 * Magic Editor X field input for the Content Manager.
 *
 * Holds one Editor.js instance. Local edits are saved (debounced) into the
 * Content Manager form as an Editor.js object and, during live
 * collaboration, into the shared Yjs document. Remote changes, history
 * restores and form resets are applied with the fewest block operations.
 */

const SAVE_DEBOUNCE_MS = 150;

/** 2.5: a lazily started editor renders out of view until ready; its static placeholder keeps the place. */
const WAITING_HOLDER_STYLE = {
  position: 'absolute',
  visibility: 'hidden',
  insetInline: 0,
  top: 0,
  pointerEvents: 'none',
};

const EditorStyles = createGlobalStyle`${editorStyles}`;
// 2.5: the configured colour tokens in the editor and the preview (light or dark values by admin theme).
const PaletteStyles = createGlobalStyle`${({ $palette, theme }) => paletteEditorCss($palette, isDarkTheme(theme))}`;
const styleOwners = createStyleOwners();

/**
 * Renders the global editor styles once per page: only the first mounted
 * field owns them (see editor/style-owners.mjs). The owner is decided in a
 * layout effect, so the styles are in place before the browser paints.
 * @returns {JSX.Element|null} Styles of the owning field.
 */
const SharedEditorStyles = ({ palette = null }) => {
  const id = useId();
  const [owner, setOwner] = useState(false);
  useLayoutEffect(() => {
    const update = () => setOwner(styleOwners.owner() === id);
    const unsubscribe = styleOwners.subscribe(update);
    styleOwners.add(id);
    update();
    return () => {
      unsubscribe();
      styleOwners.remove(id);
    };
  }, [id]);
  if (!owner) return null;
  return (
    <>
      <EditorStyles />
      {palette ? <PaletteStyles $palette={palette} /> : null}
    </>
  );
};

/** Locales written right to left (language subtag). */
const RTL_LANGUAGES = new Set([
  'ar',
  'arc',
  'dv',
  'fa',
  'ha',
  'he',
  'khw',
  'ks',
  'ku',
  'ps',
  'sd',
  'ur',
  'yi',
]);

/**
 * Text direction of a content locale.
 * @param {string|null} locale - Locale code.
 * @returns {'rtl'|'ltr'} Direction.
 */
const directionOf = (locale) =>
  typeof locale === 'string' && RTL_LANGUAGES.has(locale.split('-')[0].toLowerCase()) ? 'rtl' : 'ltr';

/** Tool names whose shortcuts the help dialog lists, with their label keys. */
const SHORTCUT_LABELS = {
  header: ['tools.names.heading', 'Heading'],
  list: ['tools.names.unorderedList', 'Bulleted list'],
  checklist: ['tools.names.checklist', 'Checklist'],
  quote: ['tools.names.quote', 'Quote'],
  warning: ['tools.names.warning', 'Warning'],
  alert: ['tools.names.alert', 'Alert'],
  code: ['tools.names.code', 'Code'],
  delimiter: ['tools.names.delimiter', 'Delimiter'],
  table: ['tools.names.table', 'Table'],
  marker: ['tools.names.marker', 'Marker'],
  underline: ['tools.names.underline', 'Underline'],
  strikethrough: ['tools.names.strikethrough', 'Strikethrough'],
  inlineCode: ['tools.names.inlineCode', 'Inline code'],
  hyperlink: ['tools.names.link', 'Link'],
  mention: ['tools.names.mention', 'Mention'],
  aiAssistant: ['tools.names.ai', 'AI assistant'],
  // 2.5 (only when the field turns them on)
  superscript$mex: ['tools.names.superscript', 'Superscript'],
  subscript$mex: ['tools.names.subscript', 'Subscript'],
  color$mex: ['tools.names.color', 'Colour'],
  annotation$abbreviation: ['tools.names.abbreviation', 'Abbreviation'],
};

/*
 * 2.12.1: on phones (below the DS small breakpoint) a panel is a bottom sheet over the editor, so
 * the text stays in view while a finding, comment or match is picked. It sits above an on-screen
 * keyboard (--mex-keyboard-inset, useVisualViewport) and takes at most 60% of the visible height.
 * From the small breakpoint up it stays in the field above the text, as before.
 */
const PanelSlot = styled(Box)`
  min-width: 0;
  position: fixed;
  inset-inline: 0;
  bottom: var(--mex-keyboard-inset, 0px);
  z-index: ${({ theme }) => theme.zIndices.overlay};
  max-height: calc(var(--mex-vv-height, 100dvh) * 0.6);
  overflow-y: auto;
  overscroll-behavior: contain;
  background: ${({ theme }) => theme.colors.neutral0};
  border-top: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => `${theme.borderRadius} ${theme.borderRadius} 0 0`};
  box-shadow: ${({ theme }) => theme.shadows.popupShadow};
  padding-bottom: max(${({ theme }) => theme.spaces[2]}, env(safe-area-inset-bottom));
  ${({ theme }) => theme.breakpoints.small} {
    position: static;
    z-index: auto;
    max-height: none;
    overflow-y: visible;
    border-top: 0;
    border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
    border-radius: 0;
    box-shadow: none;
    padding-bottom: ${({ theme }) => theme.spaces[2]};
    ${({ $fullscreen }) => ($fullscreen ? 'max-height: 45vh; overflow-y: auto; flex: 0 0 auto;' : '')}
  }
`;

/** Settings page that explains the CSP sources (registered in admin/src/index.js). */
const SETTINGS_PATH = '/settings/magic-editor-x/configuration';
const TEMPLATES_PATH = '/settings/magic-editor-x/templates';

const Frame = styled(Box)`
  min-width: 0;
  ${touchTargets}
  border: 1px solid ${({ theme, $error }) => ($error ? theme.colors.danger600 : theme.colors.neutral200)};
  border-radius: ${({ theme }) => theme.borderRadius};
  background: ${({ theme }) => theme.colors.neutral0};
  &:focus-within {
    border-color: ${({ theme, $error }) => ($error ? theme.colors.danger600 : theme.colors.primary600)};
    box-shadow: ${({ theme, $error }) => ($error ? theme.colors.danger600 : theme.colors.primary600)} 0 0 0
      2px;
  }
  ${({ $fullscreen, theme }) =>
    $fullscreen
      ? `
    position: fixed;
    inset: 0;
    /* 2.12.1: follows the visual viewport, so an on-screen keyboard never covers the text. */
    top: var(--mex-vv-top, 0px);
    bottom: auto;
    height: var(--mex-vv-height, 100%);
    z-index: ${theme.zIndices.modal};
    border-radius: 0;
    display: flex;
    flex-direction: column;
    overflow: hidden;
  `
      : ''}
`;

const EditorArea = styled.div`
  position: relative;
  min-width: 0;
  /*
   * Editor.js renders the block menu, the toolbox and their nested popovers
   * inside .ce-toolbar, which is its own stacking context (will-change:
   * opacity). Their z-index therefore cannot lift them over positioned
   * content of the fields that follow (the next field's toolbar and text drew
   * over the menu). While a popover or the inline toolbar is open, the whole
   * area is lifted to the DS popover layer.
   */
  &:has(.ce-popover--opened, .ce-inline-toolbar--showed) {
    z-index: ${({ theme }) => theme.zIndices.popover};
  }
  ${({ $fullscreen }) => ($fullscreen ? 'flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0;' : '')}
  /*
   * Visually hidden while the rendered preview is shown. The editor stays laid
   * out: with display: none, Editor.js' mutation observer loops forever when a
   * collaborator's change is applied to the hidden blocks.
   */
  ${({ $concealed }) =>
    $concealed
      ? 'position: absolute; visibility: hidden; height: 0; overflow: hidden; pointer-events: none;'
      : ''}
`;

const Holder = styled.div`
  min-width: 0;
  padding: ${({ theme }) => `${theme.spaces[4]} ${theme.spaces[3]}`};
  ${({ theme }) => theme.breakpoints.medium} {
    padding: ${({ theme }) => theme.spaces[4]};
  }
  min-height: ${({ $minHeight }) => `${$minHeight}px`};
  ${({ $fullscreen }) => ($fullscreen ? 'flex: 1 1 auto; overflow: auto;' : '')}
  /* Room for the block comment and suggestion markers at the inline end (they sit outside the holder). */
  ${({ $gutter, theme }) =>
    $gutter
      ? `&& { padding-inline-end: ${$gutter > 1 ? `calc(${theme.spaces[8]} + ${($gutter - 1) * 3.6}rem)` : theme.spaces[8]}; }`
      : ''}
  ${({ $focus, theme }) =>
    $focus
      ? `
    & .codex-editor { max-width: 72ch; margin-inline: auto; }
    & .ce-block { transition: opacity 120ms ease; }
    &:focus-within .ce-block:not(:focus-within) { opacity: 0.45; }
    @media (prefers-reduced-motion: reduce) { & .ce-block { transition: none; } }
    & .ce-block:focus-within { background: ${theme.colors.neutral0}; }
  `
      : ''}
`;

/**
 * Normalises the minHeight option.
 * @param {unknown} value - Field option.
 * @returns {number} Pixels.
 */
const minHeightOf = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number >= 120 && number <= 2000 ? number : 240;
};

/**
 * Remembers the focused element and the caret (2.7.4), so a dialog can give them back.
 * @param {{ current: object|null }} ref - Holder of `{ element, range }`.
 * @returns {void}
 */
const rememberCaret = (ref) => {
  const selection = window.getSelection();
  ref.current = {
    element: document.activeElement,
    range: selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null,
  };
};

/**
 * Focuses the remembered element and restores the caret, or calls `fallback`.
 * @param {{ current: object|null }} ref - Holder from `rememberCaret`.
 * @param {() => void} fallback - Focus target when nothing usable was remembered.
 * @returns {void}
 */
const restoreCaret = (ref, fallback) => {
  const saved = ref.current;
  ref.current = null;
  const element = saved && saved.element;
  if (!element || element === document.body || !element.isConnected || typeof element.focus !== 'function') {
    fallback();
    return;
  }
  element.focus({ preventScroll: true });
  const selection = window.getSelection();
  if (saved.range && selection && element.contains(saved.range.startContainer)) {
    selection.removeAllRanges();
    selection.addRange(saved.range);
  }
};

/**
 * Comparable form of editor content (blocks only; time changes on every save).
 * @param {object|null} data - Editor data.
 * @returns {string} Fingerprint.
 */
const contentKey = (data) => stableStringifyBlocks(data && Array.isArray(data.blocks) ? data.blocks : []);

/** Tools that work while suggest mode shows its own editor (2.7.8): the others act on the hidden field. */
const SUGGEST_MODE_TOOLS = ['shortcuts'];

/**
 * Puts the caret into a block once a dialog has closed and handed focus back (2.7.8: the Media
 * Library dialog's trigger, the placeholder block, no longer exists, so focus fell to the page).
 * @param {object} editor - Editor.js instance.
 * @param {number} index - Block index.
 * @param {'start'|'end'} position - Caret position.
 * @returns {void}
 */
const caretAfterDialog = (editor, index, position) => {
  window.setTimeout(() => {
    try {
      const count = editor.blocks.getBlocksCount();
      if (!count) return;
      const target = Math.min(Math.max(0, index), count - 1);
      if (editor.caret.setToBlock(target, position)) return;
      // A block without text (an image without caption input): focus its first control.
      const block = editor.blocks.getBlockByIndex(target);
      const holder = block && block.holder;
      const control =
        holder && holder.querySelector('button, input, [contenteditable="true"], [tabindex="0"]');
      if (control) control.focus();
    } catch {
      // The editor was destroyed meanwhile.
    }
  }, 60);
};

/**
 * Resolves in a new task, so long work before and after does not add up to one long task.
 * @returns {Promise<void>} Resolves after the browser had a chance to handle input and paint.
 */
const yieldToBrowser = () => new Promise((resolve) => setTimeout(resolve, 0));

/**
 * Fingerprint of content as the field would render it (normalised and
 * sanitised). Comparing raw editor output with a sanitised form value would
 * re-render blocks that did not change.
 * @param {unknown} value - Field value.
 * @returns {string} Fingerprint.
 */
const renderedKey = (value) => contentKey(prepareEditorValue(value).data);

/**
 * Editor body. `target` identifies the document field (the Content Manager
 * wrapper below reads it from the edit view; the template editor in the
 * settings passes an empty target, which turns collaboration, history,
 * comments and template insertion off).
 * @param {object} props - Custom field props plus `target`.
 * @returns {JSX.Element} Field.
 */
const EditorFieldBody = ({
  target,
  name,
  value,
  onChange,
  attribute,
  label,
  hint,
  required,
  disabled,
  error,
  labelAction,
  savedValues,
}) => {
  const { formatMessage, locale: adminLocale } = useIntl();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const MediaLibraryDialog = useStrapiApp('MagicEditorX', (state) => state.components['media-library']);
  // 2.5: Strapi 5.61+ Media Library drop zone (absent on older hosts and with the legacy Media Library).
  const FileDropZone = useStrapiApp(
    'MagicEditorX',
    (state) => (state.components && state.components['media-library-file-drop-zone']) || null
  );
  const { config, customBlocks, error: configError, loading: configLoading, retry } = useEditorConfig();
  const navigate = useNavigate();
  const settingsHref = useHref(SETTINGS_PATH);
  const templatesHref = useHref(TEMPLATES_PATH);
  // The editor is not rebuilt on a locale switch; the link picker reads the current locale through this ref.
  const contentLocaleRef = useRef(target.locale);
  useEffect(() => {
    contentLocaleRef.current = target.locale;
  }, [target.locale]);

  const t = useCallback(
    (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values),
    [formatMessage]
  );

  // 2.5: keys typed outside the editors (dialogs, popovers, other fields) never reach Editor.js.
  useEffect(() => installEditorKeyGuard(), []);

  const holderRef = useRef(null);
  const editorRef = useRef(null);
  const undoRef = useRef(null);
  const knownRef = useRef(new Map());
  const lastEmittedRef = useRef(null);
  // 2.7.8: what was emitted last (source for the lazy rendered key) and the object handed to the form.
  const lastEmittedSourceRef = useRef(null);
  const lastEmittedValueRef = useRef(undefined);
  const lastEmittedRawRef = useRef(null);
  const applyingRef = useRef(false);
  const saveTimerRef = useRef(null);
  // 2.7.4: the running editor.save() of a scheduled save (the submit guard waits for it).
  const savingRef = useRef(null);
  const collabRef = useRef(null);
  const pendingLocalRef = useRef(false);
  const syncedOnceRef = useRef(false);
  // 2.7.4 (M3): the first room state held unsaved changes; `saved` is the stored value at that time.
  const [roomNotice, setRoomNotice] = useState(null);
  // 2.7.8: after unsaved room changes were discarded ({ kind: 'self'|'remote', previous, focus }).
  const [roomReset, setRoomReset] = useState(null);
  const roomUndoRef = useRef(null);
  const savedValueRef = useRef(undefined);
  // 2.6: the editor shows the room (after its first render), so a found buffer is compared with the room.
  const [roomRendered, setRoomRendered] = useState(false);
  // What the editor shows as far as live collaboration knows: the content it was created with
  // (in the editor's own serialisation once available), then the last room state it rendered.
  // A new collaboration client diffs edits made before its first render against this.
  const viewRef = useRef({ blocks: [] });
  const areaRef = useRef(null);
  const remoteCacheRef = useRef(new WeakMap());
  // True once the user interacted with the editor. Before that, changes Editor.js
  // makes on its own (normalising 1.x content while rendering) only move the
  // baseline and never mark the form as changed.
  const userTouchedRef = useRef(false);
  const [contentVersion, setContentVersion] = useState(0);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState({ blocks: 0, words: 0, characters: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aiRequest, setAiRequest] = useState(null);
  // 2.4: block AI actions for the chosen block ids.
  const [blockAiRequest, setBlockAiRequest] = useState(null);
  const [mediaRequest, setMediaRequest] = useState(null);
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
  const [valueError, setValueError] = useState(null);
  const [currentData, setCurrentData] = useState(null);
  const currentDataRef = useRef(null);
  useEffect(() => {
    currentDataRef.current = currentData;
  }, [currentData]);
  const [findOpen, setFindOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  // 2.7.4 (m4): where the shortcuts dialog returns focus (the caret when opened with Ctrl/Cmd+/).
  const shortcutsReturnRef = useRef(null);
  const [focusMode, setFocusMode] = useState(false);
  const [toolShortcuts, setToolShortcuts] = useState([]);
  const frameRef = useRef(null);
  // 2.5: Editor.js (and the live room, which waits for `ready`) start when the field nears the viewport.
  const lazy = useLazyActivation(frameRef, {
    enabled: Boolean(target.uid) && !(config && config.lazyInit && config.lazyInit.enabled === false),
    marginPx: lazyMarginOf(config && config.lazyInit && config.lazyInit.marginPx),
  });
  const focusOnStartRef = useRef(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  // 2.7.4: the panel last opened from More tools gets focus when it renders (m3).
  const [menuPanel, setMenuPanel] = useState(null);
  const [commentFocusThread, setCommentFocusThread] = useState(null);
  const [currentBlockId, setCurrentBlockId] = useState(null);
  // 2.3: grammar check panel and whole-field AI actions.
  const [grammarOpen, setGrammarOpen] = useState(false);
  const [fieldAiOpen, setFieldAiOpen] = useState(false);
  const moreButtonRef = useRef(null);
  // Secondary tools live in the "More tools" menu (2.4): closing a tool's panel or dialog returns focus there.
  const focusToolsMenu = useCallback(() => {
    if (moreButtonRef.current) moreButtonRef.current.focus();
  }, []);
  // 2.4 block suggestions: suggest mode (a local copy, see SuggestEditor) and the review panel.
  const [suggestSession, setSuggestSession] = useState(null);
  const suggestMode = Boolean(suggestSession);
  const suggestModeRef = useRef(false);
  useEffect(() => {
    suggestModeRef.current = suggestMode;
  }, [suggestMode]);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionFocusBlock, setSuggestionFocusBlock] = useState(null);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);
  // 2.4 field identity: a value inside a repeatable component or dynamic zone carries a `fieldKey`.
  // A keyless value gets one when the user edits it; history, comments and the live room use the key
  // once the Content Manager has loaded it back from the saved entry (shared/field-identity.mjs).
  const positional = isPositionalFieldPath(target.field);
  const valueKey = positional && value && isValidFieldKey(value.fieldKey) ? value.fieldKey : null;
  const [localKey, setLocalKey] = useState(null);
  const fieldKey = valueKey || localKey;
  const fieldKeyRef = useRef(fieldKey);
  useEffect(() => {
    fieldKeyRef.current = fieldKey;
  }, [fieldKey]);
  const savedKey =
    positional && fieldKey && target.savedFieldKeys && target.savedFieldKeys.has(fieldKey) ? fieldKey : null;
  const identityReady = !positional || Boolean(savedKey);
  const fieldTarget = useMemo(
    () =>
      identityTarget(
        { uid: target.uid, documentId: target.documentId, locale: target.locale, field: target.field },
        savedKey
      ),
    [target.uid, target.documentId, target.locale, target.field, savedKey]
  );
  // Templates, block patterns and the in-field preview (2.3).
  const [previewOpen, setPreviewOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveTemplate, setSaveTemplate] = useState(null);
  const previewRef = useRef(null);
  const lastBlockIdRef = useRef(null);
  // 2.5 "Use existing content": insert dialog, block clipboard (paste and the "Copy block" tune).
  const [reuseOpen, setReuseOpen] = useState(false);
  // 2.11 "Import file" and "Export file" (More tools > Import and export).
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importHasContent, setImportHasContent] = useState(false);
  const toolNamesRef = useRef(new Set());
  // 2.7.8: translated tool names for the inline toolbar buttons.
  const toolTitlesRef = useRef({});
  const pasteBlocksRef = useRef(null);
  const copyBlockRef = useRef(null);
  const reuseFocusRef = useRef(null);
  // Synced blocks (2.3): the tool hands its element to the field, which renders the view through a portal.
  const [syncedMounts, setSyncedMounts] = useState(() => new Map());
  const syncedKeyRef = useRef(0);
  const mountSynced = useCallback((element, info) => {
    syncedKeyRef.current += 1;
    const key = syncedKeyRef.current;
    setSyncedMounts((current) => new Map(current).set(key, { element, ...info }));
    return () =>
      setSyncedMounts((current) => {
        if (!current.has(key)) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      });
  }, []);

  // Footnotes (2.4): the note dialog edits the marker the tool or the list points at.
  const [footnoteEdit, setFootnoteEdit] = useState(null);
  const footnoteEditRef = useRef(null);
  const onFootnoteEdit = useCallback((marker, info = {}) => {
    const holder = holderRef.current;
    if (!holder || !marker) return;
    const markers = Array.from(holder.querySelectorAll(FOOTNOTE_SELECTOR));
    const index = markers.indexOf(marker);
    if (index < 0) return;
    setFootnoteEdit({
      id: marker.getAttribute('data-mex-footnote'),
      index,
      isNew: Boolean(info.isNew),
      html: marker.getAttribute('data-mex-note') || '',
      // Focus goes back here when the dialog closes (the list button or the editor).
      returnTo: document.activeElement instanceof HTMLElement ? document.activeElement : null,
    });
  }, []);
  useEffect(() => {
    footnoteEditRef.current = onFootnoteEdit;
  }, [onFootnoteEdit]);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const fieldOptions = (attribute && attribute.options) || null;
  const minHeight = minHeightOf(fieldOptions && fieldOptions.minHeight);
  const placeholder = (fieldOptions && fieldOptions.placeholder) || '';
  const permissions = (config && config.permissions) || {};
  // Field presets (custom field options), enforced again on the server.
  const presetKey = stableStringify(fieldOptions || {});
  // eslint-disable-next-line react-hooks/exhaustive-deps -- recomputed when the options change (presetKey)
  const preset = useMemo(() => resolveFieldPreset(fieldOptions), [presetKey]);
  const presetRef = useRef(preset);
  // 2.5: component blocks. Descriptors of every component (GET /config), the ones this field allows.
  const componentList = config && Array.isArray(config.components) ? config.components : null;
  const componentsByUid = useMemo(
    () => new Map((componentList || []).map((descriptor) => [descriptor.uid, descriptor])),
    [componentList]
  );
  useEffect(() => {
    if (componentList) setActiveComponents(componentList);
  }, [componentList]);
  const allowedComponents = useMemo(
    () =>
      preset.components
        .map((uid) => componentsByUid.get(uid))
        .filter((descriptor) => descriptor && descriptor.supported),
    [preset, componentsByUid]
  );
  const [componentMounts, setComponentMounts] = useState(() => new Map());
  const componentKeyRef = useRef(0);
  const mountComponent = useCallback((element, info) => {
    componentKeyRef.current += 1;
    const key = componentKeyRef.current;
    setComponentMounts((current) => new Map(current).set(key, { element, ...info }));
    return () =>
      setComponentMounts((current) => {
        if (!current.has(key)) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      });
  }, []);
  // 2.12: "Edit in Media Library" in image blocks (the tool hands its element to the field).
  const uploadPath = useHref('/plugins/upload');
  const [mediaMounts, setMediaMounts] = useState(() => new Map());
  const mediaKeyRef = useRef(0);
  const mountMediaEdit = useCallback((element, info) => {
    mediaKeyRef.current += 1;
    const key = mediaKeyRef.current;
    setMediaMounts((current) => new Map(current).set(key, { element, ...info }));
    return () =>
      setMediaMounts((current) => {
        if (!current.has(key)) return current;
        const next = new Map(current);
        next.delete(key);
        return next;
      });
  }, []);
  useEffect(() => {
    presetRef.current = preset;
  }, [preset]);
  // 2.5: colour palette (config), extra inline formatting and annotations this field offers.
  const theme = useTheme();
  const darkRef = useRef(false);
  const palette = useMemo(() => normalizePalette(config && config.palette), [config]);
  const fieldAnnotations = useMemo(
    () =>
      enabledAnnotations(preset, [
        abbreviationAnnotation,
        ...annotationsFromSummaries(config && config.annotations),
      ]),
    [config, preset]
  );
  const inlineExtrasRef = useRef({});
  useEffect(() => {
    darkRef.current = isDarkTheme(theme);
  }, [theme]);
  useEffect(() => {
    inlineExtrasRef.current = {
      inlineExtras: { colors: preset.colors, script: preset.script },
      palette,
      annotations: fieldAnnotations,
      isDark: () => darkRef.current,
    };
  }, [preset, palette, fieldAnnotations]);
  const direction = directionOf(target.locale);
  // 2.3 AI features: owner switches (config), RBAC and the field preset; the server checks all three again.
  const aiAllowed = Boolean(config && config.ai.enabled && permissions.ai && preset.ai);
  const altTextAllowed = Boolean(aiAllowed && config.ai.altText && permissions.mediaLibrary);
  const fieldAiAllowed = Boolean(aiAllowed && config.ai.fieldActions && target.uid);
  const grammarAllowed = Boolean(
    config && config.grammar && config.grammar.enabled && permissions.grammar && preset.grammar && target.uid
  );
  const collaborationTarget =
    config &&
    config.collaboration.enabled &&
    permissions.collaborate &&
    preset.collaboration &&
    target.uid &&
    target.documentId &&
    // Positional paths (`sections.0.body`) name another entry after entries are removed or reordered:
    // the room is keyed by the entry's saved key instead (editor/field-path.mjs).
    identityReady
      ? fieldTarget
      : null;

  /** Emits editor content to the Content Manager form when it changed. */
  const emit = useCallback(
    (data, { baselineOnly = false } = {}) => {
      const meaningful =
        data &&
        Array.isArray(data.blocks) &&
        data.blocks.some(
          (block) =>
            block.type !== 'paragraph' ||
            String((block.data && block.data.text) || '').replace(/<br\s*\/?>|&nbsp;|\s/g, '') !== ''
        );
      const next = meaningful ? data : null;
      const key = contentKey(next);
      if (key === lastEmittedRawRef.current) return;
      lastEmittedRawRef.current = key;
      // 2.7.8: the rendered key (a full sanitise) is computed only when a different value arrives.
      lastEmittedRef.current = null;
      lastEmittedSourceRef.current = next;
      if (baselineOnly) return;
      // Editor.js reuses the tune objects of a block between saves, and the
      // Content Manager form freezes what it stores. Hand over a copy so the
      // editor can keep writing to its own objects.
      const copy = next ? JSON.parse(JSON.stringify(next)) : null;
      // 2.4: an edited value inside a repeatable component or dynamic zone keeps (or gets) its key.
      // An empty field stays null, so required-field checks are unchanged.
      if (copy && isPositionalFieldPath(name)) {
        let key = fieldKeyRef.current;
        if (!key) {
          key = createFieldKey();
          fieldKeyRef.current = key;
          setLocalKey(key);
        }
        copy.fieldKey = key;
      }
      lastEmittedValueRef.current = copy;
      onChangeRef.current(name, copy);
    },
    [name]
  );

  /** Saves the editor into the form now (the body of a scheduled save). */
  // 2.12.1: blocks with footnote markers keep normal rendering (editor/footnote-blocks.mjs).
  const footnoteBlocksRef = useRef(new Set());
  const markFootnotes = useCallback(
    () => markFootnoteBlocks(holderRef.current, footnoteBlocksRef.current, FOOTNOTE_SELECTOR),
    []
  );
  const runSave = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || applyingRef.current) return;
    pendingLocalRef.current = false;
    try {
      const data = await editor.save();
      markFootnotes();
      // 2.7.8: Editor.js' save of a long document is one task; the form update
      // and the field's own state follow in the next task, and the field's
      // panels (stats, comments, quality) re-render as a transition that React
      // can interrupt. Each task stays short while typing in 2,000 blocks.
      await yieldToBrowser();
      if (editorRef.current !== editor) return;
      rememberBlocks(knownRef.current, data);
      startTransition(() => {
        setStats(computeStats(data));
        setCurrentData(data);
        setContentVersion((version) => version + 1);
      });
      if (!userTouchedRef.current) {
        emit(data, { baselineOnly: true });
        return;
      }
      emit(data);
      if (collabRef.current) {
        collabRef.current.pushLocal(data);
        markComponentsPushed(data);
      }
      if (undoRef.current) undoRef.current.record();
    } catch {
      // Editor.js rejects saves while a block is being re-rendered; the next change saves again.
    }
  }, [emit, markFootnotes]);
  /**
   * Saves the editor (debounced) after a local change; `delay` 0 saves at once. 2.12.1: in long
   * documents the delay grows with the block count (editor/save-timing.mjs), so the save runs in
   * the pauses of typing instead of between two key presses.
   */
  const scheduleSave = useCallback(
    (delay = SAVE_DEBOUNCE_MS) => {
      if (applyingRef.current) return;
      pendingLocalRef.current = true;
      clearTimeout(saveTimerRef.current);
      const editor = editorRef.current;
      const blockCount = delay > 0 && editor && editor.blocks ? editor.blocks.getBlocksCount() : 0;
      saveTimerRef.current = setTimeout(
        () => {
          const running = runSave();
          savingRef.current = running;
          running.finally(() => {
            if (savingRef.current === running) savingRef.current = null;
          });
        },
        saveDelay(delay, blockCount)
      );
    },
    [runSave]
  );

  // Editor.js reports changes with a delay. When focus leaves the editor (for
  // example to click Save), store the current content right away so the
  // Content Manager never saves an older value.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !ready) return undefined;
    const onFocusOut = (event) => {
      if (!event.relatedTarget || !holder.contains(event.relatedTarget)) scheduleSave(0);
    };
    // Typing is saved shortly after each input event instead of waiting for
    // Editor.js' own (slower) change notification.
    const onInput = () => scheduleSave(40);
    // Block menu actions (alignment, text variant, indent, move, delete) do
    // not fire input events, and Editor.js reports them only after ~400 ms.
    // Save right after any click or Enter inside the editor instead.
    const onClick = () => scheduleSave(40);
    const onKeyUp = (event) => {
      if (event.key === 'Enter') scheduleSave(40);
    };
    // Editor.js uses Tab to open its block menu. Escape followed by Tab leaves
    // the editor, so keyboard users are never trapped inside it.
    let leaveArmed = false;
    // 2.7.8: the text selection behind the inline toolbar, restored when Escape leaves the toolbar.
    let textRange = null;
    const onSelection = () => {
      const selection = window.getSelection();
      if (!selection || !selection.rangeCount || selection.isCollapsed) return;
      const node = selection.anchorNode;
      const element = node && (node.nodeType === 1 ? node : node.parentElement);
      if (element && holder.contains(element) && element.closest('[contenteditable="true"]'))
        textRange = selection.getRangeAt(0).cloneRange();
    };
    const backToText = () => {
      const range = textRange;
      const host =
        range && range.startContainer.isConnected
          ? (range.startContainer.nodeType === 1
              ? range.startContainer
              : range.startContainer.parentElement
            ).closest('[contenteditable="true"]')
          : null;
      if (!host) return;
      host.focus();
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
    };
    // Registered on window (capture) because Editor.js listens on document.
    const onKeyDown = (event) => {
      if (!holder.contains(document.activeElement)) {
        leaveArmed = false;
        return;
      }
      // 2.7.8: keyboard entry into the inline toolbar (Alt+F10 with selected text, as in the table
      // and column tools), arrow keys between its buttons, Escape back to the selected text.
      const inToolbar = document.activeElement.closest('.ce-inline-toolbar');
      if (event.altKey && event.key === 'F10' && !event.ctrlKey && !event.metaKey && !inToolbar) {
        const items = inlineToolbarItems(holder);
        const selection = window.getSelection();
        if (items.length && selection && !selection.isCollapsed) {
          event.preventDefault();
          event.stopPropagation();
          onSelection();
          items[0].focus();
          return;
        }
      }
      if (inToolbar && event.key === 'Escape') {
        window.setTimeout(backToText, 0);
        return;
      }
      if (
        inToolbar &&
        ['ArrowRight', 'ArrowLeft'].includes(event.key) &&
        document.activeElement.tagName !== 'INPUT'
      ) {
        const items = inlineToolbarItems(holder);
        const index = items.indexOf(document.activeElement);
        if (index >= 0) {
          event.preventDefault();
          event.stopPropagation();
          const step = event.key === 'ArrowRight' ? 1 : -1;
          items[(index + step + items.length) % items.length].focus();
        }
        return;
      }
      if (event.key === 'Escape') {
        leaveArmed = true;
        return;
      }
      if (event.key === 'Tab' && leaveArmed) {
        event.stopPropagation();
        event.preventDefault();
        leaveArmed = false;
        const selector =
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';
        const candidates = Array.from(document.querySelectorAll(selector)).filter(
          (element) => !holder.contains(element) && element.getClientRects().length > 0
        );
        const target = event.shiftKey
          ? candidates
              .filter((element) => holder.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING)
              .pop()
          : candidates.find(
              (element) => holder.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
            );
        if (target) target.focus();
        return;
      }
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) leaveArmed = false;
      // 2.7.8 (re-audit major 2): the arrow keys stop on controls Editor.js would skip between two texts.
      if (
        ['ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight'].includes(event.key) &&
        !event.shiftKey &&
        !event.altKey &&
        !event.ctrlKey &&
        !event.metaKey
      ) {
        const from = document.activeElement;
        window.setTimeout(() => {
          const control = skippedControl(holder, from, document.activeElement);
          if (control) control.focus();
        }, 0);
        return;
      }
      // 2.7.8 (re-audit major 2): Tab reaches the controls inside blocks (audio and video Choose,
      // person photo, toggle, column style and layout, button style and new tab). Editor.js only
      // moves between text inputs; text-to-text moves and tools with their own Tab stay as they were.
      if (event.key === 'Tab' && !event.altKey && !event.ctrlKey && !event.metaKey) {
        const active = document.activeElement;
        const selection = window.getSelection();
        // An empty block opens the block types on Tab, a selection belongs to the inline toolbar.
        if (active && active.isContentEditable && !event.shiftKey && !String(active.textContent || '').trim())
          return;
        if (selection && !selection.isCollapsed && isTextStop(active)) return;
        const { target, handled } = nextTabStop(holder, active, event.shiftKey);
        if (!handled) return;
        event.stopPropagation();
        if (!target) return;
        event.preventDefault();
        focusTabStop(target, event.shiftKey);
      }
    };
    window.addEventListener('keydown', onKeyDown, true);
    document.addEventListener('selectionchange', onSelection);
    // 2.7.4 (m12): Save or Ctrl/Cmd+Enter right after typing waits until the input is in the form.
    const stopSubmitGuard = createSubmitGuard({
      holder,
      isPending: () => Boolean(pendingLocalRef.current || savingRef.current),
      flush: async () => {
        if (pendingLocalRef.current && !applyingRef.current) {
          clearTimeout(saveTimerRef.current);
          await runSave();
        } else if (savingRef.current) await savingRef.current;
      },
    });
    holder.addEventListener('focusout', onFocusOut);
    holder.addEventListener('input', onInput);
    holder.addEventListener('click', onClick);
    holder.addEventListener('keyup', onKeyUp);
    // Readiness signal for people and tests: typing is saved right away from here on.
    const clearReady = markInputReady(holder);
    return () => {
      clearReady();
      stopSubmitGuard();
      holder.removeEventListener('click', onClick);
      holder.removeEventListener('keyup', onKeyUp);
      holder.removeEventListener('focusout', onFocusOut);
      holder.removeEventListener('input', onInput);
      window.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('selectionchange', onSelection);
    };
  }, [ready, scheduleSave, runSave]);

  /** Applies a document from outside (collaboration, history, form reset). */
  // 2.5 private upload providers: the field's media signer and its request (set in an effect below).
  const mediaSignerRef = useRef(null);
  const signRequestRef = useRef(null);
  const applyExternal = useCallback(
    async (data, { emitToForm, live = false }) => {
      const editor = editorRef.current;
      if (!editor) return;
      applyingRef.current = true;
      if (undoRef.current) undoRef.current.pause();
      try {
        const signer = mediaSignerRef.current;
        if (signer && data)
          await Promise.race([
            signer.prewarm(signer.basesOf(data), signRequestRef.current),
            new Promise((resolve) => setTimeout(resolve, 3000)),
          ]);
        await applyToEditor(editor, data || { blocks: [] }, knownRef.current, {
          live,
          display: signer
            ? (blockData, block) =>
                signer.signValue({ blocks: [{ ...block, data: blockData }] }).blocks[0].data
            : undefined,
        });
        markFootnotes();
        setStats(computeStats(data));
        setCurrentData(data || null);
        setContentVersion((version) => version + 1);
        if (emitToForm) emit(data);
        else {
          const shown = data && data.blocks && data.blocks.length ? data : null;
          lastEmittedRawRef.current = contentKey(shown);
          lastEmittedRef.current = renderedKey(shown);
        }
      } finally {
        applyingRef.current = false;
        if (undoRef.current) undoRef.current.resume();
      }
    },
    [emit, markFootnotes]
  );

  /** Saves pending local edits into the shared document before remote content is shown. */
  const flushLocal = async (client) => {
    const editor = editorRef.current;
    if (!editor || !client || !pendingLocalRef.current) return;
    clearTimeout(saveTimerRef.current);
    pendingLocalRef.current = false;
    try {
      const local = await editor.save();
      client.pushLocal(local);
      markComponentsPushed(local);
    } catch {
      // the next change is saved again
    }
  };

  const collaboration = useCollaboration({
    target: collaborationTarget,
    getLocalData: () => {
      const prepared = prepareEditorValue(value);
      return prepared.data;
    },
    ready,
    onFirstSync: async (seeded, client) => {
      const editor = editorRef.current;
      if (!seeded || !editor) return;
      const local = await editor.save().catch(() => null);
      if (local && local.blocks.length > 0 && contentKey(local) !== contentKey(client.getData())) {
        client.pushLocal(local);
        markComponentsPushed(local);
      }
    },
    onRemoteData: async () => {
      const client = collabRef.current;
      const editor = editorRef.current;
      if (!client || !editor) return;
      await flushLocal(client);
      const { data, catchUp } = client.snapshot();
      // Remote content is untrusted: it is sanitised with the shared policy
      // before Editor.js renders it.
      // Blocks whose shared content equals what this editor itself produced are
      // the user's own edits: they are not rendered again (that would move the
      // caret and close open tool panels when the sanitiser normalises them).
      const own = new Set(
        data.blocks.filter((block) => knownRef.current.get(block.id) === blockKey(block)).map((b) => b.id)
      );
      const shared = prepareRemoteData(data, remoteCacheRef.current);
      shared.blocks.forEach((block) => {
        if (own.has(block.id)) knownRef.current.set(block.id, blockKey(block));
      });
      // The first room state only shows what is stored (normalised); it must
      // not mark the form as changed (unless it holds unsaved text, below). Later remote edits do.
      const first = !syncedOnceRef.current;
      syncedOnceRef.current = true;
      const storedView = viewRef.current;
      // 2.7.8: what this editor showed before the update (its own unsaved text included).
      const shownBefore = first ? null : prepareEditorValue(currentDataRef.current).data;
      await applyExternal(shared, { emitToForm: !first, live: true });
      // The editor's own serialisation of what it now shows is the base of the next local diff;
      // 2.6: component blocks count with the room's values, so edits not pushed yet stay a difference.
      const saved = await editor.save().catch(() => null);
      const shown = componentRoomView(saved);
      client.markShown(catchUp, shown || shared);
      viewRef.current = shown || shared;
      reportUnpushedComponents();
      if (first) setRoomRendered(true);
      // 2.7.8: someone else discarded the unsaved room changes (the room went back to the stored value).
      if (!first && saved) {
        const storedNow = prepareEditorValue(savedValueRef.current).data;
        if (roomWasReset(shownBefore, shown || shared, storedNow)) {
          setRoomNotice(null);
          // This person's own discard (an echo of it) keeps its Undo notice.
          setRoomReset((current) =>
            current && current.kind === 'self'
              ? current
              : { kind: 'remote', previous: shownBefore, focus: false }
          );
          // The form goes back to the stored value itself, so it is no longer marked as changed.
          lastEmittedRawRef.current = contentKey(shown || shared);
          onChangeRef.current(name, savedValueRef.current === undefined ? null : savedValueRef.current);
          userTouchedRef.current = false;
        }
      }
      // 2.7.4 (M3): a room keeps unsaved text for a while after the last editor left. When the first
      // room state differs from the stored value, the form is marked as changed (Save stores what
      // is shown) and a notice says so, with Discard to go back to the stored value.
      if (first && saved && !userTouchedRef.current) {
        const stored =
          storedView && storedView.blocks && storedView.blocks.length
            ? storedView
            : prepareEditorValue(savedValueRef.current).data;
        if (roomDiffersFromStored(saved, stored)) {
          userTouchedRef.current = true;
          lastEmittedRawRef.current = null;
          emit(saved);
          setRoomNotice({ saved: savedValueRef.current });
        }
      }
    },
    getInitialView: () => viewRef.current,
  });
  useEffect(() => {
    collabRef.current = collaboration.client;
  }, [collaboration.client]);

  // In suggest mode the field's own editor is read-only and hidden: edits go to a separate local copy.
  const readOnly =
    Boolean(disabled) || (collaboration.status === 'live' && !collaboration.canEdit) || suggestMode;
  const editableOutsideSuggest = !disabled && !(collaboration.status === 'live' && !collaboration.canEdit);
  const collabUndo = collaboration.active && collaboration.client && collaboration.canEdit;

  // Undo/redo during live collaboration only revert the user's own changes.
  useEffect(() => {
    if (!ready || !undoRef.current) return undefined;
    undoRef.current.setDelegate(collabUndo ? collaboration.client : null);
    return () => {
      if (undoRef.current) undoRef.current.setDelegate(null);
    };
  }, [ready, collabUndo, collaboration.client]);

  const announcement = usePresenceAnnouncements(collaboration.peers, t);

  // Block comments (2.3): stored apart from the field value, polled while the field is visible.
  const commentsEnabled = Boolean(
    config &&
    config.comments &&
    config.comments.enabled &&
    permissions.commentsRead &&
    target.uid &&
    target.documentId &&
    // Inside a repeatable component or dynamic zone, comments follow the entry's saved key (2.4).
    identityReady
  );
  const comments = useComments({
    target: fieldTarget,
    enabled: commentsEnabled,
    panelOpen: commentsOpen,
    elementRef: frameRef,
  });

  // 2.4 range comments: "Comment" on selected text (inline toolbar, Ctrl/Cmd+Alt+M, or the floating
  // button in read-only editors) builds an anchor and opens the panel with a new thread on that text.
  const [rangeDraft, setRangeDraft] = useState(null);
  const commentsWritable = Boolean(commentsEnabled && comments.loaded && comments.canWrite);
  const commentsWritableRef = useRef(false);
  useEffect(() => {
    commentsWritableRef.current = commentsWritable;
  }, [commentsWritable]);
  const startRangeCommentRef = useRef(null);
  const startRangeComment = async ({ range }) => {
    const editor = editorRef.current;
    const holder = holderRef.current;
    if (!commentsWritableRef.current || !holder || !range) return;
    if (editor && editor.inlineToolbar) editor.inlineToolbar.close();
    const client = collabRef.current;
    let doc = client && client.getDoc ? client.getDoc() : null;
    let blockData = null;
    if (doc) {
      // Typing not yet in the room would make the editor text differ from the shared text.
      await flushLocal(client);
      doc = client.getDoc();
    } else if (editor) {
      const start =
        range.startContainer.nodeType === 1 ? range.startContainer : range.startContainer.parentElement;
      const blockElement = start && start.closest('.ce-block[data-id]');
      const api = blockElement ? editor.blocks.getById(blockElement.getAttribute('data-id')) : null;
      try {
        const saved = api ? await api.save() : null;
        blockData = saved ? saved.data : null;
      } catch {
        blockData = null;
      }
    }
    const result = anchorFromSelection({ range, holder, doc, blockData });
    if (result.error) {
      toggleNotification({
        type: 'warning',
        message:
          result.error === 'multiple'
            ? t(
                'editor.comments.range.multiple',
                'Select text inside one paragraph, heading, list item or table cell to comment on it.'
              )
            : t('editor.comments.range.empty', 'Select some text to comment on it.'),
      });
      return;
    }
    setRangeDraft(result);
    setCommentsOpen(true);
  };
  useEffect(() => {
    startRangeCommentRef.current = startRangeComment;
  });
  // Block suggestions (2.4): for admins who may suggest or review; stored apart from the value.
  const suggestionsEnabled = Boolean(
    config &&
    config.suggestions &&
    config.suggestions.enabled &&
    (permissions.suggestionsCreate || permissions.suggestionsReview) &&
    target.uid &&
    target.documentId &&
    identityReady
  );
  const suggestions = useSuggestions({
    target: fieldTarget,
    enabled: suggestionsEnabled,
    panelOpen: suggestionsOpen,
    elementRef: frameRef,
  });
  const canSuggest = Boolean(suggestionsEnabled && permissions.suggestionsCreate && suggestions.canCreate);

  // 2.9 AI review as suggestions: the content as the field shows it (read-only editors cannot always
  // save, so the last known content is the fallback), sent to the server, which stores the suggestions.
  const readForReview = useCallback(async () => {
    const editor = editorRef.current;
    const saved =
      editor && !(editor.readOnly && editor.readOnly.isEnabled)
        ? await editor.save().catch(() => null)
        : null;
    return prepareEditorValue(saved || currentDataRef.current).data;
  }, []);
  const aiReview = useAiReview({ target: fieldTarget, readData: readForReview, suggestions });
  const aiReviewAllowed = Boolean(canSuggest && aiAllowed && !suggestMode);

  // 2.9 "Ask AI…": the admin's recent instructions (this browser only, per admin user).
  const aiOwner = useAuth('MagicEditorX', (state) => (state.user ? state.user.id : null));
  const storedInstructions = useMemo(() => readRecentInstructions(aiOwner), [aiOwner]);

  // 2.12 "Changes since last publish": Draft & Publish types, saved entries, known field identity.
  const publishedAvailable = Boolean(
    target.hasDraftAndPublish && target.uid && target.documentId && identityReady
  );
  const publishedChanges = usePublishedChanges({
    available: publishedAvailable,
    target: fieldTarget,
    baseline: target.baseline,
    data: currentData,
    get,
    owner: aiOwner,
  });
  const publishedMarksShown = Boolean(
    publishedChanges.on &&
    publishedChanges.status !== 'idle' &&
    !(publishedChanges.status === 'ready' && !publishedChanges.published)
  );
  const publishedScope = useMemo(
    () =>
      `mex${String(name)
        .replace(/[^A-Za-z0-9_-]/g, '-')
        .slice(0, 48)}`,
    [name]
  );
  const [usedInstructions, setUsedInstructions] = useState(null);
  const recentInstructions =
    usedInstructions && usedInstructions.owner === aiOwner ? usedInstructions.list : storedInstructions;
  const rememberInstruction = useCallback(
    (instruction) =>
      setUsedInstructions({ owner: aiOwner, list: saveRecentInstruction(aiOwner, instruction) }),
    [aiOwner]
  );

  // Upload helpers (multipart through the admin fetch client).
  const upload = useCallback(
    async (path, field, file) => {
      const body = new FormData();
      body.append(field, file);
      try {
        const { data } = await post(path, body);
        return data;
      } catch (requestError) {
        const info = readApiError(requestError);
        const message =
          (requestError &&
            requestError.response &&
            requestError.response.data &&
            requestError.response.data.message) ||
          info.message ||
          t('editor.upload.failed', 'The file could not be uploaded.');
        toggleNotification({ type: 'danger', message });
        return { success: 0, message };
      }
    },
    [post, t, toggleNotification]
  );

  const uploadImageByUrl = useCallback(
    async (url) => {
      try {
        const { data } = await post(API.imageByUrl, { url });
        return data;
      } catch (requestError) {
        const message =
          (requestError &&
            requestError.response &&
            requestError.response.data &&
            requestError.response.data.message) ||
          t('editor.upload.urlFailed', 'The image could not be loaded from this URL.');
        toggleNotification({ type: 'danger', message });
        return { success: 0, message };
      }
    },
    [post, t, toggleNotification]
  );

  // 2.4: pasted videos, audio, WebVTT tracks and posters. No notification per file:
  // the paste handler reports the files that could not be copied in one notice.
  const uploadMediaByUrl = useCallback(
    async (url, kind) => {
      try {
        const { data } =
          kind === 'poster' ? await post(API.imageByUrl, { url }) : await post(API.mediaByUrl, { url, kind });
        return data;
      } catch {
        return { success: 0 };
      }
    },
    [post]
  );

  const openMediaLibrary = useCallback((request) => setMediaRequest(request || {}), []);
  const onAiRequest = useCallback((request) => {
    const editor = editorRef.current;
    // Close the inline toolbar and its tooltip so nothing floats above the dialog.
    if (editor && editor.inlineToolbar) editor.inlineToolbar.close();
    if (editor && editor.tooltip && typeof editor.tooltip.hide === 'function') editor.tooltip.hide();
    // 2.9: the blocks the selection is in (an AI review of a selection suggests changes to them).
    setAiRequest(
      request ? { ...request, blockIds: blockIdsOfRange(request.range, holderRef.current) } : request
    );
  }, []);
  const onBlockAiRequest = useCallback((ids) => {
    const editor = editorRef.current;
    // Close the block toolbar and its tooltip so nothing floats above the dialog.
    if (editor && editor.toolbar && typeof editor.toolbar.close === 'function') editor.toolbar.close();
    if (editor && editor.tooltip && typeof editor.tooltip.hide === 'function') editor.tooltip.hide();
    if (Array.isArray(ids) && ids.length) setBlockAiRequest({ ids: [...ids] });
  }, []);

  // 2.5: a private upload provider serves files through expiring signed URLs, and the stored
  // (unsigned) URL answers 403. Tools request an image as soon as they set `src`, so the field
  // signs the media of its content first and Editor.js only ever sees signed URLs for display;
  // `save()` turns them back into the stored ones (createMediaSigner). Nothing is stored signed.
  const privateFiles = Boolean(config && config.uploads && config.uploads.privateFiles);
  const signTargetRef = useRef(null);
  useEffect(() => {
    signTargetRef.current = target.uid && target.documentId ? fieldTarget : null;
  });
  const requestSignedUrls = useCallback(
    async (urls) => {
      const body = { urls, ...(signTargetRef.current ? { target: signTargetRef.current } : {}) };
      const { data } = await post('/magic-editor-x/media/signed-urls', body);
      return (data && data.data && data.data.urls) || {};
    },
    [post]
  );
  const mediaSigner = useMemo(() => (privateFiles ? createMediaSigner() : null), [privateFiles]);
  const initialValueRef = useRef(value);
  useEffect(() => {
    mediaSignerRef.current = mediaSigner;
    signRequestRef.current = requestSignedUrls;
    initialValueRef.current = value;
  });
  const [mediaSigned, setMediaSigned] = useState(false);
  useEffect(() => {
    const signer = mediaSigner;
    if (!privateFiles || !signer || mediaSigned || !lazy.active) return undefined;
    let cancelled = false;
    const bases = signer.basesOf(prepareEditorValue(initialValueRef.current).data);
    // At most 3 s: the refresher still signs what is shown if the request is slow.
    const timeout = new Promise((resolve) => setTimeout(resolve, 3000));
    Promise.race([signer.prewarm(bases, requestSignedUrls), timeout]).then(() => {
      if (!cancelled) setMediaSigned(true);
    });
    return () => {
      cancelled = true;
    };
  }, [privateFiles, mediaSigner, mediaSigned, lazy.active, requestSignedUrls]);

  // Create the editor once the configuration is known; recreate it only when
  // the tool set changes (configuration, custom blocks, permissions).
  const toolsKey = config
    ? stableStringify({
        p: config.permissions,
        ai: config.ai.enabled,
        altText: altTextAllowed,
        blocks: customBlocks.map((block) => block.id + block.updatedAt),
        preset: presetKey,
        direction,
      })
    : null;
  useEffect(() => {
    if (!config || !holderRef.current || !lazy.active || (privateFiles && !mediaSigned)) return undefined;
    const prepared = prepareEditorValue(value);
    setValueError(prepared.error);
    const initial = prepared.data;
    viewRef.current = initial || { blocks: [] };
    lastEmittedRef.current = contentKey(initial);
    lastEmittedRawRef.current = contentKey(initial);
    rememberBlocks(knownRef.current, initial || { blocks: [] });
    setStats(computeStats(initial));
    setCurrentData(initial || null);
    let destroyed = false;
    let dragDrop = null;
    let paste = null;
    let shortcuts = null;
    let mentionKeys = null;
    let mathKeys = null;
    let footnoteKeys = null;
    let mentionTrigger = null;
    // Registered before Editor.js renders, so violations of the first render are seen.
    const cspGuard = createCspGuard(holderRef.current, {
      t,
      settingsHref: permissions.settingsRead ? settingsHref : null,
      onOpenSettings: () => navigate(SETTINGS_PATH),
    });
    const tools = buildTools({
      t,
      locale: adminLocale,
      fetchClient: { get, post },
      getContentLocale: () => contentLocaleRef.current,
      uploadImage: (file) => upload(API.imageByFile, 'image', file),
      uploadImageByUrl,
      uploadFile: (file) => upload(API.fileUpload, 'file', file),
      openMediaLibrary,
      onAiRequest,
      onBlockAi: target.uid ? onBlockAiRequest : undefined,
      aiEnabled: Boolean(config.ai.enabled && permissions.ai && preset.ai),
      suggestAltText: altTextAllowed
        ? createAltTextSuggester({
            post,
            getTarget: () => targetRef.current,
            getLocale: () => contentLocaleRef.current || adminLocale || null,
          })
        : undefined,
      preset: preset.restricted ? preset : null,
      canUpload: Boolean(permissions.upload),
      canBrowse: Boolean(permissions.mediaLibrary),
      linkPreview: config.linkPreview,
      customBlocks,
      placeholder,
      attachmentTypes: config.uploads.attachmentTypes,
      mountSynced,
      componentBlocks: allowedComponents,
      mountComponent,
      // 2.12: only on Strapi 5.54+ with the new Media Library, read and update rights, public files.
      mountMediaEdit: canEditInMediaLibrary({
        config,
        strapiGlobal: typeof window !== 'undefined' ? window.strapi : null,
        readOnly,
      })
        ? mountMediaEdit
        : undefined,
      onFootnoteEdit: (marker, info) => footnoteEditRef.current && footnoteEditRef.current(marker, info),
      // 2.4: "Comment" in the inline toolbar for admins who may write comments.
      onComment:
        config.comments && config.comments.enabled && permissions.commentsWrite && target.uid
          ? (request) => startRangeCommentRef.current && startRangeCommentRef.current(request)
          : undefined,
      commentsAvailable: () => commentsWritableRef.current,
      // 2.5: "Copy block" in the block menu.
      onCopyBlock: (blockId) => copyBlockRef.current && copyBlockRef.current(blockId),
      // 2.5: extra inline formatting the field turns on (off by default).
      ...inlineExtrasRef.current,
    });
    const toolNames = new Set(Object.keys(tools));
    toolNamesRef.current = toolNames;
    toolTitlesRef.current = toolTitles(
      tools,
      editorI18n(t).messages.toolNames,
      t('tools.ui.convertTo', 'Convert to')
    );
    // User input is tracked before Editor.js renders the blocks: after the
    // create -> edit redirect several fields mount at once, and text typed
    // before this field's effects ran was never reported to the form.
    const stopTracking = trackUserInput(holderRef.current, () => {
      userTouchedRef.current = true;
    });
    const shortcutList = Object.entries(tools)
      .filter(([name, tool]) => tool && tool.shortcut && tool.toolbox !== false && SHORTCUT_LABELS[name])
      .map(([name, tool]) => ({
        name,
        shortcut: tool.shortcut,
        label: t(SHORTCUT_LABELS[name][0], SHORTCUT_LABELS[name][1]),
      }));
    // 2.6: Editor.js clears the document selection while it starts; keep the caret of a field the
    // user is typing in (a lazily started field must not move it, see editor/selection-keeper.mjs).
    const selectionHold = holdSelection(holderRef.current);
    const editor = new EditorJS({
      holder: holderRef.current,
      data: (mediaSignerRef.current ? mediaSignerRef.current.signValue(initial) : initial) || undefined,
      readOnly,
      minHeight: 0,
      placeholder:
        placeholder ||
        t('editor.placeholder', 'Write, type / to choose a block, or paste a link to embed it'),
      autofocus: false,
      logLevel: 'ERROR',
      i18n: { ...editorI18n(t), direction },
      tools,
      onChange: () => scheduleSave(),

      onReady: () => {
        selectionHold.release();
        if (destroyed) return;
        // 2.5: everything save() returns carries the stored (unsigned) media URLs again.
        const signer = mediaSignerRef.current;
        if (signer) {
          const rawSave = editor.save;
          editor.save = async () => signer.unsignValue(await rawSave());
        }
        editorRef.current = editor;
        undoRef.current = createUndoManager(editor, {
          holder: holderRef.current,
          onChange: (next) => setUndoState({ canUndo: next.canUndo, canRedo: next.canRedo }),
        });
        if (!readOnly) dragDrop = createDragDrop(editor, holderRef.current);
        setToolShortcuts(shortcutList);
        const allowedNow = (type) => isBlockAllowed(presetRef.current, type);
        const markTouched = () => {
          userTouchedRef.current = true;
          scheduleSave(40);
        };
        paste = createPasteHandler({
          holder: holderRef.current,
          editor,
          t,
          isAllowed: allowedNow,
          allowedHeadingLevels: presetRef.current.headingLevels,
          canUpload: Boolean(permissions.upload),
          uploadImageByUrl,
          uploadImageFile: (file) => upload(API.imageByFile, 'image', file),
          uploadMediaByUrl,
          notify: ({ type, message }) => toggleNotification({ type, message }),
          onInserted: markTouched,
          hasTool: (name) => toolNames.has(name),
          // 2.5: blocks copied from a Magic Editor X field keep their data and tunes.
          onEditorBlocks: (blocks, position) =>
            pasteBlocksRef.current && pasteBlocksRef.current(blocks, position),
        });
        shortcuts = createMarkdownShortcuts({
          holder: holderRef.current,
          editor,
          getPreset: () => (presetRef.current.restricted ? presetRef.current : null),
          // bold and italic are Editor.js core tools, not entries of `tools`.
          hasTool: (name) => toolNames.has(name) || name === 'bold' || name === 'italic',
          onConverted: markTouched,
        });
        mentionKeys = createMentionKeys({ holder: holderRef.current });
        // 2.4: inline math (Ctrl/Cmd+Shift+E, preview popover) and footnotes (Ctrl/Cmd+Alt+F).
        const inlineAllowed = (tool) => !presetRef.current.inline || presetRef.current.inline.includes(tool);
        mathKeys = createInlineMathKeys({
          holder: holderRef.current,
          t,
          enabled: () => inlineAllowed('inlineMath'),
        });
        footnoteKeys = createFootnoteKeys({
          holder: holderRef.current,
          onEdit: (marker, info) => footnoteEditRef.current && footnoteEditRef.current(marker, info),
          enabled: () => inlineAllowed('footnote'),
          readOnly: () => Boolean(editor.readOnly && editor.readOnly.isEnabled),
        });
        // 2.4: `@` opens entry suggestions wherever the mention tool is offered (preset, link targets).
        if (Object.values(tools).some((tool) => tool && tool.class === MentionTool))
          mentionTrigger = createMentionTrigger({
            holder: holderRef.current,
            editor,
            fetchClient: { get, post },
            getLocale: () => contentLocaleRef.current,
            t,
          });
        markFootnotes();
        setReady(true);
        // Edits made while Editor.js was starting are stored right away.
        if (userTouchedRef.current) scheduleSave(0);
        else
          editor
            .save()
            .then((data) => {
              // Only stored blocks: the default paragraph of an empty field is not in any room (2.5).
              if (!destroyed && !userTouchedRef.current && data && Array.isArray(data.blocks))
                viewRef.current = restrictView(
                  data,
                  ((initial && initial.blocks) || []).map((block) => block.id)
                );
            })
            .catch(() => null);
      },
    });
    return () => {
      destroyed = true;
      stopTracking();
      cspGuard.destroy();
      clearTimeout(saveTimerRef.current);
      setReady(false);
      if (undoRef.current) undoRef.current.destroy();
      undoRef.current = null;
      if (dragDrop) dragDrop.destroy();
      if (paste) paste.destroy();
      if (shortcuts) shortcuts.destroy();
      if (mentionKeys) mentionKeys.destroy();
      if (mathKeys) mathKeys.destroy();
      if (footnoteKeys) footnoteKeys.destroy();
      if (mentionTrigger) mentionTrigger.destroy();
      editorRef.current = null;
      selectionHold.release();
      editor.isReady
        .then(() => editor.destroy())
        .catch(() => {})
        // The indent tune's window listeners (editor/tools/indent-tune.js).
        .finally(() => disposeTools(tools));
    };
    // The editor is rebuilt only when its tools change; value updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value/readOnly are handled by the effects below
  }, [toolsKey, adminLocale, lazy.active, mediaSigned]);

  // 2.5: a field started by focusing (Tab) or clicking its placeholder takes the focus once ready.
  useEffect(() => {
    if (!ready || !focusOnStartRef.current || !editorRef.current) return;
    focusOnStartRef.current = false;
    try {
      editorRef.current.focus();
    } catch {
      // nothing to focus
    }
  }, [ready]);

  // Read-only switches (permission changes, collaboration role) without rebuilding.
  useEffect(() => {
    const editor = editorRef.current;
    if (!ready || !editor || !editor.readOnly) return;
    if (editor.readOnly.isEnabled !== readOnly) editor.readOnly.toggle(readOnly).catch(() => {});
  }, [readOnly, ready]);

  // Value changes from outside the editor (form reset after save/discard, locale switch).
  useEffect(() => {
    if (!ready || collaboration.active) return;
    // 2.7.8: the form gives back the object this field emitted: nothing to compare (typing in long documents).
    if (value !== null && value !== undefined && value === lastEmittedValueRef.current) return;
    const prepared = prepareEditorValue(value);
    const key = contentKey(prepared.data);
    if (lastEmittedRef.current === null) lastEmittedRef.current = renderedKey(lastEmittedSourceRef.current);
    if (key === lastEmittedRef.current) return;
    lastEmittedRef.current = key;
    applyExternal(prepared.data, { emitToForm: false });
  }, [value, ready, collaboration.active, applyExternal]);

  // Fullscreen: Escape leaves, the page behind does not scroll.
  useEffect(() => {
    if (!fullscreen) return undefined;
    const onKey = (event) => {
      if (event.key === 'Escape' && !event.defaultPrevented) {
        setFullscreen(false);
        setFocusMode(false);
      }
    };
    // 2.7.8: Tab stays inside the full screen editor (role="dialog", aria-modal), the way the DS
    // FocusTrap wraps focus: from the last stop to the first and back. Dialogs opened from the
    // editor live in their own portal and trap focus themselves.
    const onTab = (event) => {
      const frame = frameRef.current;
      if (event.key !== 'Tab' || event.defaultPrevented || !frame || !frame.contains(document.activeElement))
        return;
      const stops = Array.from(
        frame.querySelectorAll(
          'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]'
        )
      ).filter(
        (element) => element.getClientRects().length > 0 && !element.closest('[inert], [aria-hidden="true"]')
      );
      if (!stops.length) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      const active = document.activeElement;
      if (!event.shiftKey && (active === last || last.contains(active))) {
        event.preventDefault();
        event.stopPropagation();
        first.focus();
      } else if (event.shiftKey && (active === first || first.contains(active))) {
        event.preventDefault();
        event.stopPropagation();
        last.focus();
      }
    };
    window.addEventListener('keydown', onTab, true);
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('keydown', onTab, true);
    };
  }, [fullscreen]);

  // Share the caret position with collaborators.
  useEffect(() => {
    if (!collaboration.client || !ready) return undefined;
    let timer = null;
    const onSelection = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const editor = editorRef.current;
        const holder = holderRef.current;
        const selection = window.getSelection();
        if (
          !editor ||
          !holder ||
          !selection ||
          selection.rangeCount === 0 ||
          !holder.contains(selection.anchorNode)
        )
          return;
        const index = editor.blocks.getCurrentBlockIndex();
        const block = index >= 0 ? editor.blocks.getBlockByIndex(index) : null;
        const content =
          block && block.holder && (block.holder.querySelector('.ce-block__content') || block.holder);
        if (!block || !content) {
          collaboration.client.sendCursor(null);
          return;
        }
        const anchor = offsetOf(content, selection.anchorNode, selection.anchorOffset);
        const focus = offsetOf(content, selection.focusNode, selection.focusOffset);
        collaboration.client.sendCursor({
          blockId: block.id,
          anchor: anchor ?? 0,
          focus: focus ?? anchor ?? 0,
        });
      }, 120);
    };
    document.addEventListener('selectionchange', onSelection);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('selectionchange', onSelection);
    };
  }, [collaboration.client, ready]);

  /** Inserts Media Library assets as image blocks or hands them to a custom block. */
  const onSelectAssets = useCallback(
    (assets) => {
      const request = mediaRequest || {};
      setMediaRequest(null);
      // Tools pass `accept` (video, audio, WebVTT); everything else takes images only.
      const accept =
        typeof request.accept === 'function'
          ? request.accept
          : (asset) => typeof asset.mime === 'string' && asset.mime.startsWith('image/');
      const images = (assets || []).filter((asset) => asset && accept(asset));
      if (typeof request.onSelect === 'function') {
        request.onSelect(images);
        return;
      }
      const editor = editorRef.current;
      if (!editor) return;
      const placeholder = Number.isInteger(request.blockIndex) ? request.blockIndex : null;
      const start = placeholder !== null ? placeholder : editor.blocks.getBlocksCount();
      images.forEach((asset, offset) => {
        editor.blocks.insert(
          'image',
          imageBlockData(asset),
          undefined,
          start + offset,
          offset === images.length - 1
        );
      });
      // The Media Library toolbox entry leaves a placeholder block; it is never stored.
      if (placeholder !== null) {
        const index = placeholder + images.length;
        const block = editor.blocks.getBlockByIndex(index);
        if (block && block.name === 'mediaLib') editor.blocks.delete(index);
      }
      // 2.7.8: focus goes to the last inserted image (the dialog's trigger, the placeholder, is gone).
      if (images.length) caretAfterDialog(editor, start + images.length - 1, 'end');
      scheduleSave();
    },
    [mediaRequest, scheduleSave]
  );

  const closeMediaLibrary = useCallback(() => {
    const request = mediaRequest || {};
    setMediaRequest(null);
    if (typeof request.onSelect === 'function') {
      request.onSelect([]);
      return;
    }
    const editor = editorRef.current;
    if (editor && Number.isInteger(request.blockIndex)) {
      const block = editor.blocks.getBlockByIndex(request.blockIndex);
      if (block && block.name === 'mediaLib') editor.blocks.delete(request.blockIndex);
      // 2.7.8: Escape or Close puts the caret back where the block was inserted.
      caretAfterDialog(editor, Math.max(0, request.blockIndex - 1), 'end');
    }
  }, [mediaRequest]);

  // 2.5: files dropped onto the field become image, video or audio blocks at the drop point.
  const dropAllowed = useMemo(
    () => ({
      image: Boolean(permissions.upload) && isBlockAllowed(preset, 'image'),
      video: Boolean(permissions.upload && permissions.mediaLibrary) && isBlockAllowed(preset, 'video'),
      audio: Boolean(permissions.upload && permissions.mediaLibrary) && isBlockAllowed(preset, 'audio'),
    }),
    [permissions.upload, permissions.mediaLibrary, preset]
  );
  const dropTypes = useMemo(() => dropTypesFor(dropAllowed), [dropAllowed]);
  const onDroppedAsset = useCallback(
    (asset, drop) => {
      const editor = editorRef.current;
      const planned = droppedBlock(asset, dropAllowed);
      if (!editor || !planned) return;
      const count = editor.blocks.getBlocksCount();
      if (drop.next === null) {
        const position = dropPosition(drop.target, count);
        drop.next = position.index;
        drop.replace = position.replace;
      }
      const at = Math.min(drop.next, count);
      editor.blocks.insert(planned.type, planned.data, undefined, at, false);
      if (drop.replace) {
        drop.replace = false;
        const empty = editor.blocks.getBlockByIndex(at + 1);
        if (empty && empty.isEmpty) editor.blocks.delete(at + 1);
      }
      drop.next = at + 1;
      userTouchedRef.current = true;
      scheduleSave();
    },
    [dropAllowed, scheduleSave]
  );

  // 2.5: a private upload provider serves files through expiring signed URLs: the media shown in
  // the field (editor, preview) get fresh ones (POST /media/signed-urls; nothing is stored signed).
  useEffect(() => {
    const area = areaRef.current;
    if (!privateFiles || !area) return undefined;
    const refresher = createSignedMediaRefresher({
      root: area.parentElement || area,
      cache: mediaSignerRef.current ? mediaSignerRef.current.cache : undefined,
      request: async (urls) => {
        const body = { urls, ...(signTargetRef.current ? { target: signTargetRef.current } : {}) };
        const { data } = await post('/magic-editor-x/media/signed-urls', body);
        return (data && data.data && data.data.urls) || {};
      },
    });
    return () => refresher.destroy();
  }, [privateFiles, post]);

  /** Replaces the editor content with a snapshot; the form becomes dirty and the user saves as usual. */
  const restoreSnapshot = useCallback(
    async (content) => {
      const prepared = prepareEditorValue(content);
      if (!prepared.data) return false;
      await applyExternal(prepared.data, { emitToForm: true });
      if (collabRef.current && editorRef.current) {
        const shown = await editorRef.current.save().catch(() => prepared.data);
        collabRef.current.stopCapturing();
        collabRef.current.pushLocal(shown);
        markComponentsPushed(shown);
      }
      if (undoRef.current) undoRef.current.record();
      return true;
    },
    [applyExternal]
  );

  /** Reads the current editor content (for snapshots). */
  const readContent = useCallback(async () => {
    const editor = editorRef.current;
    return editor ? editor.save() : null;
  }, []);

  /** Applies an AI suggestion to the selection it was requested for (or appends it). */
  const applyAi = useCallback(
    (html, request) => {
      const safe = sanitizeInline(html);
      const range = request && request.range;
      if (range && holderRef.current && holderRef.current.contains(range.commonAncestorContainer)) {
        const parsed = new DOMParser().parseFromString(safe, 'text/html').body;
        const fragment = document.createDocumentFragment();
        Array.from(parsed.childNodes).forEach((node) =>
          fragment.appendChild(document.importNode(node, true))
        );
        const start = range.commonAncestorContainer;
        const editable = (start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement)?.closest(
          '[contenteditable="true"]'
        );
        if (editable) insertSuggestion(range, fragment, editable);
        else {
          range.deleteContents();
          range.insertNode(fragment);
          range.collapse(false);
        }
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (editorRef.current) {
        const editor = editorRef.current;
        editor.blocks.insert('paragraph', { text: safe }, undefined, editor.blocks.getBlocksCount(), true);
      }
      scheduleSave();
    },
    [scheduleSave]
  );

  /**
   * Focus after the inline AI dialog (2.7.4): the text the request was made for (after Replace, the
   * caret behind the new text), else More tools. Never the page body.
   * @param {{ range?: Range }|null} request - The AI request of the dialog.
   * @returns {void}
   */
  const returnFromAi = useCallback(
    (request) => {
      const range = request && request.range;
      const holder = holderRef.current;
      const start = range && range.commonAncestorContainer;
      const editable =
        start && holder && holder.contains(start)
          ? (start.nodeType === Node.ELEMENT_NODE ? start : start.parentElement)?.closest(
              '[contenteditable="true"]'
            )
          : null;
      if (!editable) {
        focusToolsMenu();
        return;
      }
      editable.focus({ preventScroll: true });
      const selection = window.getSelection();
      if (selection) {
        selection.removeAllRanges();
        selection.addRange(range);
      }
    },
    [focusToolsMenu]
  );

  /** Replaces the editor content with a document and stores it like a user edit. */
  const replaceContent = useCallback(
    async (data) => {
      userTouchedRef.current = true;
      await applyExternal(data, { emitToForm: true });
      if (collabRef.current && editorRef.current) {
        const shown = await editorRef.current.save().catch(() => data);
        collabRef.current.stopCapturing();
        collabRef.current.pushLocal(shown);
        markComponentsPushed(shown);
      }
      if (undoRef.current) undoRef.current.record();
    },
    [applyExternal]
  );

  // 2.5 local draft buffer: unsaved content survives a reload, a crash, a closed tab and an ended session.
  const savedValue = useMemo(() => savedValueOf(savedValues, name, savedKey), [savedValues, name, savedKey]);
  useEffect(() => {
    savedValueRef.current = savedValue;
  }, [savedValue]);
  // Once the entry was saved after the notice appeared, the shown content is stored: no notice.
  const roomUnsaved = Boolean(roomNotice && roomNotice.saved === savedValue);

  /** Discard on the room notice (M3): the stored value comes back, in the editor, the form and the room. */
  const discardRoomChanges = useCallback(async () => {
    const notice = roomNotice;
    const editor = editorRef.current;
    if (!notice || !editor) return;
    // 2.7.8: what the room showed before, for Undo.
    const before = prepareEditorValue(await editor.save().catch(() => null)).data;
    setRoomNotice(null);
    const stored = notice.saved === undefined ? null : notice.saved;
    await applyExternal(prepareEditorValue(stored).data, { emitToForm: false, live: true });
    // The form value goes back to the stored value itself, so the form is no longer modified.
    onChangeRef.current(name, stored);
    userTouchedRef.current = false;
    const client = collabRef.current;
    if (client) {
      const local = await editor.save().catch(() => null);
      if (local) {
        client.pushLocal(local);
        markComponentsPushed(local);
        viewRef.current = componentRoomView(local) || local;
      }
    }
    if (before) setRoomReset({ kind: 'self', previous: before, focus: true });
  }, [applyExternal, name, roomNotice]);

  /** Focuses the editor text (after the room notices close). */
  const focusEditorText = useCallback(() => {
    window.requestAnimationFrame(() => {
      const holder = holderRef.current;
      const first = holder && holder.querySelector('[contenteditable="true"]');
      if (first) first.focus();
    });
  }, []);

  /** 2.7.8: Undo (own discard) or Restore (someone else's): the previous room text comes back for everyone. */
  const undoRoomReset = useCallback(async () => {
    const reset = roomReset;
    if (!reset || !reset.previous) return;
    setRoomReset(null);
    await replaceContent(reset.previous);
    if (reset.kind === 'self') {
      setRoomNotice({ saved: savedValueRef.current });
      window.requestAnimationFrame(() => {
        const discard =
          frameRef.current && frameRef.current.querySelector('[data-testid="mex-room-discard"]');
        if (discard) discard.focus();
        else focusEditorText();
      });
    } else focusEditorText();
  }, [roomReset, replaceContent, focusEditorText]);

  const dismissRoomReset = useCallback(() => {
    setRoomReset(null);
    focusEditorText();
  }, [focusEditorText]);
  const draft = useDraftBuffer({
    enabled: Boolean(target.uid && config && config.drafts && config.drafts.enabled !== false),
    ttlHours: config && config.drafts ? config.drafts.ttlHours : undefined,
    target: {
      uid: target.uid,
      documentId: target.documentId,
      locale: target.locale,
      field: name,
      fieldKey: savedKey,
    },
    value,
    savedValue,
    shownData: currentData,
    roomRendered,
    ready,
    readOnly,
    collaboration: {
      active: collaboration.active,
      status: collaboration.status,
      pending: collaboration.pending,
    },
    // 2.6: signed in again and the form was reset from the server: the typed text comes back (the banner says so).
    // Without a live room the buffer replaces what the reset form shows. In a live room nothing is
    // replaced (others may have edited meanwhile): a field that stayed mounted still shows the text
    // (the paused client kept and sends it), so only the form gets it back; a remounted field merges
    // the buffered edit (room at the pause -> buffer) onto the room, or throws (the notice is shown).
    onRecover: async (data, { remounted = false } = {}) => {
      if (!collabRef.current) {
        await replaceContent(data);
        return;
      }
      const until = Date.now() + 10000;
      while (collabRef.current && !syncedOnceRef.current && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const client = collabRef.current;
      const editor = editorRef.current;
      if (!client || !editor) throw new Error('not ready');
      if (remounted) {
        const base = collaboration.takePausedBase();
        if (!base) throw new Error('no base');
        client.mergeLocal(base, data);
        return;
      }
      const shown = await editor.save();
      lastEmittedRawRef.current = null;
      emit(shown);
    },
    onRestore: async (data) => {
      await replaceContent(data);
      toggleNotification({
        type: 'success',
        message: t('editor.drafts.restored', 'Changes restored. Save the entry to keep them.'),
      });
    },
  });

  // Field preset problems of the current content (saving fails while any remain).
  const violations = useMemo(
    () => (preset.restricted && currentData ? checkPreset(prepareEditorValue(currentData).data, preset) : []),
    [currentData, preset]
  );
  // 2.12.1: the count on "More tools" follows the content once typing pauses (the Quality panel
  // itself checks the current content), so long documents do not lint the whole field per save.
  const qualityData = useIdleValue(currentData);
  // 2.12.1: full screen editing and the panel sheets follow the visual viewport (on-screen keyboard).
  useVisualViewport(
    frameRef,
    fullscreen || suggestionsOpen || grammarOpen || findOpen || qualityOpen || commentsOpen
  );
  const quality = useQualityIssues(qualityData, fieldOptions || undefined, palette);
  const qualityFetch = useMemo(() => ({ get, post }), [get, post]);
  const qualityCount = {
    errors: quality.stats.errors + violations.length,
    total: quality.stats.errors + quality.stats.warnings + violations.length,
  };

  const fixViolations = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || readOnly) return;
    const saved = await editor.save().catch(() => null);
    const prepared = prepareEditorValue(saved).data;
    if (!prepared) return;
    const { data, fixed, removed } = fixPresetViolations(prepared, preset);
    if (!fixed) return;
    await replaceContent(data);
    toggleNotification({
      type: 'success',
      message: t(
        'editor.preset.fixed',
        '{fixed, plural, one {# block fixed} other {# blocks fixed}}{removed, plural, =0 {} one {, # removed} other {, # removed}}',
        { fixed, removed }
      ),
    });
  }, [preset, readOnly, replaceContent, t, toggleNotification]);

  /** Scrolls to a block and puts the caret into it. */
  const selectBlock = useCallback((blockId) => {
    const editor = editorRef.current;
    if (!editor || !blockId) return;
    const block = editor.blocks.getById(blockId);
    if (!block) return;
    if (block.holder) {
      // 2.12.1: on phones a panel is a bottom sheet; the block is centred in the part above it.
      const sheet = frameRef.current && frameRef.current.querySelector('[data-mex-sheet]');
      const covered =
        sheet && window.getComputedStyle(sheet).position === 'fixed'
          ? sheet.getBoundingClientRect().height
          : 0;
      if (covered) block.holder.style.scrollMarginBottom = `${Math.round(covered)}px`;
      block.holder.scrollIntoView({ block: 'center' });
      if (covered) block.holder.style.removeProperty('scroll-margin-bottom');
    }
    try {
      editor.caret.setToBlock(blockId, 'start');
    } catch {
      // blocks without a caret position (images) are only scrolled into view
    }
  }, []);

  /**
   * Footnote marker by reading-order position, checked against its id
   * (collaborators may have added or removed markers meanwhile).
   * @param {number} index - Position.
   * @param {string|null} [id] - Expected id.
   * @returns {HTMLElement|null} Marker.
   */
  const footnoteMarker = useCallback((index, id = null) => {
    const holder = holderRef.current;
    if (!holder) return null;
    const markers = Array.from(holder.querySelectorAll(FOOTNOTE_SELECTOR));
    const at = markers[index];
    if (at && (!id || at.getAttribute('data-mex-footnote') === id)) return at;
    return id ? markers.find((marker) => marker.getAttribute('data-mex-footnote') === id) || null : null;
  }, []);

  /** Puts the caret after a marker and scrolls it into view. */
  const caretAfter = useCallback((marker) => {
    const editable = marker && marker.closest('[contenteditable="true"]');
    if (!editable) return;
    marker.scrollIntoView({ block: 'center' });
    editable.focus();
    const selection = window.getSelection();
    if (!selection) return;
    const range = document.createRange();
    range.setStartAfter(marker);
    range.collapse(true);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  /** Writes the note of the edited footnote (an empty new footnote is removed instead). */
  const saveFootnote = useCallback(
    (html) => {
      const edit = footnoteEdit;
      setFootnoteEdit(null);
      if (!edit) return;
      const marker = footnoteMarker(edit.index, edit.id);
      if (!marker) {
        toggleNotification({
          type: 'warning',
          message: t('editor.footnotes.gone', 'This footnote was removed meanwhile. The note was not saved.'),
        });
        return;
      }
      userTouchedRef.current = true;
      releaseFootnote(marker);
      if (html) marker.setAttribute('data-mex-note', html);
      else marker.removeAttribute('data-mex-note');
      notifyFootnoteInput(marker);
      scheduleSave(40);
      requestAnimationFrame(() => caretAfter(marker));
    },
    [footnoteEdit, footnoteMarker, caretAfter, scheduleSave, t, toggleNotification]
  );

  /** Closes the note dialog; a footnote that was just inserted and never got a note is removed. */
  const closeFootnote = useCallback(() => {
    const edit = footnoteEdit;
    setFootnoteEdit(null);
    if (!edit) return;
    const marker = footnoteMarker(edit.index, edit.id);
    if (!marker) return;
    if (edit.isNew && !marker.getAttribute('data-mex-note')) {
      const parent = marker.parentNode;
      const next = marker.nextSibling;
      releaseFootnote(marker).remove();
      if (next && next.nodeType === Node.TEXT_NODE && next.data === '\u00a0') next.remove();
      notifyFootnoteInput(parent);
    }
    // Otherwise the dialog returns focus to where it was opened from (editor or list button).
  }, [footnoteEdit, footnoteMarker]);

  /** Removes the n-th footnote (list action, confirmed). */
  const removeFootnote = useCallback(
    (index) => {
      const marker = footnoteMarker(index);
      if (!marker) return;
      const parent = marker.parentNode;
      userTouchedRef.current = true;
      releaseFootnote(marker).remove();
      notifyFootnoteInput(parent);
      scheduleSave(40);
    },
    [footnoteMarker, scheduleSave]
  );

  /** Restores one block of a version (sanitised like any remote content). */
  const restoreBlock = useCallback(
    async (block, position) => {
      const editor = editorRef.current;
      const prepared = prepareEditorValue({ time: Date.now(), version: '2.31.7', blocks: [block] }).data;
      if (!editor || !prepared || !prepared.blocks[0]) return false;
      userTouchedRef.current = true;
      await restoreBlockInEditor(editor, prepared.blocks[0], position);
      scheduleSave(0);
      return true;
    },
    [scheduleSave]
  );

  /** Find and replace: the current content, and writing changed blocks back. */
  const readForFind = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return null;
    const saved = await editor.save().catch(() => null);
    return prepareEditorValue(saved).data;
  }, []);
  const applyFind = useCallback(
    async (data, blockIds) => {
      const editor = editorRef.current;
      if (!editor || readOnly) return;
      const byId = new Map(data.blocks.map((block) => [block.id, block]));
      userTouchedRef.current = true;
      for (const id of blockIds) {
        const block = byId.get(id);
        if (block && editor.blocks.getById(id)) await editor.blocks.update(id, block.data);
      }
      scheduleSave(0);
    },
    [readOnly, scheduleSave]
  );
  const showMatch = useCallback((match, options) => {
    const holder = holderRef.current;
    if (!holder) return;
    if (!match) {
      clearHighlight();
      return;
    }
    const element = holder.querySelector(`.ce-block[data-id="${CSS.escape(match.blockId)}"]`);
    if (element) highlightMatch(element, match, options);
  }, []);

  const closeFind = useCallback(() => {
    setFindOpen(false);
    clearHighlight();
    window.requestAnimationFrame(() => focusToolsMenu());
  }, [focusToolsMenu]);
  /**
   * 2.9: changes one block as an undo step of its own (grammar "Fix"/"Apply" and the Quality
   * panel's content fixes). Pending typing is saved first, the block is read fresh from the
   * editor, changed with the Editor.js block API and saved at once. In a live room the shared
   * document records it as this person's change, so their Undo reverts it and the room gets it
   * like typing.
   * @param {string} blockId - Block id.
   * @param {(block: object) => object|null} transform - New block data, or null for no change.
   * @returns {Promise<boolean>} True when the block changed.
   */
  const updateBlockStep = useCallback(
    async (blockId, transform) => {
      const editor = editorRef.current;
      if (!editor || readOnly || !blockId) return false;
      clearTimeout(saveTimerRef.current);
      if (pendingLocalRef.current) await runSave();
      else if (savingRef.current) await savingRef.current;
      if (undoRef.current) await undoRef.current.checkpoint();
      if (collabRef.current) collabRef.current.stopCapturing();
      const saved = prepareEditorValue(await editor.save().catch(() => null)).data;
      const block = saved && saved.blocks.find((item) => item.id === blockId);
      if (!block || !editor.blocks.getById(blockId)) return false;
      const next = transform(block);
      if (!next) return false;
      userTouchedRef.current = true;
      await editor.blocks.update(blockId, next);
      await runSave();
      if (collabRef.current) collabRef.current.stopCapturing();
      if (undoRef.current) await undoRef.current.checkpoint();
      return true;
    },
    [readOnly, runSave]
  );
  /** Grammar check: writes one corrected string back into its block. */
  const applyGrammar = useCallback(
    (blockId, path, html) =>
      updateBlockStep(blockId, (block) => {
        const { data, changed } = applySegments({ blocks: [block] }, [{ blockId, path, html }]);
        return changed ? data.blocks[0].data : null;
      }),
    [updateBlockStep]
  );
  /**
   * 2.9: one-click fix from the Quality panel. Content fixes (heading level, spacing) read the
   * block fresh from the editor, change it with the Editor.js block API and save at once, so the
   * fix is one undo step of its own (also in a live room: the shared document records it as this
   * person's change) and reaches the other people in the room like typing does. A "click here"
   * link gets the text the editor typed in the panel (`linkText` with `text`; `revealLink` and
   * `hideLink` show the link meanwhile); an image's alternative text field takes focus.
   * @param {{ rule: string, blockId: string, path?: string, params?: object }} issue - Finding.
   * @param {import('./quality-fixes.mjs').FixAction} action - Fix.
   * @param {string|null} language - Content language.
   * @returns {Promise<boolean>} True when something changed or got focus.
   */
  const applyQualityFix = useCallback(
    async (issue, action, language) => {
      if (!editorRef.current || readOnly || !issue || !issue.blockId) return false;
      const element = holderRef.current
        ? holderRef.current.querySelector(`.ce-block[data-id="${CSS.escape(issue.blockId)}"]`)
        : null;
      // The link of a "click here" finding: shown (scrolled to, highlighted) while the editor
      // types its new text in the quality panel, hidden again on Apply or Cancel.
      if (action.kind === 'revealLink' || action.kind === 'hideLink') {
        clearHighlight('mex-grammar');
        if (action.kind === 'hideLink') return true;
        const link =
          element &&
          Array.from(element.querySelectorAll('a')).find(
            (node) =>
              normalizeLinkText(node.textContent || '').slice(0, 40) === (issue.params && issue.params.text)
          );
        if (!link) return false;
        link.scrollIntoView({ block: 'center' });
        const same = Array.from(element.querySelectorAll('a')).filter(
          (node) => node.textContent === link.textContent
        );
        highlightMatch(
          element,
          { text: link.textContent, occurrence: Math.max(0, same.indexOf(link)) },
          { matchCase: true, name: 'mex-grammar' }
        );
        return true;
      }
      if (action.kind === 'linkText') clearHighlight('mex-grammar');
      if (action.kind === 'alt') {
        const inputs = element ? Array.from(element.querySelectorAll('.mex-alt__input')) : [];
        const input = inputs[action.index] || null;
        if (!input || input.disabled) return false;
        input.scrollIntoView({ block: 'center' });
        input.focus();
        toggleNotification({
          type: 'info',
          message: t(
            'editor.quality.fix.altPrompt',
            'Describe the image in the alternative text field, or mark it as decorative.'
          ),
        });
        return true;
      }
      return updateBlockStep(issue.blockId, (block) => fixedBlockData(block, issue, action, language));
    },
    [readOnly, t, toggleNotification, updateBlockStep]
  );
  const showGrammarMatch = useCallback((match, occurrence) => {
    const holder = holderRef.current;
    if (!holder || !match) {
      clearHighlight('mex-grammar');
      return;
    }
    const element = holder.querySelector(`.ce-block[data-id="${CSS.escape(match.blockId)}"]`);
    if (element)
      highlightMatch(element, { text: match.text, occurrence }, { matchCase: true, name: 'mex-grammar' });
  }, []);
  const closeGrammar = useCallback(() => {
    setGrammarOpen(false);
    clearHighlight('mex-grammar');
    window.requestAnimationFrame(() => focusToolsMenu());
  }, [focusToolsMenu]);
  /** Whole-field AI: appends a summary as a paragraph (plain text, escaped). */
  const insertParagraph = useCallback(
    (text) => {
      const editor = editorRef.current;
      if (!editor || readOnly) return;
      userTouchedRef.current = true;
      const html = escapeHtml(String(text)).replace(/\n/g, '<br>');
      editor.blocks.insert('paragraph', { text: html }, undefined, editor.blocks.getBlocksCount(), true);
      scheduleSave(0);
    },
    [readOnly, scheduleSave]
  );

  const closeQuality = useCallback(() => {
    setQualityOpen(false);
    setMenuPanel(null);
    window.requestAnimationFrame(() => focusToolsMenu());
  }, [focusToolsMenu]);

  // 2.4: block AI by keyboard. Ctrl/Cmd+Shift+G without a text selection opens it for the
  // selected blocks or the block with the caret (with selected text the inline AI tool runs).
  const blockAiByKey = Boolean(aiAllowed && target.uid && !readOnly);

  // 2.7.8: "+" and the block menu handle are buttons with names (Editor.js renders a div and a span).
  useEffect(() => {
    if (!ready) return undefined;
    return decorateToolbar(holderRef.current, {
      add: t('editor.toolbar.add', 'Add a block'),
      menu: t('editor.toolbar.blockMenu', 'Open the block menu'),
    });
  }, [ready, t]);

  // 2.7.8: inline toolbar buttons get the tool's name; a video, audio or attachment block inserted
  // from the block types gets focus on its control (Editor.js put the caret in the next paragraph).
  useEffect(() => {
    const holder = holderRef.current;
    if (!ready || !holder) return undefined;
    const stopLabels = labelInlineToolbar(holder, (name) => toolTitlesRef.current[name]);
    const stopDivButtons = decorateDivButtons(holder);
    let insertedAt = 0;
    const onToolbox = (event) => {
      if (event.target && event.target.closest && event.target.closest('.ce-toolbox, .ce-popover'))
        if (event.type === 'click' || event.key === 'Enter') insertedAt = Date.now();
    };
    const redactor = holder.querySelector('.codex-editor__redactor');
    const observer = new MutationObserver((records) => {
      if (!insertedAt || Date.now() - insertedAt > 1500) return;
      for (const record of records)
        for (const node of record.addedNodes) {
          const control = insertedBlockControl(node);
          if (!control) continue;
          insertedAt = 0;
          window.requestAnimationFrame(() => control.focus());
          return;
        }
    });
    if (redactor) observer.observe(redactor, { childList: true });
    holder.addEventListener('click', onToolbox, true);
    holder.addEventListener('keydown', onToolbox, true);
    return () => {
      stopLabels();
      stopDivButtons();
      observer.disconnect();
      holder.removeEventListener('click', onToolbox, true);
      holder.removeEventListener('keydown', onToolbox, true);
    };
  }, [ready]);

  // Editor shortcuts: Ctrl/Cmd+Shift+F find and replace, Ctrl/Cmd+Alt+/ help.
  // 2.7.8: Ctrl/Cmd+/ (without Alt) belongs to Editor.js again: it opens the block menu.
  useEffect(() => {
    if (!ready) return undefined;
    const onKey = (event) => {
      const frame = frameRef.current;
      if (!frame || !frame.contains(document.activeElement)) return;
      // Suggest mode has its own editor; the field's tools stay closed (2.4).
      if (suggestModeRef.current) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod) return;
      if (event.altKey) {
        // Ctrl/Cmd+Alt+/ opens the shortcut help (macOS writes "÷" for Alt+/, so the key code counts too).
        if (!event.shiftKey && (event.code === 'Slash' || event.key === '/')) {
          event.preventDefault();
          event.stopPropagation();
          rememberCaret(shortcutsReturnRef);
          setShortcutsOpen(true);
        }
        return;
      }
      if (event.shiftKey && (event.key === 'g' || event.key === 'G') && blockAiByKey) {
        const selection = window.getSelection();
        const holder = holderRef.current;
        const editor = editorRef.current;
        if (!holder || !editor || (selection && !selection.isCollapsed && selection.toString().trim()))
          return;
        let ids = Array.from(holder.querySelectorAll('.ce-block--selected'))
          .map((node) => node.getAttribute('data-id'))
          .filter(Boolean);
        if (!ids.length) {
          const index = editor.blocks.getCurrentBlockIndex();
          const block = index >= 0 ? editor.blocks.getBlockByIndex(index) : null;
          if (block && holder.contains(document.activeElement)) ids = [block.id];
        }
        if (!ids.length) return;
        event.preventDefault();
        event.stopPropagation();
        onBlockAiRequest(ids);
        return;
      }
      if (event.shiftKey && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault();
        event.stopPropagation();
        setFindOpen(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ready, blockAiByKey, onBlockAiRequest]);

  // Blocks of the current content for the comments panel, and open threads per block.
  const commentBlocks = useMemo(
    () =>
      (currentData && Array.isArray(currentData.blocks) ? currentData.blocks : []).map((block, index) => ({
        id: block.id,
        index,
        excerpt: blockExcerpt(block),
      })),
    [currentData]
  );
  const commentBlockIds = useMemo(() => commentBlocks.map((block) => block.id), [commentBlocks]);
  const commentCounts = useMemo(() => openThreadsByBlock(comments.threads), [comments.threads]);

  // The block the caret or pointer was in last ("comment on this block").
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !ready || !commentsEnabled) return undefined;
    const remember = (event) => {
      const block = event.target && event.target.closest ? event.target.closest('.ce-block[data-id]') : null;
      if (block && holder.contains(block)) setCurrentBlockId(block.getAttribute('data-id'));
    };
    holder.addEventListener('focusin', remember);
    holder.addEventListener('pointerdown', remember);
    return () => {
      holder.removeEventListener('focusin', remember);
      holder.removeEventListener('pointerdown', remember);
    };
  }, [ready, commentsEnabled]);

  const closeComments = useCallback(() => {
    setCommentsOpen(false);
    setMenuPanel(null);
    window.requestAnimationFrame(() => focusToolsMenu());
  }, [focusToolsMenu]);

  // 2.4: range comment highlights (CSS Custom Highlight API) and where each thread's text is.
  const commentOwner = useId();
  const getCommentDoc = useCallback(() => {
    const client = collabRef.current;
    return client && client.getDoc ? client.getDoc() : null;
  }, []);
  const [commentRevealThread, setCommentRevealThread] = useState(null);
  /** Click on commented text: open the panel and show the thread, focus stays in the editor. */
  const revealThread = useCallback(
    (threadId) => {
      setCommentsOpen(true);
      setCommentRevealThread(threadId);
    },
    [setCommentRevealThread]
  );
  const anchors = useCommentAnchors({
    owner: commentOwner,
    holderRef,
    threads: comments.threads,
    enabled: Boolean(commentsEnabled && ready && !previewOpen),
    version: contentVersion,
    getDoc: getCommentDoc,
    onOpen: revealThread,
  });

  /**
   * Ctrl/Cmd+Alt+N: the next open thread after the caret (Shift: the previous one), in document order;
   * its text is shown and the thread is focused in the panel.
   * @param {number} direction - 1 or -1.
   */
  const goToComment = useCallback(
    (direction) => {
      const order = new Map(commentBlockIds.map((id, index) => [id, index]));
      const ranges = anchors.ranges.current;
      const open = comments.threads
        .filter((thread) => thread.status === 'open' && order.has(thread.blockId))
        .sort((a, b) => {
          const block = order.get(a.blockId) - order.get(b.blockId);
          if (block) return block;
          const ra = ranges.get(a.id);
          const rb = ranges.get(b.id);
          if (ra && rb) return ra.compareBoundaryPoints(Range.START_TO_START, rb);
          return ra ? 1 : rb ? -1 : 0;
        });
      if (!open.length) {
        toggleNotification({
          type: 'info',
          message: t('editor.comments.noneOpen', 'There are no open comments.'),
        });
        return;
      }
      const current = open.findIndex((thread) => thread.id === anchors.activeId);
      const next = open[(current + direction + open.length) % open.length] || open[0];
      if (!anchors.selectRange(next.id)) selectBlock(next.blockId);
      setCommentsOpen(true);
      setCommentFocusThread(next.id);
    },
    [anchors, commentBlockIds, comments.threads, selectBlock, t, toggleNotification]
  );

  // Ctrl/Cmd+Alt+M (comment on the selection) and Ctrl/Cmd+Alt+N (next comment) while working in this field.
  useEffect(() => {
    if (!ready || !commentsEnabled) return undefined;
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || !event.altKey) return;
      if (event.code !== 'KeyM' && event.code !== 'KeyN') return;
      const frame = frameRef.current;
      const holder = holderRef.current;
      const selection = window.getSelection();
      const selectionHere = Boolean(
        selection && selection.rangeCount && holder && holder.contains(selection.anchorNode)
      );
      if (!frame || !(frame.contains(document.activeElement) || selectionHere)) return;
      if (event.code === 'KeyN') {
        event.preventDefault();
        event.stopPropagation();
        goToComment(event.shiftKey ? -1 : 1);
        return;
      }
      if (event.shiftKey || !selectionHere || selection.isCollapsed || !commentsWritableRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      startRangeCommentRef.current({ range: selection.getRangeAt(0).cloneRange() });
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ready, commentsEnabled, goToComment]);

  // 2.4: a link from a notification (`?mexThread=<id>`) opens the field's thread once.
  const location = useLocation();
  const linkedThread = new URLSearchParams(location.search).get('mexThread');
  const [handledLink, setHandledLink] = useState(null);
  if (
    linkedThread &&
    linkedThread !== handledLink &&
    comments.loaded &&
    comments.threads.some((item) => item.id === linkedThread)
  ) {
    setHandledLink(linkedThread);
    setCommentsOpen(true);
    setCommentFocusThread(linkedThread);
  }
  const markThreadsRead = comments.actions.markThreadsRead;
  const linkedNotified = Boolean(
    handledLink && comments.notifications.some((note) => note.threadId === handledLink)
  );
  useEffect(() => {
    if (!handledLink) return;
    if (frameRef.current) frameRef.current.scrollIntoView({ block: 'start' });
  }, [handledLink]);
  useEffect(() => {
    if (handledLink && linkedNotified) markThreadsRead([handledLink]).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps -- markThreadsRead changes every render
  }, [handledLink, linkedNotified]);

  /** Marker click: open the panel on the block's first open thread. */
  const openBlockComments = useCallback(
    (blockId) => {
      const thread = comments.threads.find((item) => item.blockId === blockId && item.status === 'open');
      setCommentFocusThread(thread ? thread.id : null);
      setCommentsOpen(true);
    },
    [comments.threads]
  );

  // 2.5: the Magic Editor X side panel opens this field's comments or quality check.
  const panelRequestRef = useRef(null);
  useEffect(() => {
    panelRequestRef.current = { path: target.field, savedKey, commentsEnabled, ready, suggestMode };
  });
  useEffect(() => {
    const onRequest = (event) => {
      const state = panelRequestRef.current;
      if (!state || !state.ready || state.suggestMode || !matchesFieldRequest(event.detail, state)) return;
      if (event.detail.panel === 'comments') {
        if (!state.commentsEnabled) return;
        setCommentFocusThread(null);
        setCommentsOpen(true);
      } else {
        setQualityOpen(true);
      }
      event.detail.handled = true;
      if (frameRef.current) frameRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' });
    };
    window.addEventListener(OPEN_FIELD_PANEL_EVENT, onRequest);
    return () => window.removeEventListener(OPEN_FIELD_PANEL_EVENT, onRequest);
  }, []);

  // 2.6 click-to-locate: `?mexField=<path>&mexBlock=<id>` in the edit view URL, or a
  // `magic-editor-x:locate` message from a frame of this page (Strapi's preview iframe).
  const [locateRequest, setLocateRequest] = useState(() => {
    const request = typeof window === 'undefined' ? null : parseLocateQuery(window.location.search);
    return request && request.field === target.field ? request : null;
  });
  const locatePathRef = useRef(target.field);
  useEffect(() => {
    locatePathRef.current = target.field;
  });
  useEffect(() => {
    const onMessage = (event) => {
      const request = parseLocateMessage(event.data);
      if (!request || request.field !== locatePathRef.current || !isEmbeddedFrameWindow(event.source)) return;
      setLocateRequest({ ...request });
      // Tell the frame that a field handles it (it does not navigate the admin then).
      try {
        event.source.postMessage({ type: LOCATED_MESSAGE_TYPE, field: request.field }, event.origin);
      } catch {
        // a frame without a usable origin gets no answer
      }
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);
  const activateLazy = lazy.activate;
  const handledLocateRef = useRef(null);
  useEffect(() => {
    if (!locateRequest || handledLocateRef.current === locateRequest) return;
    // A field that waits for the viewport (lazy start) starts now.
    if (!ready) {
      activateLazy();
      return;
    }
    if (suggestMode) return;
    handledLocateRef.current = locateRequest;
    const editor = editorRef.current;
    const block = locateRequest.blockId && editor ? editor.blocks.getById(locateRequest.blockId) : null;
    // After a click in the preview iframe the frame keeps the focus: give it back to the admin page first.
    const active = document.activeElement;
    if (active && active.tagName === 'IFRAME' && typeof active.blur === 'function') active.blur();
    if (block) {
      selectBlock(locateRequest.blockId);
      return;
    }
    if (frameRef.current) frameRef.current.scrollIntoView({ block: 'start' });
    if (locateRequest.blockId)
      toggleNotification({
        type: 'info',
        message: t(
          'editor.locate.missing',
          'This block is no longer in the field. It may have been moved or deleted.'
        ),
      });
  }, [locateRequest, ready, suggestMode, activateLazy, selectBlock, t, toggleNotification]);

  // Block suggestions (2.4) -------------------------------------------------
  const suggestionCounts = useMemo(
    () => (suggestionsEnabled ? openSuggestionsByBlock(suggestions.suggestions, commentBlockIds) : new Map()),
    [suggestionsEnabled, suggestions.suggestions, commentBlockIds]
  );
  const suggestionsOpenCount = suggestionsEnabled ? suggestions.counts.open : 0;
  // Marker columns at the inline end: two only while a block has both a comment and a suggestion marker.
  const reviewColumns =
    commentsEnabled || suggestionsEnabled
      ? Array.from(suggestionCounts.keys()).some((id) => commentsEnabled && commentCounts.has(id))
        ? 2
        : 1
      : 0;
  // 2.12: a "changed since publish" marker sits after the comment and suggestion markers of its block.
  const publishedColumnOf = useCallback(
    (id) =>
      (commentsEnabled && commentCounts.has(id) ? 1 : 0) +
      (suggestionsEnabled && suggestionCounts.has(id) ? 1 : 0),
    [commentsEnabled, commentCounts, suggestionsEnabled, suggestionCounts]
  );
  const publishedColumns = useMemo(() => {
    const changes = publishedMarksShown ? publishedChanges.changes : null;
    if (!changes) return 0;
    let columns = 0;
    for (const [id, mark] of changes.marks)
      if (mark.kind === 'changed') columns = Math.max(columns, publishedColumnOf(id) + 1);
    return columns;
  }, [publishedMarksShown, publishedChanges.changes, publishedColumnOf]);
  const markerColumns = Math.max(reviewColumns, publishedColumns);

  /** Starts suggest mode on a copy of what the editor shows now. */
  const startSuggest = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !canSuggest) return;
    // Read-only editors (no update right) cannot be saved by every tool; the field keeps what it shows.
    const saved = editor.readOnly && editor.readOnly.isEnabled ? null : await editor.save().catch(() => null);
    const base = prepareEditorValue(saved || currentDataRef.current).data || {
      time: Date.now(),
      version: '2.31.7',
      blocks: [],
    };
    setFindOpen(false);
    setQualityOpen(false);
    setGrammarOpen(false);
    setCommentsOpen(false);
    setSuggestionsOpen(false);
    setMenuPanel(null);
    setPreviewOpen(false);
    setFocusMode(false);
    clearHighlight();
    setSuggestSession({ base, key: Date.now() });
  }, [canSuggest]);

  /** Leaves suggest mode (unsent changes are dropped; the bar asks first). */
  const exitSuggest = useCallback(() => {
    setSuggestSession(null);
    window.requestAnimationFrame(() => moreButtonRef.current && moreButtonRef.current.focus());
  }, []);

  /** Sends the planned suggestions; afterwards the panel lists them. */
  const sendSuggestions = useCallback(
    async (list, note) => {
      try {
        const result = await suggestions.actions.send(list, note);
        const meta = (result && result.meta) || {};
        toggleNotification({
          type: 'success',
          message: t(
            'editor.suggest.sent',
            '{count, plural, one {# suggestion sent} other {# suggestions sent}} for review.',
            { count: (meta.created || 0) + (meta.updated || 0) || list.length }
          ),
        });
        setSuggestSession(null);
        setSuggestionsOpen(true);
        return true;
      } catch (requestError) {
        const code = requestError && requestError.code;
        let message = t('editor.suggest.failed', 'The suggestions could not be sent. Try again.');
        if (requestError && requestError.status === 429)
          message = t('editor.suggest.rateLimited', 'Too many suggestions. Try again in a minute.');
        else if (code === 'PRESET_VIOLATION')
          message = t(
            'editor.suggest.presetViolation',
            'A changed block does not match the settings of this field. Fix it and send again.'
          );
        else if (code === 'TOO_MANY_SUGGESTIONS')
          message = t(
            'editor.suggest.tooMany',
            'This field has too many open suggestions. Ask a reviewer to decide some first.'
          );
        toggleNotification({ type: 'danger', message });
        return false;
      }
    },
    [suggestions.actions, t, toggleNotification]
  );

  /**
   * Accepts suggestions: the server marks each accepted first (only one reviewer wins), then the
   * proposed blocks are applied through the normal whole-document path (shared document, one undo
   * step, the form becomes dirty; the normal save stores them).
   * @param {Array<{ suggestion: object, outdated: boolean }>} items - Suggestions in document order.
   * @returns {Promise<number>} Suggestions applied.
   */
  const acceptSuggestions = useCallback(
    async (items) => {
      const editor = editorRef.current;
      if (!editor || readOnly) return 0;
      const decided = [];
      let failure = null;
      for (const { suggestion, outdated } of items) {
        try {
          const result = await suggestions.actions.accept(suggestion.id, outdated, { again: false });
          if (result && result.data) decided.push(result.data);
        } catch (requestError) {
          failure = requestError;
          break;
        }
      }
      let applied = 0;
      if (decided.length) {
        const saved = await editor.save().catch(() => null);
        const prepared = prepareEditorValue(saved).data || {
          time: Date.now(),
          version: '2.31.7',
          blocks: [],
        };
        const done = new Set(decided.map((item) => item.id));
        const others = suggestions.suggestions.filter((item) => item.status === 'open' && !done.has(item.id));
        const result = applySuggestions(prepared, decided, { pendingInserts: pendingInsertsOf(others) });
        applied = result.applied.length;
        const next = prepareEditorValue(result.data).data;
        if (applied && next) await replaceContent(next);
      }
      suggestions.refresh();
      if (failure) throw failure;
      return applied;
    },
    [readOnly, replaceContent, suggestions]
  );

  /**
   * 2.9: an AI review stored its suggestions: say how many, then open the Suggestions panel.
   * @param {{ created?: number, updated?: number, duplicates?: number, capped?: number, invalid?: number }} meta - Result.
   */
  const onAiReviewed = useCallback(
    (meta) => {
      const count = (Number(meta && meta.created) || 0) + (Number(meta && meta.updated) || 0);
      const duplicates = Number(meta && meta.duplicates) || 0;
      const capped = Number(meta && meta.capped) || 0;
      let message;
      if (count)
        message = t(
          'editor.ai.review.added',
          '{count, plural, one {# suggestion} other {# suggestions}} added to the Suggestions panel.',
          { count }
        );
      else if (duplicates)
        message = t('editor.ai.review.duplicates', 'These suggestions are already in the Suggestions panel.');
      else message = t('editor.ai.review.none', 'The AI suggests no changes.');
      if (capped)
        message = `${message} ${t(
          'editor.ai.review.capped',
          'Only the first {max} are added. Review fewer blocks to see the rest.',
          { max: MAX_AI_REVIEW_SUGGESTIONS }
        )}`;
      toggleNotification({ type: count || duplicates ? 'success' : 'info', message });
      if (count || duplicates) {
        setMenuPanel('suggestions');
        setSuggestionsOpen(true);
      }
    },
    [t, toggleNotification]
  );

  const closeSuggestions = useCallback(() => {
    setSuggestionsOpen(false);
    setMenuPanel(null);
    window.requestAnimationFrame(() => moreButtonRef.current && moreButtonRef.current.focus());
  }, []);

  /** Marker click: open the panel on the block's first suggestion. */
  const openBlockSuggestions = useCallback((blockId) => {
    setSuggestionFocusBlock(blockId);
    setSuggestionsOpen(true);
  }, []);

  // Templates (2.3): the block the user worked on last is where a pattern goes.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !ready) return undefined;
    const remember = (event) => {
      const block = event.target && event.target.closest ? event.target.closest('.ce-block[data-id]') : null;
      if (block && holder.contains(block)) lastBlockIdRef.current = block.getAttribute('data-id');
    };
    holder.addEventListener('focusin', remember);
    holder.addEventListener('pointerdown', remember);
    return () => {
      holder.removeEventListener('focusin', remember);
      holder.removeEventListener('pointerdown', remember);
    };
  }, [ready]);

  const canManageTemplates = Boolean(permissions.templatesManage);
  const allowRawPreview = Boolean(config && config.rawHtml !== 'disable' && isBlockAllowed(preset, 'raw'));

  /** Current content for the template dialog (is the field empty?). */
  const readTemplateContent = useCallback(async () => {
    const editor = editorRef.current;
    const saved = editor ? await editor.save().catch(() => null) : null;
    return saved ? { blocks: saved.blocks, empty: isEmptyDocument(saved) } : null;
  }, []);

  /**
   * Inserts a reference to a synced source after the last used block (or
   * into an empty field). Only the reference is stored in the field.
   */
  const insertSynced = useCallback(
    async (template, saved) => {
      if (!isBlockAllowed(preset, 'synced')) return false;
      const taken = new Set(saved.blocks.map((block) => block.id));
      let id = newBlockId();
      while (taken.has(id)) id = newBlockId();
      const block = { id, type: 'synced', data: { ref: template.id } };
      primeSynced(template);
      const empty = isEmptyDocument(saved);
      const anchor =
        !empty && lastBlockIdRef.current
          ? saved.blocks.findIndex((item) => item.id === lastBlockIdRef.current)
          : -1;
      const next = empty
        ? { time: Date.now(), version: saved.version || '2.31.7', blocks: [block] }
        : insertBlocksAt(saved, [block], anchor >= 0 ? anchor : saved.blocks.length - 1);
      await replaceContent(next);
      lastBlockIdRef.current = id;
      toggleNotification({
        type: 'success',
        message: t('editor.synced.inserted', 'Synced block {name} inserted.', { name: template.name }),
      });
      return true;
    },
    [preset, replaceContent, t, toggleNotification]
  );

  /**
   * "Detach": replaces a synced block with a copy of its source's current
   * blocks (fresh ids, filtered by the field preset like a pattern), through
   * the same path as other whole-document changes, so Undo brings the
   * reference back.
   */
  const detachSynced = useCallback(
    async (blockId) => {
      const editor = editorRef.current;
      if (!editor || readOnly) return;
      const saved = await editor.save().catch(() => null);
      const block = saved ? saved.blocks.find((item) => item.id === blockId) : null;
      const ref = block ? syncedRefOf(block) : null;
      if (!ref) return;
      const entry = await loadSynced(get, ref, { force: true });
      if (!entry.template) {
        toggleNotification({
          type: 'warning',
          message: t(
            'editor.synced.detachFailed',
            'The synced block could not be loaded, so it was not detached.'
          ),
        });
        return;
      }
      const plan = prepareInsertion(
        sourceBlocksOf(entry.template.blocks),
        preset.restricted ? preset : null,
        {
          existingCount: saved.blocks.length - 1,
          existingIds: saved.blocks.map((item) => item.id),
        }
      );
      if (!plan.blocks.length) {
        toggleNotification({
          type: 'warning',
          message: t('editor.templates.nothing', 'No block of {name} fits this field.', {
            name: entry.template.name,
          }),
        });
        return;
      }
      const next = {
        time: Date.now(),
        version: saved.version || '2.31.7',
        blocks: replaceBlocks(saved.blocks, (item) => (item.id === blockId ? plan.blocks : null)),
      };
      await replaceContent(next);
      lastBlockIdRef.current = plan.blocks[plan.blocks.length - 1].id;
      selectBlock(plan.blocks[0].id);
      toggleNotification({
        type: 'success',
        message: t(
          'editor.synced.detached',
          '{name} detached: {count, plural, one {# block is} other {# blocks are}} now regular content of this field. Undo brings the synced block back.',
          { name: entry.template.name, count: plan.blocks.length }
        ),
      });
    },
    [get, preset, readOnly, replaceContent, selectBlock, t, toggleNotification]
  );

  const syncedEditHref = useCallback(
    (id) => (canManageTemplates ? `${templatesHref}?edit=${encodeURIComponent(id)}` : null),
    [canManageTemplates, templatesHref]
  );

  // The preview renders synced blocks with their current source (filtered like the API output).
  const previewSyncedRefs = useMemo(
    () => (previewOpen ? syncedRefsOf(currentData) : []),
    [previewOpen, currentData]
  );
  const { entries: previewSources } = useSyncedSources(previewSyncedRefs);
  const previewSynced = useMemo(() => {
    const map = new Map();
    for (const [ref, entry] of previewSources)
      if (entry.template)
        map.set(
          ref,
          filterSyncedForField(sourceBlocksOf(entry.template.blocks), preset.restricted ? preset : null)
            .blocks
        );
    return map;
  }, [previewSources, preset]);

  /**
   * Applies a template (replaces the content) or inserts a pattern after the
   * last used block, through the same path as other whole-document changes
   * (Editor.js block API, shared document, undo). Blocks the field does not
   * allow are left out; every inserted block gets a fresh id.
   */
  const insertTemplate = useCallback(
    async (template) => {
      const editor = editorRef.current;
      if (!editor || readOnly) return false;
      const saved = (await editor.save().catch(() => null)) || { blocks: [] };
      if (template.kind === 'synced') return insertSynced(template, saved);
      const source = prepareEditorValue(template.blocks).data;
      if (!source) return false;
      const replacing = template.kind === 'template' || isEmptyDocument(saved);
      const base = replacing ? [] : saved.blocks;
      const plan = prepareInsertion(source.blocks, preset.restricted ? preset : null, {
        existingCount: base.length,
        existingIds: saved.blocks.map((block) => block.id),
      });
      if (!plan.blocks.length) {
        toggleNotification({
          type: 'warning',
          message: t('editor.templates.nothing', 'No block of {name} fits this field.', {
            name: template.name,
          }),
        });
        return false;
      }
      const anchor = lastBlockIdRef.current
        ? base.findIndex((block) => block.id === lastBlockIdRef.current)
        : -1;
      const next = replacing
        ? { time: Date.now(), version: saved.version || '2.31.7', blocks: plan.blocks }
        : insertBlocksAt(saved, plan.blocks, anchor >= 0 ? anchor : base.length - 1);
      await replaceContent(next);
      lastBlockIdRef.current = plan.blocks[plan.blocks.length - 1].id;
      selectBlock(plan.blocks[0].id);
      toggleNotification({
        type: 'success',
        message:
          template.kind === 'template'
            ? t('editor.templates.applied', 'Template {name} applied.', { name: template.name })
            : t(
                'editor.templates.inserted',
                '{count, plural, one {# block} other {# blocks}} from {name} inserted.',
                { count: plan.blocks.length, name: template.name }
              ),
      });
      const omitted = plan.omitted.reduce((sum, entry) => sum + entry.count, 0);
      const notes = [
        omitted
          ? t(
              'editor.templates.omitted',
              '{count, plural, one {# block was left out} other {# blocks were left out}} because this field does not allow {count, plural, one {its type} other {their types}}.',
              { count: omitted }
            )
          : null,
        plan.truncated
          ? t(
              'editor.templates.truncated',
              '{count, plural, one {# block was left out} other {# blocks were left out}} because of the block limit of this field.',
              { count: plan.truncated }
            )
          : null,
        plan.adjusted
          ? t(
              'editor.templates.adjusted',
              '{count, plural, one {# block was adjusted} other {# blocks were adjusted}} to the settings of this field.',
              { count: plan.adjusted }
            )
          : null,
      ].filter(Boolean);
      if (notes.length) toggleNotification({ type: 'warning', message: notes.join(' ') });
      return true;
    },
    [insertSynced, preset, readOnly, replaceContent, selectBlock, t, toggleNotification]
  );

  /** Whether this editor has a tool for a block type (a disabled custom block has none). */
  const hasBlockTool = useCallback((type) => toolNamesRef.current.has(type), []);

  /**
   * 2.5 "Use existing content": inserts blocks from another entry, field or
   * locale (dialog) or from the block clipboard (paste). Blocks are cleaned
   * like a save, get fresh ids (comments and suggestions stay with the
   * source), are checked against this field's preset and go in through the
   * same path as templates: Editor.js block API, the shared document, one
   * undo step, the form and the normal save.
   * @param {Array<object>} sourceBlocks - Blocks to insert (source order).
   * @param {{ syncedAvailable?: (ref: string) => boolean|undefined, position?: { index: number, block: object|null }|null, title?: string }} [context] - Synced
   *   source state; `position` = paste at the caret (else after the block worked on last).
   * @returns {Promise<boolean>} True when blocks were inserted.
   */
  const insertReused = useCallback(
    async (sourceBlocks, context = {}) => {
      const { syncedAvailable, position = null, title = '', replace = false } = context;
      const editor = editorRef.current;
      if (!editor || readOnly) return false;
      const saved = (await editor.save().catch(() => null)) || { blocks: [] };
      const clean = prepareEditorValue({ blocks: sourceBlocks }).data;
      // 2.11 import "Replace content": planned and applied like an insert into an empty field.
      const empty = replace || isEmptyDocument(saved);
      const plan = planReuseInsertion(clean ? clean.blocks : [], {
        preset: preset.restricted ? preset : null,
        hasTool: hasBlockTool,
        syncedAvailable,
        existing: empty ? [] : saved.blocks,
      });
      const count = (reason) =>
        plan.omitted.filter((item) => item.reason === reason).reduce((sum, item) => sum + item.count, 0);
      const notes = [
        count('notAllowed')
          ? t(
              'editor.templates.omitted',
              '{count, plural, one {# block was left out} other {# blocks were left out}} because this field does not allow {count, plural, one {its type} other {their types}}.',
              { count: count('notAllowed') }
            )
          : null,
        count('unavailable')
          ? t(
              'editor.reuse.omitted.unavailable',
              '{count, plural, one {# block was left out} other {# blocks were left out}} because this editor has no tool for {count, plural, one {its type} other {their types}}.',
              { count: count('unavailable') }
            )
          : null,
        count('syncedMissing')
          ? t(
              'editor.reuse.omitted.syncedMissing',
              '{count, plural, one {# synced block was left out} other {# synced blocks were left out}} because {count, plural, one {its source was} other {their sources were}} removed or {count, plural, one {is} other {are}} no longer offered.',
              { count: count('syncedMissing') }
            )
          : null,
        count('unfixable')
          ? t(
              'editor.reuse.omitted.unfixable',
              '{count, plural, one {# block was left out} other {# blocks were left out}} because {count, plural, one {it} other {they}} could not be adjusted to the settings of this field.',
              { count: count('unfixable') }
            )
          : null,
        plan.truncated
          ? t(
              'editor.templates.truncated',
              '{count, plural, one {# block was left out} other {# blocks were left out}} because of the block limit of this field.',
              { count: plan.truncated }
            )
          : null,
        plan.adjusted
          ? t(
              'editor.templates.adjusted',
              '{count, plural, one {# block was adjusted} other {# blocks were adjusted}} to the settings of this field.',
              { count: plan.adjusted }
            )
          : null,
      ].filter(Boolean);
      if (!plan.blocks.length) {
        toggleNotification({
          type: 'warning',
          message: [
            t('editor.reuse.nothing', 'None of these blocks can be inserted into this field.'),
            ...notes,
          ].join(' '),
        });
        return false;
      }
      let next;
      if (empty) next = { time: Date.now(), version: saved.version || '2.31.7', blocks: plan.blocks };
      else if (position) {
        const index = position.block ? saved.blocks.findIndex((block) => block.id === position.block.id) : -1;
        const replace = index >= 0 && position.block.name === 'paragraph' && position.block.isEmpty;
        next = spliceReuse(
          saved,
          plan.blocks,
          replace ? { replaceIndex: index } : { afterIndex: index >= 0 ? index : saved.blocks.length - 1 }
        );
      } else {
        const anchor = lastBlockIdRef.current
          ? saved.blocks.findIndex((block) => block.id === lastBlockIdRef.current)
          : -1;
        next = spliceReuse(saved, plan.blocks, {
          afterIndex: anchor >= 0 ? anchor : saved.blocks.length - 1,
        });
      }
      await replaceContent(next);
      const last = plan.blocks[plan.blocks.length - 1].id;
      lastBlockIdRef.current = last;
      if (position) {
        try {
          editor.caret.setToBlock(last, 'end');
        } catch {
          // blocks without a caret position (images) keep the focus where it is
        }
      } else {
        // The dialog closes next: the caret goes to the first inserted block after it (closeReuse).
        reuseFocusRef.current = plan.blocks[0].id;
        toggleNotification({
          type: 'success',
          message: replace
            ? t(
                'editor.import.replaced',
                'The content was replaced with {count, plural, one {# block} other {# blocks}} from {name}. Undo brings the previous content back.',
                { count: plan.blocks.length, name: title }
              )
            : title
              ? t(
                  'editor.reuse.inserted',
                  '{count, plural, one {# block} other {# blocks}} from {name} inserted.',
                  {
                    count: plan.blocks.length,
                    name: title,
                  }
                )
              : t(
                  'editor.reuse.insertedPlain',
                  '{count, plural, one {# block inserted} other {# blocks inserted}}.',
                  {
                    count: plan.blocks.length,
                  }
                ),
        });
      }
      if (notes.length) toggleNotification({ type: 'warning', message: notes.join(' ') });
      return true;
    },
    [hasBlockTool, preset, readOnly, replaceContent, t, toggleNotification]
  );

  /** Paste of Editor.js blocks (any Magic Editor X field, entry or tab): synced sources are checked first. */
  const pasteEditorBlocks = useCallback(
    async (blocks, position) => {
      const refs = syncedRefsOf({ blocks }).slice(0, 100);
      const states = new Map();
      for (const ref of refs) {
        const entry = await loadSynced(get, ref);
        // Gone (404) or disabled (no longer offered for insertion): left out; a failed load is not known.
        if (entry.status === 'ready')
          states.set(ref, Boolean(entry.template) && entry.template.enabled !== false);
        else if (entry.status === 'missing') states.set(ref, false);
      }
      await insertReused(blocks, { position, syncedAvailable: (ref) => states.get(ref) });
    },
    [get, insertReused]
  );

  /** "Copy block" in the block menu: the block with its data and tunes goes to the clipboard. */
  const copyBlock = useCallback(
    async (blockId) => {
      const editor = editorRef.current;
      if (!editor) return;
      const saved = await editor.save().catch(() => null);
      const block = saved && saved.blocks.find((item) => item.id === blockId);
      if (!block) return;
      const clean = prepareEditorValue({ blocks: [block] }).data;
      const ok = writeBlocksToClipboard(clean && clean.blocks.length ? clean.blocks : [block]);
      toggleNotification(
        ok
          ? {
              type: 'success',
              message: t('editor.reuse.copied', 'Block copied. Paste it into any Magic Editor X field.'),
            }
          : {
              type: 'warning',
              message: t(
                'editor.reuse.copyFailed',
                'The block could not be copied. Select it and press Ctrl+C (Cmd+C on a Mac).'
              ),
            }
      );
    },
    [t, toggleNotification]
  );

  useEffect(() => {
    pasteBlocksRef.current = pasteEditorBlocks;
    copyBlockRef.current = copyBlock;
  }, [pasteEditorBlocks, copyBlock]);

  const closeReuse = useCallback(() => {
    setReuseOpen(false);
    const inserted = reuseFocusRef.current;
    reuseFocusRef.current = null;
    // After the modal returned focus: the first inserted block, or the More tools trigger.
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => (inserted ? selectBlock(inserted) : focusToolsMenu()))
    );
  }, [focusToolsMenu, selectBlock]);

  /** 2.11: closes the import dialog; the caret goes to the first imported block (else the More tools trigger). */
  const closeImport = useCallback(() => {
    setImportOpen(false);
    const inserted = reuseFocusRef.current;
    reuseFocusRef.current = null;
    window.requestAnimationFrame(() =>
      window.requestAnimationFrame(() => (inserted ? selectBlock(inserted) : focusToolsMenu()))
    );
  }, [focusToolsMenu, selectBlock]);

  /** 2.11 "Import file": opens the dialog (it offers "Insert at cursor" only when the field has content). */
  const openImport = useCallback(async () => {
    const editor = editorRef.current;
    const saved = editor ? await editor.save().catch(() => null) : null;
    setImportHasContent(Boolean(saved) && !isEmptyDocument(saved));
    setImportOpen(true);
  }, []);

  /** 2.11 "Export file": the content as shown (unsaved changes included) and the sources of its synced blocks. */
  const readExportContent = useCallback(async () => {
    const editor = editorRef.current;
    const saved = editor ? await editor.save().catch(() => null) : null;
    const value = saved ? prepareEditorValue(saved).data : null;
    const synced = new Map();
    for (const ref of syncedRefsOf(value).slice(0, 100)) {
      const entry = await loadSynced(get, ref);
      if (entry.template)
        synced.set(
          ref,
          filterSyncedForField(sourceBlocksOf(entry.template.blocks), preset.restricted ? preset : null)
            .blocks
        );
    }
    return { value, synced };
  }, [get, preset]);

  const closeExport = useCallback(() => {
    setExportOpen(false);
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => focusToolsMenu()));
  }, [focusToolsMenu]);

  /** "Save as pattern" from the block selection bar (template managers). */
  const saveSelection = useCallback(async (ids) => {
    const editor = editorRef.current;
    const saved = editor ? await editor.save().catch(() => null) : null;
    if (!saved) return;
    const wanted = new Set(ids);
    const blocks = saved.blocks.filter((block) => wanted.has(block.id));
    if (blocks.length) setSaveTemplate({ blocks, kind: 'pattern' });
  }, []);

  /** "Save content as template" from the insert dialog (template managers). */
  const saveWholeContent = useCallback(async () => {
    const editor = editorRef.current;
    const saved = editor ? await editor.save().catch(() => null) : null;
    setTemplatesOpen(false);
    if (saved && !isEmptyDocument(saved)) setSaveTemplate({ blocks: saved.blocks, kind: 'template' });
    else
      toggleNotification({
        type: 'warning',
        message: t('editor.saveTemplate.empty', 'This field is empty. Write something first.'),
      });
  }, [t, toggleNotification]);

  const closeTemplates = useCallback(() => {
    setTemplatesOpen(false);
    window.requestAnimationFrame(() => focusToolsMenu());
  }, [focusToolsMenu]);

  /** Preview on: focus the rendered region. Off: back to the editor (shortcut, "Back to editing") or the tools menu. */
  const togglePreview = useCallback(
    (fromShortcut = false) => {
      const next = !previewOpen;
      setPreviewOpen(next);
      window.requestAnimationFrame(() => {
        if (next) {
          if (previewRef.current) previewRef.current.focus();
          return;
        }
        if (fromShortcut === true && editorRef.current) {
          try {
            editorRef.current.focus();
            return;
          } catch {
            // fall back to the toggle
          }
        }
        focusToolsMenu();
      });
    },
    [previewOpen, focusToolsMenu]
  );

  // Ctrl/Cmd+Alt+P toggles the preview while focus is in the field (key code: Alt changes the character on macOS).
  useEffect(() => {
    if (!ready) return undefined;
    const onKey = (event) => {
      const frame = frameRef.current;
      if (!frame || !frame.contains(document.activeElement)) return;
      if (suggestModeRef.current) return;
      if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey || event.code !== 'KeyP')
        return;
      event.preventDefault();
      event.stopPropagation();
      togglePreview(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ready, togglePreview]);

  // Field tool registry (2.4, editor/field-tools.mjs): every secondary tool is one entry of the
  // "More tools" menu. A new tool adds one entry here; `visible` hides it where it cannot work.
  // 2.12.3: `order` puts the tasks editors need most first in each group (Write: AI, templates,
  // reuse, find, grammar, suggest; Review: quality, comments, suggestions, history, published
  // changes; Import and export; View).
  const fieldTools = [
    {
      id: 'comments',
      group: 'review',
      order: 2,
      label: t('editor.toolbar.comments', 'Comments'),
      icon: <Discuss />,
      badge: {
        count: comments.counts.open,
        tone: 'primary',
        label: t(
          'editor.toolbar.commentsCount',
          'Comments ({count, plural, one {# open thread} other {# open threads}})',
          { count: comments.counts.open }
        ),
      },
      pressed: commentsOpen,
      movesFocus: true,
      visible: commentsEnabled,
      onSelect: () => {
        if (commentsOpen) closeComments();
        else {
          setMenuPanel('comments');
          setCommentsOpen(true);
        }
      },
    },
    {
      id: 'history',
      group: 'review',
      order: 4,
      label: t('editor.toolbar.history', 'Version history'),
      icon: <ClockCounterClockwise />,
      movesFocus: true,
      visible: Boolean(target.uid && target.documentId && identityReady),
      onSelect: () => setHistoryOpen(true),
    },
    // 2.12: marks blocks added, changed or removed since the published version (off by default).
    {
      id: 'publishedChanges',
      group: 'review',
      order: 5,
      label: t('editor.publishedChanges.title', 'Changes since last publish'),
      icon: <ListSearch />,
      pressed: publishedChanges.on,
      // 2.12.3: an entry that was never published has nothing to compare, so the entry is left out
      // instead of being shown disabled with an explanation (the registry rule: never render a tool
      // that cannot work). While the status loads it stays visible but disabled.
      visible: publishedAvailable && !(publishedChanges.status === 'ready' && !publishedChanges.published),
      disabled: publishedChanges.status === 'loading',
      description:
        publishedChanges.status === 'error'
          ? t(
              'editor.publishedChanges.statusError',
              'Could not check the published version. Select to try again.'
            )
          : undefined,
      onSelect: () => {
        if (publishedChanges.status === 'error') publishedChanges.retry();
        publishedChanges.setOn(!publishedChanges.on);
      },
    },
    {
      id: 'suggestions',
      group: 'review',
      order: 3,
      label: t('editor.toolbar.suggestions', 'Suggestions'),
      icon: <Lightbulb />,
      badge: {
        count: suggestionsOpenCount,
        tone: 'primary',
        label: t(
          'editor.toolbar.suggestionsCount',
          'Suggestions ({count, plural, one {# open} other {# open}})',
          { count: suggestionsOpenCount }
        ),
      },
      pressed: suggestionsOpen,
      movesFocus: true,
      visible: suggestionsEnabled,
      onSelect: () => {
        if (suggestionsOpen) closeSuggestions();
        else {
          setMenuPanel('suggestions');
          setSuggestionsOpen(true);
        }
      },
    },
    {
      id: 'suggest',
      group: 'write',
      order: 6,
      label: t('editor.toolbar.suggest', 'Suggest changes'),
      icon: <Pencil />,
      movesFocus: true,
      visible: Boolean(canSuggest),
      disabled: !ready,
      onSelect: () => startSuggest(),
    },
    {
      id: 'quality',
      group: 'review',
      order: 1,
      label: t('editor.toolbar.quality', 'Quality checks'),
      icon: <SealCheck />,
      badge: {
        count: qualityCount.total,
        tone: qualityCount.errors ? 'danger' : 'warning',
        label: t(
          'editor.toolbar.qualityCount',
          'Quality checks ({count, plural, one {# problem} other {# problems}})',
          { count: qualityCount.total }
        ),
      },
      pressed: qualityOpen,
      movesFocus: true,
      onSelect: () => {
        if (qualityOpen) closeQuality();
        else {
          setMenuPanel('quality');
          setQualityOpen(true);
        }
      },
    },
    {
      id: 'fieldAi',
      group: 'write',
      order: 1,
      label: t('editor.toolbar.fieldAi', 'AI for the whole field'),
      icon: <Sparkle />,
      movesFocus: true,
      visible: fieldAiAllowed,
      onSelect: () => setFieldAiOpen(true),
    },
    {
      id: 'grammar',
      group: 'write',
      order: 5,
      label: t('editor.toolbar.grammar', 'Check grammar'),
      icon: <Feather />,
      pressed: grammarOpen,
      movesFocus: true,
      visible: grammarAllowed,
      onSelect: () => (grammarOpen ? closeGrammar() : setGrammarOpen(true)),
    },
    {
      id: 'find',
      group: 'write',
      order: 4,
      label: t('editor.toolbar.find', 'Find and replace'),
      icon: <Search />,
      shortcut: 'CMD+SHIFT+F',
      pressed: findOpen,
      movesFocus: true,
      onSelect: () => (findOpen ? closeFind() : setFindOpen(true)),
    },
    {
      id: 'templates',
      group: 'write',
      order: 2,
      label: t('editor.toolbar.templates', 'Insert template'),
      icon: <Layout />,
      movesFocus: true,
      visible: Boolean(target.uid) && !readOnly,
      disabled: previewOpen,
      onSelect: () => setTemplatesOpen(true),
    },
    {
      id: 'preview',
      group: 'view',
      order: 1,
      label: t('editor.toolbar.preview', 'Preview'),
      icon: <Monitor />,
      shortcut: 'CMD+ALT+P',
      pressed: previewOpen,
      exitLabel: t('editor.toolbar.previewOff', 'Back to editing'),
      movesFocus: true,
      onSelect: () => togglePreview(true),
    },
    {
      id: 'focus',
      group: 'view',
      order: 2,
      label: t('editor.toolbar.focusOn', 'Focus mode'),
      icon: <Eye />,
      pressed: focusMode,
      exitLabel: t('editor.toolbar.focusOff', 'Leave focus mode'),
      onSelect: () =>
        setFocusMode((value) => {
          if (!value) setFullscreen(true);
          return !value;
        }),
    },
    {
      id: 'shortcuts',
      group: 'view',
      order: 3,
      label: t('editor.toolbar.shortcuts', 'Keyboard shortcuts'),
      icon: <Command />,
      shortcut: 'CMD+ALT+/',
      movesFocus: true,
      onSelect: () => {
        shortcutsReturnRef.current = null;
        setShortcutsOpen(true);
      },
    },
    // 2.5 "Use existing content": blocks from another entry, field or language.
    {
      id: 'reuse',
      group: 'write',
      order: 3,
      label: t('editor.toolbar.reuse', 'Insert from another entry'),
      icon: <Files />,
      movesFocus: true,
      visible: Boolean(config && config.reuse && config.reuse.enabled) && !readOnly,
      disabled: previewOpen || !ready,
      onSelect: () => setReuseOpen(true),
    },
    // 2.11 import and export (2.12.3: one "Import and export" section).
    {
      id: 'import',
      group: 'file',
      order: 1,
      label: t('editor.toolbar.import', 'Import file'),
      icon: <Upload />,
      movesFocus: true,
      visible: !readOnly,
      disabled: previewOpen || !ready,
      onSelect: () => openImport(),
    },
    {
      id: 'export',
      group: 'file',
      order: 2,
      label: t('editor.toolbar.export', 'Export file'),
      icon: <Download />,
      movesFocus: true,
      disabled: !ready,
      onSelect: () => setExportOpen(true),
    },
  ];

  const fieldHint = valueError
    ? t('editor.value.invalid', 'The stored content could not be read. It is kept until you edit this field.')
    : hint;

  return (
    <Field.Root name={name} id={name} error={error} hint={fieldHint} required={required}>
      <SharedEditorStyles palette={palette} />
      <Flex direction="column" alignItems="stretch" gap={1}>
        <Field.Label action={labelAction}>{label}</Field.Label>
        <Frame
          ref={frameRef}
          data-mex-frame="true"
          $error={Boolean(error)}
          $fullscreen={fullscreen}
          role={fullscreen ? 'dialog' : undefined}
          aria-modal={fullscreen ? true : undefined}
          aria-label={fullscreen ? label : undefined}
        >
          {suggestSession ? (
            <SuggestEditor
              key={suggestSession.key}
              t={t}
              base={suggestSession.base}
              toolOptions={{
                t,
                locale: adminLocale,
                fetchClient: { get, post },
                getContentLocale: () => contentLocaleRef.current,
                uploadImage: async () => ({ success: 0 }),
                uploadImageByUrl: async () => ({ success: 0 }),
                uploadFile: async () => ({ success: 0 }),
                linkPreview: config && config.linkPreview,
                customBlocks,
                placeholder,
                attachmentTypes: config && config.uploads.attachmentTypes,
                mountSynced,
                // 2.5: the same extra inline formatting as the field.
                inlineExtras: { colors: preset.colors, script: preset.script },
                palette,
                annotations: fieldAnnotations,
                isDark: () => darkRef.current,
                componentBlocks: allowedComponents,
                mountComponent,
              }}
              preset={preset}
              direction={direction}
              lang={target.locale || undefined}
              minHeight={minHeight}
              placeholder={
                placeholder ||
                t('editor.placeholder', 'Write, type / to choose a block, or paste a link to embed it')
              }
              fullscreen={fullscreen}
              onSend={sendSuggestions}
              onExit={exitSuggest}
            />
          ) : null}
          <EditorToolbar
            hidden={suggestMode}
            t={t}
            ready={ready}
            readOnly={readOnly}
            fullscreen={fullscreen}
            onToggleFullscreen={() => {
              if (fullscreen) setFocusMode(false);
              setFullscreen((value) => !value);
            }}
            canUndo={collabUndo ? collaboration.canUndo : undoState.canUndo}
            canRedo={collabUndo ? collaboration.canRedo : undoState.canRedo}
            onUndo={() => undoRef.current && undoRef.current.undo()}
            onRedo={() => undoRef.current && undoRef.current.redo()}
            identityHint={
              target.uid && target.documentId && !identityReady
                ? t(
                    'editor.identity.saveHint',
                    'Save the entry once to turn on history and comments for this section.'
                  )
                : null
            }
            collaboration={collaboration}
            stats={stats}
            limits={{ maxBlocks: preset.maxBlocks, maxCharacters: preset.maxCharacters }}
            tools={fieldTools}
            onlyTools={suggestMode ? SUGGEST_MODE_TOOLS : null}
            moreButtonRef={moreButtonRef}
            onToolsOpenChange={(open) => {
              if (open) publishedChanges.ensureStatus();
            }}
          />
          {target.uid ? <SessionBanner t={t} /> : null}
          {publishedMarksShown && ready && !suggestMode && !previewOpen ? (
            <PublishedChangesBar
              t={t}
              status={publishedChanges.status}
              publishedAt={publishedChanges.publishedAt}
              changes={publishedChanges.changes}
              onRetry={publishedChanges.retry}
              onToggle={(next) => {
                publishedChanges.setOn(next);
                // The bar goes away with the marks: focus goes back to More tools, never to <body>.
                if (!next) window.requestAnimationFrame(() => focusToolsMenu());
              }}
            />
          ) : null}
          {roomUnsaved && ready && !suggestMode ? (
            <RoomNotice
              t={t}
              onDiscard={discardRoomChanges}
              disabled={readOnly}
              fallbackFocusRef={roomUndoRef}
            />
          ) : null}
          {roomReset && ready && !suggestMode ? (
            <RoomResetNotice
              t={t}
              kind={roomReset.kind}
              onUndo={undoRoomReset}
              onDismiss={dismissRoomReset}
              autoFocus={roomReset.focus}
              undoRef={roomUndoRef}
              disabled={readOnly}
            />
          ) : null}
          {draft.notice && ready && !suggestMode ? (
            <DraftNotice
              t={t}
              notice={draft.notice}
              onRestore={draft.restore}
              onDiscard={draft.discard}
              busy={draft.busy}
              disabled={!ready || readOnly}
            />
          ) : null}
          {suggestionsOpen && suggestionsEnabled && ready && !suggestMode ? (
            <PanelSlot padding={2} $fullscreen={fullscreen} data-mex-sheet="true">
              <SuggestionsPanel
                autoFocus={menuPanel === 'suggestions'}
                t={t}
                suggestions={suggestions}
                current={currentData}
                canDecide={Boolean(suggestions.canReview && !readOnly)}
                onAccept={acceptSuggestions}
                onSelectBlock={selectBlock}
                onClose={closeSuggestions}
                focusBlockId={suggestionFocusBlock}
                onFocusHandled={() => setSuggestionFocusBlock(null)}
                fail={(message) => toggleNotification({ type: 'danger', message })}
              />
            </PanelSlot>
          ) : null}
          {grammarOpen && grammarAllowed && ready && !suggestMode ? (
            <PanelSlot padding={2} $fullscreen={fullscreen} data-mex-sheet="true">
              <GrammarPanel
                t={t}
                fetchClient={qualityFetch}
                target={target}
                getData={readForFind}
                onApply={applyGrammar}
                onSelect={showGrammarMatch}
                onClose={closeGrammar}
                readOnly={readOnly}
              />
            </PanelSlot>
          ) : null}
          {findOpen && ready && !suggestMode ? (
            <PanelSlot padding={2} $fullscreen={fullscreen} data-mex-sheet="true">
              <FindReplacePanel
                t={t}
                getData={readForFind}
                onApply={applyFind}
                onSelect={showMatch}
                onClose={closeFind}
                readOnly={readOnly}
                contentVersion={contentVersion}
              />
            </PanelSlot>
          ) : null}
          {qualityOpen && ready && !suggestMode ? (
            <PanelSlot padding={2} $fullscreen={fullscreen} data-mex-sheet="true">
              <QualityPanel
                autoFocus={menuPanel === 'quality'}
                t={t}
                data={currentData}
                options={fieldOptions || undefined}
                fetchClient={qualityFetch}
                externalEnabled={Boolean(config && config.quality && config.quality.externalLinks)}
                scheduledEnabled={Boolean(config && config.quality && config.quality.scheduledLinks)}
                target={fieldTarget}
                onSelectBlock={selectBlock}
                onClose={closeQuality}
                violations={violations}
                onFixViolations={readOnly ? null : fixViolations}
                palette={palette}
                contentChecks={config && config.quality ? config.quality.contentChecks : undefined}
                headingLevels={preset.headingLevels}
                onFix={readOnly ? null : applyQualityFix}
              />
            </PanelSlot>
          ) : null}
          {commentsOpen && commentsEnabled && ready && !suggestMode ? (
            <PanelSlot padding={2} $fullscreen={fullscreen} data-mex-sheet="true">
              <CommentsPanel
                autoFocus={menuPanel === 'comments'}
                t={t}
                comments={comments}
                blocks={commentBlocks}
                currentBlockId={currentBlockId}
                onSelectBlock={selectBlock}
                onClose={closeComments}
                focusThreadId={commentFocusThread}
                onFocusHandled={() => setCommentFocusThread(null)}
                fail={(message) => toggleNotification({ type: 'danger', message })}
                rangeDraft={rangeDraft}
                onRangeDraftHandled={() => setRangeDraft(null)}
                anchorStatuses={anchors.statuses}
                onShowRange={anchors.selectRange}
                activeThreadId={anchors.activeId}
                revealThreadId={commentRevealThread}
                onRevealHandled={() => setCommentRevealThread(null)}
              />
            </PanelSlot>
          ) : null}
          {configError ? (
            <Flex padding={4} gap={2} direction="column" alignItems="flex-start">
              <Typography variant="omega" textColor="danger600">
                {t('editor.config.error', 'The editor could not be loaded.')}
              </Typography>
              <Button variant="secondary" onClick={retry}>
                {t('editor.config.retry', 'Try again')}
              </Button>
            </Flex>
          ) : null}
          {configLoading ? (
            <Flex padding={4} justifyContent="center">
              <Loader small>{t('editor.loading', 'Loading the editor')}</Loader>
            </Flex>
          ) : null}
          {previewOpen ? (
            <FieldPreview
              ref={previewRef}
              id={`${name}-mex-preview`}
              t={t}
              data={currentData}
              synced={previewSynced}
              allowRaw={allowRawPreview}
              minHeight={minHeight}
              fullscreen={fullscreen}
              lang={target.locale || undefined}
              dir={direction}
            />
          ) : null}
          <EditorArea
            ref={areaRef}
            $fullscreen={fullscreen && !previewOpen && !suggestMode}
            $concealed={previewOpen || suggestMode}
            aria-hidden={previewOpen || suggestMode ? true : undefined}
            inert={previewOpen || suggestMode ? '' : undefined}
            data-mex-changes={publishedMarksShown ? publishedScope : undefined}
          >
            <BlockSelectionBar
              t={t}
              holderRef={holderRef}
              editorRef={editorRef}
              ready={ready}
              readOnly={readOnly}
              canCreate={(type) => isBlockAllowed(preset, type)}
              onChanged={() => {
                userTouchedRef.current = true;
                scheduleSave(40);
              }}
              notify={(message) => toggleNotification({ type: 'success', message })}
              onSaveSelection={canManageTemplates ? saveSelection : undefined}
              onAi={aiAllowed && target.uid ? onBlockAiRequest : undefined}
            />
            {lazy.deferred && !ready && !configError ? (
              <LazyPlaceholder
                t={t}
                value={value}
                minHeight={minHeight}
                placeholder={placeholder}
                allowRaw={allowRawPreview}
                lang={target.locale || undefined}
                dir={direction}
                onStart={() => {
                  focusOnStartRef.current = true;
                  lazy.activate();
                }}
              />
            ) : null}
            <MediaDropArea
              FileDropZone={FileDropZone}
              enabled={Boolean(ready && !readOnly && dropTypes.length)}
              allowedTypes={dropTypes}
              fullscreen={fullscreen}
              holderRef={holderRef}
              onAsset={onDroppedAsset}
            >
              <Holder
                ref={holderRef}
                style={lazy.deferred && !ready ? WAITING_HOLDER_STYLE : undefined}
                className="mex-editor"
                // 2.7.8: the field label names the editor (as Strapi's Blocks field does).
                role="group"
                aria-labelledby={label ? `${name}-label` : undefined}
                lang={target.locale || undefined}
                dir={direction}
                $minHeight={minHeight}
                $fullscreen={fullscreen}
                $focus={focusMode}
                $gutter={markerColumns}
                data-testid="magic-editor-x"
                aria-busy={!ready}
                aria-describedby={`${name}-mex-keyboard`}
              />
            </MediaDropArea>
            {commentsWritable && readOnly && ready && !previewOpen ? (
              <SelectionCommentButton
                containerRef={areaRef}
                holderRef={holderRef}
                onComment={(range) => startRangeCommentRef.current({ range })}
                t={t}
              />
            ) : null}
            {commentsEnabled && ready && !previewOpen ? (
              <CommentMarkers
                containerRef={areaRef}
                holderRef={holderRef}
                counts={commentCounts}
                blockIds={commentBlockIds}
                version={contentVersion}
                onOpen={openBlockComments}
                t={t}
              />
            ) : null}
            {suggestionsEnabled && ready && !previewOpen && !suggestMode && suggestionCounts.size ? (
              <SuggestionMarkers
                containerRef={areaRef}
                holderRef={holderRef}
                counts={suggestionCounts}
                beside={commentsEnabled ? commentCounts : undefined}
                blockIds={commentBlockIds}
                version={contentVersion}
                onOpen={openBlockSuggestions}
                t={t}
              />
            ) : null}
            {publishedMarksShown && ready && !previewOpen && !suggestMode ? (
              <PublishedChangeMarks
                scope={publishedScope}
                containerRef={areaRef}
                holderRef={holderRef}
                changes={publishedChanges.changes}
                blockIds={commentBlockIds}
                columnOf={publishedColumnOf}
                version={contentVersion}
                t={t}
              />
            ) : null}
            {collaboration.active && collaboration.peers.length > 0 && !previewOpen ? (
              <RemoteCarets
                containerRef={areaRef}
                holderRef={holderRef}
                peers={collaboration.peers}
                version={contentVersion}
                t={t}
              />
            ) : null}
          </EditorArea>
          {!previewOpen && !suggestMode ? (
            <FootnotesPanel
              t={t}
              id={`${name}-mex`}
              holderRef={holderRef}
              ready={ready}
              readOnly={readOnly}
              onEdit={(index) => {
                const marker = footnoteMarker(index);
                if (marker) onFootnoteEdit(marker);
              }}
              onGoTo={(index) => caretAfter(footnoteMarker(index))}
              onRemove={removeFootnote}
            />
          ) : null}
          <VisuallyHidden aria-live="polite" aria-atomic="true">
            {announcement}
          </VisuallyHidden>
          <VisuallyHidden id={`${name}-mex-keyboard`}>
            {t(
              'editor.keyboard',
              'Type / in an empty block to choose a block type. Tab moves to the next block; press Escape, then Tab, to leave the editor.'
            )}
          </VisuallyHidden>
        </Frame>
        {suggestionsEnabled && !suggestMode && (suggestionsOpenCount > 0 || (canSuggest && disabled)) ? (
          <Flex gap={2} wrap="wrap" alignItems="center" data-testid="mex-suggestions-notice">
            {canSuggest && disabled ? (
              <>
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'editor.suggest.readOnlyHint',
                    'You cannot edit this field, but you can suggest changes.'
                  )}
                </Typography>
                <Button
                  variant="ghost"
                  size="S"
                  startIcon={<Pencil />}
                  onClick={startSuggest}
                  disabled={!ready}
                  data-testid="mex-suggest-start"
                >
                  {t('editor.suggest.start', 'Suggest changes')}
                </Button>
              </>
            ) : null}
            {suggestionsOpenCount > 0 && !suggestionsOpen ? (
              <>
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'editor.suggestions.notice',
                    '{count, plural, one {# open suggestion} other {# open suggestions}}',
                    { count: suggestionsOpenCount }
                  )}
                </Typography>
                <Button
                  variant="ghost"
                  size="S"
                  startIcon={<Lightbulb />}
                  onClick={() => setSuggestionsOpen(true)}
                  data-testid="mex-suggestions-show"
                >
                  {suggestions.canReview && editableOutsideSuggest
                    ? t('editor.suggestions.review', 'Review suggestions')
                    : t('editor.suggestions.showAll', 'Show suggestions')}
                </Button>
              </>
            ) : null}
          </Flex>
        ) : null}
        {violations.length ? (
          <Flex gap={2} wrap="wrap" alignItems="center" data-testid="mex-preset-violations">
            <Typography variant="pi" textColor="danger600">
              {t(
                'editor.preset.notice',
                'This content does not match the settings of this field ({count, plural, one {# problem} other {# problems}}). Saving fails until it is fixed.',
                { count: violations.length }
              )}
            </Typography>
            <TextButton onClick={() => setQualityOpen(true)}>
              {t('editor.preset.show', 'Show problems')}
            </TextButton>
          </Flex>
        ) : null}
        <Field.Hint />
        <Field.Error />
      </Flex>
      {historyOpen ? (
        <HistoryModal
          t={t}
          target={fieldTarget}
          readContent={readContent}
          onRestore={restoreSnapshot}
          onRestoreBlock={readOnly ? undefined : restoreBlock}
          onClose={() => {
            setHistoryOpen(false);
            window.requestAnimationFrame(() => focusToolsMenu());
          }}
          canEdit={!readOnly}
          canReadActivity={Boolean(
            permissions.auditRead && !(config && config.audit && config.audit.enabled === false)
          )}
        />
      ) : null}
      {aiRequest ? (
        <AiDialog
          t={t}
          request={aiRequest}
          config={config && config.ai}
          target={{ uid: target.uid, field: target.field }}
          preset={preset}
          canSuggest={aiReviewAllowed && !readOnly}
          review={aiReview}
          onReviewed={onAiReviewed}
          recent={recentInstructions}
          onInstructionUsed={rememberInstruction}
          onApply={(html) => {
            applyAi(html, aiRequest);
            setAiRequest(null);
          }}
          onClose={() => setAiRequest(null)}
          returnFocus={() => returnFromAi(aiRequest)}
        />
      ) : null}
      {blockAiRequest && aiAllowed && target.uid && !readOnly ? (
        <BlockAiDialog
          t={t}
          config={config.ai}
          target={{ uid: target.uid, field: target.field }}
          blockIds={blockAiRequest.ids}
          preset={preset}
          getData={readForFind}
          onApply={async (data, count) => {
            await replaceContent(data);
            toggleNotification({
              type: 'success',
              message: t(
                'editor.aiBlocks.applied',
                '{count, plural, one {# block updated} other {# blocks updated}}',
                { count }
              ),
            });
          }}
          onClose={() => setBlockAiRequest(null)}
          returnFocus={() => selectBlock(blockAiRequest.ids[0])}
          canSuggest={aiReviewAllowed}
          review={aiReview}
          onReviewed={onAiReviewed}
          recent={recentInstructions}
          onInstructionUsed={rememberInstruction}
        />
      ) : null}
      {fieldAiOpen && fieldAiAllowed ? (
        <FieldAiDialog
          t={t}
          config={config.ai}
          target={{ uid: target.uid, field: target.field }}
          getData={readForFind}
          onReplace={replaceContent}
          onInsertParagraph={insertParagraph}
          onClose={() => setFieldAiOpen(false)}
          readOnly={readOnly}
          returnFocus={focusToolsMenu}
          preset={preset}
          canSuggest={aiReviewAllowed}
          review={aiReview}
          onReviewed={onAiReviewed}
        />
      ) : null}
      {shortcutsOpen ? (
        <ShortcutsDialog
          t={t}
          tools={toolShortcuts}
          hasBlock={(type) => isBlockAllowed(preset, type)}
          hasInline={(tool) => !readOnly && (!preset.inline || preset.inline.includes(tool))}
          onClose={() => setShortcutsOpen(false)}
          comments={commentsEnabled}
          returnFocus={() => restoreCaret(shortcutsReturnRef, focusToolsMenu)}
        />
      ) : null}
      {[...componentMounts].map(([key, mount]) =>
        createPortal(
          <ComponentBlockView
            t={t}
            blockId={mount.blockId}
            uid={mount.uid}
            values={mount.values}
            fresh={mount.fresh}
            readOnly={Boolean(mount.readOnly || readOnly)}
            descriptor={componentsByUid.get(mount.uid) || null}
            allowed={preset.components.includes(mount.uid)}
            focus={mount.focus}
            onChange={mount.onChange}
            subscribe={mount.subscribe}
          />,
          mount.element,
          `component-${key}`
        )
      )}
      {[...mediaMounts].map(([key, mount]) =>
        createPortal(
          <MediaEditControl
            t={t}
            uploadPath={uploadPath}
            get={get}
            getFile={mount.getFile}
            subscribe={mount.subscribe}
            applyFile={mount.applyFile}
          />,
          mount.element,
          `media-${key}`
        )
      )}
      {[...syncedMounts].map(([key, mount]) =>
        createPortal(
          <SyncedBlockView
            t={t}
            refId={mount.ref}
            readOnly={Boolean(mount.readOnly || readOnly)}
            preset={preset}
            editHref={syncedEditHref}
            onDetach={() => detachSynced(mount.blockId)}
            allowRaw={allowRawPreview}
            lang={target.locale || undefined}
            dir={direction}
          />,
          mount.element,
          String(key)
        )
      )}
      {templatesOpen ? (
        <TemplateDialog
          t={t}
          target={target}
          preset={preset}
          readContent={readTemplateContent}
          onApply={insertTemplate}
          onSaveCurrent={canManageTemplates ? saveWholeContent : null}
          onClose={closeTemplates}
          allowRaw={allowRawPreview}
        />
      ) : null}
      {reuseOpen ? (
        <ReuseDialog
          t={t}
          get={get}
          target={target}
          preset={preset}
          hasTool={hasBlockTool}
          known={{ customBlocks, codeBlocks: (config && config.codeBlocks) || [] }}
          onInsert={(blocks, context) => insertReused(blocks, context)}
          onClose={closeReuse}
          allowRaw={allowRawPreview}
          lang={target.locale || undefined}
          dir={direction}
        />
      ) : null}
      {importOpen ? (
        <ImportDialog
          t={t}
          hasContent={importHasContent}
          onImport={(blocks, { replace, title }) => insertReused(blocks, { replace, title })}
          onClose={closeImport}
          allowRaw={allowRawPreview}
          lang={target.locale || undefined}
          dir={direction}
        />
      ) : null}
      {exportOpen ? (
        <ExportDialog
          t={t}
          readContent={readExportContent}
          field={name}
          lang={target.locale || undefined}
          dir={direction}
          onExported={(message) => toggleNotification({ type: 'success', message })}
          onClose={closeExport}
        />
      ) : null}
      {footnoteEdit ? (
        <FootnoteDialog
          t={t}
          number={footnoteEdit.index + 1}
          html={footnoteEdit.html}
          readOnly={readOnly}
          allowedTags={allowedInlineTags(preset)}
          onSave={saveFootnote}
          onClose={closeFootnote}
          returnFocusTo={footnoteEdit.returnTo}
        />
      ) : null}
      {saveTemplate ? (
        <SaveTemplateDialog
          t={t}
          request={saveTemplate}
          target={target}
          fieldLabel={typeof label === 'string' && label ? label : target.field}
          onSaved={(templateName) => {
            setSaveTemplate(null);
            toggleNotification({
              type: 'success',
              message: t('editor.saveTemplate.saved', 'Template {name} saved.', { name: templateName }),
            });
          }}
          onClose={() => setSaveTemplate(null)}
        />
      ) : null}
      {mediaRequest && MediaLibraryDialog ? (
        // eslint-disable-next-line react-hooks/static-components -- the dialog is a stable component registered by the upload plugin, not created here
        <MediaLibraryDialog
          allowedTypes={
            Array.isArray(mediaRequest.allowedTypes) && mediaRequest.allowedTypes.length
              ? mediaRequest.allowedTypes
              : ['images']
          }
          multiple={mediaRequest.multiple !== false}
          onClose={closeMediaLibrary}
          onSelectAssets={onSelectAssets}
        />
      ) : null}
    </Field.Root>
  );
};

/**
 * Content Manager custom field input: the editor body for the document
 * field of the current edit view.
 * @param {object} props - Custom field props.
 * @returns {JSX.Element} Field.
 */
const EditorField = (props) => {
  const target = useFieldTarget(props.name);
  const savedValues = useSavedValues();
  return <EditorFieldBody {...props} target={target} savedValues={savedValues} />;
};

export { EditorField, EditorFieldBody };
export default EditorField;
