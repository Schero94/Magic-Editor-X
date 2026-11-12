import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import EditorJS from '@editorjs/editorjs';
import {
  Badge,
  Box,
  Button,
  Field,
  Flex,
  IconButton,
  Modal,
  Textarea,
  Typography,
} from '@strapi/design-system';
import { ArrowClockwise, ArrowsCounterClockwise } from '@strapi/icons';
import styled from 'styled-components';
import { buildTools, editorI18n, createUndoManager, INLINE_TOOLS } from '../../editor/tools';
import { prepareEditorValue } from '../../editor/sanitize';
import { createPasteHandler } from '../../editor/paste';
import { createMarkdownShortcuts } from '../../editor/markdown-shortcuts';
import { ConfirmAction } from '../ui/ConfirmAction';
import { markInputReady } from '../../editor/input-tracking.mjs';
import { checkPreset, isBlockAllowed } from '../../../../shared/presets.mjs';
import { MAX_SUGGESTION_NOTE_LENGTH, suggestionsFromDiff } from '../../../../shared/suggestions.mjs';

/**
 * Suggest mode (2.4): a separate, local Editor.js instance on a copy of the
 * field's content.
 *
 * Why a second instance: the field's own editor is wired to the Content
 * Manager form (emit), the live room (pushLocal), its undo history and every
 * write path (paste, Markdown shortcuts, AI, templates, find and replace,
 * footnotes, the table tool, drag and drop). Instead of guarding each of them,
 * suggest mode never touches that editor: it is set read-only and hidden, keeps
 * receiving live changes, and this instance has no form, room or server
 * connection at all. Its edits live in this component until "Send
 * suggestions" turns the difference to the base (`suggestionsFromDiff`) into
 * one suggestion per changed, inserted or deleted block.
 *
 * The local instance has no AI, no Media Library and no uploads (a suggestion
 * must not create assets before anyone reviewed it), and no footnote dialog;
 * all other tools and the field preset are the same, so suggestions fit the field.
 */

const Bar = styled(Flex)`
  min-width: 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  background: ${({ theme }) => theme.colors.primary100};
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

const Area = styled.div`
  position: relative;
  min-width: 0;
  ${({ $fullscreen }) => ($fullscreen ? 'flex: 1 1 auto; display: flex; flex-direction: column; min-height: 0;' : '')}
`;

const PLAN_DEBOUNCE_MS = 250;

/**
 * Counts of a plan per operation.
 * @param {Array<{ op: string }>} suggestions - Planned suggestions.
 * @returns {{ changed: number, added: number, removed: number }} Counts.
 */
export const planCounts = (suggestions) => ({
  changed: suggestions.filter((item) => item.op === 'update').length,
  added: suggestions.filter((item) => item.op === 'insert').length,
  removed: suggestions.filter((item) => item.op === 'delete').length,
});

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {object} props.base - Content when suggest mode started (normalised with prepareEditorValue).
 * @param {object} props.toolOptions - Options for `buildTools` (translator, locale, fetch client, custom blocks, ...).
 * @param {object} props.preset - Resolved field preset.
 * @param {'ltr'|'rtl'} props.direction - Text direction.
 * @param {string|undefined} props.lang - Content locale.
 * @param {number} props.minHeight - Minimum height in px.
 * @param {string} props.placeholder - Placeholder.
 * @param {boolean} props.fullscreen - Full screen layout.
 * @param {boolean} props.canUpload - Kept for the paste handler (always false here).
 * @param {(suggestions: object[], note: string|null) => Promise<boolean>} props.onSend - Sends; true when stored.
 * @param {() => void} props.onExit - Leaves suggest mode.
 * @param {(pending: number) => void} [props.onPendingChange] - Number of unsent changes.
 * @returns {JSX.Element} Suggest mode editor.
 */
export const SuggestEditor = ({
  t,
  base,
  toolOptions,
  preset,
  direction,
  lang,
  minHeight,
  placeholder,
  fullscreen,
  onSend,
  onExit,
  onPendingChange,
}) => {
  const holderRef = useRef(null);
  const editorRef = useRef(null);
  const undoRef = useRef(null);
  const timerRef = useRef(null);
  const sendButtonRef = useRef(null);
  const [ready, setReady] = useState(false);
  const [plan, setPlan] = useState({ suggestions: [], moved: 0, violations: [] });
  const [undoState, setUndoState] = useState({ canUndo: false, canRedo: false });
  const [sendOpen, setSendOpen] = useState(false);
  const [note, setNote] = useState('');
  const [sending, setSending] = useState(false);

  const recompute = useCallback(
    (delay = PLAN_DEBOUNCE_MS) => {
      clearTimeout(timerRef.current);
      timerRef.current = setTimeout(async () => {
        const editor = editorRef.current;
        if (!editor) return;
        const saved = await editor.save().catch(() => null);
        if (!saved) return;
        const edited = prepareEditorValue(saved).data || { blocks: [] };
        const next = suggestionsFromDiff(base || { blocks: [] }, edited);
        const planned = new Set(next.suggestions.map((item) => item.blockId));
        const violations = preset.restricted
          ? checkPreset(edited, preset).filter(
              (violation) => violation.blockId && planned.has(violation.blockId)
            )
          : [];
        setPlan({ ...next, violations });
        if (undoRef.current) undoRef.current.record();
      }, delay);
    },
    [base, preset]
  );

  useEffect(() => {
    if (onPendingChange) onPendingChange(plan.suggestions.length);
  }, [plan.suggestions.length, onPendingChange]);

  // One local Editor.js instance for the whole suggest session.
  useEffect(() => {
    if (!holderRef.current) return undefined;
    let destroyed = false;
    let paste = null;
    let shortcuts = null;
    // No footnote dialog here: the inline footnote tool is left out.
    const localPreset = {
      ...preset,
      inline: (preset.inline || INLINE_TOOLS).filter((name) => name !== 'footnote'),
    };
    const tools = buildTools({
      ...toolOptions,
      aiEnabled: false,
      onAiRequest: undefined,
      onBlockAi: undefined,
      suggestAltText: undefined,
      openMediaLibrary: undefined,
      canUpload: false,
      canBrowse: false,
      onFootnoteEdit: undefined,
      preset: localPreset,
    });
    const toolNames = new Set(Object.keys(tools));
    const editor = new EditorJS({
      holder: holderRef.current,
      data: base && base.blocks.length ? base : undefined,
      readOnly: false,
      minHeight: 0,
      placeholder,
      autofocus: false,
      logLevel: 'ERROR',
      i18n: { ...editorI18n(t), direction },
      tools,
      onChange: () => recompute(),
      onReady: () => {
        if (destroyed) return;
        editorRef.current = editor;
        undoRef.current = createUndoManager(editor, {
          holder: holderRef.current,
          onChange: (next) => setUndoState({ canUndo: next.canUndo, canRedo: next.canRedo }),
        });
        undoRef.current.record();
        paste = createPasteHandler({
          holder: holderRef.current,
          editor,
          t,
          isAllowed: (type) => isBlockAllowed(preset, type),
          allowedHeadingLevels: localPreset.headingLevels,
          canUpload: false,
          uploadImageByUrl: async () => ({ success: 0 }),
          uploadImageFile: async () => ({ success: 0 }),
          uploadMediaByUrl: async () => ({ success: 0 }),
          notify: () => {},
          onInserted: () => recompute(40),
          hasTool: (name) => toolNames.has(name),
        });
        shortcuts = createMarkdownShortcuts({
          holder: holderRef.current,
          editor,
          getPreset: () => (preset.restricted ? localPreset : null),
          hasTool: (name) => toolNames.has(name) || name === 'bold' || name === 'italic',
          onConverted: () => recompute(40),
        });
        setReady(true);
        // Focus the copy so the user can start right away, unless they already clicked into it
        // while Editor.js was starting (moving the caret then breaks the "/" toolbox of the new block).
        if (!holderRef.current.contains(document.activeElement)) {
          try {
            editor.focus();
          } catch {
            // empty editors without a block cannot take the caret
          }
        }
      },
    });
    return () => {
      destroyed = true;
      clearTimeout(timerRef.current);
      if (undoRef.current) undoRef.current.destroy();
      undoRef.current = null;
      if (paste) paste.destroy();
      if (shortcuts) shortcuts.destroy();
      editorRef.current = null;
      editor.isReady.then(() => editor.destroy()).catch(() => {});
    };
    // The local editor is created once per suggest session.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- base and tools are fixed for the session
  }, []);

  // Typing updates the plan right away; Editor.js reports some changes late.
  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !ready) return undefined;
    const onInput = () => recompute(120);
    holder.addEventListener('input', onInput);
    holder.addEventListener('click', onInput);
    // Escape, then Tab leaves the editor (Editor.js uses Tab for its block menu).
    let leaveArmed = false;
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
        const next = event.shiftKey
          ? candidates
              .filter((element) => holder.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING)
              .pop()
          : candidates.find(
              (element) => holder.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING
            );
        if (next) next.focus();
        return;
      }
      if (!['Shift', 'Control', 'Alt', 'Meta'].includes(event.key)) leaveArmed = false;
    };
    window.addEventListener('keydown', onKeyDown, true);
    // Readiness signal for people and tests (same attribute as the field editor).
    const clearReady = markInputReady(holder);
    return () => {
      clearReady();
      holder.removeEventListener('input', onInput);
      holder.removeEventListener('click', onInput);
      window.removeEventListener('keydown', onKeyDown, true);
    };
  }, [ready, recompute]);

  // Unsent suggestions are lost when the page is closed: the browser asks first.
  const pending = plan.suggestions.length;
  useEffect(() => {
    if (!pending) return undefined;
    const onBeforeUnload = (event) => {
      event.preventDefault();
      // Older browsers need a return value to show the prompt.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [pending]);

  const counts = useMemo(() => planCounts(plan.suggestions), [plan.suggestions]);

  const send = async () => {
    if (!pending || sending) return;
    setSending(true);
    try {
      // The latest content, not the debounced plan.
      clearTimeout(timerRef.current);
      const saved = editorRef.current ? await editorRef.current.save().catch(() => null) : null;
      const edited = prepareEditorValue(saved).data || { blocks: [] };
      const { suggestions } = suggestionsFromDiff(base || { blocks: [] }, edited);
      const stored = suggestions.length ? await onSend(suggestions, note.trim() || null) : false;
      if (stored) setSendOpen(false);
    } finally {
      setSending(false);
    }
  };

  const blocked = plan.violations.length > 0;

  return (
    <>
      <Bar
        gap={2}
        paddingTop={2}
        paddingBottom={2}
        paddingLeft={3}
        paddingRight={3}
        justifyContent="space-between"
        wrap="wrap"
        data-testid="mex-suggest-bar"
      >
        <Flex gap={2} wrap="wrap" alignItems="center" minWidth={0}>
          <Badge backgroundColor="primary600" textColor="neutral0">
            {t('editor.suggest.badge', 'Suggesting')}
          </Badge>
          <Typography variant="pi" textColor="neutral800">
            {t(
              'editor.suggest.help',
              'Your edits are not saved to the entry. Send them as suggestions for review.'
            )}
          </Typography>
        </Flex>
        <Flex gap={1} wrap="wrap" alignItems="center">
          <IconButton
            label={t('editor.toolbar.undo', 'Undo')}
            variant="ghost"
            onClick={() => undoRef.current && undoRef.current.undo()}
            disabled={!ready || !undoState.canUndo}
          >
            <ArrowsCounterClockwise />
          </IconButton>
          <IconButton
            label={t('editor.toolbar.redo', 'Redo')}
            variant="ghost"
            onClick={() => undoRef.current && undoRef.current.redo()}
            disabled={!ready || !undoState.canRedo}
          >
            <ArrowClockwise />
          </IconButton>
          {pending ? (
            <ConfirmAction
              trigger={
                <Button variant="tertiary" size="S" data-testid="mex-suggest-exit">
                  {t('editor.suggest.exit', 'Stop suggesting')}
                </Button>
              }
              title={t('editor.suggest.discard.title', 'Discard your unsent changes?')}
              body={t(
                'editor.suggest.discard.body',
                '{count, plural, one {# change is} other {# changes are}} not sent yet and will be lost.',
                { count: pending }
              )}
              confirmLabel={t('editor.suggest.discard.confirm', 'Discard changes')}
              onConfirm={onExit}
            />
          ) : (
            <Button variant="tertiary" size="S" onClick={onExit} data-testid="mex-suggest-exit">
              {t('editor.suggest.exit', 'Stop suggesting')}
            </Button>
          )}
          <Button
            ref={sendButtonRef}
            size="S"
            onClick={() => {
              // An open Editor.js toolbar keeps a document Tab handler (Flipper) that would take the
              // first Tab presses inside the dialog.
              const editor = editorRef.current;
              if (editor && editor.toolbar && typeof editor.toolbar.close === 'function')
                editor.toolbar.close();
              if (editor && editor.inlineToolbar && typeof editor.inlineToolbar.close === 'function')
                editor.inlineToolbar.close();
              setSendOpen(true);
            }}
            disabled={!ready || !pending || blocked}
            data-testid="mex-suggest-send"
          >
            {pending
              ? t(
                  'editor.suggest.sendCount',
                  'Send {count, plural, one {# suggestion} other {# suggestions}}',
                  {
                    count: pending,
                  }
                )
              : t('editor.suggest.send', 'Send suggestions')}
          </Button>
        </Flex>
        {blocked ? (
          <Box width="100%">
            <Typography variant="pi" textColor="danger600" role="status">
              {t(
                'editor.suggest.violations',
                'Some changed blocks do not match the settings of this field. Fix them before sending.'
              )}
            </Typography>
          </Box>
        ) : null}
      </Bar>
      <Area $fullscreen={fullscreen}>
        <Holder
          ref={holderRef}
          className="mex-editor"
          lang={lang}
          dir={direction}
          $minHeight={minHeight}
          $fullscreen={fullscreen}
          data-testid="mex-suggest-editor"
          aria-busy={!ready}
          aria-label={t('editor.suggest.region', 'Suggested version of this field')}
          role="region"
        />
      </Area>
      {sendOpen ? (
        <Modal.Root
          open
          onOpenChange={(next) => {
            if (!next && !sending) {
              setSendOpen(false);
              window.requestAnimationFrame(() => sendButtonRef.current && sendButtonRef.current.focus());
            }
          }}
        >
          <Modal.Content>
            <Modal.Header closeLabel={t('editor.suggest.dialog.close', 'Close')}>
              <Modal.Title>{t('editor.suggest.dialog.title', 'Send suggestions')}</Modal.Title>
            </Modal.Header>
            <Modal.Body>
              <Flex direction="column" alignItems="stretch" gap={4}>
                <Typography variant="omega" textColor="neutral800" data-testid="mex-suggest-summary">
                  {t(
                    'editor.suggest.dialog.summary',
                    '{changed, plural, one {# changed block} other {# changed blocks}} · {added, plural, one {# new block} other {# new blocks}} · {removed, plural, one {# removed block} other {# removed blocks}}',
                    counts
                  )}
                </Typography>
                <Typography variant="pi" textColor="neutral600">
                  {t(
                    'editor.suggest.dialog.help',
                    'Each block becomes one suggestion. People who review this entry accept or reject them; until then the entry does not change.'
                  )}
                </Typography>
                {plan.moved ? (
                  <Typography variant="pi" textColor="neutral600">
                    {t(
                      'editor.suggest.dialog.moved',
                      'Moving blocks is not part of a suggestion: {count, plural, one {# moved block keeps its place} other {# moved blocks keep their place}}.',
                      { count: plan.moved }
                    )}
                  </Typography>
                ) : null}
                <Field.Root
                  name="mex-suggest-note"
                  hint={t('editor.suggest.dialog.noteHint', 'Plain text, up to {max} characters.', {
                    max: MAX_SUGGESTION_NOTE_LENGTH,
                  })}
                >
                  <Field.Label>
                    {t('editor.suggest.dialog.note', 'Note for the reviewers (optional)')}
                  </Field.Label>
                  <Textarea
                    value={note}
                    maxLength={MAX_SUGGESTION_NOTE_LENGTH}
                    onChange={(event) => setNote(event.target.value)}
                  />
                  <Field.Hint />
                </Field.Root>
              </Flex>
            </Modal.Body>
            <Modal.Footer>
              <Modal.Close>
                <Button variant="tertiary" disabled={sending}>
                  {t('editor.suggest.dialog.cancel', 'Keep editing')}
                </Button>
              </Modal.Close>
              <Button onClick={send} loading={sending} disabled={sending} data-testid="mex-suggest-confirm">
                {t(
                  'editor.suggest.sendCount',
                  'Send {count, plural, one {# suggestion} other {# suggestions}}',
                  {
                    count: pending,
                  }
                )}
              </Button>
            </Modal.Footer>
          </Modal.Content>
        </Modal.Root>
      ) : null}
    </>
  );
};

export default SuggestEditor;
