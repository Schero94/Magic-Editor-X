import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Flex,
  IconButton,
  SingleSelect,
  SingleSelectOption,
  Typography,
  VisuallyHidden,
} from '@strapi/design-system';
import { ArrowDown, ArrowUp, Duplicate, Trash, Code, Layout, Sparkle } from '@strapi/icons';
import styled from 'styled-components';
import { renderMarkdown } from '../../../../shared/render/index.mjs';

/**
 * Actions for several selected blocks (Editor.js cross-block selection:
 * Shift+Arrow from a block edge, Cmd/Ctrl+A twice, or a mouse drag across
 * blocks): delete, move up/down, duplicate, convert, copy as Markdown.
 * Editor.js clears its selection on the next click, so the bar keeps the ids
 * it saw last for a short moment.
 */

const Bar = styled(Flex)`
  position: sticky;
  top: 0;
  z-index: 2;
  min-width: 0;
  border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  background: ${({ theme }) => theme.colors.primary100};
`;

const CONVERT_TARGETS = [
  ['paragraph', 'tools.names.text', 'Text'],
  ['header', 'tools.names.heading', 'Heading'],
  ['list', 'tools.names.unorderedList', 'Bulleted list'],
  ['quote', 'tools.names.quote', 'Quote'],
];

/**
 * Ids of the blocks Editor.js shows as selected.
 * @param {HTMLElement} holder - Editor holder.
 * @returns {string[]} Block ids in document order.
 */
const selectedIds = (holder) =>
  Array.from(holder.querySelectorAll('.ce-block--selected'))
    .map((node) => node.getAttribute('data-id'))
    .filter(Boolean);

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {{ current: HTMLElement|null }} props.holderRef - Editor holder.
 * @param {{ current: object|null }} props.editorRef - Editor.js instance.
 * @param {boolean} props.ready - Editor ready.
 * @param {boolean} props.readOnly - Read-only mode.
 * @param {(type: string) => boolean} props.canCreate - Whether a block type may be created (field preset).
 * @param {() => void} props.onChanged - Called after an action changed the content.
 * @param {(message: string) => void} props.notify - Success message.
 * @param {(ids: string[]) => void} [props.onSaveSelection] - "Save as pattern" for template managers (2.3).
 * @param {(ids: string[]) => void} [props.onAi] - Block AI actions (2.4); absent when AI is not allowed here.
 * @returns {JSX.Element|null} Bar.
 */
export const BlockSelectionBar = ({
  t,
  holderRef,
  editorRef,
  ready,
  readOnly,
  canCreate,
  onChanged,
  notify,
  onSaveSelection,
  onAi,
}) => {
  const [ids, setIds] = useState([]);
  const actingRef = useRef(false);
  const hideTimer = useRef(null);
  const barRef = useRef(null);
  // Keyboard users reach the bar with Escape, then Shift+Tab (Escape clears the
  // Editor.js selection); the bar stays while focus is inside it (2.4).
  const hideLater = useCallback(() => {
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (!(barRef.current && barRef.current.contains(document.activeElement))) setIds([]);
    }, 400);
  }, []);

  useEffect(() => {
    const holder = holderRef.current;
    if (!holder || !ready) return undefined;
    const update = () => {
      const next = selectedIds(holder);
      clearTimeout(hideTimer.current);
      if (next.length >= 2) setIds(next);
      else if (!actingRef.current) hideLater();
    };
    const observer = new MutationObserver(update);
    observer.observe(holder, { subtree: true, attributes: true, attributeFilter: ['class'] });
    return () => {
      observer.disconnect();
      clearTimeout(hideTimer.current);
    };
  }, [holderRef, ready, hideLater]);

  // Editor.js handles Tab on `document` (capture) while a block is current and moves the caret
  // back into the editor; Tab inside the bar must move focus between its controls instead.
  const visible = !readOnly && ids.length >= 2;
  useEffect(() => {
    if (!visible) return undefined;
    const onKey = (event) => {
      if (event.key === 'Tab' && barRef.current && barRef.current.contains(event.target))
        event.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [visible]);

  if (!visible) return null;

  const indices = () => {
    const editor = editorRef.current;
    if (!editor) return [];
    return ids
      .map((id) => editor.blocks.getBlockIndex(id))
      .filter((index) => Number.isInteger(index) && index >= 0)
      .sort((a, b) => a - b);
  };

  const run = async (action) => {
    const editor = editorRef.current;
    if (!editor) return;
    actingRef.current = true;
    try {
      await action(editor, indices());
      onChanged();
    } finally {
      actingRef.current = false;
      setIds([]);
    }
  };

  const remove = () =>
    run((editor, list) => {
      [...list].reverse().forEach((index) => editor.blocks.delete(index));
      notify(
        t('editor.selection.deleted', '{count, plural, one {# block deleted} other {# blocks deleted}}', {
          count: list.length,
        })
      );
    });

  const move = (direction) =>
    run((editor, list) => {
      if (!list.length) return;
      const first = list[0];
      const last = list[list.length - 1];
      if (direction < 0 && first > 0) editor.blocks.move(last, first - 1);
      if (direction > 0 && last < editor.blocks.getBlocksCount() - 1) editor.blocks.move(first, last + 1);
    });

  const duplicate = () =>
    run(async (editor, list) => {
      const saved = await editor.save();
      const byId = new Map(saved.blocks.map((block) => [block.id, block]));
      const blocks = ids.map((id) => byId.get(id)).filter(Boolean);
      let at = list[list.length - 1] + 1;
      for (const block of blocks) {
        editor.blocks.insert(block.type, block.data, undefined, at, false);
        at += 1;
      }
      notify(
        t(
          'editor.selection.duplicated',
          '{count, plural, one {# block duplicated} other {# blocks duplicated}}',
          { count: blocks.length }
        )
      );
    });

  const convert = (type) =>
    run(async (editor) => {
      let done = 0;
      for (const id of ids) {
        const block = editor.blocks.getById(id);
        if (!block || block.name === type) continue;
        try {
          await editor.blocks.convert(id, type);
          done += 1;
        } catch {
          // blocks without a text form (images, tables) cannot be converted
        }
      }
      notify(
        t(
          'editor.selection.converted',
          '{count, plural, one {# block converted} other {# blocks converted}}',
          { count: done }
        )
      );
    });

  const copyMarkdown = () =>
    run(async (editor) => {
      const saved = await editor.save();
      const set = new Set(ids);
      const markdown = renderMarkdown({
        ...saved,
        blocks: saved.blocks.filter((block) => set.has(block.id)),
      });
      await navigator.clipboard.writeText(markdown);
      notify(t('editor.selection.copied', 'Copied as Markdown'));
    });

  // Pointer down on the bar must not let Editor.js drop the selection first.
  const keep = () => {
    actingRef.current = true;
    clearTimeout(hideTimer.current);
  };

  return (
    <Bar
      ref={barRef}
      role="toolbar"
      aria-label={t('editor.selection.label', 'Selected blocks')}
      gap={2}
      wrap="wrap"
      paddingTop={2}
      paddingBottom={2}
      paddingLeft={3}
      paddingRight={3}
      onPointerDownCapture={keep}
      onPointerUp={() => {
        actingRef.current = false;
      }}
      onBlur={(event) => {
        if (!barRef.current || !barRef.current.contains(event.relatedTarget)) {
          if (holderRef.current && selectedIds(holderRef.current).length < 2) hideLater();
        }
      }}
    >
      <Typography variant="pi" fontWeight="bold" textColor="primary700">
        {t('editor.selection.count', '{count, plural, one {# block selected} other {# blocks selected}}', {
          count: ids.length,
        })}
      </Typography>
      <IconButton label={t('editor.selection.moveUp', 'Move up')} variant="ghost" onClick={() => move(-1)}>
        <ArrowUp />
      </IconButton>
      <IconButton label={t('editor.selection.moveDown', 'Move down')} variant="ghost" onClick={() => move(1)}>
        <ArrowDown />
      </IconButton>
      <IconButton label={t('editor.selection.duplicate', 'Duplicate')} variant="ghost" onClick={duplicate}>
        <Duplicate />
      </IconButton>
      <IconButton
        label={t('editor.selection.copyMarkdown', 'Copy as Markdown')}
        variant="ghost"
        onClick={copyMarkdown}
      >
        <Code />
      </IconButton>
      {onAi ? (
        <IconButton
          label={t('editor.aiBlocks.open', 'AI for the chosen blocks')}
          variant="ghost"
          onClick={() => {
            const selection = [...ids];
            actingRef.current = false;
            setIds([]);
            onAi(selection);
          }}
          data-testid="mex-selection-ai"
        >
          <Sparkle />
        </IconButton>
      ) : null}
      {onSaveSelection ? (
        <IconButton
          label={t('editor.selection.saveTemplate', 'Save as pattern')}
          variant="ghost"
          onClick={() => {
            const selection = [...ids];
            actingRef.current = false;
            setIds([]);
            onSaveSelection(selection);
          }}
          data-testid="mex-selection-save-template"
        >
          <Layout />
        </IconButton>
      ) : null}
      <IconButton label={t('editor.selection.delete', 'Delete')} variant="ghost" onClick={remove}>
        <Trash />
      </IconButton>
      <SingleSelect
        size="S"
        aria-label={t('editor.selection.convert', 'Convert to')}
        placeholder={t('editor.selection.convert', 'Convert to')}
        value={null}
        onChange={(type) => type && convert(String(type))}
      >
        {CONVERT_TARGETS.filter(([type]) => canCreate(type)).map(([type, key, text]) => (
          <SingleSelectOption key={type} value={type}>
            {t(key, text)}
          </SingleSelectOption>
        ))}
      </SingleSelect>
      <VisuallyHidden aria-live="polite">
        {t('editor.selection.count', '{count, plural, one {# block selected} other {# blocks selected}}', {
          count: ids.length,
        })}
      </VisuallyHidden>
    </Bar>
  );
};

export default BlockSelectionBar;
