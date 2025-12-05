/**
 * Magic Editor X - EditorJS Tools Configuration
 * Comprehensive collection of Editor.js tools for rich content editing
 * @see https://github.com/editor-js/awesome-editorjs
 */

// ============================================
// OFFICIAL BLOCK TOOLS (@editorjs/*)
// ============================================
import Header from '@editorjs/header';
import Paragraph from '@editorjs/paragraph';
import NestedList from '@editorjs/nested-list';
import Checklist from '@editorjs/checklist';
import Quote from '@editorjs/quote';
import Warning from '@editorjs/warning';
import Code from '@editorjs/code';
import Delimiter from '@editorjs/delimiter';
import Table from '@editorjs/table';
import Embed from '@editorjs/embed';
import Raw from '@editorjs/raw';
import Image from '@editorjs/image';
import SimpleImage from '@editorjs/simple-image';
import LinkTool from '@editorjs/link';
import Attaches from '@editorjs/attaches';
import Personality from '@editorjs/personality';

// ============================================
// COMMUNITY BLOCK TOOLS
// ============================================
import Alert from 'editorjs-alert';
import ToggleBlock from 'editorjs-toggle-block';
import CodeFlask from '@calumk/editorjs-codeflask';

// ============================================
// CUSTOM TOOLS (Secure implementations without eval)
// ============================================
import { ButtonTool, HyperlinkTool } from '../components/EditorTools';

// ============================================
// OFFICIAL INLINE TOOLS
// ============================================
import Marker from '@editorjs/marker';
import InlineCode from '@editorjs/inline-code';
import Underline from '@editorjs/underline';

// ============================================
// COMMUNITY INLINE TOOLS
// ============================================
import Strikethrough from '@sotaproject/strikethrough';
import Tooltip from 'editorjs-tooltip';

// ============================================
// TUNES
// ============================================
import TextVariantTune from '@editorjs/text-variant-tune';
import AlignmentTune from 'editorjs-text-alignment-blocktune';
import IndentTune from 'editorjs-indent-tune';

// ============================================
// PLUGINS (Undo/Redo, Drag-Drop)
// ============================================
import Undo from 'editorjs-undo';
import DragDrop from 'editorjs-drag-drop';

// ============================================
// CUSTOM ADAPTERS
// ============================================
import MediaLibAdapter from '../components/MediaLib/MediaLibAdapter';

/**
 * Get authentication token from Strapi
 */
const getAuthToken = () => {
  try {
    const token = sessionStorage.getItem('jwtToken');
    if (token) {
      return JSON.parse(token);
    }
    const localToken = localStorage.getItem('jwtToken');
    if (localToken) {
      return JSON.parse(localToken);
    }
    return null;
  } catch (e) {
    console.warn('[Magic Editor X] Could not get auth token:', e);
    return null;
  }
};

/**
 * Get all EditorJS tools configuration
 */
export const getTools = ({ mediaLibToggleFunc, pluginId }) => {
  const token = getAuthToken();
  const authHeader = token ? `Bearer ${token}` : '';

  return {
    // ============================================
    // OFFICIAL BLOCK TOOLS (16 Tools)
    // ============================================
    
    /**
     * Header Tool
     * @see https://github.com/editor-js/header
     */
    header: {
      class: Header,
      inlineToolbar: true,
      tunes: ['alignmentTune'],
      config: {
        placeholder: 'Enter a heading',
        levels: [1, 2, 3, 4, 5, 6],
        defaultLevel: 2,
      },
      shortcut: 'CMD+SHIFT+H',
    },

    /**
     * Paragraph Tool (default)
     * @see https://github.com/editor-js/paragraph
     */
    paragraph: {
      class: Paragraph,
      inlineToolbar: true,
      tunes: ['alignmentTune', 'indentTune'],
      config: {
        placeholder: 'Start writing or press Tab to add a block...',
        preserveBlank: true,
      },
    },

    /**
     * Nested List Tool
     * @see https://github.com/editor-js/nested-list
     */
    list: {
      class: NestedList,
      inlineToolbar: true,
      tunes: ['indentTune'],
      config: {
        defaultStyle: 'unordered',
      },
      shortcut: 'CMD+SHIFT+L',
    },

    /**
     * Checklist Tool
     * @see https://github.com/editor-js/checklist
     */
    checklist: {
      class: Checklist,
      inlineToolbar: true,
      shortcut: 'CMD+SHIFT+C',
    },

    /**
     * Quote Tool
     * @see https://github.com/editor-js/quote
     */
    quote: {
      class: Quote,
      inlineToolbar: true,
      tunes: ['alignmentTune'],
      config: {
        quotePlaceholder: 'Enter a quote',
        captionPlaceholder: 'Quote author',
      },
      shortcut: 'CMD+SHIFT+Q',
    },

    /**
     * Warning Tool
     * @see https://github.com/editor-js/warning
     */
    warning: {
      class: Warning,
      inlineToolbar: true,
      config: {
        titlePlaceholder: 'Warning title',
        messagePlaceholder: 'Warning message',
      },
      shortcut: 'CMD+SHIFT+W',
    },

    /**
     * Code Tool (basic)
     * @see https://github.com/editor-js/code
     */
    code: {
      class: Code,
      config: {
        placeholder: 'Enter code here...',
      },
      shortcut: 'CMD+SHIFT+P',
    },

    /**
     * Delimiter Tool
     * @see https://github.com/editor-js/delimiter
     */
    delimiter: {
      class: Delimiter,
      shortcut: 'CMD+SHIFT+D',
    },

    /**
     * Table Tool
     * @see https://github.com/editor-js/table
     */
    table: {
      class: Table,
      inlineToolbar: true,
      config: {
        rows: 2,
        cols: 3,
        withHeadings: true,
      },
      shortcut: 'CMD+SHIFT+T',
    },

    /**
     * Embed Tool
     * @see https://github.com/editor-js/embed
     */
    embed: {
      class: Embed,
      config: {
        services: {
          youtube: true,
          vimeo: true,
          twitter: true,
          instagram: true,
          codepen: true,
          codesandbox: true,
          github: true,
          gfycat: true,
          imgur: true,
          pinterest: true,
          twitch: true,
          miro: true,
          figma: true,
          aparat: true,
          facebook: true,
        },
      },
    },

    /**
     * Raw HTML Tool
     * @see https://github.com/editor-js/raw
     */
    raw: {
      class: Raw,
      config: {
        placeholder: 'Enter raw HTML...',
      },
    },

    /**
     * Link Tool
     * @see https://github.com/editor-js/link
     */
    linkTool: {
      class: LinkTool,
      config: {
        endpoint: `/api/${pluginId}/link`,
        headers: {
          Authorization: authHeader,
        },
      },
    },

    /**
     * Image Tool (with Upload)
     * @see https://github.com/editor-js/image
     */
    image: {
      class: Image,
      config: {
        field: 'files.image',
        additionalRequestData: {
          data: JSON.stringify({}),
        },
        additionalRequestHeaders: {
          Authorization: authHeader,
        },
        endpoints: {
          byUrl: `/api/${pluginId}/image/byUrl`,
        },
        uploader: {
          async uploadByFile(file) {
            const formData = new FormData();
            formData.append('data', JSON.stringify({}));
            formData.append('files.image', file);

            try {
              const response = await fetch(`/api/${pluginId}/image/byFile`, {
                method: 'POST',
                headers: {
                  Authorization: authHeader,
                },
                body: formData,
              });
              return await response.json();
            } catch (error) {
              console.error('[Magic Editor X] Upload error:', error);
              return { success: 0, message: error.message };
            }
          },
        },
        captionPlaceholder: 'Image caption',
        buttonContent: 'Select image',
      },
    },

    /**
     * Simple Image Tool (URL only)
     * @see https://github.com/editor-js/simple-image
     */
    simpleImage: {
      class: SimpleImage,
    },

    /**
     * Attaches Tool
     * @see https://github.com/editor-js/attaches
     */
    attaches: {
      class: Attaches,
      config: {
        endpoint: `/api/${pluginId}/file/upload`,
        field: 'file',
        types: '*',
        buttonText: 'Select file to upload',
        errorMessage: 'File upload failed',
        additionalRequestHeaders: {
          Authorization: authHeader,
        },
      },
    },

    /**
     * Personality Tool
     * @see https://github.com/editor-js/personality
     */
    personality: {
      class: Personality,
      config: {
        endpoint: `/api/${pluginId}/image/byFile`,
        field: 'files.image',
        additionalRequestHeaders: {
          Authorization: authHeader,
        },
        namePlaceholder: 'Name',
        descriptionPlaceholder: 'Description / Title',
        linkPlaceholder: 'Link (optional)',
      },
    },

    /**
     * Media Library Tool (Custom)
     * Strapi Media Library integration
     */
    mediaLib: {
      class: MediaLibAdapter,
      config: {
        mediaLibToggleFunc,
      },
    },

    // ============================================
    // COMMUNITY BLOCK TOOLS (4 Tools)
    // ============================================

    /**
     * Alert Tool
     * @see https://github.com/vishaltelangre/editorjs-alert
     * Colorful alert boxes (info, success, warning, danger)
     */
    alert: {
      class: Alert,
      inlineToolbar: true,
      config: {
        defaultType: 'info',
        messagePlaceholder: 'Enter your message...',
      },
      shortcut: 'CMD+SHIFT+A',
    },

    /**
     * Toggle Block Tool
     * @see https://github.com/kommitters/editorjs-toggle-block
     * Collapsible/expandable content blocks (FAQ, Accordions)
     */
    toggle: {
      class: ToggleBlock,
      inlineToolbar: true,
      config: {
        placeholder: 'Toggle title',
        defaultContent: 'Toggle content...',
      },
    },

    /**
     * CodeFlask Tool (with Syntax Highlighting)
     * @see https://github.com/calumk/editorjs-codeflask
     * Code blocks with syntax highlighting
     */
    codeFlask: {
      class: CodeFlask,
      config: {
        language: 'javascript',
      },
    },

    /**
     * Button Tool (Custom Implementation)
     * CTA buttons with customizable text, link, and style
     * Secure implementation without eval()
     */
    button: {
      class: ButtonTool,
      inlineToolbar: false,
    },

    // ============================================
    // OFFICIAL INLINE TOOLS (3 Tools)
    // ============================================

    /**
     * Marker (Highlight) Tool
     * @see https://github.com/editor-js/marker
     */
    marker: {
      class: Marker,
      shortcut: 'CMD+SHIFT+M',
    },

    /**
     * Inline Code Tool
     * @see https://github.com/editor-js/inline-code
     */
    inlineCode: {
      class: InlineCode,
      shortcut: 'CMD+SHIFT+I',
    },

    /**
     * Underline Tool
     * @see https://github.com/editor-js/underline
     */
    underline: {
      class: Underline,
      shortcut: 'CMD+U',
    },

    // ============================================
    // COMMUNITY INLINE TOOLS (3 Tools)
    // ============================================

    /**
     * Strikethrough Tool
     * @see https://github.com/nicosrm/strikethrough
     */
    strikethrough: {
      class: Strikethrough,
      shortcut: 'CMD+SHIFT+S',
    },

    /**
     * Tooltip Tool
     * @see https://github.com/kommitters/editorjs-tooltip
     * Add tooltips to text
     */
    tooltip: {
      class: Tooltip,
      config: {
        location: 'top',
        highlightColor: '#FFEFD5',
        underline: true,
        backgroundColor: '#1e293b',
        textColor: '#ffffff',
      },
    },

    /**
     * Hyperlink Tool (Custom Implementation)
     * Links with target and rel attributes
     * Secure implementation without eval()
     */
    hyperlink: {
      class: HyperlinkTool,
      config: {
        shortcut: 'CMD+K',
        target: '_blank',
        rel: 'noopener noreferrer',
        availableTargets: ['_blank', '_self', '_parent', '_top'],
        availableRels: ['nofollow', 'noreferrer', 'noopener', 'sponsored', 'ugc'],
      },
    },

    // ============================================
    // TUNES (3 Tunes)
    // ============================================

    /**
     * Text Variant Tune
     * @see https://github.com/editor-js/text-variant-tune
     */
    textVariant: TextVariantTune,

    /**
     * Alignment Tune
     * @see https://github.com/kaaaaaaaaaaai/editorjs-alignment-blocktune
     * Text alignment (left, center, right, justify)
     */
    alignmentTune: {
      class: AlignmentTune,
      config: {
        default: 'left',
        blocks: {
          header: 'center',
        },
      },
    },

    /**
     * Indent Tune
     * @see https://github.com/kommitters/editorjs-indent-tune
     * Block indentation
     */
    indentTune: {
      class: IndentTune,
      config: {
        maxIndent: 5,
        indentSize: 30,
        multiblock: true,
        tuneName: 'indentTune',
      },
    },
  };
};

/**
 * Initialize Undo/Redo plugin
 * Must be called after editor is ready
 */
export const initUndoRedo = (editor) => {
  return new Undo({ editor });
};

/**
 * Initialize Drag & Drop plugin
 * Must be called after editor is ready
 */
export const initDragDrop = (editor) => {
  return new DragDrop(editor);
};

/**
 * Default tools list
 */
export const defaultTools = [
  // Official Block Tools
  'header',
  'paragraph',
  'list',
  'checklist',
  'quote',
  'warning',
  'code',
  'delimiter',
  'table',
  'embed',
  'raw',
  'image',
  'simpleImage',
  'linkTool',
  'attaches',
  'personality',
  'mediaLib',
  // Community Block Tools
  'alert',
  'toggle',
  'codeFlask',
  'button',
  // Official Inline Tools
  'marker',
  'inlineCode',
  'underline',
  // Community Inline Tools
  'strikethrough',
  'tooltip',
  'hyperlink',
  // Tunes
  'textVariant',
  'alignmentTune',
  'indentTune',
];

/**
 * Tool categories for documentation
 */
export const toolCategories = {
  blockTools: [
    { name: 'header', label: 'Header', description: 'H1-H6 headings', official: true },
    { name: 'paragraph', label: 'Paragraph', description: 'Basic text block', official: true },
    { name: 'list', label: 'Nested List', description: 'Ordered/unordered nested lists', official: true },
    { name: 'checklist', label: 'Checklist', description: 'Interactive checkboxes', official: true },
    { name: 'quote', label: 'Quote', description: 'Blockquotes with caption', official: true },
    { name: 'warning', label: 'Warning', description: 'Alert/warning boxes', official: true },
    { name: 'code', label: 'Code', description: 'Code blocks (basic)', official: true },
    { name: 'codeFlask', label: 'Code (Highlight)', description: 'Code with syntax highlighting', official: false },
    { name: 'delimiter', label: 'Delimiter', description: 'Visual separator', official: true },
    { name: 'table', label: 'Table', description: 'Create/edit tables', official: true },
    { name: 'embed', label: 'Embed', description: 'YouTube, Vimeo, Twitter, etc.', official: true },
    { name: 'raw', label: 'Raw HTML', description: 'Insert raw HTML', official: true },
    { name: 'image', label: 'Image', description: 'Upload images by file/URL', official: true },
    { name: 'simpleImage', label: 'Simple Image', description: 'Image via URL only', official: true },
    { name: 'linkTool', label: 'Link Preview', description: 'Link cards with metadata', official: true },
    { name: 'attaches', label: 'Attaches', description: 'File attachments', official: true },
    { name: 'mediaLib', label: 'Media Library', description: 'Strapi Media Library', official: false },
    { name: 'personality', label: 'Personality', description: 'Author/person card with photo', official: true },
    { name: 'alert', label: 'Alert', description: 'Colorful alert messages', official: false },
    { name: 'toggle', label: 'Toggle', description: 'Collapsible content blocks', official: false },
    { name: 'button', label: 'Button', description: 'CTA buttons', official: false },
  ],
  inlineTools: [
    { name: 'marker', label: 'Marker', description: 'Highlight text', official: true },
    { name: 'inlineCode', label: 'Inline Code', description: 'Code formatting', official: true },
    { name: 'underline', label: 'Underline', description: 'Underline text', official: true },
    { name: 'strikethrough', label: 'Strikethrough', description: 'Strike through text', official: false },
    { name: 'tooltip', label: 'Tooltip', description: 'Add tooltips to text', official: false },
    { name: 'hyperlink', label: 'Hyperlink', description: 'Links with target/rel', official: false },
  ],
  tunes: [
    { name: 'textVariant', label: 'Text Variant', description: 'Call-out, citation, details', official: true },
    { name: 'alignmentTune', label: 'Alignment', description: 'Text alignment', official: false },
    { name: 'indentTune', label: 'Indent', description: 'Block indentation', official: false },
  ],
  plugins: [
    { name: 'undo', label: 'Undo/Redo', description: 'History management', official: false },
    { name: 'dragDrop', label: 'Drag & Drop', description: 'Reorder blocks by drag', official: false },
  ],
};

export default getTools;
