import { useCallback, useEffect, useRef, useState } from 'react';
import { useIntl } from 'react-intl';
import EditorJS from '@editorjs/editorjs';
import { Box, Button, Field, Flex, Loader, Typography } from '@strapi/design-system';
import { useFetchClient, useNotification, useStrapiApp } from '@strapi/strapi/admin';
import styled, { createGlobalStyle } from 'styled-components';
import { buildTools, editorI18n, createUndoManager, createDragDrop } from '../../editor/tools';
import { editorStyles } from '../../editor/tools/styles';
import { prepareEditorValue, sanitizeInline } from '../../editor/sanitize';
import { applyToEditor, rememberBlocks } from '../../editor/apply-remote';
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

const Holder = styled.div`
  min-width: 0;
  padding: ${({ theme }) => `${theme.spaces[4]} ${theme.spaces[3]}`};
  ${({ theme }) => theme.breakpoints.medium} {
    padding: ${({ theme }) => theme.spaces[4]};
  }
  min-height: ${({ $minHeight }) => `${$minHeight}px`};
  ${({ $fullscreen }) => ($fullscreen ? 'flex: 1 1 auto; overflow: auto;' : '')}
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

const EditorField = ({
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
  const target = useFieldTarget(name);

  const t = useCallback(
    (id, defaultMessage, values) => formatMessage({ id: getTranslation(id), defaultMessage }, values),
    [formatMessage]
  );

  const holderRef = useRef(null);
  const editorRef = useRef(null);
  const undoRef = useRef(null);
  const knownRef = useRef(new Map());
  const lastEmittedRef = useRef(null);
  const applyingRef = useRef(false);
  const saveTimerRef = useRef(null);
  const collabRef = useRef(null);
  const pendingLocalRef = useRef(false);
  const syncedOnceRef = useRef(false);
  const onChangeRef = useRef(onChange);
  const [ready, setReady] = useState(false);
  const [stats, setStats] = useState({ blocks: 0, words: 0, characters: 0 });
  const [fullscreen, setFullscreen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [aiRequest, setAiRequest] = useState(null);
  const [mediaRequest, setMediaRequest] = useState(null);
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
  const [valueError, setValueError] = useState(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  const minHeight = minHeightOf(attribute && attribute.options && attribute.options.minHeight);
  const placeholder = (attribute && attribute.options && attribute.options.placeholder) || '';
  const permissions = (config && config.permissions) || {};
  const collaborationTarget =
    config && config.collaboration.enabled && permissions.collaborate && target.uid && target.documentId
      ? target
      : null;

  /** Emits editor content to the Content Manager form when it changed. */
  const emit = useCallback(
    (data) => {
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
      if (key === lastEmittedRef.current) return;
      lastEmittedRef.current = key;
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
    holder.addEventListener('focusout', onFocusOut);
    holder.addEventListener('input', onInput);
    return () => {
      holder.removeEventListener('focusout', onFocusOut);
      holder.removeEventListener('input', onInput);
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
        if (emitToForm) emit(data);
        else lastEmittedRef.current = contentKey(data && data.blocks && data.blocks.length ? data : null);
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
      if (!client) return;
      await flushLocal(client);
      const shared = client.getData();
      // The first room state only shows what is stored (normalised); it must
      // not mark the form as changed. Later remote edits do.
      const first = !syncedOnceRef.current;
      syncedOnceRef.current = true;
      await applyExternal(shared, { emitToForm: !first });
      client.markShown(shared);
    },
  });
  useEffect(() => {
    collabRef.current = collaboration.client;
  }, [collaboration.client]);

  const readOnly = Boolean(disabled) || (collaboration.status === 'live' && !collaboration.canEdit);

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
  const onAiRequest = useCallback((request) => setAiRequest(request), []);

  // Create the editor once the configuration is known; recreate it only when
  // the tool set changes (configuration, custom blocks, permissions).
  const toolsKey = config
    ? stableStringify({
        p: config.permissions,
        ai: config.ai.enabled,
        blocks: customBlocks.map((block) => block.id + block.updatedAt),
      })
    : null;
  useEffect(() => {
    if (!config || !holderRef.current) return undefined;
    const prepared = prepareEditorValue(value);
    setValueError(prepared.error);
    const initial = prepared.data;
    lastEmittedRef.current = contentKey(initial);
    rememberBlocks(knownRef.current, initial || { blocks: [] });
    setStats(computeStats(initial));
    let destroyed = false;
    let dragDrop = null;
    const editor = new EditorJS({
      holder: holderRef.current,
      data: initial || undefined,
      readOnly,
      minHeight: 0,
      placeholder: placeholder || t('editor.placeholder', 'Write something, or press Tab to choose a block'),
      autofocus: false,
      logLevel: 'ERROR',
      i18n: editorI18n(t),
      tools: buildTools({
        t,
        fetchClient: { get, post },
        uploadImage: (file) => upload(API.imageByFile, 'image', file),
        uploadImageByUrl,
        uploadFile: (file) => upload(API.fileUpload, 'file', file),
        openMediaLibrary,
        onAiRequest,
        aiEnabled: Boolean(config.ai.enabled && permissions.ai),
        canUpload: Boolean(permissions.upload),
        linkPreview: config.linkPreview,
        customBlocks,
        placeholder,
        attachmentTypes: config.uploads.attachmentTypes,
      }),
      onChange: () => scheduleSave(),

      onReady: () => {
        if (destroyed) return;
        editorRef.current = editor;
        undoRef.current = createUndoManager(editor, {
          holder: holderRef.current,
          onChange: (next) => setUndoState({ canUndo: next.canUndo, canRedo: next.canRedo }),
        });
        if (!readOnly) dragDrop = createDragDrop(editor, holderRef.current);
        setReady(true);
      },
    });
    return () => {
      destroyed = true;
      clearTimeout(saveTimerRef.current);
      setReady(false);
      if (undoRef.current) undoRef.current.destroy();
      undoRef.current = null;
      if (dragDrop) dragDrop.destroy();
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
      if (event.key === 'Escape' && !event.defaultPrevented) setFullscreen(false);
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
        collaboration.client.sendCursor(block ? { blockId: block.id, offset: selection.anchorOffset } : null);
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
      const images = (assets || []).filter(
        (asset) => typeof asset.mime === 'string' && asset.mime.startsWith('image/')
      );
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
      if (collabRef.current) collabRef.current.pushLocal(prepared.data);
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

  const fieldHint = valueError
    ? t('editor.value.invalid', 'The stored content could not be read. It is kept until you edit this field.')
    : hint;

  return (
    <Field.Root name={name} id={name} error={error} hint={fieldHint} required={required}>
      <EditorStyles />
      <Flex direction="column" alignItems="stretch" gap={1}>
        <Field.Label action={labelAction}>{label}</Field.Label>
        <Frame
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
            onToggleFullscreen={() => setFullscreen((value) => !value)}
            canUndo={undoState.canUndo}
            canRedo={undoState.canRedo}
            onUndo={() => undoRef.current && undoRef.current.undo()}
            onRedo={() => undoRef.current && undoRef.current.redo()}
            historyAvailable={Boolean(target.uid && target.documentId)}
            onOpenHistory={() => setHistoryOpen(true)}
            collaboration={collaboration}
            stats={stats}
          />
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
          <Holder
            ref={holderRef}
            className="mex-editor"
            $minHeight={minHeight}
            $fullscreen={fullscreen}
            data-testid="magic-editor-x"
            aria-busy={!ready}
          />
        </Frame>
        <Field.Hint />
        <Field.Error />
      </Flex>
      {historyOpen ? (
        <HistoryModal
          t={t}
          target={target}
          readContent={readContent}
          onRestore={restoreSnapshot}
          onClose={() => setHistoryOpen(false)}
          canEdit={!readOnly}
        />
      ) : null}
      {aiRequest ? (
        <AiDialog
          t={t}
          request={aiRequest}
          config={config && config.ai}
          onApply={(html) => {
            applyAi(html, aiRequest);
            setAiRequest(null);
          }}
          onClose={() => setAiRequest(null)}
        />
      ) : null}
      {mediaRequest && MediaLibraryDialog ? (
        // eslint-disable-next-line react-hooks/static-components -- the dialog is a stable component registered by the upload plugin, not created here
        <MediaLibraryDialog
          allowedTypes={['images']}
          multiple={mediaRequest.multiple !== false}
          onClose={closeMediaLibrary}
          onSelectAssets={onSelectAssets}
        />
      ) : null}
    </Field.Root>
  );
};

export { EditorField };
export default EditorField;
