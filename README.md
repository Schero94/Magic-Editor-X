# ✒️ Magic Editor X

> **Advanced block-based Custom Field for Strapi v5 powered by Editor.js**

[![NPM Version](https://img.shields.io/npm/v/magic-editor-x.svg)](https://www.npmjs.com/package/magic-editor-x)
[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Strapi v5](https://img.shields.io/badge/Strapi-v5-7C3AED.svg)](https://strapi.io)
[![Editor.js](https://img.shields.io/badge/Editor.js-2.31.0-000.svg)](https://editorjs.io)

---

## 🌟 Overview

**Magic Editor X** is a Strapi v5 **Custom Field** that provides a powerful block-based editor using [Editor.js](https://editorjs.io/). Unlike regular WYSIWYG replacements, this plugin registers as a proper Custom Field, making it available in the Content-Type Builder.

### Key Features

- ✅ **Custom Field** - Proper Strapi v5 Custom Field (not WYSIWYG replacement)
- ✅ **18+ Block Types** - Headers, paragraphs, lists, quotes, code, tables, and more
- ✅ **Media Library Integration** - Use Strapi's built-in Media Library
- ✅ **Image Upload** - Upload by file or URL
- ✅ **Link Previews** - OpenGraph metadata for rich link embeds
- ✅ **Inline Formatting** - Bold, italic, underline, highlight, code
- ✅ **Keyboard Shortcuts** - Fast editing with keyboard commands
- ✅ **Clean Output** - JSON-based structured content
- ✅ **Editor.js 2.31.0** - Latest Editor.js version
- ✅ **Heroicons** - Beautiful icons throughout

---

## 🚀 Quick Start

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

## 📋 How It Works

Magic Editor X registers as a **Custom Field** in Strapi v5:

```
Content-Type Builder → Add Field → Custom → Magic Editor X
```

This follows the official Strapi Custom Fields API:
- [Strapi Custom Fields Documentation](https://docs.strapi.io/cms/features/custom-fields)

### Server Registration

```javascript
// server/src/register.js
strapi.customFields.register({
  name: 'richtext',
  plugin: 'magic-editor-x',
  type: 'text',
  inputSize: { default: 12, isResizable: true },
});
```

### Admin Registration

```javascript
// admin/src/index.js
app.customFields.register({
  name: 'richtext',
  pluginId: 'magic-editor-x',
  type: 'text',
  intlLabel: { id: '...', defaultMessage: 'Magic Editor X' },
  components: {
    Input: async () => import('./components/EditorJS'),
  },
});
```

---

## 🛠️ Available Tools

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

## ⚙️ Custom Field Options

When adding the field in Content-Type Builder, you can configure:

### Base Settings
- **Placeholder** - Custom placeholder text

### Advanced Settings
- **Minimum Height** - Editor minimum height in pixels (default: 300)

---

## 📊 Output Format

Magic Editor X outputs clean JSON:

```json
{
  "time": 1699999999999,
  "blocks": [
    {
      "type": "header",
      "data": {
        "text": "Hello World",
        "level": 2
      }
    },
    {
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

## 🔧 API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/magic-editor-x/link?url=...` | Fetch link metadata |
| POST | `/api/magic-editor-x/image/byFile` | Upload image by file |
| POST | `/api/magic-editor-x/image/byUrl` | Upload image by URL |

---

## 🛡️ Security

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

## 🔮 Roadmap

- [ ] **Collaboration** - Real-time collaborative editing with Socket.io
- [ ] **AI Integration** - AI-powered content suggestions
- [ ] **Custom Blocks** - Create your own custom block types
- [ ] **Version History** - Track content changes

---

## 📚 Resources

- [Strapi Custom Fields Documentation](https://docs.strapi.io/cms/features/custom-fields)
- [Editor.js Documentation](https://editorjs.io/)
- [Editor.js Plugins](https://github.com/editor-js)

---

## 📝 License

MIT License - see [LICENSE](LICENSE)

---

**Made with ❤️ by [Schero D.](https://github.com/Schero94)**

*Part of the MagicDX Plugin Suite*
