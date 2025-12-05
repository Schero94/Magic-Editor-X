# Magic Editor X

> **Advanced block-based Custom Field for Strapi v5 powered by Editor.js with Real-Time Collaboration**

[![NPM Version](https://img.shields.io/npm/v/magic-editor-x.svg)](https://www.npmjs.com/package/magic-editor-x)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Strapi v5](https://img.shields.io/badge/Strapi-v5-7C3AED.svg)](https://strapi.io)
[![Editor.js](https://img.shields.io/badge/Editor.js-2.31.0-000.svg)](https://editorjs.io)

---

## Overview

**Magic Editor X** is a Strapi v5 **Custom Field** that provides a powerful block-based editor using [Editor.js](https://editorjs.io/). Unlike regular WYSIWYG replacements, this plugin registers as a proper Custom Field, making it available in the Content-Type Builder.

### Key Features

- **Custom Field** - Proper Strapi v5 Custom Field (not WYSIWYG replacement)
- **18+ Block Types** - Headers, paragraphs, lists, quotes, code, tables, and more
- **Real-Time Collaboration** - Multiple users can edit simultaneously with live cursors
- **Media Library Integration** - Use Strapi's built-in Media Library
- **Image Upload** - Upload by file or URL
- **Link Previews** - OpenGraph metadata for rich link embeds
- **Inline Formatting** - Bold, italic, underline, highlight, code
- **Keyboard Shortcuts** - Fast editing with keyboard commands
- **Clean Output** - JSON-based structured content
- **Y.js Powered** - Conflict-free real-time sync using CRDT technology

---

## Pricing

Magic Editor X offers a freemium model. **The editor itself is completely FREE** - you only pay for extended collaboration features.

| Feature | FREE | PREMIUM ($9.90/mo) | ADVANCED ($24.90/mo) |
|---------|------|---------------------|----------------------|
| Full Editor Access | Yes | Yes | Yes |
| All Editor Tools | Yes | Yes | Yes |
| Real-Time Sync | Yes | Yes | Yes |
| Collaborators | 2 | 10 | Unlimited |
| Version History | - | Yes | Yes |
| AI Assistant | - | Usage-based | Full Access |
| Priority Support | - | Yes | Yes |

**Upgrade at:** https://store.magicdx.dev/

---

## Quick Start

### Installation

```bash
npm install magic-editor-x
# or
yarn add magic-editor-x
```

### Enable Plugin

Add to `config/plugins.ts`:

```typescript
export default () => ({
  'magic-editor-x': {
    enabled: true,
    config: {
      collaboration: {
        enabled: true, // Enable real-time collaboration
      },
    },
  },
});
```

### Build & Start

```bash
npm run build
npm run develop
```

### Use in Content-Type Builder

1. Open **Content-Type Builder**
2. Add a new field
3. Go to **Custom** tab
4. Select **Magic Editor X**
5. Configure options and save!

---

## Real-Time Collaboration

Magic Editor X includes built-in real-time collaboration powered by Y.js and Socket.io.

### How it Works

1. When a user opens a content entry with a Magic Editor X field, they automatically join a collaboration room
2. Changes are synced in real-time using Y.js CRDT (Conflict-free Replicated Data Types)
3. Remote cursors show where other users are editing
4. Presence indicators show who is currently in the document

### Managing Collaborators

Navigate to **Plugins > Magic Editor X > Collaboration** in the Strapi admin panel to:

- Add collaborators with different roles (Viewer, Editor, Owner)
- Set permissions per content type
- View current collaborator usage vs. your plan limit

### Collaboration Roles

| Role | View | Edit | Manage Permissions |
|------|------|------|-------------------|
| Viewer | Yes | No | No |
| Editor | Yes | Yes | No |
| Owner | Yes | Yes | Yes |

---

## Available Tools

### Block Tools

| Tool | Description | Shortcut |
|------|-------------|----------|
| **Header** | H1-H4 headings | `CMD+SHIFT+H` |
| **Paragraph** | Basic text block | - |
| **List** | Ordered & unordered | `CMD+SHIFT+L` |
| **Checklist** | Interactive checkboxes | `CMD+SHIFT+C` |
| **Quote** | Blockquotes with caption | `CMD+SHIFT+Q` |
| **Warning** | Alert/warning boxes | `CMD+SHIFT+W` |
| **Code** | Code blocks | `CMD+SHIFT+P` |
| **Delimiter** | Visual separator | `CMD+SHIFT+D` |
| **Table** | Create/edit tables | `CMD+SHIFT+T` |
| **Embed** | YouTube, Vimeo, Twitter, etc. | - |
| **Raw HTML** | Insert raw HTML | - |
| **Image** | Upload by file/URL | - |
| **Media Library** | Strapi Media Library | - |
| **Link** | Link previews | - |

### Inline Tools

| Tool | Description | Shortcut |
|------|-------------|----------|
| **Bold** | Bold text | `CMD+B` |
| **Italic** | Italic text | `CMD+I` |
| **Underline** | Underline text | `CMD+U` |
| **Marker** | Highlight text | `CMD+SHIFT+M` |
| **Inline Code** | Code formatting | `CMD+SHIFT+I` |
| **Link** | Add hyperlinks | `CMD+K` |

---

## Custom Field Options

When adding the field in Content-Type Builder, you can configure:

### Base Settings
- **Placeholder** - Custom placeholder text

### Advanced Settings
- **Minimum Height** - Editor minimum height in pixels (default: 300)

---

## Output Format

Magic Editor X outputs clean JSON:

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
        "text": "This is a paragraph with <b>bold</b> text."
      }
    }
  ],
  "version": "2.31.0"
}
```

---

## API Endpoints

### Editor Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/magic-editor-x/link?url=...` | Fetch link metadata |
| POST | `/api/magic-editor-x/image/byFile` | Upload image by file |
| POST | `/api/magic-editor-x/image/byUrl` | Upload image by URL |

### License Endpoints (Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/magic-editor-x/license/status` | Get license status |
| GET | `/magic-editor-x/license/limits` | Get current limits |
| POST | `/magic-editor-x/license/auto-create` | Auto-create FREE license |
| POST | `/magic-editor-x/license/store-key` | Activate existing license |

### Collaboration Endpoints (Admin)

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/magic-editor-x/collaboration/permissions` | List all permissions |
| POST | `/magic-editor-x/collaboration/permissions` | Add collaborator |
| PUT | `/magic-editor-x/collaboration/permissions/:id` | Update permission |
| DELETE | `/magic-editor-x/collaboration/permissions/:id` | Remove collaborator |

---

## Security

For link previews to display images, update CSP in `config/middlewares.js`:

```javascript
module.exports = [
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        directives: {
          'img-src': ['*'],
        },
      }
    },
  },
];
```

---

## Roadmap

- [x] **Collaboration** - Real-time collaborative editing with Socket.io
- [ ] **AI Integration** - AI-powered content suggestions (coming soon)
- [ ] **Custom Blocks** - Create your own custom block types
- [ ] **Version History** - Track content changes

---

## Resources

- [Strapi Custom Fields Documentation](https://docs.strapi.io/cms/features/custom-fields)
- [Editor.js Documentation](https://editorjs.io/)
- [Y.js Documentation](https://docs.yjs.dev/)
- [MagicDX Store](https://store.magicdx.dev/)

---

## License

MIT License - see [LICENSE](LICENSE)

---

**Made by [Schero D.](https://github.com/Schero94)**

*Part of the MagicDX Plugin Suite*
