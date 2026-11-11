import Header from '@editorjs/header';
import Paragraph from '@editorjs/paragraph';
import List from '@editorjs/list';
import Quote from '@editorjs/quote';
import Warning from '@editorjs/warning';
import Code from '@editorjs/code';
import Table from '@editorjs/table';
import Embed from '@editorjs/embed';
import Raw from '@editorjs/raw';
import ImageTool from '@editorjs/image';
import Attaches from '@editorjs/attaches';
import InlineCode from '@editorjs/inline-code';
import IndentTune from 'editorjs-indent-tune';
import {
  MarkerTool,
  UnderlineTool,
  StrikethroughTool,
  TooltipTool,
  HyperlinkTool,
  AiInlineTool,
} from './inline';
import { AlignmentTune, TextVariantTune } from './tunes';
import {
  AlertTool,
  DelimiterTool,
  SimpleImageTool,
  PersonalityTool,
  ButtonTool,
  LinkPreviewTool,
  MediaLibraryTool,
} from './blocks';
import { CodeHighlightTool } from './code-highlight';
import { ToggleTool } from './toggle';
import { ChecklistTool } from './checklist';
import { buildCustomBlockTools } from './custom-block';

export { createUndoManager } from './undo';
export { createDragDrop } from './drag-drop';

/**
 * Editor.js tool configuration of Magic Editor X 2.0.
 *
 * Block names and stored data are the same as in 1.x. Official @editorjs
 * packages that are maintained are used directly; unmaintained community
 * packages are replaced by the in-repo tools in this folder.
 */

/** Inline tools offered in text blocks (bold/italic are Editor.js core tools). */
const INLINE = [
  'bold',
  'italic',
  'hyperlink',
  'marker',
  'underline',
  'strikethrough',
  'inlineCode',
  'tooltip',
];

/**
 * Builds the `tools` object for `new EditorJS({ tools })`.
 * @param {object} ctx - Context from the editor field (see README in the parent component).
 * @returns {Record<string, object>} Editor.js tools.
 */
export function buildTools(ctx) {
  const t = typeof ctx.t === 'function' ? ctx.t : (_id, fallback) => fallback;
  const inline = ctx.aiEnabled ? [...INLINE, 'aiAssistant'] : INLINE;
  const canUpload = ctx.canUpload !== false;
  const shared = {
    t,
    fetchClient: ctx.fetchClient,
    canUpload,
    linkPreview: ctx.linkPreview !== false,
    uploadImage: ctx.uploadImage,
    openMediaLibrary: ctx.openMediaLibrary,
  };
  const refuseUpload = async () => ({
    success: 0,
    message: t('tools.common.noUpload', 'You do not have permission to upload files'),
  });

  const tools = {
    paragraph: {
      class: Paragraph,
      inlineToolbar: inline,
      tunes: ['alignmentTune', 'textVariant', 'indentTune'],
      config: {
        placeholder:
          ctx.placeholder || t('tools.paragraph.placeholder', 'Write, or press Tab to choose a block'),
        preserveBlank: true,
      },
    },
    header: {
      class: Header,
      inlineToolbar: inline,
      tunes: ['alignmentTune', 'indentTune'],
      shortcut: 'CMD+SHIFT+H',
      config: {
        placeholder: t('tools.header.placeholder', 'Heading'),
        levels: [1, 2, 3, 4, 5, 6],
        defaultLevel: 2,
      },
    },
    list: {
      class: List,
      inlineToolbar: inline,
      tunes: ['indentTune'],
      shortcut: 'CMD+SHIFT+L',
      config: { defaultStyle: 'unordered' },
    },
    checklist: { class: ChecklistTool, inlineToolbar: inline, shortcut: 'CMD+SHIFT+C', config: {} },
    quote: {
      class: Quote,
      inlineToolbar: inline,
      tunes: ['alignmentTune'],
      shortcut: 'CMD+SHIFT+Q',
      config: {
        quotePlaceholder: t('tools.quote.text', 'Quote'),
        captionPlaceholder: t('tools.quote.caption', 'Author'),
      },
    },
    warning: {
      class: Warning,
      inlineToolbar: inline,
      shortcut: 'CMD+SHIFT+W',
      config: {
        titlePlaceholder: t('tools.warning.title', 'Title'),
        messagePlaceholder: t('tools.warning.message', 'Message'),
      },
    },
    alert: {
      class: AlertTool,
      inlineToolbar: inline,
      shortcut: 'CMD+SHIFT+A',
      config: { ...shared, defaultType: 'info' },
    },
    toggle: { class: ToggleTool, inlineToolbar: inline, config: shared },
    code: {
      class: Code,
      shortcut: 'CMD+SHIFT+P',
      config: { placeholder: t('tools.code.placeholder', 'Enter code') },
    },
    codeFlask: { class: CodeHighlightTool, config: { ...shared, language: 'javascript' } },
    delimiter: { class: DelimiterTool, shortcut: 'CMD+SHIFT+D', config: shared },
    table: {
      class: Table,
      inlineToolbar: inline,
      shortcut: 'CMD+SHIFT+T',
      config: { rows: 2, cols: 3, withHeadings: true },
    },
    embed: {
      class: Embed,
      inlineToolbar: true,
      config: {
        services: {
          youtube: true,
          vimeo: true,
          twitter: true,
          instagram: true,
          codepen: true,
          github: true,
          imgur: true,
          pinterest: true,
          twitch: true,
          miro: true,
          figma: true,
          facebook: true,
        },
      },
    },
    raw: { class: Raw, config: { placeholder: t('tools.raw.placeholder', 'Enter HTML') } },
    image: {
      class: ImageTool,
      inlineToolbar: inline,
      toolbox: canUpload ? undefined : false,
      config: {
        uploader: {
          uploadByFile: canUpload ? ctx.uploadImage : refuseUpload,
          uploadByUrl: canUpload ? ctx.uploadImageByUrl : refuseUpload,
        },
        types: 'image/jpeg,image/png,image/gif,image/webp,image/avif',
        captionPlaceholder: t('tools.common.caption', 'Caption'),
        buttonContent: t('tools.image.select', 'Select an image'),
      },
    },
    simpleImage: { class: SimpleImageTool, inlineToolbar: inline, config: shared },
    linkTool: { class: LinkPreviewTool, config: shared },
    attaches: {
      class: Attaches,
      toolbox: canUpload ? undefined : false,
      config: {
        uploader: { uploadByFile: canUpload ? ctx.uploadFile : refuseUpload },
        types: (ctx.attachmentTypes || []).join(','),
        buttonText: t('tools.attaches.select', 'Select a file'),
        errorMessage: t('tools.attaches.failed', 'The file could not be uploaded'),
      },
    },
    personality: { class: PersonalityTool, config: shared },
    button: { class: ButtonTool, config: shared },

    marker: { class: MarkerTool, shortcut: 'CMD+SHIFT+M' },
    underline: { class: UnderlineTool, shortcut: 'CMD+U' },
    strikethrough: { class: StrikethroughTool, shortcut: 'CMD+SHIFT+X' },
    inlineCode: { class: InlineCode, shortcut: 'CMD+SHIFT+I' },
    tooltip: { class: TooltipTool, config: { t } },
    hyperlink: { class: HyperlinkTool, shortcut: 'CMD+K', config: { t, target: '_blank' } },

    alignmentTune: { class: AlignmentTune, config: { t, default: 'left' } },
    textVariant: { class: TextVariantTune, config: { t } },
    indentTune: {
      class: IndentTune,
      config: { maxIndent: 5, indentSize: 30, multiblock: true, tuneName: 'indentTune' },
    },
  };

  if (canUpload && typeof ctx.openMediaLibrary === 'function') {
    tools.mediaLib = { class: MediaLibraryTool, config: shared };
  }
  if (ctx.aiEnabled && typeof ctx.onAiRequest === 'function') {
    tools.aiAssistant = {
      class: AiInlineTool,
      shortcut: 'CMD+SHIFT+G',
      config: { t, onAiRequest: ctx.onAiRequest },
    };
  }

  const custom = buildCustomBlockTools(ctx.customBlocks, { ...ctx, t, canUpload }, shared);
  for (const [name, tool] of Object.entries(custom)) {
    if (!Object.prototype.hasOwnProperty.call(tools, name)) {
      tools[name] = tool.inlineToolbar === true ? { ...tool, inlineToolbar: inline } : tool;
    }
  }
  return tools;
}

/**
 * Editor.js `i18n` configuration built from the admin translations.
 * @param {(id: string, defaultMessage: string, values?: object) => string} t - Translator.
 * @returns {{ messages: object }} Editor.js i18n config.
 */
export function editorI18n(t) {
  const tr = typeof t === 'function' ? t : (_id, fallback) => fallback;
  return {
    messages: {
      ui: {
        blockTunes: {
          toggler: {
            'Click to tune': tr('tools.ui.clickToTune', 'Click to open the block menu'),
            'or drag to move': tr('tools.ui.dragToMove', 'or drag to move'),
          },
        },
        inlineToolbar: { converter: { 'Convert to': tr('tools.ui.convertTo', 'Convert to') } },
        toolbar: { toolbox: { Add: tr('tools.ui.add', 'Add a block') } },
        popover: {
          Filter: tr('tools.ui.filter', 'Filter'),
          'Nothing found': tr('tools.ui.nothingFound', 'Nothing found'),
          'Convert to': tr('tools.ui.convertTo', 'Convert to'),
        },
      },
      toolNames: {
        Text: tr('tools.names.text', 'Text'),
        Heading: tr('tools.names.heading', 'Heading'),
        'Unordered List': tr('tools.names.unorderedList', 'Bulleted list'),
        'Ordered List': tr('tools.names.orderedList', 'Numbered list'),
        Checklist: tr('tools.names.checklist', 'Checklist'),
        Quote: tr('tools.names.quote', 'Quote'),
        Warning: tr('tools.names.warning', 'Warning'),
        Alert: tr('tools.names.alert', 'Alert'),
        Toggle: tr('tools.names.toggle', 'Toggle'),
        Code: tr('tools.names.code', 'Code'),
        'Code (highlighted)': tr('tools.names.codeHighlighted', 'Code (highlighted)'),
        Delimiter: tr('tools.names.delimiter', 'Delimiter'),
        Table: tr('tools.names.table', 'Table'),
        'Raw HTML': tr('tools.names.raw', 'Raw HTML'),
        Image: tr('tools.names.image', 'Image'),
        'Image by URL': tr('tools.names.simpleImage', 'Image by URL'),
        'Link preview': tr('tools.names.linkPreview', 'Link preview'),
        Attachment: tr('tools.names.attachment', 'Attachment'),
        Person: tr('tools.names.person', 'Person'),
        Button: tr('tools.names.button', 'Button'),
        'Media Library': tr('tools.names.mediaLibrary', 'Media Library'),
        'Embedded entry': tr('tools.names.embeddedEntry', 'Embedded entry'),
        Link: tr('tools.names.link', 'Link'),
        Bold: tr('tools.names.bold', 'Bold'),
        Italic: tr('tools.names.italic', 'Italic'),
        Marker: tr('tools.names.marker', 'Marker'),
        Underline: tr('tools.names.underline', 'Underline'),
        Strikethrough: tr('tools.names.strikethrough', 'Strikethrough'),
        'Inline Code': tr('tools.names.inlineCode', 'Inline code'),
        Tooltip: tr('tools.names.tooltip', 'Tooltip'),
        'AI assistant': tr('tools.names.ai', 'AI assistant'),
      },
      tools: {
        link: { 'Add a link': tr('tools.hyperlink.placeholder', 'Paste a link and press Enter') },
        stub: {
          'The block can not be displayed correctly.': tr(
            'tools.ui.stub',
            'This block cannot be shown. Its content is kept when you save.'
          ),
        },
        image: {
          Caption: tr('tools.common.caption', 'Caption'),
          'Select an Image': tr('tools.image.select', 'Select an image'),
          'With border': tr('tools.image.border', 'With border'),
          'Stretch image': tr('tools.image.stretch', 'Stretch image'),
          'With background': tr('tools.image.background', 'With background'),
        },
        list: {
          Unordered: tr('tools.list.unordered', 'Bulleted'),
          Ordered: tr('tools.list.ordered', 'Numbered'),
          Checklist: tr('tools.names.checklist', 'Checklist'),
        },
        table: {
          'With headings': tr('tools.table.withHeadings', 'With headings'),
          'Without headings': tr('tools.table.withoutHeadings', 'Without headings'),
          'Add row above': tr('tools.table.rowAbove', 'Add row above'),
          'Add row below': tr('tools.table.rowBelow', 'Add row below'),
          'Delete row': tr('tools.table.deleteRow', 'Delete row'),
          'Add column to left': tr('tools.table.columnLeft', 'Add column to the left'),
          'Add column to right': tr('tools.table.columnRight', 'Add column to the right'),
          'Delete column': tr('tools.table.deleteColumn', 'Delete column'),
        },
        header: {
          'Heading 1': tr('tools.header.level1', 'Heading 1'),
          'Heading 2': tr('tools.header.level2', 'Heading 2'),
          'Heading 3': tr('tools.header.level3', 'Heading 3'),
          'Heading 4': tr('tools.header.level4', 'Heading 4'),
          'Heading 5': tr('tools.header.level5', 'Heading 5'),
          'Heading 6': tr('tools.header.level6', 'Heading 6'),
        },
        quote: {
          'Align Left': tr('tools.alignment.left', 'Align left'),
          'Align Center': tr('tools.alignment.center', 'Align center'),
        },
      },
      blockTunes: {
        delete: {
          Delete: tr('tools.tunes.delete', 'Delete'),
          'Click to delete': tr('tools.tunes.confirmDelete', 'Click again to delete'),
        },
        moveUp: { 'Move up': tr('tools.tunes.moveUp', 'Move up') },
        moveDown: { 'Move down': tr('tools.tunes.moveDown', 'Move down') },
      },
    },
  };
}

export { INLINE as INLINE_TOOLS };
