import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import { useHref, useNavigate } from 'react-router-dom';
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
import { useFetchClient, useNotification, useStrapiApp } from '@strapi/strapi/admin';
import styled, { createGlobalStyle } from 'styled-components';
import { buildTools, editorI18n, createUndoManager, createDragDrop } from '../../editor/tools';
import { editorStyles } from '../../editor/tools/styles';
import { createCspGuard } from '../../editor/tools/csp-guard';
import { prepareEditorValue, prepareRemoteData, sanitizeInline } from '../../editor/sanitize';
import { applyToEditor, blockKey, rememberBlocks } from '../../editor/apply-remote';
import { computeStats } from '../../../../shared/editor-data.mjs';
import { stableStringify } from '../../../../shared/ydoc.mjs';
import { useEditorConfig } from '../../hooks/useEditorConfig';
import { getTranslation } from '../../utils/getTranslation';
import { API, readApiError } from '../../utils/api';
import { useFieldTarget } from './useFieldTarget';
import { useCollaboration } from './useCollaboration';
import { EditorToolbar } from './EditorToolbar';
import { HistoryModal } from './HistoryModal';
import { AiDialog } from './AiDialog';
import { RemoteCarets, offsetOf } from './RemoteCarets';
import { usePresenceAnnouncements } from './usePresenceAnnouncements';
import { QualityPanel } from './QualityPanel';
import { useQualityIssues } from './useQualityIssues';
import { FindReplacePanel } from './FindReplacePanel';
import { ShortcutsDialog } from './ShortcutsDialog';
import { BlockSelectionBar } from './BlockSelectionBar';
import { useComments } from './useComments';
import { CommentsPanel } from './CommentsPanel';
import { CommentMarkers } from './CommentMarkers';
import { blockExcerpt, openThreadsByBlock } from '../../../../shared/comments.mjs';
import { FieldPreview } from './FieldPreview';
import { TemplateDialog } from './TemplateDialog';
import { SaveTemplateDialog } from './SaveTemplateDialog';
import { insertBlocksAt, isEmptyDocument, prepareInsertion } from '../../../../shared/templates.mjs';
import { createPasteHandler } from '../../editor/paste';
import { createMarkdownShortcuts } from '../../editor/markdown-shortcuts';
import { createMentionKeys } from '../../editor/tools/mention';
import { restoreBlockInEditor } from '../../editor/restore-block.mjs';
import { highlightMatch, clearHighlight } from '../../editor/find-highlight';
import { createAltTextSuggester } from '../../editor/ai-alt-text';
import { GrammarPanel } from './GrammarPanel';
import { FieldAiDialog } from './FieldAiDialog';
import { applySegments } from '../../../../shared/ai-fields.mjs';
import { escapeHtml } from '../../../../shared/render/inline.mjs';
import {
  resolveFieldPreset,
  checkPreset,
  fixPresetViolations,
  isBlockAllowed,
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

const EditorStyles = createGlobalStyle`${editorStyles}`;

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
};

const PanelSlot = styled(Box)`
  min-width: 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  ${({ $fullscreen }) => ($fullscreen ? 'max-height: 45vh; overflow: auto; flex: 0 0 auto;' : '')}
`;

/** Settings page that explains the CSP sources (registered in admin/src/index.js). */
const SETTINGS_PATH = '/settings/magic-editor-x/configuration';

const Frame = styled(Box)`
  min-width: 0;
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
  /* Room for the block comment markers at the inline end (they sit outside the holder). */
  ${({ $gutter, theme }) => ($gutter ? `&& { padding-inline-end: ${theme.spaces[8]}; }` : '')}
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
 * Comparable form of editor content (blocks only; time changes on every save).
 * @param {object|null} data - Editor data.
 * @returns {string} Fingerprint.
 */
const contentKey = (data) => stableStringify(data && Array.isArray(data.blocks) ? data.blocks : []);

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
}) => {
  const { formatMessage, locale: adminLocale } = useIntl();
  const { get, post } = useFetchClient();
  const { toggleNotification } = useNotification();
  const MediaLibraryDialog = useStrapiApp('MagicEditorX', (state) => state.components['media-library']);
  const { config, customBlocks, error: configError, loading: configLoading, retry } = useEditorConfig();
  const navigate = useNavigate();
  const settingsHref = useHref(SETTINGS_PATH);
  // The editor is not rebuilt on a locale switch; the link picker reads the current locale through this ref.
  const contentLocaleRef = useRef(target.locale);
  useEffect(() => {
    contentLocaleRef.current = target.locale;
  }, [target.locale]);

  const t = useCallback(
    (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values),
    [formatMessage]
  );

  const holderRef = useRef(null);
  const editorRef = useRef(null);
  const undoRef = useRef(null);
  const knownRef = useRef(new Map());
  const lastEmittedRef = useRef(null);
  const lastEmittedRawRef = useRef(null);
  const applyingRef = useRef(false);
  const saveTimerRef = useRef(null);
  const collabRef = useRef(null);
  const pendingLocalRef = useRef(false);
  const syncedOnceRef = useRef(false);
  const historyButtonRef = useRef(null);
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
  const [mediaRequest, setMediaRequest] = useState(null);
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
  const [valueError, setValueError] = useState(null);
  const [currentData, setCurrentData] = useState(null);
  const [findOpen, setFindOpen] = useState(false);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const findButtonRef = useRef(null);
  const [toolShortcuts, setToolShortcuts] = useState([]);
  const qualityButtonRef = useRef(null);
  const frameRef = useRef(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentFocusThread, setCommentFocusThread] = useState(null);
  const [currentBlockId, setCurrentBlockId] = useState(null);
  const commentsButtonRef = useRef(null);
  // 2.3: grammar check panel and whole-field AI actions.
  const [grammarOpen, setGrammarOpen] = useState(false);
  const [fieldAiOpen, setFieldAiOpen] = useState(false);
  const grammarButtonRef = useRef(null);
  const moreButtonRef = useRef(null);
  const targetRef = useRef(target);
  useEffect(() => {
    targetRef.current = target;
  }, [target]);
  // Templates, block patterns and the in-field preview (2.3).
  const [previewOpen, setPreviewOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [saveTemplate, setSaveTemplate] = useState(null);
  const previewRef = useRef(null);
  const previewButtonRef = useRef(null);
  const templatesButtonRef = useRef(null);
  const lastBlockIdRef = useRef(null);

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
  useEffect(() => {
    presetRef.current = preset;
  }, [preset]);
  const direction = directionOf(target.locale);
  // 2.3 AI features: owner switches (config), RBAC and the field preset; the server checks all three again.
  const aiAllowed = Boolean(config && config.ai.enabled && permissions.ai && preset.ai);
  const altTextAllowed = Boolean(aiAllowed && config.ai.altText && permissions.mediaLibrary);
  const fieldAiAllowed = Boolean(aiAllowed && config.ai.fieldActions && target.uid);
  const grammarAllowed = Boolean(
    config && config.grammar && config.grammar.enabled && permissions.grammar && target.uid
  );
  const collaborationTarget =
    config &&
    config.collaboration.enabled &&
    permissions.collaborate &&
    preset.collaboration &&
    target.uid &&
    target.documentId
      ? target
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
      lastEmittedRef.current = renderedKey(next);
      if (baselineOnly) return;
      // Editor.js reuses the tune objects of a block between saves, and the
      // Content Manager form freezes what it stores. Hand over a copy so the
      // editor can keep writing to its own objects.
      onChangeRef.current(name, next ? JSON.parse(JSON.stringify(next)) : null);
    },
    [name]
  );

  /** Saves the editor (debounced) after a local change; `delay` 0 saves at once. */
  const scheduleSave = useCallback(
    (delay = SAVE_DEBOUNCE_MS) => {
      if (applyingRef.current) return;
      pendingLocalRef.current = true;
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        const editor = editorRef.current;
        if (!editor || applyingRef.current) return;
        pendingLocalRef.current = false;
        try {
          const data = await editor.save();
          rememberBlocks(knownRef.current, data);
          setStats(computeStats(data));
          setCurrentData(data);
          setContentVersion((version) => version + 1);
          if (!userTouchedRef.current) {
            emit(data, { baselineOnly: true });
            return;
          }
          emit(data);
          if (collabRef.current) collabRef.current.pushLocal(data);
          if (undoRef.current) undoRef.current.record();
        } catch {
          // Editor.js rejects saves while a block is being re-rendered; the next change saves again.
        }
      }, delay);
    },
    [emit]
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
    // Registered on window (capture) because Editor.js listens on document.
    const onKeyDown = (event) => {
      if (!holder.contains(document.activeElement)) {
        leaveArmed = false;
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
    };
    const onTouch = () => {
      userTouchedRef.current = true;
    };
    const touchEvents = ['pointerdown', 'keydown', 'input', 'paste', 'drop'];
    touchEvents.forEach((type) => holder.addEventListener(type, onTouch, true));
    window.addEventListener('keydown', onKeyDown, true);
    holder.addEventListener('focusout', onFocusOut);
    holder.addEventListener('input', onInput);
    holder.addEventListener('click', onClick);
    holder.addEventListener('keyup', onKeyUp);
    return () => {
      touchEvents.forEach((type) => holder.removeEventListener(type, onTouch, true));
      holder.removeEventListener('click', onClick);
      holder.removeEventListener('keyup', onKeyUp);
      holder.removeEventListener('focusout', onFocusOut);
      holder.removeEventListener('input', onInput);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [ready, scheduleSave]);

  /** Applies a document from outside (collaboration, history, form reset). */
  const applyExternal = useCallback(
    async (data, { emitToForm }) => {
      const editor = editorRef.current;
      if (!editor) return;
      applyingRef.current = true;
      if (undoRef.current) undoRef.current.pause();
      try {
        await applyToEditor(editor, data || { blocks: [] }, knownRef.current);
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
    [emit]
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
      if (local && local.blocks.length > 0 && contentKey(local) !== contentKey(client.getData()))
        client.pushLocal(local);
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
      // not mark the form as changed. Later remote edits do.
      const first = !syncedOnceRef.current;
      syncedOnceRef.current = true;
      await applyExternal(shared, { emitToForm: !first });
      // The editor's own serialisation of what it now shows is the base of the next local diff.
      const shown = await editor.save().catch(() => null);
      client.markShown(catchUp, shown || shared);
    },
  });
  useEffect(() => {
    collabRef.current = collaboration.client;
  }, [collaboration.client]);

  const readOnly = Boolean(disabled) || (collaboration.status === 'live' && !collaboration.canEdit);
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
    target.documentId
  );
  const comments = useComments({
    target,
    enabled: commentsEnabled,
    panelOpen: commentsOpen,
    elementRef: frameRef,
  });

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

  const openMediaLibrary = useCallback((request) => setMediaRequest(request || {}), []);
  const onAiRequest = useCallback((request) => {
    const editor = editorRef.current;
    // Close the inline toolbar and its tooltip so nothing floats above the dialog.
    if (editor && editor.inlineToolbar) editor.inlineToolbar.close();
    if (editor && editor.tooltip && typeof editor.tooltip.hide === 'function') editor.tooltip.hide();
    setAiRequest(request);
  }, []);

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
    if (!config || !holderRef.current) return undefined;
    const prepared = prepareEditorValue(value);
    setValueError(prepared.error);
    const initial = prepared.data;
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
    });
    const toolNames = new Set(Object.keys(tools));
    const shortcutList = Object.entries(tools)
      .filter(([name, tool]) => tool && tool.shortcut && tool.toolbox !== false && SHORTCUT_LABELS[name])
      .map(([name, tool]) => ({
        name,
        shortcut: tool.shortcut,
        label: t(SHORTCUT_LABELS[name][0], SHORTCUT_LABELS[name][1]),
      }));
    const editor = new EditorJS({
      holder: holderRef.current,
      data: initial || undefined,
      readOnly,
      minHeight: 0,
      placeholder: placeholder || t('editor.placeholder', 'Write something, or type / to choose a block'),
      autofocus: false,
      logLevel: 'ERROR',
      i18n: { ...editorI18n(t), direction },
      tools,
      onChange: () => scheduleSave(),

      onReady: () => {
        if (destroyed) return;
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
          notify: ({ type, message }) => toggleNotification({ type, message }),
          onInserted: markTouched,
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
        setReady(true);
      },
    });
    return () => {
      destroyed = true;
      cspGuard.destroy();
      clearTimeout(saveTimerRef.current);
      setReady(false);
      if (undoRef.current) undoRef.current.destroy();
      undoRef.current = null;
      if (dragDrop) dragDrop.destroy();
      if (paste) paste.destroy();
      if (shortcuts) shortcuts.destroy();
      if (mentionKeys) mentionKeys.destroy();
      editorRef.current = null;
      editor.isReady.then(() => editor.destroy()).catch(() => {});
    };
    // The editor is rebuilt only when its tools change; value updates are applied below.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- value/readOnly are handled by the effects below
  }, [toolsKey, adminLocale]);

  // Read-only switches (permission changes, collaboration role) without rebuilding.
  useEffect(() => {
    const editor = editorRef.current;
    if (!ready || !editor || !editor.readOnly) return;
    if (editor.readOnly.isEnabled !== readOnly) editor.readOnly.toggle(readOnly).catch(() => {});
  }, [readOnly, ready]);

  // Value changes from outside the editor (form reset after save/discard, locale switch).
  useEffect(() => {
    if (!ready || collaboration.active) return;
    const prepared = prepareEditorValue(value);
    const key = contentKey(prepared.data);
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
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener('keydown', onKey);
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
          {
            file: {
              url: asset.url,
              mime: asset.mime,
              width: asset.width,
              height: asset.height,
              size: asset.size,
              alt: asset.alternativeText || asset.name || '',
              formats: asset.formats || undefined,
              id: asset.id,
              documentId: asset.documentId,
            },
            caption: asset.caption || '',
            withBorder: false,
            withBackground: false,
            stretched: false,
          },
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
    }
  }, [mediaRequest]);

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
        range.deleteContents();
        range.insertNode(fragment);
        range.collapse(false);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        const editable = range.commonAncestorContainer.parentElement?.closest('[contenteditable="true"]');
        if (editable) editable.dispatchEvent(new Event('input', { bubbles: true }));
      } else if (editorRef.current) {
        const editor = editorRef.current;
        editor.blocks.insert('paragraph', { text: safe }, undefined, editor.blocks.getBlocksCount(), true);
      }
      scheduleSave();
    },
    [scheduleSave]
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
      }
      if (undoRef.current) undoRef.current.record();
    },
    [applyExternal]
  );

  // Field preset problems of the current content (saving fails while any remain).
  const violations = useMemo(
    () => (preset.restricted && currentData ? checkPreset(prepareEditorValue(currentData).data, preset) : []),
    [currentData, preset]
  );
  const quality = useQualityIssues(currentData, fieldOptions || undefined);
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
    if (block.holder) block.holder.scrollIntoView({ block: 'center' });
    try {
      editor.caret.setToBlock(blockId, 'start');
    } catch {
      // blocks without a caret position (images) are only scrolled into view
    }
  }, []);

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
    window.requestAnimationFrame(() => findButtonRef.current && findButtonRef.current.focus());
  }, []);
  /** Grammar check: writes one corrected string back into its block. */
  const applyGrammar = useCallback(
    async (blockId, path, html) => {
      const editor = editorRef.current;
      if (!editor || readOnly) return false;
      const saved = prepareEditorValue(await editor.save().catch(() => null)).data;
      const block = saved && saved.blocks.find((item) => item.id === blockId);
      if (!block || !editor.blocks.getById(blockId)) return false;
      const { data, changed } = applySegments({ blocks: [block] }, [{ blockId, path, html }]);
      if (!changed) return false;
      userTouchedRef.current = true;
      await editor.blocks.update(blockId, data.blocks[0].data);
      scheduleSave(0);
      return true;
    },
    [readOnly, scheduleSave]
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
    window.requestAnimationFrame(() => grammarButtonRef.current && grammarButtonRef.current.focus());
  }, []);
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
    window.requestAnimationFrame(() => qualityButtonRef.current && qualityButtonRef.current.focus());
  }, []);

  // Editor shortcuts: Ctrl/Cmd+Shift+F find and replace, Ctrl/Cmd+/ help.
  useEffect(() => {
    if (!ready) return undefined;
    const onKey = (event) => {
      const frame = frameRef.current;
      if (!frame || !frame.contains(document.activeElement)) return;
      const mod = event.metaKey || event.ctrlKey;
      if (!mod || event.altKey) return;
      if (event.shiftKey && (event.key === 'f' || event.key === 'F')) {
        event.preventDefault();
        event.stopPropagation();
        setFindOpen(true);
      } else if (!event.shiftKey && event.key === '/') {
        event.preventDefault();
        event.stopPropagation();
        setShortcutsOpen(true);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ready]);

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
    window.requestAnimationFrame(() => commentsButtonRef.current && commentsButtonRef.current.focus());
  }, []);

  /** Marker click: open the panel on the block's first open thread. */
  const openBlockComments = useCallback(
    (blockId) => {
      const thread = comments.threads.find((item) => item.blockId === blockId && item.status === 'open');
      setCommentFocusThread(thread ? thread.id : null);
      setCommentsOpen(true);
    },
    [comments.threads]
  );

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
    [preset, readOnly, replaceContent, selectBlock, t, toggleNotification]
  );

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
    window.requestAnimationFrame(() => templatesButtonRef.current && templatesButtonRef.current.focus());
  }, []);

  /** Preview on: focus the rendered region. Off: back to the editor (shortcut) or the toggle (button). */
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
        if (previewButtonRef.current) previewButtonRef.current.focus();
      });
    },
    [previewOpen]
  );

  // Ctrl/Cmd+Alt+P toggles the preview while focus is in the field (key code: Alt changes the character on macOS).
  useEffect(() => {
    if (!ready) return undefined;
    const onKey = (event) => {
      const frame = frameRef.current;
      if (!frame || !frame.contains(document.activeElement)) return;
      if (!(event.metaKey || event.ctrlKey) || !event.altKey || event.shiftKey || event.code !== 'KeyP')
        return;
      event.preventDefault();
      event.stopPropagation();
      togglePreview(true);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [ready, togglePreview]);

  const fieldHint = valueError
    ? t('editor.value.invalid', 'The stored content could not be read. It is kept until you edit this field.')
    : hint;

  return (
    <Field.Root name={name} id={name} error={error} hint={fieldHint} required={required}>
      <EditorStyles />
      <Flex direction="column" alignItems="stretch" gap={1}>
        <Field.Label action={labelAction}>{label}</Field.Label>
        <Frame
          ref={frameRef}
          $error={Boolean(error)}
          $fullscreen={fullscreen}
          role={fullscreen ? 'dialog' : undefined}
          aria-modal={fullscreen ? true : undefined}
          aria-label={fullscreen ? label : undefined}
        >
          <EditorToolbar
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
            historyAvailable={Boolean(target.uid && target.documentId)}
            onOpenHistory={() => setHistoryOpen(true)}
            historyButtonRef={historyButtonRef}
            collaboration={collaboration}
            stats={stats}
            limits={{ maxBlocks: preset.maxBlocks, maxCharacters: preset.maxCharacters }}
            findOpen={findOpen}
            onToggleFind={() => (findOpen ? closeFind() : setFindOpen(true))}
            findButtonRef={findButtonRef}
            qualityOpen={qualityOpen}
            onToggleQuality={() => (qualityOpen ? closeQuality() : setQualityOpen(true))}
            qualityCount={qualityCount}
            qualityButtonRef={qualityButtonRef}
            focusMode={focusMode}
            onToggleFocus={() =>
              setFocusMode((value) => {
                if (!value) setFullscreen(true);
                return !value;
              })
            }
            onOpenShortcuts={() => setShortcutsOpen(true)}
            commentsAvailable={commentsEnabled}
            commentsOpen={commentsOpen}
            onToggleComments={() => (commentsOpen ? closeComments() : setCommentsOpen(true))}
            commentsCount={comments.counts.open}
            commentsButtonRef={commentsButtonRef}
            grammarOpen={grammarOpen}
            onToggleGrammar={
              grammarAllowed ? () => (grammarOpen ? closeGrammar() : setGrammarOpen(true)) : undefined
            }
            grammarButtonRef={grammarButtonRef}
            onOpenFieldAi={fieldAiAllowed ? () => setFieldAiOpen(true) : undefined}
            moreButtonRef={moreButtonRef}
            onOpenTemplates={target.uid ? () => setTemplatesOpen(true) : undefined}
            templatesButtonRef={templatesButtonRef}
            previewOpen={previewOpen}
            onTogglePreview={() => togglePreview(false)}
            previewButtonRef={previewButtonRef}
            previewId={`${name}-mex-preview`}
          />
          {grammarOpen && grammarAllowed && ready ? (
            <PanelSlot padding={2} $fullscreen={fullscreen}>
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
          {findOpen && ready ? (
            <PanelSlot padding={2} $fullscreen={fullscreen}>
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
          {qualityOpen && ready ? (
            <PanelSlot padding={2} $fullscreen={fullscreen}>
              <QualityPanel
                t={t}
                data={currentData}
                options={fieldOptions || undefined}
                fetchClient={qualityFetch}
                externalEnabled={Boolean(config && config.quality && config.quality.externalLinks)}
                scheduledEnabled={Boolean(config && config.quality && config.quality.scheduledLinks)}
                target={target}
                onSelectBlock={selectBlock}
                onClose={closeQuality}
                violations={violations}
                onFixViolations={readOnly ? null : fixViolations}
              />
            </PanelSlot>
          ) : null}
          {commentsOpen && commentsEnabled && ready ? (
            <PanelSlot padding={2} $fullscreen={fullscreen}>
              <CommentsPanel
                t={t}
                comments={comments}
                blocks={commentBlocks}
                currentBlockId={currentBlockId}
                onSelectBlock={selectBlock}
                onClose={closeComments}
                focusThreadId={commentFocusThread}
                onFocusHandled={() => setCommentFocusThread(null)}
                fail={(message) => toggleNotification({ type: 'danger', message })}
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
              allowRaw={allowRawPreview}
              minHeight={minHeight}
              fullscreen={fullscreen}
              lang={target.locale || undefined}
              dir={direction}
            />
          ) : null}
          <EditorArea
            ref={areaRef}
            $fullscreen={fullscreen && !previewOpen}
            $concealed={previewOpen}
            aria-hidden={previewOpen ? true : undefined}
            inert={previewOpen ? '' : undefined}
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
            />
            <Holder
              ref={holderRef}
              className="mex-editor"
              lang={target.locale || undefined}
              dir={direction}
              $minHeight={minHeight}
              $fullscreen={fullscreen}
              $focus={focusMode}
              $gutter={commentsEnabled}
              data-testid="magic-editor-x"
              aria-busy={!ready}
              aria-describedby={`${name}-mex-keyboard`}
            />
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
          target={target}
          readContent={readContent}
          onRestore={restoreSnapshot}
          onRestoreBlock={readOnly ? undefined : restoreBlock}
          onClose={() => {
            setHistoryOpen(false);
            window.requestAnimationFrame(() => historyButtonRef.current && historyButtonRef.current.focus());
          }}
          canEdit={!readOnly}
        />
      ) : null}
      {aiRequest ? (
        <AiDialog
          t={t}
          request={aiRequest}
          config={config && config.ai}
          target={{ uid: target.uid, field: target.field }}
          onApply={(html) => {
            applyAi(html, aiRequest);
            setAiRequest(null);
          }}
          onClose={() => setAiRequest(null)}
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
          returnFocus={() => moreButtonRef.current && moreButtonRef.current.focus()}
        />
      ) : null}
      {shortcutsOpen ? (
        <ShortcutsDialog
          t={t}
          tools={toolShortcuts}
          hasBlock={(type) => isBlockAllowed(preset, type)}
          onClose={() => setShortcutsOpen(false)}
        />
      ) : null}
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
  return <EditorFieldBody {...props} target={target} />;
};

export { EditorField, EditorFieldBody };
export default EditorField;
