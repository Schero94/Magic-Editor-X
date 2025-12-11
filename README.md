# Magic Editor X

**Advanced Block-Based Content Editor for Strapi v5 with Real-Time Collaboration**

[![NPM Version](https://img.shields.io/npm/v/magic-editor-x.svg)](https://www.npmjs.com/package/magic-editor-x)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Strapi v5](https://img.shields.io/badge/Strapi-v5-7C3AED.svg)](https://strapi.io)
[![Editor.js](https://img.shields.io/badge/Editor.js-2.31.0-000.svg)](https://editorjs.io)

---

## 🆕 What's New in v1.2.0

- **Character-Level Collaboration** - Multiple users can now type in the same paragraph simultaneously without conflicts
- **Webtools Links Integration** - Optional integration with PluginPal's Webtools Links addon for internal/external link management
- **Improved Fullscreen Mode** - Blocks now stretch to full width, Media Library modal works correctly
- **Performance Improvements** - Removed debug logging, optimized Y.js sync

---

## Introduction

Magic Editor X is a production-ready Strapi v5 Custom Field that brings the power of Editor.js to your content management workflow. Unlike traditional WYSIWYG replacements or plugins that override Strapi's default editor, Magic Editor X integrates as a **proper Custom Field** in Strapi's Content-Type Builder, giving you complete control over when and where to use it.

Built on proven technologies like Editor.js for the editing interface and Y.js for conflict-free real-time collaboration, this plugin provides a modern, extensible content editing experience that scales from solo developers to large editorial teams.

### Why Magic Editor X? :)

**For Developers:**
- Clean JSON output instead of unstructured HTML
- 25+ pre-configured Editor.js tools out of the box
- Type-safe content structure with versioned schemas
- Real-time collaboration with CRDT (Conflict-free Replicated Data Types)
- Full TypeScript support with proper type definitions
- Extensible architecture for custom block types

**For Content Teams:**
- Familiar Medium-style block editor experience
- Live collaborative editing with presence indicators
- Keyboard shortcuts for fast content creation
- Inline formatting without toolbar clutter
- Media Library integration for asset management
- AI-powered content suggestions (premium)

---

## Screenshots

### Editor Interface
![Magic Editor X Interface](https://raw.githubusercontent.com/Schero94/magic-editor-x/main/pics/editorX.png)

### Real-Time Collaboration
![Live Collaboration](https://raw.githubusercontent.com/Schero94/magic-editor-x/main/pics/collab-magiceditorX.png)

### Collaboration Widget
![Collaboration Panel](https://raw.githubusercontent.com/Schero94/magic-editor-x/main/pics/liveCollabwidget1.png)

---

## Architecture Overview

Magic Editor X follows a clean client-server architecture with three main components:

### Client-Side (Admin Panel)

```
admin/
├── src/
│   ├── components/
│   │   ├── EditorJS/           # Main editor component
│   │   ├── EditorTools/        # Custom tools (Button, Hyperlink, AI, WebtoolsLink)
│   │   ├── MediaLib/           # Strapi Media Library adapter
│   │   └── LiveCollaborationPanel.jsx  # Collaboration UI
│   ├── hooks/
│   │   ├── useMagicCollaboration.js    # Y.js & Socket.io integration
│   │   ├── useWebtoolsLinks.js         # 🆕 Webtools Links addon integration
│   │   ├── useAIAssistant.js           # AI features
│   │   └── useLicense.js               # License management
│   ├── utils/
│   │   └── YTextBinding.js     # 🆕 Y.Text <-> contenteditable binding
│   ├── config/
│   │   └── tools.js            # Editor.js tools configuration
│   └── index.js                # Plugin registration
```

**Key Technologies:**
- **React 18** - UI components with hooks
- **Editor.js 2.31** - Block-based editor core
- **Y.js 13.6** - CRDT for real-time sync
- **Socket.io-client 4.8** - WebSocket communication
- **IndexedDB** - Local persistence via y-indexeddb

### Server-Side (Strapi Backend)

```
server/
├── src/
│   ├── controllers/
│   │   ├── editor-controller.js        # Image upload, link previews
│   │   ├── collaboration-controller.js # Permission management
│   │   ├── realtime-controller.js      # Session tokens
│   │   └── license-controller.js       # License validation
│   ├── services/
│   │   ├── realtime-service.js         # Y.js document management
│   │   ├── access-service.js           # Permission checks
│   │   ├── license-service.js          # License API
│   │   └── snapshot-service.js         # Document snapshots
│   ├── routes/
│   │   ├── admin.js            # Admin panel routes
│   │   └── content-api.js      # Public API routes
│   └── config/
│       └── index.js            # Plugin configuration
```

**Key Technologies:**
- **Socket.io 4.8** - WebSocket server
- **Y.js 13.6** - Server-side CRDT state
- **Open Graph Scraper** - Link metadata extraction
- **Strapi 5.31** - Backend framework

### Data Flow

1. **Editor Changes** → Y.js Document (CRDT) → Socket.io → Server → Other Clients
2. **Image Upload** → Strapi Controller → Strapi Upload Service → Media Library
3. **Link Preview** → Backend Scraper → OpenGraph Metadata → Client
4. **Collaboration** → Permission Check → Session Token → WebSocket Connection

---

## Features Deep Dive

### 1. Block-Based Content Structure

Magic Editor X stores content as structured JSON, not HTML. Each block has a unique ID, type, and data object:

```json
{
  "time": 1699999999999,
  "blocks": [
    {
      "id": "abc123",
      "type": "header",
      "data": {
        "text": "Hello World",
        "level": 2
      }
    },
    {
      "id": "def456",
      "type": "paragraph",
      "data": {
        "text": "This is <b>bold</b> and <i>italic</i> text."
      }
    },
    {
      "id": "ghi789",
      "type": "list",
      "data": {
        "style": "unordered",
        "items": [
          {
            "content": "First item",
            "items": []
          },
          {
            "content": "Second item with nested list",
            "items": [
              {
                "content": "Nested item",
                "items": []
              }
            ]
          }
        ]
      }
    }
  ],
  "version": "2.31.0"
}
```

**Benefits:**
- Predictable, type-safe content structure
- Easy to parse, transform, and render
- Version control friendly (no HTML diffs)
- Can be validated against JSON schemas
- Simple to migrate between systems

### 2. Real-Time Collaboration (CRDT Technology)

Magic Editor X uses Y.js, a battle-tested CRDT implementation, to enable true real-time collaboration without conflicts:

**How It Works:**

1. **Y.Doc Creation** - Each content entry gets a shared Y.js document
2. **Local Changes** - Edits create CRDT operations (not plain text diffs)
3. **Sync Protocol** - Operations are sent via Socket.io to the server
4. **Server Broadcast** - Server distributes operations to all connected clients
5. **Automatic Merge** - Y.js guarantees conflict-free merges (no "last write wins")
6. **Persistence** - Changes are stored in IndexedDB for offline capability

**🆕 Character-Level Collaboration (v1.2.0)**

Starting with v1.2.0, Magic Editor X supports **simultaneous editing within the same block**. Multiple users can type in the same paragraph at the same time without conflicts:

```
┌─────────────────────────────────────────────────────────┐
│  Before v1.2.0: Block-Level Sync                        │
│  User A edits Block 1 → User B's Block 1 changes lost   │
├─────────────────────────────────────────────────────────┤
│  After v1.2.0: Character-Level Sync                     │
│  User A types "Hello" → User B types "World" → "HelloWorld" │
│  Both changes merge seamlessly!                          │
└─────────────────────────────────────────────────────────┘
```

**Hybrid Data Structure:**
- `Y.Map` for block metadata (type, tunes, order)
- `Y.Text` for character-level content (rich text with formatting)
- `Y.Map` for document metadata (blockOrder, timestamps)

**Example: Collaborative Editing Flow**

```javascript
// Client A types "Hello" at position 0
const update = Y.encodeStateAsUpdate(yDoc);
socket.emit('collab:update', update);

// Server broadcasts to all clients
socket.broadcast.to(roomId).emit('collab:update', update);

// Client B applies the update
Y.applyUpdate(yDoc, update);
// Editor automatically re-renders with "Hello"
```

**Presence & Cursors:**

```javascript
// Awareness protocol for presence
awareness.setLocalStateField('cursor', {
  blockId: 'abc123',
  position: 42,
  user: {
    id: 'user-1',
    name: 'John Doe',
    color: '#FF6B6B'
  }
});

// Other clients receive cursor updates
awareness.on('change', ({ added, updated, removed }) => {
  // Render remote cursor indicators
  renderCursors(awareness.getStates());
});
```

### 3. 25+ Editor.js Tools

Magic Editor X comes with a comprehensive collection of tools, categorized for easy reference:

#### Block Tools (21 Tools)

| Tool | Description | Package | Shortcut |
|------|-------------|---------|----------|
| **Header** | H1-H6 headings with alignment | `@editorjs/header` | `CMD+SHIFT+H` |
| **Paragraph** | Text blocks with inline formatting | `@editorjs/paragraph` | - |
| **Nested List** | Multi-level ordered/unordered lists | `@editorjs/nested-list` | `CMD+SHIFT+L` |
| **Checklist** | Interactive todo lists | `@editorjs/checklist` | `CMD+SHIFT+C` |
| **Quote** | Blockquotes with caption | `@editorjs/quote` | `CMD+SHIFT+Q` |
| **Warning** | Alert boxes | `@editorjs/warning` | `CMD+SHIFT+W` |
| **Code** | Basic code blocks | `@editorjs/code` | `CMD+SHIFT+P` |
| **Code (Highlight)** | Syntax-highlighted code | `@calumk/editorjs-codeflask` | - |
| **Delimiter** | Visual section separator | `@editorjs/delimiter` | `CMD+SHIFT+D` |
| **Table** | Create/edit tables | `@editorjs/table` | `CMD+SHIFT+T` |
| **Embed** | YouTube, Vimeo, Twitter, etc. | `@editorjs/embed` | - |
| **Raw HTML** | Insert raw HTML | `@editorjs/raw` | - |
| **Image** | Upload by file or URL | `@editorjs/image` | - |
| **Simple Image** | Image by URL only | `@editorjs/simple-image` | - |
| **Link Preview** | Rich link cards with metadata | `@editorjs/link` | - |
| **Attaches** | File attachments | `@editorjs/attaches` | - |
| **Media Library** | Strapi Media Library picker | Custom | - |
| **Personality** | Author/person cards | `@editorjs/personality` | - |
| **Alert** | Colored alert messages | `editorjs-alert` | `CMD+SHIFT+A` |
| **Toggle** | Collapsible content blocks | `editorjs-toggle-block` | - |
| **Button** | CTA buttons | Custom | - |

#### Inline Tools (7 Tools)

| Tool | Description | Package | Shortcut |
|------|-------------|---------|----------|
| **Bold** | Bold text | Built-in | `CMD+B` |
| **Italic** | Italic text | Built-in | `CMD+I` |
| **Marker** | Highlight text | `@editorjs/marker` | `CMD+SHIFT+M` |
| **Inline Code** | Code formatting | `@editorjs/inline-code` | `CMD+SHIFT+I` |
| **Underline** | Underline text | `@editorjs/underline` | `CMD+U` |
| **Strikethrough** | Strike through text | `@sotaproject/strikethrough` | `CMD+SHIFT+S` |
| **Hyperlink** | Links with target/rel | Custom | `CMD+K` |
| **Tooltip** | Add tooltips to text | `editorjs-tooltip` | - |

#### Block Tunes (3 Tunes)

| Tune | Description | Package |
|------|-------------|---------|
| **Alignment** | Left, center, right, justify | `editorjs-text-alignment-blocktune` |
| **Indent** | Multi-level indentation | `editorjs-indent-tune` |
| **Text Variant** | Call-out, citation, details styles | `@editorjs/text-variant-tune` |

#### Plugins (2 Plugins)

| Plugin | Description | Package |
|--------|-------------|---------|
| **Undo/Redo** | History management | `editorjs-undo` |
| **Drag & Drop** | Reorder blocks by dragging | `editorjs-drag-drop` |

### 4. Media Library Integration

Seamless integration with Strapi's built-in Media Library:

```javascript
// Custom MediaLibAdapter bridges Editor.js and Strapi
class MediaLibAdapter {
  static get toolbox() {
    return {
      title: 'Media Library',
      icon: '<svg>...</svg>'
    };
  }

  render() {
    const button = document.createElement('button');
    button.textContent = 'Choose from Media Library';
    button.onclick = () => {
      // Opens Strapi's Media Library modal
      this.config.mediaLibToggleFunc();
    };
    return button;
  }

  save(blockContent) {
    return {
      url: blockContent.url,
      caption: blockContent.caption,
      alt: blockContent.alt
    };
  }
}
```

### 5. Webtools Links Integration (Optional)

Magic Editor X integrates seamlessly with the [Webtools Links addon](https://www.pluginpal.io/plugin/webtools) by PluginPal for enhanced link management:

**Features:**
- 🔗 **Internal Link Picker** - Select pages/entries from your Strapi content
- 🌐 **External URL Support** - Paste external URLs with validation
- ✏️ **Edit Existing Links** - Click on a link to edit its URL and text
- 🔍 **Link Detection** - Automatically detects when cursor is inside a link

**Setup:**

1. Install the Webtools Links addon (requires Webtools license)
2. Magic Editor X auto-detects the addon and enables the Link Picker button

**Usage:**

```javascript
// The integration uses Strapi's plugin API
const getPlugin = useStrapiApp('WebtoolsLinks', (state) => state.getPlugin);
const linksPlugin = getPlugin('webtools-addon-links');
const { openLinkPicker } = linksPlugin?.apis;

// Open picker with existing link data (for editing)
const result = await openLinkPicker({
  linkType: 'both',           // 'internal', 'external', or 'both'
  initialHref: existingUrl,   // Pre-fill for editing
  initialText: selectedText   // Pre-fill link text
});
```

**Without Webtools:**

If Webtools is not installed, a subtle promo link appears in the editor footer pointing to the addon store page.

---

### 6. AI-Powered Features (Premium)

Built-in AI assistant for content enhancement:

**Grammar Check:**
```javascript
// Automatically fix grammar and spelling
aiAssistant.check(text) → corrected text
```

**Style Improvement:**
```javascript
// Make text more professional, casual, or friendly
aiAssistant.rewrite(text, style: 'professional') → improved text
```

**Content Generation:**
```javascript
// Generate content based on prompts
aiAssistant.generate(prompt) → generated content
```

---

## Installation & Setup

### 1. Install Package

```bash
npm install magic-editor-x
# or
yarn add magic-editor-x
# or
pnpm add magic-editor-x
```

### 2. Enable Plugin

Create or update `config/plugins.ts` (or `.js`):

```typescript
export default () => ({
  'magic-editor-x': {
    enabled: true,
    config: {
      // Editor Configuration
      enabledTools: [
        'header', 'paragraph', 'list', 'checklist', 'quote',
        'warning', 'code', 'delimiter', 'table', 'embed',
        'raw', 'image', 'mediaLib', 'linkTool'
      ],
      
      // Upload Limits
      maxImageSize: 10 * 1024 * 1024, // 10MB
      allowedImageTypes: [
        'image/jpeg', 'image/png', 'image/gif', 
        'image/webp', 'image/svg+xml'
      ],
      
      // Link Previews
      linkPreviewTimeout: 10000, // 10 seconds
      
      // Real-Time Collaboration
      collaboration: {
        enabled: true,
        sessionTTL: 2 * 60 * 1000, // 2 minutes
        wsPath: '/magic-editor-x/realtime',
        wsUrl: null, // Auto-detect or set custom URL
        allowedOrigins: ['http://localhost:1337'],
        allowedAdminRoles: ['strapi-super-admin'],
        allowedAdminUserIds: [],
      },

      // API Response Settings
      api: {
        autoParseJSON: true, // Auto-parse JSON strings to objects in API responses
      },
    },
  },
});
```

### 3. Content Security Policy (Optional)

For link previews with external images, update `config/middlewares.ts`:

```typescript
export default [
  'strapi::logger',
  'strapi::errors',
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'connect-src': ["'self'", 'https:'],
          'img-src': [
            "'self'",
            'data:',
            'blob:',
            'market-assets.strapi.io',
            '*', // Allow external images for link previews
          ],
          'media-src': [
            "'self'",
            'data:',
            'blob:',
            'market-assets.strapi.io',
          ],
          upgradeInsecureRequests: null,
        },
      },
    },
  },
  'strapi::cors',
  'strapi::poweredBy',
  'strapi::query',
  'strapi::body',
  'strapi::session',
  'strapi::favicon',
  'strapi::public',
];
```

### 4. Build & Start

```bash
# Build admin panel with plugin
npm run build

# Start in development mode
npm run develop

# Or in production
npm run start
```

### 5. Add Field to Content Type

1. Navigate to **Content-Type Builder**
2. Select a content type or create a new one
3. Click **Add another field**
4. Go to the **Custom** tab
5. Select **Magic Editor X**
6. Configure field name and options
7. Click **Finish** and save the content type

---

## Configuration Reference

### Plugin Configuration

All options for `config/plugins.ts`:

```typescript
interface MagicEditorXConfig {
  // Tool Selection
  enabledTools?: string[]; // Default: all tools
  
  // Upload Settings
  maxImageSize?: number; // Bytes, default: 10MB
  allowedImageTypes?: string[]; // MIME types
  
  // Link Preview Settings
  linkPreviewTimeout?: number; // Milliseconds, default: 10000
  
  // API Response Settings
  api?: {
    autoParseJSON: boolean; // Auto-parse JSON strings to objects, default: true
  };
  
  // Collaboration Settings
  collaboration?: {
    enabled: boolean; // Default: true
    sessionTTL: number; // Milliseconds, default: 120000 (2 min)
    wsPath: string; // WebSocket path, default: '/magic-editor-x/realtime'
    wsUrl: string | null; // Custom WebSocket URL (for proxies)
    allowedOrigins: string[]; // CORS origins
    allowedAdminRoles: string[]; // Roles that can collaborate
    allowedAdminUserIds: number[]; // Specific user IDs
  };
}
```

### Field Options

When adding the field in Content-Type Builder:

**Base Settings:**
- **Placeholder** - Placeholder text (default: "Start writing or press Tab...")
- **Required** - Make field mandatory
- **Private** - Exclude from API responses

**Advanced Settings:**
- **Minimum Height** - Editor height in pixels (default: 300)
- **Max Length** - Maximum characters (optional)
- **Min Length** - Minimum characters (optional)

---

## API Response Format

### Automatic JSON Parsing

Magic Editor X automatically transforms JSON string fields into structured objects in API responses for better developer experience.

**Without auto-parsing (raw Strapi response):**
```json
{
  "data": {
    "id": 1,
    "documentId": "abc123",
    "editorX": "{\"time\":1699999999999,\"blocks\":[{\"id\":\"xyz\",\"type\":\"paragraph\",\"data\":{\"text\":\"Hello\"}}],\"version\":\"2.31.0\"}"
  }
}
```

**With auto-parsing (Magic Editor X middleware active):**
```json
{
  "data": {
    "id": 1,
    "documentId": "abc123",
    "editorX": {
      "time": 1699999999999,
      "blocks": [
        {
          "id": "xyz",
          "type": "paragraph",
          "data": {
            "text": "Hello"
          }
        }
      ],
      "version": "2.31.0"
    }
  }
}
```

**Configuration:**

Auto-parsing is enabled by default. To disable it, add to `config/plugins.ts`:

```typescript
{
  'magic-editor-x': {
    config: {
      api: {
        autoParseJSON: false // Disable automatic JSON parsing
      }
    }
  }
}
```

**Manual Parsing (if auto-parse is disabled):**

```javascript
// Client-side parsing
const response = await fetch('/api/articles/1');
const data = await response.json();

// Parse Editor.js field manually
const editorContent = JSON.parse(data.data.editorX);
console.log(editorContent.blocks); // Array of blocks
```

---

## API Reference

### Public API Endpoints

These endpoints are available for content-api usage:

#### Fetch Link Metadata

```http
GET /api/magic-editor-x/link?url=https://example.com
```

**Response:**
```json
{
  "success": 1,
  "meta": {
    "title": "Example Domain",
    "description": "Example domain for documentation",
    "image": {
      "url": "https://example.com/og-image.jpg"
    }
  }
}
```

#### Upload Image by File

```http
POST /api/magic-editor-x/image/byFile
Content-Type: multipart/form-data

files.image: <file>
```

**Response:**
```json
{
  "success": 1,
  "file": {
    "url": "https://cdn.example.com/image.jpg",
    "name": "image.jpg",
    "size": 123456
  }
}
```

#### Upload Image by URL

```http
POST /api/magic-editor-x/image/byUrl
Content-Type: application/json

{
  "url": "https://example.com/image.jpg"
}
```

**Response:**
```json
{
  "success": 1,
  "file": {
    "url": "https://cdn.example.com/image.jpg",
    "name": "image.jpg",
    "size": 123456
  }
}
```

### Admin API Endpoints

These endpoints require authentication and admin permissions:

#### License Management

```http
GET /magic-editor-x/license/status
GET /magic-editor-x/license/limits
POST /magic-editor-x/license/auto-create
POST /magic-editor-x/license/store-key
```

#### Collaboration Permissions

```http
GET /magic-editor-x/collaboration/permissions
POST /magic-editor-x/collaboration/permissions
PUT /magic-editor-x/collaboration/permissions/:id
DELETE /magic-editor-x/collaboration/permissions/:id
```

#### Real-Time Sessions

```http
POST /magic-editor-x/realtime/session-token
```

**Request:**
```json
{
  "roomId": "api::article.article|abc123|content",
  "fieldName": "content"
}
```

**Response:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresAt": 1699999999999
}
```

---

## Collaboration System

### Permission Model

Magic Editor X uses a flexible role-based permission system:

**Roles:**
- **Owner** - Full control (edit, delete, manage permissions)
- **Editor** - Can edit content
- **Viewer** - Read-only access

**Permission Scope:**
- Per content type (e.g., `api::article.article`)
- Per user or role
- Inherits from Strapi's built-in RBAC

### Managing Collaborators

Navigate to **Plugins > Magic Editor X > Collaboration** to:

1. **Add Collaborator**
   - Select user
   - Choose content type
   - Assign role (Viewer, Editor, Owner)
   
2. **Update Permission**
   - Change role
   - Modify content type access

3. **Remove Collaborator**
   - Revoke access

### Collaboration Limits

Limits are enforced based on your license:

| License | Concurrent Collaborators |
|---------|-------------------------|
| FREE | 2 |
| PREMIUM | 10 |
| ADVANCED | Unlimited |

**Note:** The editor itself is completely free. You only pay for extended collaboration features.

---

## Pricing

Magic Editor X follows a freemium model:

| Feature | FREE | PREMIUM | ADVANCED |
|---------|------|---------|----------|
| **Price** | $0 | $9.90/mo | $24.90/mo |
| Full Editor | Yes | Yes | Yes |
| All 25+ Tools | Yes | Yes | Yes |
| Real-Time Sync | Yes | Yes | Yes |
| Collaborators | 2 | 10 | Unlimited |
| Version History | - | Yes | Yes |
| AI Assistant | - | Pay-per-use | Included |
| Priority Support | - | Email | Email + Chat |
| Custom Blocks | - | - | Yes |

**Get started:** https://store.magicdx.dev/

---

## Development & Extension

### Custom Block Types

Create your own block tools:

```javascript
// custom-tools/MyCustomTool.js
export default class MyCustomTool {
  static get toolbox() {
    return {
      title: 'My Tool',
      icon: '<svg>...</svg>'
    };
  }

  constructor({ data, api, config }) {
    this.data = data;
    this.api = api;
    this.config = config;
  }

  render() {
    const wrapper = document.createElement('div');
    wrapper.classList.add('my-custom-tool');
    // Add your UI
    return wrapper;
  }

  save(blockContent) {
    return {
      // Your data structure
      text: blockContent.querySelector('input').value
    };
  }

  static get sanitize() {
    return {
      text: {} // Sanitizer config
    };
  }
}
```

**Register in `config/tools.js`:**

```javascript
import MyCustomTool from './custom-tools/MyCustomTool';

export const getTools = ({ mediaLibToggleFunc, pluginId }) => {
  return {
    // ... existing tools
    myCustomTool: {
      class: MyCustomTool,
      config: {
        // Your config
      }
    }
  };
};
```

### Extending Collaboration

Hook into collaboration events:

```javascript
// In your component
const { awareness } = useMagicCollaboration({
  enabled: true,
  roomId: 'my-room',
  onRemoteUpdate: () => {
    console.log('Remote update received');
  }
});

// Listen to presence changes
awareness.on('change', ({ added, updated, removed }) => {
  console.log('Users joined:', added);
  console.log('Users updated:', updated);
  console.log('Users left:', removed);
});
```

---

## Troubleshooting

### Common Issues

**1. Editor Not Loading**

Check browser console for errors. Common causes:
- Plugin not enabled in `config/plugins.ts`
- Build not run after installation (`npm run build`)
- CSP blocking external resources

**2. Image Upload Failing**

Verify:
- Strapi Upload plugin is enabled
- File size within limits (default 10MB)
- File type is allowed
- User has upload permissions

**3. Collaboration Not Working**

Debug checklist:
- WebSocket connection established (check Network tab)
- Session token valid (check `/realtime/session-token` response)
- User has collaboration permissions
- Firewall/proxy allows WebSocket connections

**4. Link Previews Not Showing**

Ensure:
- CSP allows `img-src: '*'` in middlewares config
- Target site returns OpenGraph metadata
- Link preview timeout not too short (default: 10s)

### Enable Debug Logging

Add to `config/plugins.ts`:

```typescript
{
  'magic-editor-x': {
    config: {
      debug: true // Enable verbose logging
    }
  }
}
```

---

## Roadmap

### ✅ Completed
- **Version History** - Track all content changes with snapshot restore (v1.1.0)
- **Character-Level Collaboration** - Simultaneous editing in same block (v1.2.0)
- **Webtools Links Integration** - Internal/external link picker (v1.2.0)

### 🚧 In Progress
- **Comments & Annotations** - Inline comments for editorial workflow
- **Custom Blocks API** - Simplified API for creating custom tools

### 📋 Planned
- **Advanced AI** - Content suggestions, auto-completion, tone analysis
- **Offline Mode** - Full offline editing with sync on reconnect
- **Import/Export** - Markdown, HTML, DOCX conversion
- **Templates** - Pre-built content templates
- **Block Permissions** - Per-block editing restrictions

---

## Resources

- **Documentation:** https://docs.magicdx.dev/
- **Store:** https://store.magicdx.dev/
- **GitHub:** https://github.com/Schero94/magic-editor-x
- **Strapi Custom Fields:** https://docs.strapi.io/cms/features/custom-fields
- **Editor.js:** https://editorjs.io/
- **Y.js:** https://docs.yjs.dev/

---

## Contributing

Contributions are welcome! Please:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

**Development Setup:**

```bash
git clone https://github.com/Schero94/magic-editor-x.git
cd magic-editor-x
npm install
npm run watch:link
```

---

## License

MIT License - See [LICENSE](LICENSE) for details

Copyright (c) 2024-2025 Schero D.

---

## Support

- **Email:** support@magicdx.dev
- **Issues:** https://github.com/Schero94/magic-editor-x/issues
- **Discord:** https://discord.gg/magicdx

---

**Built with dedication by [Schero D.](https://github.com/Schero94)**

Part of the MagicDX Plugin Suite for Strapi
