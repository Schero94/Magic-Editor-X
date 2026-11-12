import Header from '@editorjs/header';
import Paragraph from '@editorjs/paragraph';
import List from '@editorjs/list';
import Quote from '@editorjs/quote';
import Warning from '@editorjs/warning';
import Code from '@editorjs/code';
import Embed from '@editorjs/embed';
import Raw from '@editorjs/raw';
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
import { AiBlockTune, AlignmentTune, TextVariantTune } from './tunes';
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
import { TocTool } from './toc';
import { SyncedTool } from './synced';
import { MentionTool } from './mention';
import { ToggleTool } from './toggle';
import { TableTool } from './table';
import { ChecklistTool } from './checklist';
import { buildCustomBlockTools } from './custom-block';
import { MexImageTool } from './alt-text';
import { GalleryTool, VideoTool, AudioTool } from './media';
import { MathTool } from './math';
import { InlineMathTool } from './inline-math';
import { FootnoteTool } from './footnote';
import { CommentInlineTool } from './comment';
import { MARKED_BLOCKS } from '../../../../shared/sanitize-policy.mjs';
import { markedTool } from './marked';
import { isBlockAllowed } from '../../../../shared/presets.mjs';
import { buildCodeBlockTools, codeBlocks } from '../block-registry';

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
  // 2.4
  'inlineMath',
  'footnote',
];

/** Names 2.3 gave to built-in tools that a Settings custom block could already have. */
const LEGACY_CUSTOM_NAMES = new Set([...Object.keys(MARKED_BLOCKS), 'mention']);

/**
 * Key of the mention inline tool when a custom block owns `mention`. Custom
 * block names cannot contain `$`, so it never clashes with one.
 */
const MENTION_FALLBACK_KEY = 'mention$mex';

/**
 * Key of the range comment inline tool (2.4). Custom block names cannot contain `$`, so it never
 * clashes with one; the tool stores nothing in the content.
 */
const COMMENT_TOOL = 'comment$mex';

/** Keys of the 2.4 inline tools when a custom block (Settings or code) owns their name. */
const INLINE_FALLBACK_KEYS = Object.freeze({ inlineMath: 'inlineMath$mex', footnote: 'footnote$mex' });

/**
 * True when an enabled custom block has this exact name.
 * @param {unknown} blocks - Custom block DTOs.
 * @param {string} name - Tool name.
 * @returns {boolean} Result.
 */
const hasCustomBlock = (blocks, name) =>
  Array.isArray(blocks) && blocks.some((block) => block && block.name === name && block.enabled !== false);

/**
 * Builds the `tools` object for `new EditorJS({ tools })`.
 * @param {object} ctx - Context from the editor field (see README in the parent component).
 * @returns {Record<string, object>} Editor.js tools.
 */
export function buildTools(ctx) {
  const t = typeof ctx.t === 'function' ? ctx.t : (_id, fallback) => fallback;
  const preset = ctx.preset || null;
  const presetInline =
    preset && preset.inline ? INLINE.filter((name) => preset.inline.includes(name)) : INLINE;
  // Mentions are internal links: offered with the hyperlink tool when the field allows links to entries.
  const linkTargets = (preset && preset.linkTargets) || 'all';
  const mentions =
    presetInline.includes('hyperlink') &&
    (linkTargets === 'all' || linkTargets === 'internal') &&
    Boolean(ctx.fetchClient && typeof ctx.fetchClient.get === 'function');
  // A custom block named `mention` from before 2.3 keeps the name; the inline tool then uses another key
  // (inline tools store no name, so this changes nothing in the content).
  const mentionKey = hasCustomBlock(ctx.customBlocks, 'mention') ? MENTION_FALLBACK_KEY : 'mention';
  // 2.4: inline math and footnotes keep working when a custom block (Settings or code) has their name.
  const codeNames = new Set(codeBlocks().map((entry) => entry.definition.name));
  const inlineKey = (name) =>
    INLINE_FALLBACK_KEYS[name] && (hasCustomBlock(ctx.customBlocks, name) || codeNames.has(name))
      ? INLINE_FALLBACK_KEYS[name]
      : name;
  const keyed = presetInline.map(inlineKey);
  const allowedInline = mentions
    ? keyed.flatMap((name) => (name === 'hyperlink' ? [name, mentionKey] : [name]))
    : keyed;
  const withAi = ctx.aiEnabled ? [...allowedInline, 'aiAssistant'] : allowedInline;
  // 2.4: "Comment" on a selection, for fields with comments the admin may write. Not content, so presets
  // never remove it.
  const commentsOn = typeof ctx.onComment === 'function';
  const inline = commentsOn ? [...withAi, COMMENT_TOOL] : withAi;
  const levels = preset && preset.headingLevels.length ? preset.headingLevels : [1, 2, 3, 4, 5, 6];
  const canUpload = ctx.canUpload !== false;
  // Choosing files in the Media Library dialog needs `plugin::upload.read`.
  const canBrowse = ctx.canBrowse === true && typeof ctx.openMediaLibrary === 'function';
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
          ctx.placeholder || t('tools.paragraph.placeholder', 'Write, or type / to choose a block'),
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
        levels,
        defaultLevel: levels.includes(2) ? 2 : levels[0],
      },
    },
    list: {
      class: List,
      inlineToolbar: inline,
      tunes: ['indentTune'],
      shortcut: 'CMD+SHIFT+L',
      // The dedicated `checklist` tool keeps the 1.x data shape, so the list offers only its two list styles.
      toolbox: (Array.isArray(List.toolbox) ? List.toolbox : [List.toolbox]).filter(
        (item) => !item || !item.data || item.data.style !== 'checklist'
      ),
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
    toc: { class: markedTool(TocTool, 'toc'), config: { t, levels } },
    // Math block (2.4): TeX with a live preview (Temml, loaded on demand).
    math: { class: markedTool(MathTool, 'math'), config: { t } },
    // Synced block (2.3): inserted from the template dialog; the field renders its view (`ctx.mountSynced`).
    synced: { class: markedTool(SyncedTool, 'synced'), config: { t, mount: ctx.mountSynced } },
    // 2.4: own table tool (header row and column, alignment, merged cells, caption).
    table: {
      class: TableTool,
      inlineToolbar: inline,
      shortcut: 'CMD+SHIFT+T',
      config: { rows: 2, cols: 3, withHeadings: true, t },
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
      class: MexImageTool,
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
        t,
        requireAlt: Boolean(preset && preset.requireAlt),
        // 2.3: AI alternative text suggestion (only when the owner and the field allow it).
        suggestAltText: ctx.suggestAltText,
      },
    },
    simpleImage: {
      class: SimpleImageTool,
      inlineToolbar: inline,
      config: { ...shared, requireAlt: Boolean(preset && preset.requireAlt) },
    },
    gallery: {
      class: markedTool(GalleryTool, 'gallery'),
      inlineToolbar: inline,
      toolbox: canBrowse ? undefined : false,
      config: {
        ...shared,
        canBrowse,
        requireAlt: Boolean(preset && preset.requireAlt),
        suggestAltText: ctx.suggestAltText,
      },
    },
    video: {
      class: markedTool(VideoTool, 'video'),
      inlineToolbar: inline,
      toolbox: canBrowse ? undefined : false,
      config: { ...shared, canBrowse, getLocale: ctx.getContentLocale },
    },
    audio: {
      class: markedTool(AudioTool, 'audio'),
      inlineToolbar: inline,
      toolbox: canBrowse ? undefined : false,
      config: { ...shared, canBrowse, getLocale: ctx.getContentLocale },
    },
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
    hyperlink: {
      class: HyperlinkTool,
      shortcut: 'CMD+K',
      config: {
        t,
        target: '_blank',
        fetchClient: ctx.fetchClient,
        getLocale: ctx.getContentLocale,
        linkTargets: (preset && preset.linkTargets) || 'all',
      },
    },
    [inlineKey('inlineMath')]: { class: InlineMathTool, config: { t } },
    [inlineKey('footnote')]: {
      class: FootnoteTool,
      config: { t, onEdit: typeof ctx.onFootnoteEdit === 'function' ? ctx.onFootnoteEdit : null },
    },
    ...(mentions
      ? {
          [mentionKey]: {
            class: MentionTool,
            shortcut: 'CMD+SHIFT+2',
            config: { t, fetchClient: ctx.fetchClient, getLocale: ctx.getContentLocale },
          },
        }
      : {}),

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

  if (commentsOn) {
    tools[COMMENT_TOOL] = {
      class: CommentInlineTool,
      config: { onComment: ctx.onComment, isAvailable: ctx.commentsAvailable },
    };
  }

  const withAiTune = ctx.aiEnabled && typeof ctx.onBlockAi === 'function';
  if (withAiTune) tools.aiBlockTune = { class: AiBlockTune, config: { t, onBlockAi: ctx.onBlockAi } };

  const custom = buildCustomBlockTools(ctx.customBlocks, { ...ctx, t, canUpload }, shared);
  for (const [name, tool] of Object.entries(custom)) {
    // A custom block created before 2.3 under a name 2.3 gave to a built-in tool
    // (`toc`, `gallery`, `video`, `audio`, `synced`, `mention`) keeps its own tool.
    const legacy = LEGACY_CUSTOM_NAMES.has(name);
    if (legacy || !Object.prototype.hasOwnProperty.call(tools, name)) {
      tools[name] = tool.inlineToolbar === true ? { ...tool, inlineToolbar: inline } : tool;
    }
  }
  // 2.3: blocks registered in code by the host app (custom block SDK). Their
  // names never clash with built-in tools; a Settings block of the same name
  // cannot exist (the server refuses to start), so the code tool wins.
  const code = buildCodeBlockTools({ t, locale: ctx.locale, inline, shared });
  for (const [name, tool] of Object.entries(code)) tools[name] = tool;
  // 2.4: text blocks (those with an inline toolbar) get "AI assistant" in their block menu.
  if (withAiTune) {
    for (const [name, tool] of Object.entries(tools)) {
      if (NOT_BLOCKS.has(name) || !tool || !tool.inlineToolbar) continue;
      tools[name] = { ...tool, tunes: [...(Array.isArray(tool.tunes) ? tool.tunes : []), 'aiBlockTune'] };
    }
  }
  return preset ? applyPreset(tools, preset) : tools;
}

/** Tools that are not blocks of their own (inline tools, tunes, the Media Library placeholder). */
const NOT_BLOCKS = new Set([
  ...INLINE,
  ...Object.values(INLINE_FALLBACK_KEYS),
  'mention',
  MENTION_FALLBACK_KEY,
  'aiAssistant',
  COMMENT_TOOL,
  'aiBlockTune',
  'alignmentTune',
  'textVariant',
  'indentTune',
  'mediaLib',
]);

/**
 * Wraps a block tool so it is not offered for new content: no toolbox entry,
 * no paste handling (so pasted content never creates it). Existing blocks of
 * the type still render and stay editable; the save check reports them.
 * @param {Function} ToolClass - Editor.js block tool class.
 * @returns {Function} Restricted subclass.
 */
const restrictTool = (ToolClass) =>
  class RestrictedTool extends ToolClass {
    static get pasteConfig() {
      return false;
    }
  };

/**
 * Applies a field preset to the tool set.
 * @param {Record<string, object>} tools - Tools from `buildTools`.
 * @param {import('../../../../shared/presets.mjs').FieldPreset} preset - Field preset.
 * @returns {Record<string, object>} Tools.
 */
export function applyPreset(tools, preset) {
  const out = {};
  for (const [name, tool] of Object.entries(tools)) {
    if (preset.inline && INLINE.includes(name) && !preset.inline.includes(name)) continue;
    if (name === 'mediaLib' && !isBlockAllowed(preset, 'image')) continue;
    if (NOT_BLOCKS.has(name) || isBlockAllowed(preset, name)) {
      out[name] = tool;
      continue;
    }
    const { shortcut, ...rest } = tool;
    out[name] = { ...rest, class: restrictTool(tool.class), toolbox: false };
  }
  return out;
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
        'Table of contents': tr('tools.names.toc', 'Table of contents'),
        Table: tr('tools.names.table', 'Table'),
        'Raw HTML': tr('tools.names.raw', 'Raw HTML'),
        Image: tr('tools.names.image', 'Image'),
        'Image by URL': tr('tools.names.simpleImage', 'Image by URL'),
        Gallery: tr('tools.names.gallery', 'Gallery'),
        Video: tr('tools.names.video', 'Video'),
        Audio: tr('tools.names.audio', 'Audio'),
        'Link preview': tr('tools.names.linkPreview', 'Link preview'),
        Attachment: tr('tools.names.attachment', 'Attachment'),
        Person: tr('tools.names.person', 'Person'),
        Button: tr('tools.names.button', 'Button'),
        'Media Library': tr('tools.names.mediaLibrary', 'Media Library'),
        'Embedded entry': tr('tools.names.embeddedEntry', 'Embedded entry'),
        Link: tr('tools.names.link', 'Link'),
        Mention: tr('tools.names.mention', 'Mention'),
        Bold: tr('tools.names.bold', 'Bold'),
        Italic: tr('tools.names.italic', 'Italic'),
        Marker: tr('tools.names.marker', 'Marker'),
        Underline: tr('tools.names.underline', 'Underline'),
        Strikethrough: tr('tools.names.strikethrough', 'Strikethrough'),
        'Inline Code': tr('tools.names.inlineCode', 'Inline code'),
        Tooltip: tr('tools.names.tooltip', 'Tooltip'),
        'AI assistant': tr('tools.names.ai', 'AI assistant'),
        Math: tr('tools.names.math', 'Math'),
        'Inline math': tr('tools.names.inlineMath', 'Inline math'),
        Footnote: tr('tools.names.footnote', 'Footnote'),
        Comment: tr('tools.names.comment', 'Comment'),
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
