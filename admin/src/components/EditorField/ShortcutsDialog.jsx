import { Box, Button, Flex, Modal, Typography } from '@strapi/design-system';
import styled from 'styled-components';

/**
 * Keyboard shortcut help (Ctrl/Cmd + /). Lists the editor's own shortcuts,
 * the block and inline tool shortcuts and the Markdown shortcuts.
 */

const Keys = styled.kbd`
  display: inline-block;
  font-family: ${({ theme }) => theme.fonts?.code || 'monospace'};
  font-size: ${({ theme }) => theme.fontSizes[1]};
  color: ${({ theme }) => theme.colors.neutral800};
  background: ${({ theme }) => theme.colors.neutral100};
  border: 1px solid ${({ theme }) => theme.colors.neutral200};
  border-radius: ${({ theme }) => theme.borderRadius};
  padding: 0 ${({ theme }) => theme.spaces[1]};
  white-space: nowrap;
`;

const Table = styled.table`
  width: 100%;
  border-collapse: collapse;
  th,
  td {
    text-align: start;
    vertical-align: top;
    padding: ${({ theme }) => theme.spaces[2]} ${({ theme }) => theme.spaces[2]};
    border-bottom: 1px solid ${({ theme }) => theme.colors.neutral150};
  }
  th {
    width: 45%;
    font-weight: normal;
  }
`;

/**
 * Platform modifier label.
 * @returns {string} "Cmd" on Apple platforms, otherwise "Ctrl".
 */
const modKey = () =>
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || '')
    ? 'Cmd'
    : 'Ctrl';

/**
 * Renders a key combination such as "CMD+SHIFT+H".
 * @param {{ combo: string }} props - Props.
 * @returns {JSX.Element} Keys.
 */
const Combo = ({ combo }) => (
  <Flex gap={1} wrap="wrap" tag="span">
    {combo.split('+').map((key, index) => (
      <Keys key={`${key}-${index}`}>{key === 'CMD' ? modKey() : key}</Keys>
    ))}
  </Flex>
);

/**
 * @param {object} props - Props.
 * @param {Function} props.t - Translator.
 * @param {Array<{ name: string, shortcut: string }>} props.tools - Tools with shortcuts (already filtered by the field preset).
 * @param {(name: string) => boolean} props.hasBlock - Whether a block type can be created (Markdown shortcuts shown accordingly).
 * @param {(name: string) => boolean} [props.hasInline] - Whether an inline tool is available (2.4: inline math, footnotes).
 * @param {() => void} props.onClose - Closes the dialog.
 * @returns {JSX.Element} Dialog.
 */
export const ShortcutsDialog = ({ t, tools, hasBlock, hasInline = () => true, onClose }) => {
  const editorKeys = [
    ['CMD+Z', t('editor.shortcuts.undo', 'Undo')],
    ['CMD+SHIFT+Z', t('editor.shortcuts.redo', 'Redo')],
    ['CMD+SHIFT+F', t('editor.shortcuts.find', 'Find and replace')],
    ['CMD+/', t('editor.shortcuts.help', 'Show keyboard shortcuts')],
    ['CMD+ALT+P', t('editor.shortcuts.preview', 'Show or hide the rendered preview')],
    ['Tab', t('editor.shortcuts.toolbox', 'Choose a block type (in an empty block)')],
    ['Escape+Tab', t('editor.shortcuts.leave', 'Leave the editor')],
    ['CMD+SHIFT+V', t('editor.shortcuts.plainPaste', 'Paste as plain text')],
    ...(hasInline('inlineMath')
      ? [['CMD+SHIFT+E', t('editor.shortcuts.inlineMath', 'Inline math (wraps the selection as TeX)')]]
      : []),
    ...(hasInline('footnote')
      ? [['CMD+ALT+F', t('editor.shortcuts.footnote', 'Footnote at the caret, or edit the one next to it')]]
      : []),
  ];
  const markdown = [
    ['#', 'header', t('editor.shortcuts.md.heading', 'Heading (# to ######, then Space)')],
    ['-', 'list', t('editor.shortcuts.md.bullets', 'Bulleted list (- or *, then Space)')],
    ['1.', 'list', t('editor.shortcuts.md.numbers', 'Numbered list (1. then Space)')],
    ['[]', 'checklist', t('editor.shortcuts.md.checklist', 'Checklist ([] or [x], then Space)')],
    ['>', 'quote', t('editor.shortcuts.md.quote', 'Quote (> then Space)')],
    ['```', 'code', t('editor.shortcuts.md.code', 'Code block (``` then Enter)')],
    ['---', 'delimiter', t('editor.shortcuts.md.delimiter', 'Delimiter (--- then Enter)')],
    ['**', null, t('editor.shortcuts.md.bold', '**bold**, _italic_, ~~strike~~, `code`')],
  ].filter(([, block]) => !block || hasBlock(block) || (block === 'code' && hasBlock('codeFlask')));

  const section = (title, rows) => (
    <Box>
      <Typography variant="delta" tag="h3">
        {title}
      </Typography>
      <Table>
        <tbody>
          {rows.map(([keys, label]) => (
            <tr key={`${keys}-${label}`}>
              <th scope="row">
                <Combo combo={keys} />
              </th>
              <td>
                <Typography variant="omega">{label}</Typography>
              </td>
            </tr>
          ))}
        </tbody>
      </Table>
    </Box>
  );

  return (
    <Modal.Root open onOpenChange={(open) => !open && onClose()}>
      <Modal.Content>
        <Modal.Header closeLabel={t('editor.shortcuts.close', 'Close')}>
          <Modal.Title>{t('editor.shortcuts.title', 'Keyboard shortcuts')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Flex direction="column" alignItems="stretch" gap={6}>
            {section(t('editor.shortcuts.editor', 'Editor'), editorKeys)}
            {tools.length
              ? section(
                  t('editor.shortcuts.tools', 'Blocks and formatting'),
                  tools.map((tool) => [tool.shortcut, tool.label])
                )
              : null}
            {section(
              t('editor.shortcuts.markdown', 'Markdown while typing'),
              markdown.map(([keys, , label]) => [keys, label])
            )}
          </Flex>
        </Modal.Body>
        <Modal.Footer>
          <Modal.Close>
            <Button variant="tertiary">{t('editor.shortcuts.close', 'Close')}</Button>
          </Modal.Close>
        </Modal.Footer>
      </Modal.Content>
    </Modal.Root>
  );
};

export default ShortcutsDialog;
