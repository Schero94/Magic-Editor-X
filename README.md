<p align="center">
  <img src="https://raw.githubusercontent.com/Schero94/Magic-Editor-X/main/docs/site/img/icon.svg" alt="Magic Editor X" width="96" height="96" />
</p>

# Magic Editor X

Block editor for Strapi 5: an [Editor.js](https://editorjs.io/) custom field with Media Library uploads, custom blocks, templates, block comments, version history, live collaboration across several servers, rendered Content API and GraphQL output, React and Vue components, and optional AI and grammar assistants that use your own provider. Free and open source under the MIT license.

[![npm](https://img.shields.io/npm/v/magic-editor-x)](https://www.npmjs.com/package/magic-editor-x)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue)](./LICENSE)

Live docs: <https://schero94.github.io/Magic-Editor-X/>

## Contents

- [Features](#features)
- [Screenshots](#screenshots)
- [Core concepts](#core-concepts)
- [Screens](#screens)
- [Compatibility](#compatibility)
- [Install](#install)
- [Configuration](#configuration)
- [Live collaboration](#live-collaboration)
- [Running several instances](#running-several-instances)
- [AI assistant](#ai-assistant)
- [Grammar check (LanguageTool)](#grammar-check-languagetool)
- [Field presets](#field-presets)
- [Writing tools](#writing-tools)
- [Templates, patterns and synced blocks](#templates-patterns-and-synced-blocks)
- [Comments](#comments)
- [Paste, import and migration](#paste-import-and-migration)
- [Version history](#version-history)
- [Quality checks](#quality-checks)
- [Data format](#data-format)
- [Rendering content](#rendering-content)
- [Content API and GraphQL output](#content-api-and-graphql-output)
- [Custom blocks in code (SDK)](#custom-blocks-in-code-sdk)
- [Admin API and permissions](#admin-api-and-permissions)
- [Security and privacy](#security-and-privacy)
- [Troubleshooting](#troubleshooting)
- [Upgrading from 2.2](#upgrading-from-22)
- [Migrating from 1.x](#migrating-from-1x)
- [Development and tests](#development-and-tests)
- [Maintenance status](#maintenance-status)
- [Languages](#languages)
- [License](#license)

## Features

Every feature is available in every installation. There is nothing to activate, no tiers and no usage limits. The plugin makes outgoing requests only for link previews, images by URL, the external link check and the AI provider and LanguageTool server the owner configured, and only when someone uses one of these features (see [Security and privacy](#security-and-privacy)).

- **Custom field** `plugin::magic-editor-x.richtext` (stored as JSON) for collection types, single types, components and dynamic zones, including localised fields and Draft & Publish.
- **Block tools** (block name in brackets, the same names 1.x used):
  - text: paragraph (`paragraph`), heading H1 to H6 (`header`), list with nesting, ordered and unordered (`list`), checklist (`checklist`), quote (`quote`), warning (`warning`), alert in eight colours (`alert`), collapsible toggle (`toggle`), delimiter (`delimiter`), table (`table`);
  - structure: table of contents built from the headings, with stable anchors (`toc`), synced block that shows shared content edited in one place (`synced`, see [Templates, patterns and synced blocks](#templates-patterns-and-synced-blocks));
  - code: plain code (`code`), code with syntax highlighting (`codeFlask`; Prism with plain text, JavaScript, TypeScript, JSX, TSX, JSON, HTML/XML, CSS, SCSS, Shell, Python, PHP, Ruby, Java, Kotlin, Swift, C#, C, C++, Go, Rust, SQL, GraphQL, YAML, Markdown, Dockerfile and diff);
  - media: image upload by file or URL into the Media Library (`image`, with alternative text and a focal point), picking images from the Media Library (`mediaLib`, inserts `image` blocks), image by URL without upload (`simpleImage`), gallery of Media Library images as grid or carousel (`gallery`), video and audio from the Media Library with captions and WebVTT tracks (`video`, `audio`), file attachments (`attaches`), embeds such as YouTube, Vimeo, CodePen, GitHub, Figma and others (`embed`);
  - other: link preview card (`linkTool`), person card (`personality`), call-to-action button (`button`), raw HTML (`raw`).
- **Inline tools:** bold, italic, link with target and rel (`hyperlink`, with a built-in picker that links an entry of your content types, see [Internal links](#internal-links)), mention of an entry (`mention`, Ctrl/Cmd+Shift+2), marker, underline, strikethrough, inline code, tooltip, and the AI assistant when it is enabled.
- **Block tunes:** alignment (`alignmentTune`), text variant call-out / citation / details (`textVariant`), indent (`indentTune`).
- **Field presets:** per field in the Content-Type Builder: allowed blocks and heading levels, character and block limits, required alternative text, allowed links, AI and live collaboration on or off, publishing guard. Enforced on every save and over the live channel, not only in the editor. See [Field presets](#field-presets).
- **Writing:** Markdown shortcuts (`#`, `-`, `1.`, `[]`, `>`, ` ``` `, `---`, `**bold**`, `_italic_`, `~~strike~~`, `` `code` ``), find and replace, keyboard shortcut help, focus mode, actions for several selected blocks, counts with reading time, a rendered preview of the field (Ctrl/Cmd+Alt+P), undo and redo, drag and drop, full screen. See [Writing tools](#writing-tools).
- **Templates, patterns and synced blocks:** reusable starting content and block sequences per field or preset, inserted from the editor toolbar, and synced blocks that every field shows from one source. See [Templates, patterns and synced blocks](#templates-patterns-and-synced-blocks).
- **Block comments:** threads on single blocks with replies, resolve and reopen, for editors and read-only reviewers, with their own permissions. See [Comments](#comments).
- **Paste and import:** Word, Google Docs, LibreOffice, web pages and Markdown become real blocks; a CLI migrates Strapi Blocks, Markdown and HTML fields. See [Paste, import and migration](#paste-import-and-migration).
- **Media:** alternative text and "decorative image" on image blocks and gallery images, a focal point that frontends keep visible when they crop; images keep their Media Library id and responsive formats.
- **Quality checks:** accessibility lint (alternative texts, heading order, link texts, table headers, contrast of custom colours, videos without captions, empty tables of contents), a link check and an optional scheduled check of every external link, with an optional publishing guard. See [Quality checks](#quality-checks).
- **Renderers, schema and types:** `magic-editor-x/render` (HTML, plain text, Markdown; framework-free and XSS-safe), React and Vue components (`magic-editor-x/react`, `magic-editor-x/vue`), guides for React, Vue/Nuxt and Astro, `magic-editor-x/schema` (JSON Schema) and `magic-editor-x/types` (TypeScript). See [Rendering content](#rendering-content).
- **Content API and GraphQL output:** `?mex=html|text|markdown|json` on Content API requests and `<field>Rendered` / `<field>Resolved` in GraphQL, with internal links, mentions, embedded entries, media and synced blocks resolved with the caller's permissions. See [Content API and GraphQL output](#content-api-and-graphql-output).
- **Custom blocks:** define your own blocks in Settings: simple blocks with fields (text, textarea, URL, number, select, checkbox, image, colour) and an optional HTML template, or embedded-entry blocks that link an entry of another content type. Import and export as JSON. Blocks that need code (own editor UI, strict data rules, own output) are defined once with the block SDK; see [Custom blocks in code (SDK)](#custom-blocks-in-code-sdk).
- **Version history:** named versions, a word-level comparison with the current content (tune changes shown as "Alignment: left → center"), restore of the whole field or a single block; automatic versions during live sessions.
- **Live collaboration:** several admins edit the same field at the same time with character-level merging, presence avatars and read-only viewers. Works with several Node processes behind a load balancer without sticky sessions.
- **AI assistant:** improve, fix grammar, shorten, expand, summarize, simplify, translate, change tone and continue writing, using Anthropic, OpenAI or any OpenAI-compatible server (for example a local model) with your own key. Optional, each behind its own owner switch: alternative text suggestions for images and translate or summarize a whole field. See [AI assistant](#ai-assistant).
- **Grammar check:** spelling and grammar of a whole field with a LanguageTool server (self-hosted or hosted), off until the owner turns it on. See [Grammar check (LanguageTool)](#grammar-check-languagetool).
- **Strapi-native admin:** built with the Strapi Design System, light and dark mode, keyboard accessible, admin in English, German, French, Spanish and Portuguese.
- **Safe content:** every value is normalised and sanitised on the server when it is saved, from the Content Manager, the Content API or code.

## Screenshots

|                                                                                   |                                                                                |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| ![Editor in the Content Manager, light mode](docs/site/img/editor-light-1440.png) | ![Editor in dark mode](docs/site/img/editor-dark-1440.png)                     |
| ![Two admins editing the same field](docs/site/img/collaboration-1440.png)        | ![Version history dialog](docs/site/img/history-1440.png)                      |
| ![AI assistant dialog](docs/site/img/ai-1440.png)                                 | ![Settings, configuration page](docs/site/img/settings-configuration-1440.png) |
| ![Settings, custom blocks list](docs/site/img/settings-custom-blocks-1440.png)    | ![Custom block form](docs/site/img/custom-block-modal-1440.png)                |

| ![Field presets in the Content-Type Builder](docs/site/img/field-presets-1440.png) | ![Content that does not match its field settings](docs/site/img/preset-problems-1440.png) |
| ![Find and replace](docs/site/img/find-replace-1440.png) | ![Quality checks and link check](docs/site/img/quality-panel-1440.png) |
| ![Version comparison with per-block restore](docs/site/img/history-diff-1440.png) | ![Image block with alternative text](docs/site/img/image-alt-1440.png) |
| ![Actions for several selected blocks](docs/site/img/block-actions-1440.png) | ![Keyboard shortcuts](docs/site/img/shortcuts-1440.png) |

New in 2.3:

|                                                                                                                                                                       |                                                                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ![Comments panel with an open thread and its reply, a resolved thread whose block was removed, and a comment marker next to a block](docs/site/img/comments-1440.png) | ![Comments panel in dark mode](docs/site/img/comments-dark-1440.png)                                                                                    |
| ![Insert a template or pattern dialog with a search, the pattern Release notes and its rendered preview](docs/site/img/templates-insert-1440.png)                     | ![Settings, Templates: patterns and a template with where they are offered, on/off switches and row actions](docs/site/img/templates-settings-1440.png) |
| ![The field as a rendered preview: heading, list, code with line numbers, table, image and quote](docs/site/img/preview-1440.png)                                     | ![A synced block Opening hours in the editor with the Edit source and Detach buttons](docs/site/img/synced-blocks-1440.png)                             |
| ![Gallery block in grid layout with two columns: three images with alternative texts, captions and focal points](docs/site/img/gallery-1440.png)                      | ![Video block with title, poster image and an English captions track, and an audio block](docs/site/img/video-audio-1440.png)                           |
| ![Focal point picker: the point marked on the image, its position in percent and a Reset focal point button](docs/site/img/focal-point-1440.png)                      | ![Table of contents block with its settings and the live list of headings, and two mention chips in the text](docs/site/img/toc-mentions-1440.png)      |
| ![Code block with the language Python and line numbers](docs/site/img/code-block-1440.png)                                                                            | ![Editor tool of a block defined in code with title, text, link and tone fields](docs/site/img/block-sdk-1440.png)                                      |
| ![Quality panel with the last scheduled link check: one broken link with status 404](docs/site/img/link-schedule-1440.png)                                            | ![Image block with an AI suggestion for the alternative text and the Use suggestion and Dismiss buttons](docs/site/img/ai-alt-text-1440.png)            |
| ![AI for the whole field dialog: translation into German, a note on what is sent and a preview per text](docs/site/img/ai-field-1440.png)                             | ![Grammar check panel with two LanguageTool issues and suggested replacements](docs/site/img/grammar-1440.png)                                          |

|                                                                        |                                                                           |                                                                   |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| ![Editor on a 390 px wide screen](docs/site/img/editor-mobile-390.png) | ![Comments panel on a 390 px wide screen](docs/site/img/comments-390.png) | ![Preview on a 390 px wide screen](docs/site/img/preview-390.png) |

All screenshots use synthetic data (acceptance host: Strapi 5.61.1).

## Core concepts

| Term         | Meaning                                                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Field        | One Magic Editor X attribute of a content type or component. Its value is an Editor.js document.                                                        |
| Block        | One entry of the document's `blocks` array, for example a paragraph or an image. Each block has an `id`, a `type` (the block name) and `data`.          |
| Custom block | A block type defined in Settings > Magic Editor X > Custom blocks, or in code with the block SDK. Its name becomes the block `type`.                    |
| Template     | Starting content for a field. Inserting it replaces the field content.                                                                                  |
| Pattern      | A group of blocks that editors insert anywhere in a field.                                                                                              |
| Synced block | Shared content edited once in Settings > Magic Editor X > Templates. A field stores only a reference (`{ ref }`) and shows the current source content.  |
| Thread       | A comment and its replies on one block of one field, document and locale. Threads are not part of the field value.                                      |
| Version      | A stored copy (snapshot) of one field of one document in one locale, listed in the version history.                                                     |
| Room         | The live editing session of one field of one document in one locale. A room exists while people edit and for `collaboration.roomTtlMinutes` afterwards. |
| Viewer       | Someone in a room who can read the document but not update it. Viewers see changes live but cannot type.                                                |

## Screens

| Screen                         | Where                                                                                            | Who can open it                                                                                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Editor field                   | Content Manager, edit view                                                                       | Everyone who can read the field. Uploads, version history and the AI assistant need the permissions in [Admin API and permissions](#admin-api-and-permissions). |
| Version history                | Clock button in the editor toolbar of a saved document                                           | `access` and Content Manager read on the document; saving, naming and restoring need update.                                                                    |
| Find and replace               | Magnifier button, or Ctrl/Cmd+Shift+F in the editor                                              | Everyone who can read the field; replacing needs update.                                                                                                        |
| Quality checks                 | Seal button in the editor toolbar (the number counts problems)                                   | Everyone who can read the field; the link check needs `access`.                                                                                                 |
| Keyboard shortcuts, focus mode | More (…) button, or Ctrl/Cmd+/                                                                   | Everyone who can read the field.                                                                                                                                |
| Field options                  | Content-Type Builder, Magic Editor X field, Basic and Advanced settings                          | Content-Type Builder access (development mode).                                                                                                                 |
| AI assistant                   | Inline toolbar (select text)                                                                     | `access` and `ai.use`, when an administrator turned the assistant on.                                                                                           |
| AI for the whole field         | More (…) button > AI for the whole field                                                         | `access` and `ai.use`, when the owner allowed whole-field AI actions and the field does not turn AI off.                                                        |
| Comments panel                 | Comments button in the editor toolbar (shows the open-thread count), or a block's comment marker | `access`, `comments.read` and Content Manager read on the document; writing needs `comments.write`, deleting others' comments `comments.moderate`.              |
| Insert template                | Insert template button in the editor toolbar                                                     | `access` and Content Manager read on the type; "Save content as template" and "Save as pattern" need `templates.manage`.                                        |
| Preview                        | Preview button in the editor toolbar, or Ctrl/Cmd+Alt+P                                          | Everyone who can read the field, read-only users included.                                                                                                      |
| Grammar check                  | Check grammar button in the editor toolbar                                                       | `access` and `grammar.use`, when the owner turned LanguageTool on.                                                                                              |
| Configuration                  | Settings > Magic Editor X > Configuration                                                        | `settings.read` (view), `settings.update` (edit).                                                                                                               |
| Custom blocks                  | Settings > Magic Editor X > Custom blocks                                                        | `custom-blocks.manage`.                                                                                                                                         |
| Templates                      | Settings > Magic Editor X > Templates (templates, patterns and synced blocks)                    | `templates.manage`.                                                                                                                                             |

## Compatibility

| Plugin | Strapi                                         | Node     | Notes                                                                                                                       |
| ------ | ---------------------------------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------- |
| 2.x    | 5.38 or later (acceptance host: Strapi 5.61.1) | 22 or 24 | SQLite, PostgreSQL and MySQL/MariaDB through the Strapi database connection. Acceptance runs used SQLite and PostgreSQL 16. |
| 1.x    | 5.x                                            | 22       | No longer developed.                                                                                                        |

- `engines.node` is `>=22.0.0 <=26.x.x`; the 2.3 acceptance ran on Node 22.23.1.
- The admin uses the React, React Router, react-intl, styled-components and Design System versions of the Strapi admin (React 18, Design System 2.2.4).
- The editor uses Editor.js 2.31.7. Editor.js 2.32.0 is still a release candidate on npm and is not used.
- `magic-editor-x/react` works with React 18 and 19 (peer `^18.0.0 || ^19.0.0`), in the browser and in server rendering, including React Server Components.
- `magic-editor-x/vue` needs Vue 3.5 or later (optional peer `^3.5.0`; it is never installed by the plugin).
- `magic-editor-x/render` and `magic-editor-x/blocks` have no dependencies and no Node built-ins, so they run in Node, browsers and edge runtimes.
- The GraphQL fields need `@strapi/plugin-graphql`; without it nothing is registered.

## Install

```bash
npm install magic-editor-x
```

Enable the plugin in `config/plugins.ts` (or `config/plugins.js`):

```ts
export default ({ env }) => ({
  'magic-editor-x': {
    enabled: true,
    config: {
      // optional, see Configuration
    },
  },
});
```

Then rebuild the admin and restart:

```bash
npm run build
npm run develop
```

Add the field in the Content-Type Builder: **Add another field > Custom > Magic Editor X**. In its settings you can set a placeholder, a preset and the other [field presets](#field-presets), and a minimum height (120 to 2000 px).

After the first start, Super Admins can use everything. Other roles need the plugin actions listed in [Admin API and permissions](#admin-api-and-permissions) (Settings > Administration Panel > Roles > Plugins > Magic Editor X).

## Configuration

### Reference

All keys are optional. Infrastructure options live in `config/plugins`; the AI provider is edited at runtime in Settings > Magic Editor X > Configuration.

| Key                                                       | Type                                     | Default                                                                                           | Effect                                                                                                                                                                                                                                                                                                                                                                          |
| --------------------------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `debug`                                                   | boolean                                  | `false`                                                                                           | Writes debug log lines (never content or personal data).                                                                                                                                                                                                                                                                                                                        |
| `rawHtml`                                                 | `'sanitize'` \| `'allow'` \| `'disable'` | `'sanitize'`                                                                                      | Raw HTML block on save: `sanitize` removes scripts, event handlers, iframes and unsafe URLs; `allow` stores the HTML as typed; `disable` empties it.                                                                                                                                                                                                                            |
| `sanitizeOnSave`                                          | boolean                                  | `true`                                                                                            | Normalise and sanitise Magic Editor X values on every Document Service write. Turning this off is not recommended.                                                                                                                                                                                                                                                              |
| `encryptionKey`                                           | string (32+ characters)                  | unset                                                                                             | Key for the stored AI provider key. Prefer the `MAGIC_EDITOR_X_ENCRYPTION_KEY` environment variable.                                                                                                                                                                                                                                                                            |
| `uploads.maxImageBytes`                                   | integer                                  | `10485760` (10 MiB)                                                                               | Largest image accepted by file or URL (hard cap 500 MiB).                                                                                                                                                                                                                                                                                                                       |
| `uploads.maxFileBytes`                                    | integer                                  | `20971520` (20 MiB)                                                                               | Largest attachment.                                                                                                                                                                                                                                                                                                                                                             |
| `linkPreview.enabled`                                     | boolean                                  | `true`                                                                                            | Link preview cards. When `false`, `GET /magic-editor-x/link` answers 404.                                                                                                                                                                                                                                                                                                       |
| `linkPreview.timeoutMs`                                   | integer                                  | `8000`                                                                                            | Time limit for fetching a page (1000 to 30000).                                                                                                                                                                                                                                                                                                                                 |
| `api.autoParseJSON`                                       | boolean                                  | `true`                                                                                            | Turn 1.x JSON strings into objects in Content API GET responses.                                                                                                                                                                                                                                                                                                                |
| `ai.allowPrivateBaseUrl`                                  | boolean                                  | `false`                                                                                           | Allow AI base URLs on loopback or private networks (for local models). Owner decision; not editable in the admin.                                                                                                                                                                                                                                                               |
| `ai.apiKey`                                               | string                                   | unset                                                                                             | Provider key from the environment. When set it wins over a key stored in the settings.                                                                                                                                                                                                                                                                                          |
| `ai.requestsPerMinute`                                    | integer                                  | `20`                                                                                              | AI requests per admin per minute, shared by all processes.                                                                                                                                                                                                                                                                                                                      |
| `ai.timeoutMs`                                            | integer                                  | `60000`                                                                                           | Time limit for one provider request.                                                                                                                                                                                                                                                                                                                                            |
| `languageTool.allowPrivateBaseUrl`                        | boolean                                  | `false`                                                                                           | Allow a LanguageTool base URL on loopback or private networks (self-hosted server in the LAN). Owner decision.                                                                                                                                                                                                                                                                  |
| `languageTool.requestsPerMinute`                          | integer                                  | `30`                                                                                              | Grammar checks per admin per minute, shared by all processes.                                                                                                                                                                                                                                                                                                                   |
| `languageTool.timeoutMs`                                  | integer                                  | `20000`                                                                                           | Time limit for one LanguageTool request.                                                                                                                                                                                                                                                                                                                                        |
| `collaboration.enabled`                                   | boolean                                  | `true`                                                                                            | Live collaboration and its Socket.IO server.                                                                                                                                                                                                                                                                                                                                    |
| `collaboration.path`                                      | string                                   | `'/magic-editor-x/realtime'`                                                                      | Socket.IO path on the Strapi HTTP server.                                                                                                                                                                                                                                                                                                                                       |
| `collaboration.allowedOrigins`                            | string[]                                 | `[]`                                                                                              | Extra browser origins allowed to open the socket. The admin URL and the server URL are always allowed.                                                                                                                                                                                                                                                                          |
| `collaboration.pollIntervalMs`                            | integer                                  | `400`                                                                                             | How often each process reads updates written by other processes (50 to 10000).                                                                                                                                                                                                                                                                                                  |
| `collaboration.roomTtlMinutes`                            | integer                                  | `30`                                                                                              | Keep a room's live state this long after the last person left.                                                                                                                                                                                                                                                                                                                  |
| `collaboration.maxMessageBytes`                           | integer                                  | `2097152` (2 MiB)                                                                                 | Largest accepted socket message.                                                                                                                                                                                                                                                                                                                                                |
| `collaboration.snapshotIntervalMinutes`                   | integer                                  | `10`                                                                                              | Automatic version while people edit live. `0` turns it off.                                                                                                                                                                                                                                                                                                                     |
| `collaboration.tokenTtlSeconds`                           | integer                                  | `60`                                                                                              | Lifetime of the one-time token that opens the socket.                                                                                                                                                                                                                                                                                                                           |
| `collaboration.maxConnectionsPerAdmin`                    | integer                                  | `20`                                                                                              | Open live sockets per admin across all processes.                                                                                                                                                                                                                                                                                                                               |
| `collaboration.maxRoomsPerAdmin`                          | integer                                  | `20`                                                                                              | Different fields one admin may have open live at the same time, across all processes.                                                                                                                                                                                                                                                                                           |
| `collaboration.revalidateSeconds`                         | integer                                  | `60`                                                                                              | Full permission re-check of open sockets. Role, permission and user changes are applied within about a second anyway.                                                                                                                                                                                                                                                           |
| `collaboration.rateLimit`                                 | object                                   | `{ sessionsPerMinute: 60, updatesPer10s: 300, bytesPer10s: 8388608 }`                             | Session tokens per admin and minute (shared by all processes), updates and update bytes per socket in 10 seconds.                                                                                                                                                                                                                                                               |
| `collaboration.compaction`                                | object                                   | `{ enabled: true, idleSeconds: 60, minBytes: 262144, ratio: 4, checkIntervalSeconds: 30 }`        | Rebuilds an idle room whose live state is `ratio` times larger than a fresh copy (and at least `minBytes`) as a new generation, once across all processes. Open editors switch without reconnecting; edits that had not reached the server yet are kept. Bounds: `idleSeconds` 15 to 86400, `minBytes` 1 KiB to 512 MiB, `ratio` 1.5 to 1000, `checkIntervalSeconds` 1 to 3600. |
| `history.maxSnapshotsPerField`                            | integer                                  | `50`                                                                                              | Versions kept per field and locale; older ones are deleted.                                                                                                                                                                                                                                                                                                                     |
| `comments.enabled`                                        | boolean                                  | `true`                                                                                            | Block comments in the editor. `false` hides them and the comment routes answer 404.                                                                                                                                                                                                                                                                                             |
| `comments.perMinute`                                      | integer                                  | `30`                                                                                              | New comments and replies one admin may post per minute, shared by all processes (1 to 1000).                                                                                                                                                                                                                                                                                    |
| `links.urlPattern`                                        | string                                   | `''`                                                                                              | `href` of internal links, for example `'/{locale}/{collection}/{slug}'` or `'https://www.example.com/{collection}/{documentId}'`. Placeholders: `{documentId}`, `{locale}`, `{slug}`, `{collection}`, `{singular}`. Empty means `'/{collection}/{documentId}'`. See [Internal links](#internal-links).                                                                          |
| `qualityChecks.externalLinks`                             | object                                   | `{ enabled: false, timeoutMs: 5000, perMinute: 30 }`                                              | External link check of the quality panel; keys below.                                                                                                                                                                                                                                                                                                                           |
| `qualityChecks.externalLinks.enabled`                     | boolean                                  | `false`                                                                                           | Lets the quality panel check external links (outgoing requests through the SSRF-protected fetcher; owner opt-in).                                                                                                                                                                                                                                                               |
| `qualityChecks.externalLinks.timeoutMs`                   | integer                                  | `5000`                                                                                            | Time limit per request and per redirect hop (1000 to 15000).                                                                                                                                                                                                                                                                                                                    |
| `qualityChecks.externalLinks.perMinute`                   | integer                                  | `30`                                                                                              | External URLs one admin may check per minute, shared by all processes.                                                                                                                                                                                                                                                                                                          |
| `qualityChecks.externalLinks.allowPrivateOrigins`         | string[]                                 | `[]`                                                                                              | Exact origins (for example an intranet host) that the link checks may reach although they resolve to a private address. Redirects from them are never followed.                                                                                                                                                                                                                 |
| `qualityChecks.externalLinks.schedule`                    | object                                   | `{ enabled: false, rule: '0 3 * * *', maxUrlsPerRun: 500, perMinute: 60, perHostConcurrency: 2 }` | Scheduled check of every external link in all editor fields (needs `externalLinks.enabled`); keys below.                                                                                                                                                                                                                                                                        |
| `qualityChecks.externalLinks.schedule.enabled`            | boolean                                  | `false`                                                                                           | Runs the scheduled check. One process in a cluster runs each check (lease).                                                                                                                                                                                                                                                                                                     |
| `qualityChecks.externalLinks.schedule.rule`               | string                                   | `'0 3 * * *'`                                                                                     | Cron rule (server time).                                                                                                                                                                                                                                                                                                                                                        |
| `qualityChecks.externalLinks.schedule.maxUrlsPerRun`      | integer                                  | `500`                                                                                             | Distinct URLs checked per run (1 to 10000).                                                                                                                                                                                                                                                                                                                                     |
| `qualityChecks.externalLinks.schedule.perMinute`          | integer                                  | `60`                                                                                              | Requests per minute for the whole run (1 to 600).                                                                                                                                                                                                                                                                                                                               |
| `qualityChecks.externalLinks.schedule.perHostConcurrency` | integer                                  | `2`                                                                                               | Requests in flight per host (1 to 8).                                                                                                                                                                                                                                                                                                                                           |

The validator rejects wrong types and ranges at startup and names the key, never the value. Keys from 1.x that no longer exist are ignored with a warning; see [Migrating from 1.x](#migrating-from-1x).

### Environment variables

| Name                            | Required                                                | Default | Effect                                                                                                                                                                                                                                                                                                                                                                                                                |
| ------------------------------- | ------------------------------------------------------- | ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAGIC_EDITOR_X_ENCRYPTION_KEY` | Only to store an AI or LanguageTool key in the settings | unset   | 32 or more characters. Encrypts the AI provider key and the LanguageTool key (AES-256-GCM). Without it the settings page cannot store a key; you can still pass one with `ai.apiKey`. Generate one with `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`. Keep it stable: a different key makes a stored provider key unreadable, and the settings page then asks you to enter it again. |

The plugin also uses Strapi's own `admin.auth.secret` (`ADMIN_JWT_SECRET`) to sign collaboration tokens. Every process of a cluster must use the same value.

### AI settings (admin)

Settings > Magic Editor X > Configuration stores these values in the Strapi store:

| Setting                                               | Default                                                                                                    | Range                                                                        |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Enabled                                               | off                                                                                                        |                                                                              |
| Provider                                              | `anthropic`                                                                                                | `anthropic`, `openai`, `openai-compatible`                                   |
| Base URL                                              | provider default (`https://api.anthropic.com`, `https://api.openai.com`); required for `openai-compatible` | https, or private hosts when `ai.allowPrivateBaseUrl` is on                  |
| Model                                                 | `claude-opus-5-5` (Anthropic), `gpt-6-luna` (OpenAI)                                                       | letters, digits and `._:/@-`                                                 |
| API key                                               | none                                                                                                       | never returned; changing the provider or base URL requires entering it again |
| Max input characters                                  | 8000                                                                                                       | 200 to 50000                                                                 |
| Max output tokens                                     | 4096                                                                                                       | 64 to 16000                                                                  |
| Send images to the AI provider (`ai.allowImages`)     | off                                                                                                        | Allows alternative text suggestions; see [AI assistant](#ai-assistant)       |
| Allow whole-field AI actions (`ai.allowFieldActions`) | off                                                                                                        | Allows translate and summarize of a whole field                              |

The same page has a **Grammar check (LanguageTool)** section; see [Grammar check (LanguageTool)](#grammar-check-languagetool). It also shows the scheduled link check read-only (rule, budget and the last run).

## Live collaboration

When a document has been saved once, the editor joins the room of its field. Everyone with Content Manager read access to that document, locale and field and the `collaborate` action can join; people with update access can type, others watch as viewers.

How it works:

- **Conflict-free structure.** The field is shared as a Yjs document in which every block has a stable id and every part of its data has its own shared type: texts merge character by character, and every table cell, list item, checklist entry, tune (alignment, text variant, indent) and custom block field is merged separately. Two people can edit different cells of one table, different items of one list, or the text and the alignment of one paragraph at the same time and both changes are kept. When two people change the same number, switch or option at the same moment, one value wins on every screen. The stored Editor.js JSON does not change.
- **Presence.** Avatars with first name and last initial (never e-mail addresses), coloured carets and selections of the others in the text, a coloured marker at the block someone is editing and an "away" state after a minute without activity or when the tab is hidden. Joins and leaves are announced politely to screen readers. Colours follow the light and dark theme; the caret does not blink when reduced motion is requested.
- **Connection state** in the toolbar: Connecting, Syncing, Live, Reconnecting, Offline, View only, or Live editing unavailable.
- **Offline and reconnects.** You can keep typing while the connection is gone. Unsent changes are kept, sent again after the reconnect and merged with what others did meanwhile, without duplicates. Reconnects use exponential backoff with jitter and a new one-time token; waking a laptop or returning to a tab reconnects at once. Closing the tab leaves the room immediately.
- **Undo and redo** (toolbar, Cmd/Ctrl+Z, Shift+Cmd/Ctrl+Z) only revert your own changes, never what others typed (the last 200 steps).
- **Saving.** Changes made by others become part of your form. Save, publish and discard work as usual. Version history restores into the live room, so everyone sees the restored content. Each locale has its own room.
- **Permissions** are checked when you join, re-checked within about a second when roles, permissions or users change (on every process), and every `collaboration.revalidateSeconds`. An admin who loses update access becomes a viewer; one who loses read access is disconnected.
- **Nothing typed is lost.** Edits are stored in the database before they are confirmed. When a room is cleaned up `collaboration.roomTtlMinutes` after the last person left and contains edits nobody saved, a version is created first, so they can be restored from the history.

Limits:

- A new entry that has not been saved yet has no room.
- Text formatting (bold, links, …) is part of the text; two people formatting the same word at the same moment can produce nested tags, which the sanitiser keeps valid.
- Up to 5000 blocks per field (the stored-content limit); rooms above 64 MiB of history refuse further edits until they are compacted.

## Running several instances

Collaboration works with several Node processes and several machines that share one database, for example Railway with 2 replicas and pm2 with 4 processes each, behind a load balancer **without sticky sessions**. No Redis is needed.

How it works:

- The browser connects with the WebSocket transport only. A WebSocket connection is one long-lived request, so it does not need sticky routing. Your proxy must allow WebSocket upgrades on `collaboration.path` (default `/magic-editor-x/realtime`) and send them to Strapi.
- The session token is signed with a key derived from `admin.auth.secret`, so any process can accept a token issued by another one. All processes must use the same `ADMIN_JWT_SECRET`.
- Every update is written to the table `magic_editor_x_collab_updates` before it is acknowledged. Other processes read new rows every `collaboration.pollIntervalMs` and send them to their own sockets.
- Presence is stored in `magic_editor_x_collab_presence` with heartbeats; leases and one-time keys in `magic_editor_x_locks`. Seeding a room, compaction, automatic versions and cleanup each run once across all processes.
- Every process keeps the active rooms in memory, checks every update before it is stored (only the structures the editor uses, every dependency present, every touched block valid within the content limits) and relays it.
- Clients resynchronise their state every 20 seconds and after each reconnect, so a process restart or deploy loses nothing that was acknowledged.
- Permission changes set a signal in `magic_editor_x_locks` that every process checks every second. Session, AI, link check, comment and grammar check rate limits are counted in `magic_editor_x_counters`, so they apply to the whole cluster.
- Every process fires the scheduled link check; a one-time key and a lease in `magic_editor_x_locks` let exactly one process run it. Its results are stored in `magic_editor_x_link_fields` and `magic_editor_x_link_urls`.
- Comments are read from the database (polled every 15 seconds while the field is visible, 8 seconds with the panel open), so they appear on every process.

The plugin creates these tables on startup. They are not content types, so Strapi's schema sync leaves them alone. Comments, templates and versions are content types of the plugin, hidden from the Content Manager.

Behind a proxy, also set `server.proxy` in `config/server` (`koa: true` and the number of trusted hops in `maxIpsCount`) so Strapi sees the real client address.

The acceptance run with several processes is described in [CONTRIBUTING.md](./CONTRIBUTING.md).

## AI assistant

The assistant is off until an administrator turns it on in Settings > Magic Editor X > Configuration and gives it a provider:

| Provider                                                | Request                                                                             | Default model (2026-11-11) |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------- | -------------------------- |
| Anthropic                                               | `POST {base}/v1/messages`, headers `x-api-key` and `anthropic-version: 2026-10-21`  | `claude-opus-5-5`          |
| OpenAI                                                  | `POST {base}/v1/chat/completions`, `Authorization: Bearer`, `max_completion_tokens` | `gpt-6-luna`               |
| OpenAI-compatible (Ollama, vLLM, LM Studio and similar) | `POST {base}/v1/chat/completions`, optional bearer key, `max_tokens`                | none; you name the model   |

- The key stays on the server. It is encrypted at rest with `MAGIC_EDITOR_X_ENCRYPTION_KEY` or read from `ai.apiKey`, and it is never sent to the browser or written to logs.
- The selected text (with its inline formatting) and a fixed instruction are sent to the provider. Nothing else from the document is sent. The text is never logged.
- Base URLs must be public https URLs. Loopback and private hosts are allowed only with `ai.allowPrivateBaseUrl: true` in `config/plugins`. Redirects are not followed.
- Input is limited by "Max input characters", output by "Max output tokens". Each admin can send `ai.requestsPerMinute` requests per minute; the counter is shared by all processes.
- The answer is sanitised to the inline tags the editor uses before it reaches the browser. The admin reviews the suggestion and chooses Replace selection; nothing changes before that.

### Alternative text and whole-field actions

Two more AI features use the same provider, key and rate limit. Each has its own switch in Settings > Magic Editor X > Configuration, off by default, with a note that says what is sent. Fields with `disableAi` answer 403 for both. Results are suggestions: the server never writes content.

| Feature                | Owner switch                                          | What is sent                                                                                                                                         | Result                                                                                                                                                                                                               |
| ---------------------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Alternative text       | Send images to the AI provider (`ai.allowImages`)     | One Media Library image (the largest stored size with a long edge up to 1568 px and at most 3.5 MB; JPEG, PNG, GIF or WebP) and the content language | "Suggest alternative text" on image blocks and on every gallery image; plain text up to 150 characters that the editor reviews and uses with "Use suggestion". Needs Media Library read on the file (404 otherwise). |
| Translate or summarize | Allow whole-field AI actions (`ai.allowFieldActions`) | The inline text of every block in the field, with its formatting and links. Images, files and other block data are not sent                          | More (…) > AI for the whole field. A translation is shown as a preview and replaces the texts in place (blocks, ids and settings stay; one undo step); a summary can be copied or inserted as a paragraph.           |

- Local files are read only from the `public/uploads` folder; remote files (for example a cloud upload provider) are fetched through the same SSRF-protected fetcher as link previews. The image type is taken from the file's bytes.
- A translation must return every text it was sent, exactly once, or nothing changes (502 `BAD_RESPONSE`); each text is sanitised again and links that were not in the original are removed. Fields over "Max input characters" answer 413.
- `POST /magic-editor-x/ai/image/alt-text` answers 503 `IMAGES_DISABLED` while images are off; `POST /magic-editor-x/ai/field/:action` answers 503 `FIELD_ACTIONS_DISABLED` while field actions are off.

## Grammar check (LanguageTool)

Editors with `grammar.use` can check the spelling and grammar of a whole field with "Check grammar" in the editor toolbar. Issues are highlighted in the text; a suggested replacement is applied only when the flagged text is still there and lies in one piece of text (not across formatting or a line break). The check is not AI: `disableAi` does not affect it.

It is off until an owner configures it in Settings > Magic Editor X > Configuration > **Grammar check (LanguageTool)**:

| Setting                   | Default  | Notes                                                                                                                                                                                          |
| ------------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Turn on the grammar check | off      | Nothing is sent while it is off or until an editor starts a check.                                                                                                                             |
| LanguageTool base URL     | empty    | Your own server or a hosted service, for example `https://languagetool.example.com`; requests go to `<base URL>/v2/check`. Public https only, unless `languageTool.allowPrivateBaseUrl` is on. |
| User name, API key        | empty    | Only for hosted accounts. The key is encrypted with `MAGIC_EDITOR_X_ENCRYPTION_KEY` (own key derivation), never returned, and must be entered again when the base URL or user name change.     |
| Rules                     | Standard | Standard or Strict (`level=picky`, adds style rules).                                                                                                                                          |

- **Test LanguageTool** checks a fixed sample sentence (`POST /magic-editor-x/settings/language-tool/test`); a test against another URL never receives the stored key.
- What is sent: the plain text of every block in the field and the language of the content locale (`en` becomes `en-US`, `de` `de-DE`, `pt` `pt-PT`; without a locale `auto`). Up to 60,000 characters per check in requests of at most 20,000; longer fields answer 413. At most 500 issues are shown.
- `languageTool.requestsPerMinute` limits checks per admin, shared by all processes; `languageTool.timeoutMs` limits one request.

## Field presets

Each Magic Editor X field can have its own rules, set in the Content-Type Builder (field settings). They are stored as custom field options in the schema and enforced in three places with the same code (`shared/presets.mjs`): the editor offers only what the field allows, the realtime server refuses new blocks a preset does not allow, and every write (Content Manager, Content API, imports, code) is checked by the Document Service middleware.

| Option (`options.*`)   | Where in the field settings | Values                                                                            | Effect                                                                                                                                                                |
| ---------------------- | --------------------------- | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `preset`               | Basic                       | `full` (default), `article`, `basic`, `minimal`                                   | Allowed blocks, inline tools and heading levels, see below.                                                                                                           |
| `linkTargets`          | Basic                       | `all` (default), `internal`, `external`, `none`                                   | Which links are allowed: entries of the site (internal links), web addresses, both or none. Link blocks (`linkTool`, `button`, `personality`) count as web addresses. |
| `requireAlt`           | Basic                       | checkbox                                                                          | Images need an alternative text or the "decorative image" mark.                                                                                                       |
| `allowedBlocks`        | Advanced                    | comma-separated block names, for example `paragraph, header, list, image, myHero` | Replaces the preset's block list (custom blocks by name). `paragraph` is always allowed.                                                                              |
| `headingLevels`        | Advanced                    | `2-4`, `2,3`, `1, 3-5`                                                            | Replaces the preset's heading levels.                                                                                                                                 |
| `maxBlocks`            | Advanced                    | number, empty or 0 = no limit                                                     | Block limit, shown in the toolbar (`12 / 20 blocks`).                                                                                                                 |
| `maxCharacters`        | Advanced                    | number, empty or 0 = no limit                                                     | Visible characters, counted like the toolbar (`380 / 400 characters`).                                                                                                |
| `disableAi`            | Advanced                    | checkbox                                                                          | No AI button in this field; the AI route answers 403 for requests from it.                                                                                            |
| `disableCollaboration` | Advanced                    | checkbox                                                                          | No live editing in this field (the session route answers 403).                                                                                                        |
| `publishGuard`         | Advanced                    | checkbox                                                                          | Publishing is refused while the [quality checks](#quality-checks) report errors in this field.                                                                        |

| Preset    | Blocks                                                                                                                                                                                                                                                            | Inline tools                                 | Headings |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | -------- |
| `full`    | all, custom blocks included                                                                                                                                                                                                                                       | all                                          | H1-H6    |
| `article` | paragraph, header, list, checklist, quote, warning, alert, toggle, code, codeFlask, delimiter, toc, synced, table, embed, image (and the Media Library picker), gallery, video, audio, linkTool, attaches, button, and code-registered blocks that list `article` | all                                          | H2-H4    |
| `basic`   | paragraph, header, list, quote, image, delimiter                                                                                                                                                                                                                  | bold, italic, underline, strikethrough, link | H2-H3    |
| `minimal` | paragraph, list                                                                                                                                                                                                                                                   | bold, italic, link                           | none     |

How the rules apply:

- **Editor:** blocks that are not allowed leave the toolbox, the conversion menu and paste handling; heading levels and inline tools are limited; Markdown shortcuts and pasted content follow the preset (a pasted H1 becomes the nearest allowed level, a table becomes text). Existing content that no longer fits is kept, listed under "Field settings" in the quality panel with **Fix automatically** (changes heading levels, turns blocks that are not allowed into paragraphs, removes links that are not allowed), and a note under the field says that saving fails until it is fixed.
- **Save:** a value that breaks a rule is refused with 400 `ValidationError`, `details.code: 'PRESET_VIOLATION'`, `details.violations: [{ field, code, blockId, index, params }]` (codes `BLOCK_NOT_ALLOWED`, `HEADING_LEVEL`, `LINK_NOT_ALLOWED`, `ALT_REQUIRED`, `TOO_MANY_BLOCKS`, `TOO_MANY_CHARACTERS`) and `details.errors` with the field path, so the Content Manager shows the reason on the field. Errors carry rule codes and block ids only, never content. Inline formatting a preset leaves out (for example a marker in a `basic` field) is removed on save; the text stays.
- **Live editing:** the server refuses updates that add a block type or heading level the preset does not allow (blocks that existed before stay editable). Limits and alternative texts are checked on save only, so typing is never refused half-way.

Changing a preset never changes stored content by itself. Turning `sanitizeOnSave` off also turns the save check off.

## Writing tools

| Tool                    | How                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Markdown shortcuts      | At the start of an empty paragraph: `#` to `######` + Space (heading), `-`, `*` or `+` + Space (bulleted list), `1.` + Space (numbered list, other numbers set the start), `[]` or `[x]` + Space (checklist), `>` + Space (quote), ` ``` ` (optionally with a language) + Enter (code block), `---` + Enter (delimiter). While typing: `**bold**`, `__bold__`, `*italic*`, `_italic_`, `~~strike~~`, `` `code` ``. Never inside code, raw HTML or tables; only blocks and marks the field allows. |
| Find and replace        | Magnifier button or Ctrl/Cmd+Shift+F. Searches every text block, list item, table cell, caption and code block; keeps formatting; match case, whole words, regular expressions (off by default, patterns up to 200 characters). Enter / Shift+Enter move between matches, the current match is highlighted. Replacements are normal edits (undo, collaboration). A match cannot span differently formatted text.                                                                                  |
| Keyboard shortcuts      | Ctrl/Cmd+/ or More > Keyboard shortcuts: editor, block and inline tool shortcuts and the Markdown shortcuts of this field.                                                                                                                                                                                                                                                                                                                                                                        |
| Focus mode              | More > Focus mode: full screen, narrower text column, other blocks dimmed. Escape leaves.                                                                                                                                                                                                                                                                                                                                                                                                         |
| Several selected blocks | Select across blocks (Shift+Arrow at a block edge, Ctrl/Cmd+A twice, or drag across blocks): move up or down, duplicate, copy as Markdown, delete, convert to text, heading, list or quote.                                                                                                                                                                                                                                                                                                       |
| Counts                  | Blocks, words, characters and reading time (200 words per minute) in the toolbar, with the field's limits.                                                                                                                                                                                                                                                                                                                                                                                        |
| Alternative text        | Image and image-by-URL blocks and every gallery image: "Alternative text" field (prefilled from the Media Library) and "Decorative image (no alternative text)". Required when the field has `requireAlt`. With the AI image switch on, "Suggest alternative text" (see [AI assistant](#alternative-text-and-whole-field-actions)).                                                                                                                                                               |
| Focal point             | Image blocks and gallery images: "Set focal point", then click or tap the image, or use the arrow keys (1 %, Shift for 10 %); Reset clears it. Frontends keep this point visible when they crop the image.                                                                                                                                                                                                                                                                                        |
| Mentions                | Select text and press the Mention button or Ctrl/Cmd+Shift+2: the internal-link picker opens with the selection as search text and the picked entry becomes a chip with its title. Backspace or Delete removes the whole chip. Offered when the field allows links to entries (`linkTargets` `all` or `internal`).                                                                                                                                                                                |
| Table of contents       | Block "Table of contents": title, heading levels (from, to) and list style. The editor shows a live preview from the headings; frontends build the list when they render.                                                                                                                                                                                                                                                                                                                         |
| Code language           | The code block's language select lists 27 languages (one list for the editor, highlighting and renderers). A language the list does not have (from older or imported content) is kept and highlighted as plain text.                                                                                                                                                                                                                                                                              |
| Preview                 | Preview button or Ctrl/Cmd+Alt+P: the field rendered with `magic-editor-x/react` as a frontend would show it (code line numbers on). Embeds appear as labelled links, links do not navigate, raw HTML only when the field allows it and after a second sanitising pass. The editor stays open in the background, so collaborators' edits show up live.                                                                                                                                            |
| Language and direction  | The editor gets the content locale as `lang` (spell checking) and writes right to left for Arabic, Hebrew, Persian, Urdu and other RTL locales.                                                                                                                                                                                                                                                                                                                                                   |

## Templates, patterns and synced blocks

Settings > Magic Editor X > **Templates** (permission `templates.manage`) holds three kinds of reusable content, each with a name, an optional description, its blocks (edited in an embedded editor), a scope and an on/off switch:

| Kind         | Stored as          | In the editor                                                                                                                                                                          |
| ------------ | ------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Template     | `kind: 'template'` | "Insert template" replaces the field content (with a confirmation when the field is not empty; Undo brings it back).                                                                   |
| Pattern      | `kind: 'pattern'`  | Inserted after the block you worked on last (or into an empty field).                                                                                                                  |
| Synced block | `kind: 'synced'`   | Inserted as a reference. The field stores `{ type: 'synced', data: { ref } }` and shows the current content of the source; a change to the source appears in every field that uses it. |

- **Scope:** every Magic Editor X field, or only fields with chosen presets and chosen fields. The "Insert template" dialog lists the enabled entries whose scope covers the field (searchable, with a preview).
- **Field rules apply:** blocks the field's preset does not allow are left out, heading levels and links are fixed like "Fix automatically", `maxBlocks` cuts the list, and every inserted block gets a new id. The dialog says how many blocks were left out or adjusted.
- **Saving from the editor:** managers can save the whole field ("Save content as template" in the dialog) or the selected blocks ("Save as pattern" in the block selection bar).
- **Limits:** 1 to 200 blocks and 256 KiB per entry, at most 500 entries. Blocks are cleaned with the same sanitiser as field values on every write; raw HTML is sanitised (or emptied when `rawHtml` is `disable`), never stored as typed.

Synced blocks in detail:

- In the editor a synced block shows "Synced block:" with the source name and the rendered source. **Edit source** (only with `templates.manage`) opens it in Settings; **Detach** replaces the reference with a copy of the blocks, which then become normal content of the field (one undo step). A deleted source shows "Synced block removed" and renders nothing.
- A source cannot contain another synced block, and its kind cannot change (400). Turning a source off only stops offering it for insertion; fields that reference it keep showing it.
- Sources have no Draft & Publish and are not localised: a saved change is live in published API output at once. Old versions of a field store the reference only, so they show the current source.
- Settings shows how often a source is used (entries, fields, templates and patterns; `GET /magic-editor-x/templates/:id/usage`, counts only). The count reads the stored data, so it includes changes made through the Content API, scripts or imports; on very large sites it stops after 200,000 rows or 20 seconds and says "at least".
- Synced blocks are offered only where the field's preset allows `synced` (`full` and `article`). Blocks of the source that the field does not allow are left out, and the editor says how many.
- Without `?mex`, the Content API returns the stored reference. With `?mex`, GraphQL `…Rendered`/`…Resolved` or the renderers' `synced` option, the source blocks are expanded in place (see [Content API and GraphQL output](#content-api-and-graphql-output)).

## Comments

Reviewers and editors can discuss single blocks without changing the content. The Comments button in the editor toolbar shows the number of open threads and opens the panel; each block with open threads gets a marker at its end.

- Start a thread on a chosen block, reply, resolve and reopen; edit or delete your own comments (deletion asks for confirmation). Resolved threads are hidden until you choose "Show resolved threads". A thread whose block was deleted stays readable and can be resolved.
- Comments are plain text (up to 4000 characters; control, bidi-override and zero-width characters are removed). They are never part of the field value, the version history or the Content API.
- Permissions: `comments.read` to see threads (plus Content Manager read on the document, locale and field), `comments.write` to comment, reply, resolve, reopen and edit or delete your own (no update right needed, so read-only reviewers can comment), `comments.moderate` to delete other people's comments or a thread with their replies.
- New comments appear for others within about 15 seconds (8 seconds with the panel open), on every process of a cluster.
- Limits: `comments.perMinute` per admin, 1000 comments per field and locale, 200 replies per thread.
- Deleting a document locale deletes its comments. Deleting an admin keeps their comments and shows them as "Deleted user". `comments.enabled: false` hides comments and the routes answer 404.

## Paste, import and migration

**Paste.** Pasting from Word, Google Docs, LibreOffice, web pages (two or more blocks) or Markdown text creates real blocks: headings, nested lists, checklists, quotes, code, tables, links, bold, italic, underline and strikethrough. Styles, classes, comments and scripts are removed; the clipboard HTML is parsed into an inert document and never attached to the page. Images from the web are copied into the Media Library through the same SSRF-protected path as "image by URL" (at most 10 per paste) when you may upload; images Word keeps on your disk (`file:`) cannot be pasted and are counted in a message. Blocks the field does not allow become paragraphs. Ctrl/Cmd+Shift+V pastes plain text. Pastes into code, raw HTML and table cells are not changed.

**Migrate an existing field.** Add a Magic Editor X field next to the old one, then run from the project root (the old field is kept):

```bash
npx magic-editor-x migrate --uid api::article.article --from body --to content            # dry run, writes nothing
npx magic-editor-x migrate --uid api::article.article --from body --to content --apply    # convert
```

Options: `--format auto|blocks|markdown|html` (auto: Blocks fields as Strapi Blocks, Rich text as Markdown, text and string as HTML when they contain tags, else Markdown, JSON as Strapi Blocks or Editor.js), `--locale <code>` or `--locale '*'` (all locales), `--overwrite` (replace a target that already has content), `--batch 50`, `--limit <n>`, `--json` (machine-readable report on stdout; Strapi's own log lines go to stderr), `--out report.json`. Re-running skips converted documents (idempotent). The report counts scanned, converted, skipped and failed documents and lists lossy conversions (for example a skipped image) by document id and note, never content. Drafts are converted; publish afterwards. The same is available in code: `strapi.plugin('magic-editor-x').service('migrate').run({ uid, from, to, format, locale, dryRun, overwrite })`.

## Version history

The clock button opens the versions of the field (per document and locale). **Save current version** stores the editor content, optionally with a name ("Before legal review", up to 120 characters); the pencil renames a version. Open a version with the eye button: **Preview** shows it, **Changes** compares it with the current editor content: added, removed, moved and changed blocks, changes marked word by word (`<ins>`/`<del>` with text labels, not colour alone), formatting-only changes and tune changes in words ("Alignment: left → center", "Indent: 0 → 1"; tunes that differ only in key order are not reported). A synced block appears as "Synced block" with its source name. **Restore this block** puts a single block back (at its old place, or over the current block); **Restore** replaces the whole field. Save the entry to keep a restore. Automatic versions are taken during live sessions (`collaboration.snapshotIntervalMinutes`).

## Quality checks

The seal button opens the quality panel; its number counts problems. It never blocks editing.

- **Accessibility lint** (`shared/quality.mjs`): images and gallery images without alternative text (an error when the field has `requireAlt`, otherwise a warning; decorative images are fine), skipped heading levels, more than one H1, empty headings, empty links (error), link texts such as "click here", "hier", "cliquez ici", "aquí", "clique aqui" (English, German, French, Spanish, Portuguese), tables without a header row, custom-block colour pairs below 4.5:1, videos without a captions or subtitles track (`video-no-captions`, warning) and a table of contents without headings in its level range (`toc-no-headings`, warning). Click an issue to jump to its block.
- **Field settings:** content that breaks the field's [preset](#field-presets), with automatic fixes.
- **Check links** (`POST /magic-editor-x/quality/links`): internal links and mentions (entries you cannot read answer "Not checked", so nothing is revealed; "Not published" for drafts of Draft & Publish types), Media Library files of image, gallery, video and audio blocks (needs Media Library read) and, only when `qualityChecks.externalLinks.enabled` is true, external links through the SSRF-protected fetcher (public addresses only, pinned DNS, redirects re-checked, HEAD then a capped GET, rate limited per admin across processes, cached for 10 minutes). URLs are never logged.
- **Scheduled link check** (opt-in): with `qualityChecks.externalLinks.enabled` and `qualityChecks.externalLinks.schedule.enabled`, a cron job (`schedule.rule`, server time, default 03:00 every day) scans every editor field of every `api::` type (top level, components, dynamic zones; drafts and published versions; all locales) and checks up to `maxUrlsPerRun` external URLs, least recently checked first, at `perMinute` requests per minute and `perHostConcurrency` per host. In a cluster one process runs each check. The quality panel shows the last result for the field ("Scheduled check": broken links with their status for the draft and the published version; Enter on a link moves to its block), and Settings > Configuration shows the rule and the last run. URLs not checked within the budget keep their earlier result. Strapi's docs ask hosts to set `cron: { enabled: true }` in `config/server`; set it when you turn the schedule on. The plugin refuses to start when the schedule is on and `externalLinks.enabled` is off.
- **Private hosts:** `qualityChecks.externalLinks.allowPrivateOrigins` lists exact origins (for example `https://intranet.example.test`) that both link checks may reach although they resolve to a private address. Redirects from them are not followed.
- **Publishing guard:** with the field option `publishGuard`, publishing a document whose field has errors answers 400 `details.code: 'QUALITY_GATE'` with `details.issues: [{ field, rule, blockId, locale? }]` and `details.errors` for the form. Warnings never block.

## Data format

The field stores an Editor.js document as JSON:

```json
{
  "time": 1762866000000,
  "version": "2.31.7",
  "blocks": [
    { "id": "kq1x9w0abc", "type": "header", "data": { "text": "Release notes", "level": 2 } },
    {
      "id": "kq1x9w0abd",
      "type": "paragraph",
      "data": { "text": "Read the <a href=\"https://example.test\">guide</a>." },
      "tunes": { "alignmentTune": { "alignment": "left" } }
    }
  ]
}
```

Data of each block type as stored after sanitising (`shared/sanitize-policy.mjs`):

| Block                       | `data`                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `paragraph`                 | `{ text }` (inline HTML)                                                                                                                                                                                                                                                                                                                                         |
| `header`                    | `{ text, level: 1-6 }`                                                                                                                                                                                                                                                                                                                                           |
| `list`                      | `{ style: 'ordered' \| 'unordered' \| 'checklist', meta?: { start?, counterType? }, items: [{ content, meta?, items: [...] }] }`                                                                                                                                                                                                                                 |
| `checklist`                 | `{ items: [{ text, checked }] }`                                                                                                                                                                                                                                                                                                                                 |
| `quote`                     | `{ text, caption, alignment: 'left' \| 'center' }`                                                                                                                                                                                                                                                                                                               |
| `warning`                   | `{ title, message }`                                                                                                                                                                                                                                                                                                                                             |
| `alert`                     | `{ type: 'primary' \| 'secondary' \| 'info' \| 'success' \| 'warning' \| 'danger' \| 'light' \| 'dark', align: 'left' \| 'center' \| 'right', message }`                                                                                                                                                                                                         |
| `toggle`                    | `{ text, status: 'open' \| 'closed', fk?, items }` (the next `items` blocks are its content)                                                                                                                                                                                                                                                                     |
| `code`                      | `{ code }` (plain text)                                                                                                                                                                                                                                                                                                                                          |
| `codeFlask`                 | `{ code, language, showlinenumbers? }`                                                                                                                                                                                                                                                                                                                           |
| `raw`                       | `{ html }` (see `rawHtml`)                                                                                                                                                                                                                                                                                                                                       |
| `table`                     | `{ withHeadings, stretched, content: string[][] }`                                                                                                                                                                                                                                                                                                               |
| `image`                     | `{ file: { url, mime?, alt?, width?, height?, size?, formats?, id?, documentId? }, caption, withBorder, withBackground, stretched, decorative?, focalPoint? }` (`id`/`documentId` reference the Media Library file, `formats` its responsive sizes; `decorative: true` = intentionally empty alternative text; `focalPoint: { x, y }` from 0 to 1, two decimals) |
| `gallery` (2.3)             | `{ images: [{ file, caption, decorative?, focalPoint? }] (at most 50), layout: 'grid' \| 'carousel', columns: 1-6 (default 3), caption }` (`file` like the image block; entries without a URL or with a non-image MIME type are dropped)                                                                                                                         |
| `video` (2.3)               | `{ file: { url, id?, documentId?, mime?, name?, hash?, ext?, width?, height?, size? }, poster?, title, caption, loop, muted, tracks }` (`file` must be `video/*`; `poster` an image file; no autoplay)                                                                                                                                                           |
| `audio` (2.3)               | `{ file, title, caption, loop, tracks }` (`file` must be `audio/*`)                                                                                                                                                                                                                                                                                              |
| video/audio `tracks`        | `[{ file, kind: 'captions' \| 'subtitles' \| 'descriptions' \| 'chapters', srclang, label, default? }]` (at most 8, WebVTT files only, at most one `default`)                                                                                                                                                                                                    |
| `toc` (2.3)                 | `{ title, minLevel: 1-6 (default 2), maxLevel: 1-6 (default 4), style: 'ordered' \| 'unordered' }` (only the settings are stored; the entries are built from the headings when rendering)                                                                                                                                                                        |
| `synced` (2.3)              | `{ ref }` (the `documentId` of a synced source, or `''` when invalid; nothing else is stored)                                                                                                                                                                                                                                                                    |
| `simpleImage`               | `{ url, caption, withBorder, withBackground, stretched, alt?, decorative? }`                                                                                                                                                                                                                                                                                     |
| `linkTool`                  | `{ link, meta: { title, description, site_name?, image?: { url } } }`                                                                                                                                                                                                                                                                                            |
| `attaches`                  | `{ file: { url, name?, extension?, size?, title? }, title }`                                                                                                                                                                                                                                                                                                     |
| `embed`                     | `{ service, source, embed, width?, height?, caption }` (`embed` is always https)                                                                                                                                                                                                                                                                                 |
| `personality`               | `{ name, description, link, photo }`                                                                                                                                                                                                                                                                                                                             |
| `button`                    | `{ text, link, style, openInNewTab }`                                                                                                                                                                                                                                                                                                                            |
| `delimiter`                 | `{}`                                                                                                                                                                                                                                                                                                                                                             |
| custom simple block         | `{ content, <field values>, blockType: 'simple', blockName }`                                                                                                                                                                                                                                                                                                    |
| custom embedded-entry block | `{ entry: { id, documentId, title, <display fields> }, contentType, displayMode }`                                                                                                                                                                                                                                                                               |
| block defined in code (SDK) | the keys of its `schema`, in declaration order (see [Custom blocks in code (SDK)](#custom-blocks-in-code-sdk))                                                                                                                                                                                                                                                   |

Before 2.3 a custom block could be named `gallery`, `video`, `audio` or `synced`. Stored blocks of such a type without the new block's key (`images`, `file`, `file`, `ref`) stay custom block data everywhere; new custom blocks cannot use these names.

Inline HTML may contain `b`, `strong`, `i`, `em`, `u`, `s`, `mark`, `code`, `a` (`href`, `target`, `rel`, `title`, and for internal links `data-mex-uid`, `data-mex-document-id`, `data-mex-locale`, plus `data-mex-mention="true"` for mentions), `br`, `span` (class `cdx-tooltip` with `data-tooltip`), `sub` and `sup`. Links allow `http`, `https`, `mailto`, `tel` and relative URLs. Escape plain-text fields (`code`, `personality`, `button.text`, link card text) when you render them.

### Internal links

The link tool (`CMD+K`) has a **Link to an entry** button: choose a content type, search by title (arrow keys move through the results, Enter picks, Escape closes) and the selected text becomes a link to that entry. The picker lists only the content types and entries you can read in the Content Manager, with its conditions and field permissions. The link is stored as plain HTML:

```html
<a
  href="/articles/x7k2m9q4p1v8"
  data-mex-uid="api::article.article"
  data-mex-document-id="x7k2m9q4p1v8"
  data-mex-locale="en"
  >our guide</a
>
```

- `href` is always a normal URL, so every frontend can render the link as it is. It is built on the server from `links.urlPattern` when the link is inserted: `{documentId}`, `{locale}` (empty for types without i18n; empty path segments are removed), `{slug}` (the first `uid` attribute of the type, or the documentId when there is none), `{collection}` (plural API name) and `{singular}` (singular API name). Values are URL-encoded. The pattern must be a site-relative path or an `http(s)` URL with a fixed host. Without a pattern the link is `/{collection}/{documentId}`.
- `data-mex-uid`, `data-mex-document-id` and `data-mex-locale` identify the entry, so a frontend can resolve the current URL itself (for example when a slug changed after the link was inserted). They are kept only when they are valid and only on `<a>`; a link whose address you edit by hand becomes a normal link.
- **Mentions** are internal links with `data-mex-mention="true"`; their text is the entry title at the time of insertion. Everything above applies to them (presets, link check, `resolveHrefs`, API output); renderers add `class="mex-mention"`, and the `links` resolver receives `mention: true`.
- **Links follow slug changes** because the entry reference is stored, not only the URL: render with `renderHtml(value, { links: ({ uid, documentId, locale, href }) => urlFor(uid, documentId, locale) })` (see [Rendering content](#rendering-content)), or in server code `await strapi.plugin('magic-editor-x').service('links').resolveHrefs(value, { status: 'published' })`, which re-renders every internal `href` from `links.urlPattern` and the entry's current slug (one query per type and locale; links to deleted entries keep their stored `href`; it does not check admin permissions, so use it for content the caller may already see).

Tunes are stored per block in `tunes`: `alignmentTune: { alignment }`, `textVariant: '' | 'call-out' | 'citation' | 'details'`, `indentTune: { indentLevel }`.

The Content API returns the object as stored. Entries saved with 1.x may still contain a JSON string until they are saved again; with `api.autoParseJSON` (default) the plugin parses such strings in Content API GET responses.

## Rendering content

`npm i magic-editor-x` also gives you a framework-free renderer (ESM and CommonJS, no dependencies, no Node built-ins, so it runs in Node, browsers and edge runtimes), a JSON Schema and TypeScript types:

```js
import { renderHtml, renderText, renderMarkdown } from 'magic-editor-x/render';

const html = renderHtml(entry.body, {
  links: ({ uid, documentId, locale, href }) => `/${locale}/articles/${slugs.get(documentId)}`, // internal links follow slug changes
  media: (file) => file, // refresh Media Library files by file.id / file.documentId if you like
  overrides: { myHero: (block, h) => `<section class="hero">${h.escape(block.data.title)}</section>` },
});
const text = renderText(entry.body); // search index, meta description
const markdown = renderMarkdown(entry.body); // feeds, LLM context, export
```

- **Safe by default:** stored inline HTML is re-parsed and only the editor's own tags and attributes survive (entities are decoded before URL checks, `javascript:`/`data:` links are dropped, `target="_blank"` gets `rel="noopener noreferrer"`), so the output is safe even for content that did not pass the server sanitiser. Raw HTML blocks are left out unless you pass `rawHtml: 'allow'` together with your own `sanitizeRaw` function. Embeds become iframes (`sandbox`, `loading="lazy"`, `referrerpolicy`) only for `embedHosts` (default: YouTube, youtube-nocookie, Vimeo player, CodePen, Twitch, Figma, Miro); other embeds become links.
- **Output:** HTML elements with stable `mex-` classes (tunes as `mex-align-*`, `mex-variant-*`, `mex-indent-N`), images with `srcset` from the Media Library `formats`, width, height and lazy loading (`imageSizes`, default `100vw`), decorative images with `alt=""`, toggles as `<details>`. Custom blocks render as `<div class="mex-block mex-<name>" data-mex-block>` with escaped values unless you pass an override. Markdown is CommonMark plus GFM tables and task lists; plain text uses blank lines between blocks.
- **Deterministic:** the same value always gives the same string.
- **Schema:** `magic-editor-x/schema` is a JSON Schema (draft 2020-12) of the stored value with one data schema per block type; validate content in CI. **Types:** `import type { MagicEditorXData, MagicEditorXBlock } from 'magic-editor-x/types'`.

### Options added in 2.3

All are off or neutral by default, so `renderHtml` output for existing content is the same as in 2.2 unless the value has a table of contents.

| Option       | Values                                                                                              | Effect                                                                                                                                                                                                                                                             |
| ------------ | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `code`       | `{ lineNumbers?: boolean \| 'block', copyButton?: boolean \| { label, copiedLabel, failedLabel } }` | Line numbers (`<span class="mex-code-line">` per line, numbers from CSS counters; `'block'` follows the block's own setting) and a copy button with a polite status region. Call `enhanceCodeBlocks()` in the browser to wire the buttons of server-rendered HTML. |
| `focalPoint` | `'data'` (default) \| `'style'`                                                                     | `data-mex-focal-x`/`data-mex-focal-y` on `<img>` (no inline style, works under a strict CSP), or also `style="object-position:X% Y%"`.                                                                                                                             |
| `headingIds` | `true` \| `false`                                                                                   | `id="mex-h-<blockId>"` on headings. Default: only when the value has a `toc` block. The anchor is the block id, so it survives text edits, reordering and translated locales.                                                                                      |
| `toc`        | `{ label? }`                                                                                        | `aria-label` of a table of contents without a title (default "Table of contents").                                                                                                                                                                                 |
| `blocks`     | array of `defineBlock` definitions                                                                  | Blocks defined in code (see [Custom blocks in code (SDK)](#custom-blocks-in-code-sdk)).                                                                                                                                                                            |
| `synced`     | `{ [ref]: document \| blocks }`, a `Map`, or `(ref) => document \| blocks \| null`                  | Sources of synced blocks. Without it, or for an unknown `ref`, a synced block renders nothing. The copies are cleaned and rendered like any block, and a table of contents lists their headings.                                                                   |

New block output: gallery as `<figure class="mex-gallery mex-gallery-<layout> mex-gallery-cols-<n>">` with a list of figures, video and audio as `<figure class="mex-video">`/`<figure class="mex-audio">` with native controls and `<track>` elements (never autoplay), the table of contents as `<nav class="mex-toc">` with nested `ol`/`ul` links to the heading ids, mentions as `<a class="mex-mention">`. Markdown output of a table of contents links to GitHub-style slugs of the heading text, because Markdown pipelines assign heading ids themselves.

`renderTree(value, options)` returns the same output as plain nodes (`{ type: 'element', tag, attrs, children }`, `{ type: 'text', value }`) for your own serialiser; `serializeNodes(nodes)` turns them into the `renderHtml` string.

```js
import { renderHtml } from 'magic-editor-x/render';

const html = renderHtml(entry.body, {
  synced: (ref) => sources.get(ref) ?? null, // sources you loaded, for example from ?mex=json
  code: { lineNumbers: 'block', copyButton: true },
  focalPoint: 'style',
});
```

### React and Vue components

`magic-editor-x/react` and `magic-editor-x/vue` export `MagicEditorXContent`, built on the same render tree as `renderHtml`: text stays text, URLs are validated, and `dangerouslySetInnerHTML`/`innerHTML` is used only for raw HTML blocks you opt in to with `rawHtml: 'allow'` and `sanitizeRaw`.

```jsx
import { MagicEditorXContent } from 'magic-editor-x/react';

<MagicEditorXContent
  value={article.content}
  options={{ code: { lineNumbers: 'block', copyButton: true } }}
  components={{ paragraph: ({ children }) => <div className="lead">{children}</div> }}
/>;
```

- Props: `value`, `options` (every option above) and `components` (per block type, receives `{ block, helpers, children }`; `children` is the default output). Vue also takes scoped slots `block-<type>`, which win over `components`.
- React 18 and 19, server rendering and React Server Components (the copy button needs a client component or `enhanceCodeBlocks()`); Vue 3.5 or later, also with Nuxt server rendering.
- Guides: [React](docs/guides/react.md), [Vue and Nuxt](docs/guides/vue-nuxt.md), [Astro](docs/guides/astro.md) (`renderHtml` with `set:html`, or the components as server-rendered islands, plus the CSS for line numbers and copy buttons).

## Content API and GraphQL output

Without extra parameters the Content API returns the stored value, as in 2.2. Add `?mex=` to a GET request to get the field rendered or resolved instead:

| `mex`      | Each Magic Editor X field becomes                                                   |
| ---------- | ----------------------------------------------------------------------------------- |
| `html`     | The rendered HTML string (`''` when empty)                                          |
| `text`     | Plain text                                                                          |
| `markdown` | Markdown                                                                            |
| `json`     | The stored document with resolved references (internal links, media, synced blocks) |

```http
GET /api/articles/k9d2w4xq8m1n0p3r5t7v9b1c?mex=text
Authorization: Bearer <API token>
```

```json
{
  "data": {
    "documentId": "k9d2w4xq8m1n0p3r5t7v9b1c",
    "title": "Release notes",
    "body": "Release notes\n\nRead our guide.\n\nShared footer"
  },
  "meta": {}
}
```

- Works on GET requests of Content API routes of `api::` content types (`find`, `findOne` and custom GET actions of the same controller), for fields at the top level, in components, in dynamic zones and in populated relations, in the flat and the `Strapi-Response-Format: v4` response. Admin and plugin routes and error responses are never changed. Any other value answers 400 (`details.param: 'mex'`). `mex` is registered with Strapi's `contentAPI.addQueryParams`, so it also passes with `api.rest.strictParams: true`.
- References are resolved with the caller's own permissions (API token or users-permissions role): a target entry is read only when the caller has `find` on its type, Media Library files only with the upload plugin's `find`, and every row goes through Strapi's output sanitising. Published versions are used unless the request asks for `status=draft`.
- Internal links and mentions get the `href` from `links.urlPattern` with the current slug; a resolved mention shows the entry's current title. A link the caller may not see, or that points to a missing or draft-only entry, is removed and only its text stays. Embedded entries (custom blocks) get the live display fields, or `entry: null`. Media Library files get their current URL and formats. Synced blocks are expanded with the containing field's sanitiser and preset; `json` output marks the copied blocks with `syncedFrom`.
- Raw HTML blocks are left out of `html`, `text` and `markdown`. Heading ids are written in `html` when the value has a table of contents.
- Bounds: 500 distinct references and 5 seconds per response; at most 100 distinct synced sources per response. References over the limit stay unresolved.

**GraphQL** (when `@strapi/plugin-graphql` is installed): for every Magic Editor X attribute `body` of an `api::` content type or component in the schema, the plugin adds `bodyRendered(format: MagicEditorXFormat = HTML): String` (`HTML`, `TEXT`, `MARKDOWN`) and `bodyResolved: JSON`, with the same resolution and permissions. Fields that are private, disabled through `shadowCRUD`, or that would clash with an existing attribute name are skipped.

```graphql
query {
  articles {
    title
    bodyRendered(format: HTML)
  }
}
```

In server code, `strapi.plugin('magic-editor-x').service('references').transform(items, { format, auth, status })` gives the same output.

## Custom blocks in code (SDK)

When a block needs real code (its own editor UI, strict data rules or frontend output you control), define it once with `defineBlock` from `magic-editor-x/blocks` and use the definition on the server, in the admin and in your frontend:

```js
import { defineBlock } from 'magic-editor-x/blocks';

export const calloutCard = defineBlock({
  name: 'calloutCard',
  title: 'Callout card',
  schema: {
    title: { type: 'text', max: 120 },
    body: { type: 'inline', max: 2000 },
    link: { type: 'url' },
    tone: { type: 'enum', values: ['info', 'success', 'warning'] },
  },
  presets: ['article'],
});
```

- **Server:** call `strapi.plugin('magic-editor-x').service('blocks').register(calloutCard)` in your app's `register()`. Every save cleans the block with its schema (unknown keys dropped, values bounded, URLs and inline HTML through the same policies as built-in blocks); presets, live collaboration, `?mex=` and GraphQL use it without further wiring. A Settings custom block with the same name stops Strapi from starting (`NAME_TAKEN`).
- **Admin:** in `src/admin/app.js`, call `app.getPlugin('magic-editor-x').apis.registerBlock({ definition, tool, title?, icon?, i18n?, inlineToolbar?, shortcut? })`; `apis.createReactTool(Component)` turns a React component into an Editor.js tool. Settings > Custom blocks lists code blocks read-only under "Defined in code".
- **Frontend:** pass `blocks: [calloutCard]` to `renderHtml`, `renderText`, `renderMarkdown` or the React/Vue components; give the definition a `render`, `text` or `markdown` function for your own output, or get a neutral default.
- Field types: `text`, `inline`, `url`, `enum`, `number`, `boolean`, `array`, `object`. `blockJsonSchema(definition)` returns the JSON Schema of the stored shape.

The full guide with the admin tool, field types and security notes is [docs/guides/custom-blocks-sdk.md](docs/guides/custom-blocks-sdk.md).

## Admin API and permissions

### Permissions

| Action                                        | Label in Roles                                                          | Gates                                                                                                                                                                                                                                                  |
| --------------------------------------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `plugin::magic-editor-x.access`               | Use the editor (uploads, link previews, custom blocks, version history) | Editor configuration, link previews, uploads (with the Media Library permission), content type list, internal-link search, custom block list, templates offered in a field, version history, link check, collaboration, comment, grammar and AI routes |
| `plugin::magic-editor-x.collaborate`          | Edit together in real time                                              | Joining live rooms                                                                                                                                                                                                                                     |
| `plugin::magic-editor-x.ai.use`               | Use the AI assistant                                                    | AI requests                                                                                                                                                                                                                                            |
| `plugin::magic-editor-x.custom-blocks.manage` | Manage custom blocks                                                    | Settings > Custom blocks and its routes                                                                                                                                                                                                                |
| `plugin::magic-editor-x.settings.read`        | Read settings                                                           | Settings > Configuration (read)                                                                                                                                                                                                                        |
| `plugin::magic-editor-x.settings.update`      | Update settings                                                         | Saving settings, testing the AI connection                                                                                                                                                                                                             |
| `plugin::magic-editor-x.comments.read`        | Read block comments                                                     | Comment threads in the editor (with Content Manager read on the document)                                                                                                                                                                              |
| `plugin::magic-editor-x.comments.write`       | Write block comments                                                    | New threads, replies, resolve and reopen, editing and deleting your own comments (no update right needed)                                                                                                                                              |
| `plugin::magic-editor-x.comments.moderate`    | Moderate block comments                                                 | Deleting other people's comments                                                                                                                                                                                                                       |
| `plugin::magic-editor-x.grammar.use`          | Use the grammar check (LanguageTool)                                    | The "Check grammar" toolbar button and `POST /grammar/check`                                                                                                                                                                                           |
| `plugin::magic-editor-x.templates.manage`     | Manage templates and block patterns                                     | Settings > Magic Editor X > Templates (templates, patterns and synced blocks, usage counts), "Save content as template" and "Save as pattern" in the editor, "Edit source" on synced blocks                                                            |

Uploads also need the Media Library action `plugin::upload.assets.create`. Version history and collaboration also apply the Content Manager permissions of the document: read access (including conditions such as "is creator", locale and field permissions) to list versions and join a room, update access to save versions, restore and type. A document you cannot read answers 404, the same as a document that does not exist.

Super Admins have all actions. The `access` action keeps its 1.x id, so roles that had it keep using the editor.

### Routes

All routes are admin routes served at `/magic-editor-x/...` and need an admin session (`Authorization: Bearer <admin JWT>`). There are no Content API routes; the Content API output of your own types is described in [Content API and GraphQL output](#content-api-and-graphql-output). Errors use the Strapi envelope `{ "data": null, "error": { "status", "name", "message", "details" } }`; validation errors carry `details.fieldErrors` keyed by field path. Editor.js tool routes answer `{ "success": 0, "message" }` on errors, as the tools expect.

| Method | Path                                          | Actions                                                        | Body / query                                                                                                                                                                              | Response                                                                                                                                                                        |
| ------ | --------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/magic-editor-x/config`                      | access                                                         |                                                                                                                                                                                           | `{ data: { collaboration, ai, grammar, uploads, linkPreview, quality, comments, rawHtml, codeBlocks, permissions } }`                                                           |
| GET    | `/magic-editor-x/link`                        | access                                                         | `?url=`                                                                                                                                                                                   | `{ success: 1, link, meta }`                                                                                                                                                    |
| POST   | `/magic-editor-x/image/byFile`                | access, upload                                                 | multipart `image`                                                                                                                                                                         | `{ success: 1, file: { url, ... } }`                                                                                                                                            |
| POST   | `/magic-editor-x/image/byUrl`                 | access, upload                                                 | `{ url }`                                                                                                                                                                                 | `{ success: 1, file }`                                                                                                                                                          |
| POST   | `/magic-editor-x/file/upload`                 | access, upload                                                 | multipart `file`                                                                                                                                                                          | `{ success: 1, file: { url, name, title, size, extension } }`                                                                                                                   |
| GET    | `/magic-editor-x/content-types`               | access                                                         |                                                                                                                                                                                           | `{ data: [{ uid, kind, displayName, attributes }] }` (types you can read)                                                                                                       |
| GET    | `/magic-editor-x/links/types`                 | access                                                         |                                                                                                                                                                                           | `{ data: [{ uid, kind, displayName, localized }] }` (API types you can read)                                                                                                    |
| GET    | `/magic-editor-x/links/search`                | access (+ Content Manager read)                                | `?uid=api::x.y&q=&locale=&page=` (`q` up to 100 characters)                                                                                                                               | `{ data: [{ documentId, uid, locale, title, href, status? }], meta: { pagination } }` (up to 20 readable entries; unknown or unreadable type 404)                               |
| GET    | `/magic-editor-x/custom-blocks`               | access (`?all=true` also needs custom-blocks.manage)           | `?all=true`                                                                                                                                                                               | `{ data: [block] }`                                                                                                                                                             |
| GET    | `/magic-editor-x/custom-blocks/export`        | custom-blocks.manage                                           |                                                                                                                                                                                           | `{ data: { format: 'magic-editor-x/custom-blocks', version: 2, exportedAt, blocks } }`                                                                                          |
| POST   | `/magic-editor-x/custom-blocks/import`        | custom-blocks.manage                                           | export document                                                                                                                                                                           | `{ data: { created: [name], skipped: [{ name, reason }] } }`                                                                                                                    |
| PUT    | `/magic-editor-x/custom-blocks/order`         | custom-blocks.manage                                           | `{ ids }` (every block once)                                                                                                                                                              | `{ data: [block] }`                                                                                                                                                             |
| POST   | `/magic-editor-x/custom-blocks`               | custom-blocks.manage                                           | block definition                                                                                                                                                                          | 201 `{ data: block }`                                                                                                                                                           |
| PUT    | `/magic-editor-x/custom-blocks/:id`           | custom-blocks.manage                                           | full block definition                                                                                                                                                                     | `{ data: block }`                                                                                                                                                               |
| DELETE | `/magic-editor-x/custom-blocks/:id`           | custom-blocks.manage                                           |                                                                                                                                                                                           | `{ data: { id } }`                                                                                                                                                              |
| POST   | `/magic-editor-x/custom-blocks/:id/duplicate` | custom-blocks.manage                                           |                                                                                                                                                                                           | 201 `{ data: block }`                                                                                                                                                           |
| GET    | `/magic-editor-x/templates`                   | access (`all=true`: templates.manage)                          | `?uid&field` or `?all=true`                                                                                                                                                               | `{ data: [template] }` (enabled templates offered in the field; unknown or unreadable field 404)                                                                                |
| GET    | `/magic-editor-x/templates/targets`           | access, templates.manage                                       |                                                                                                                                                                                           | `{ data: [{ uid, displayName, field, preset }] }`                                                                                                                               |
| PUT    | `/magic-editor-x/templates/order`             | access, templates.manage                                       | `{ ids }`                                                                                                                                                                                 | `{ data: [template] }`                                                                                                                                                          |
| GET    | `/magic-editor-x/templates/:id`               | access                                                         |                                                                                                                                                                                           | `{ data: template }` (disabled ones only for managers; synced sources always)                                                                                                   |
| GET    | `/magic-editor-x/templates/:id/usage`         | access, templates.manage                                       |                                                                                                                                                                                           | `{ data: { entries, fields, templates, complete } }` (synced sources: how often they are referenced, counts only)                                                               |
| POST   | `/magic-editor-x/templates`                   | access, templates.manage                                       | `{ name, description?, kind, blocks, scope, enabled? }`                                                                                                                                   | 201 `{ data: template }`                                                                                                                                                        |
| PUT    | `/magic-editor-x/templates/:id`               | access, templates.manage                                       | full definition                                                                                                                                                                           | `{ data: template }`                                                                                                                                                            |
| DELETE | `/magic-editor-x/templates/:id`               | access, templates.manage                                       |                                                                                                                                                                                           | `{ data: { id } }`                                                                                                                                                              |
| POST   | `/magic-editor-x/templates/:id/duplicate`     | access, templates.manage                                       |                                                                                                                                                                                           | 201 `{ data: template }` (disabled copy)                                                                                                                                        |
| POST   | `/magic-editor-x/collaboration/session`       | access, collaborate                                            | `{ uid, documentId, locale?, field, initialValue? }`                                                                                                                                      | `{ data: { token, path, canEdit, expiresAt } }`                                                                                                                                 |
| GET    | `/magic-editor-x/history`                     | access                                                         | `?uid&documentId&locale&field`                                                                                                                                                            | `{ data: [version], meta: { canRestore, canCreate } }`                                                                                                                          |
| GET    | `/magic-editor-x/history/:id`                 | access                                                         |                                                                                                                                                                                           | `{ data: { ...version, content } }`                                                                                                                                             |
| POST   | `/magic-editor-x/history`                     | access                                                         | `{ uid, documentId, locale?, field, content, label? }`                                                                                                                                    | 201 new version, 200 with `meta.created: false` when unchanged (a `label` then names the latest version)                                                                        |
| PUT    | `/magic-editor-x/history/:id`                 | access (+ Content Manager update)                              | `{ label }` (up to 120 characters, `''` or `null` clears)                                                                                                                                 | `{ data: version }`; 403 for read-only access, 404 without read access                                                                                                          |
| POST   | `/magic-editor-x/quality/links`               | access (+ Content Manager read per type, Media Library read)   | `{ internal?: [{ uid, documentId, locale? }] (max 100), media?: [id] (max 100), external?: [url] (max 20) }`                                                                              | `{ data: { internal: [{ uid, documentId, locale, status }], media: [{ id, status }], external: [{ url, status, code? }] } }`; 429 above `qualityChecks.externalLinks.perMinute` |
| GET    | `/magic-editor-x/quality/link-report`         | access (+ Content Manager read on the field)                   | `?uid&documentId&locale&field`                                                                                                                                                            | `{ data: { enabled, lastRun, draft, published } }` (last scheduled check of the field)                                                                                          |
| GET    | `/magic-editor-x/quality/link-schedule`       | settings.read                                                  |                                                                                                                                                                                           | `{ data: { enabled, scheduled, rule, maxUrlsPerRun, perMinute, perHostConcurrency, running, lastRun } }`                                                                        |
| POST   | `/magic-editor-x/quality/link-schedule/run`   | settings.read, settings.update                                 |                                                                                                                                                                                           | 202 `{ data: { started: true } }`; 409 `RUNNING`; 400 `DISABLED`                                                                                                                |
| GET    | `/magic-editor-x/comments`                    | access, comments.read (+ Content Manager read)                 | `?uid&documentId&locale&field`                                                                                                                                                            | `{ data: [thread], meta: { counts, canWrite, canModerate } }`                                                                                                                   |
| POST   | `/magic-editor-x/comments`                    | access, comments.read, comments.write (+ Content Manager read) | `{ uid, documentId, locale?, field, blockId, body (1-4000), excerpt? }`                                                                                                                   | 201 `{ data: thread }`; 429 above `comments.perMinute`                                                                                                                          |
| POST   | `/magic-editor-x/comments/:id/replies`        | access, comments.read, comments.write (+ Content Manager read) | `{ body }`                                                                                                                                                                                | 201 `{ data: comment }` (reopens a resolved thread)                                                                                                                             |
| PUT    | `/magic-editor-x/comments/:id`                | access, comments.read, comments.write (+ Content Manager read) | `{ body }`                                                                                                                                                                                | `{ data: comment }`; author only (403)                                                                                                                                          |
| POST   | `/magic-editor-x/comments/:id/resolve`        | access, comments.read, comments.write (+ Content Manager read) |                                                                                                                                                                                           | `{ data: { id, status, resolvedAt, resolvedBy } }`                                                                                                                              |
| POST   | `/magic-editor-x/comments/:id/reopen`         | access, comments.read, comments.write (+ Content Manager read) |                                                                                                                                                                                           | `{ data: { id, status, resolvedAt, resolvedBy } }`                                                                                                                              |
| DELETE | `/magic-editor-x/comments/:id`                | access, comments.read (+ Content Manager read)                 |                                                                                                                                                                                           | `{ data: { id, removed } }`; others' comments need comments.moderate (403)                                                                                                      |
| POST   | `/magic-editor-x/ai/:action`                  | access, ai.use                                                 | `{ text, language?, tone?, target: { uid, field } }`                                                                                                                                      | `{ data: { text } }`; 403 when the field turns AI off                                                                                                                           |
| POST   | `/magic-editor-x/ai/image/alt-text`           | access, ai.use (+ Media Library read)                          | `{ target: { uid, field }, fileId, locale? }`                                                                                                                                             | `{ data: { text } }`; 503 unless "Send images" is on                                                                                                                            |
| POST   | `/magic-editor-x/ai/field/:action`            | access, ai.use                                                 | `{ target, segments: [{ blockId, path, html }], language? }`                                                                                                                              | `{ data: { segments } }` or `{ data: { text } }`                                                                                                                                |
| POST   | `/magic-editor-x/grammar/check`               | access, grammar.use                                            | `{ target, segments, locale? }`                                                                                                                                                           | `{ data: { language, matches, truncated } }`                                                                                                                                    |
| GET    | `/magic-editor-x/settings`                    | settings.read                                                  |                                                                                                                                                                                           | `{ data: { ai, languageTool, environment } }` (no secrets)                                                                                                                      |
| PUT    | `/magic-editor-x/settings`                    | settings.read, settings.update                                 | `{ ai: { enabled, provider, baseUrl, model, maxInputChars, maxOutputTokens, allowImages?, allowFieldActions?, apiKey? }, languageTool?: { enabled, baseUrl, username, level, apiKey? } }` | `{ data: { ai, languageTool, environment } }`                                                                                                                                   |
| POST   | `/magic-editor-x/settings/ai/test`            | settings.read, settings.update                                 | `{ ai: {...} }`                                                                                                                                                                           | `{ data: { ok: true } }`                                                                                                                                                        |
| POST   | `/magic-editor-x/settings/language-tool/test` | settings.read, settings.update                                 | `{ languageTool: {...} }`                                                                                                                                                                 | `{ data: { ok: true } }`                                                                                                                                                        |

`upload` means `plugin::upload.assets.create`. AI actions: `improve`, `grammar`, `shorten`, `expand`, `summarize`, `simplify`, `translate` (with `language`), `tone` (with `tone`), `continue`. Provider problems answer with `name: 'AIProviderError'` and `details.code` (`DISABLED`, `NOT_CONFIGURED`, `NO_API_KEY`, `AUTH_FAILED`, `PROVIDER_RATE_LIMIT`, `TIMEOUT`, `REFUSED`, `PROVIDER_ERROR`). Too long text answers 413, too many requests 429.

Example: save a version.

```http
POST /magic-editor-x/history
Authorization: Bearer <admin JWT>
Content-Type: application/json

{ "uid": "api::article.article", "documentId": "k9d2w4xq8m1n0p3r5t7v9b1c", "locale": "en", "field": "body",
  "content": { "blocks": [{ "id": "a1", "type": "paragraph", "data": { "text": "Hello" } }] } }
```

```json
{
  "data": {
    "id": "s8f2k1x0w9q7e5r3t1y6u4i2",
    "version": 3,
    "trigger": "manual",
    "createdAt": "2026-11-11T09:30:00.000Z",
    "createdBy": "Anna Beispiel",
    "stats": { "blocks": 1, "words": 1, "characters": 5 },
    "restorable": true
  },
  "meta": { "created": true }
}
```

## Security and privacy

- **Stored content:** every Magic Editor X value is normalised and sanitised on save by a Document Service middleware (Content Manager, Content API, imports and code). Unknown keys of known block types are dropped, URLs are checked, inline HTML is limited to the tags above and the raw HTML block follows `rawHtml`. Values over 5 MiB, with more than 5000 blocks or nested deeper than 24 levels are rejected with 400, never truncated. The admin sanitises again before rendering (DOMPurify with the same rules).
- **Outgoing requests:** the plugin sends nothing on its own; there is no telemetry. What leaves the server, and when:

  | Request                      | When                                                                                     | What is sent                                                                                       |
  | ---------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
  | Link preview, image by URL   | An editor adds a link card or an image by URL (`linkPreview.enabled` for link cards)     | A GET request to that URL                                                                          |
  | Manual link check            | An editor presses "Check links" and `qualityChecks.externalLinks.enabled` is on          | HEAD (or a capped GET) to each external URL of the field                                           |
  | Scheduled link check         | The cron rule fires and `qualityChecks.externalLinks.schedule.enabled` is on             | HEAD (or a capped GET) to external URLs of all editor fields, within the run's budget              |
  | AI assistant                 | An editor runs an action on selected text, after the owner configured a provider         | The selected text and a fixed instruction                                                          |
  | AI alternative text          | An editor asks for a suggestion and the owner turned on "Send images to the AI provider" | One image file (at most 1568 px on the long edge, 3.5 MB) and the content language                 |
  | AI for the whole field       | An editor translates or summarizes and the owner turned on whole-field actions           | The inline text of every block in the field (no images, files or other block data)                 |
  | Grammar check (LanguageTool) | An editor presses "Check grammar" and the owner turned LanguageTool on                   | The plain text of every block in the field and its language, to the configured LanguageTool server |

  Link previews, images by URL and the link checks only fetch public http(s) addresses: the host is resolved once, every address must be public, the connection is pinned to that address, redirects are re-checked (at most 3), and size, type and time are limited. AI and LanguageTool base URLs must be public https URLs unless `ai.allowPrivateBaseUrl` or `languageTool.allowPrivateBaseUrl` is on; link-check origins on private networks need `qualityChecks.externalLinks.allowPrivateOrigins`.

- **Uploads** are checked by their first bytes (not by the file name or the browser's MIME type) and stored through the Media Library with the admin as creator.
- **Collaboration:** tokens are signed, bound to admin, document, locale and field, expire after `collaboration.tokenTtlSeconds` and work once on any process; the socket accepts the admin and server origins and `collaboration.allowedOrigins` and only clients of the current protocol; every update is checked (allowed structures only, no prototype keys, dependencies present, touched blocks valid) before it is stored or relayed, and a socket that keeps sending invalid updates is closed; names and colours of other people come from the server, never from a client; remote content is sanitised before the editor renders it; updates, sessions, sockets and rooms per admin are rate limited; viewers cannot write. See [docs/security-audit-2.1.md](./docs/security-audit-2.1.md).
- **Field presets** are enforced on the server (save middleware and realtime guard), not only in the editor; see [Field presets](#field-presets).
- **Paste, import and rendering:** pasted and imported HTML/Markdown is parsed into an inert document and rebuilt from the editor's own tags only, then sanitised again on save; `magic-editor-x/render` re-parses stored inline HTML and never trusts it. The link check fetches external URLs only when the owner turns it on, through the SSRF-protected fetcher, rate limited, without logging URLs. See [docs/security-audit-2.2.md](./docs/security-audit-2.2.md).
- **Content API and GraphQL output (2.3):** `?mex=` and the GraphQL fields resolve internal links, mentions, embedded entries, media and synced blocks with the caller's own permissions (`find` on the target type, upload `find` for media), read published versions unless the request asks for drafts, and pass every row through Strapi's output sanitising. Targets the caller may not read are handled like missing ones, so the output reveals neither their existence nor their titles or slugs. Without `?mex` the response is the stored value, which still carries stored hrefs and embedded-entry snapshots, as in 2.2.
- **React and Vue components (2.3)** use the same render tree as `renderHtml`; text is rendered as text and raw HTML only through your `sanitizeRaw`. The XSS corpus is rendered through all three outputs in the tests.
- **Comments, templates and synced blocks (2.3):** comment routes check the plugin actions and Content Manager read on the document, locale and field (404 otherwise); admin ids are never returned; comment text is plain text. Templates and synced sources are cleaned with the field sanitiser on every write and filtered by the field preset when inserted or expanded; a synced source cannot contain another synced block. Synced sources have no Draft & Publish, so an edit is live in published output at once.
- **Secrets:** the AI key and the LanguageTool key are encrypted with AES-256-GCM (random IV, versioned format, separate key derivation per purpose) and never returned. Changing the AI provider or base URL, or the LanguageTool base URL or user name, requires entering the key again, so a stored key cannot be sent to another host.
- **Logs** contain operation names and error codes only, never content, URLs with queries, tokens, user ids or email addresses.
- **Stored data:** custom block definitions, versions (field content and the admin who saved it), live rooms (Yjs updates, removed `collaboration.roomTtlMinutes` after the last person left), presence rows (admin display name, colour, caret position; removed when the socket closes or after missed heartbeats), comments (text, author id and display name; deleted with the document locale, anonymised when the admin is deleted), templates, patterns and synced sources (with the creator's display name) and, with the scheduled link check, the external URLs of editor fields with their last status.
- **Reviews:** [docs/security-audit-2.3.md](./docs/security-audit-2.3.md) covers every 2.3 surface (findings MEX-23-01 to MEX-23-14 with their controls and tests, and the residual risks).
- **Content Security Policy:** Editor.js and the Design System add inline styles, which Strapi's default `style-src 'unsafe-inline'` allows. The socket connects to the same origin as the admin, which `connect-src 'self'` covers; add the `wss:` origin only when the admin runs on another host. Embeds and external images in the editor preview need `frame-src` and `img-src` sources; see [Content Security Policy](#content-security-policy) below.

Report vulnerabilities privately through GitHub security advisories on the repository.

### Content Security Policy

Strapi's default admin CSP (`strapi::security`) has no `frame-src`, so embed iframes fall back to `default-src 'self'`, and its `img-src` allows only `'self'`, `data:`, `blob:` and `market-assets.strapi.io`. YouTube, Vimeo and the other embeds, and images from other hosts (for example link preview images), are therefore blocked in the editor preview. The stored content is not affected and your frontend has its own CSP.

The plugin never changes the CSP. Instead:

- **Settings > Magic Editor X > Configuration** shows a "Content Security Policy" notice when sources are missing: what is blocked and the exact `config/middlewares.js` snippet, with a copy button. The server reads the effective `strapi::security` configuration once at startup (string and object entries, `useDefaults`, `frame-src`, `child-src`, `default-src`, `img-src`) and returns it in `GET /magic-editor-x/settings` as `data.environment.csp` (`{ active, frameSrcMissing, imgSrcMissing, snippet }`). Only CSP sources are returned; browsers receive them in every response header anyway.
- **In the editor**, a blocked embed or image is replaced by a placeholder inside the block ("This embed is blocked by your Content Security Policy.") with a link to the settings page for admins who can read the settings. The block data is saved unchanged.

The snippet for Strapi's defaults (merge it into your existing `strapi::security` entry and keep your other directives, for example the hosts of your upload provider; Strapi merges arrays with its defaults by position):

```js
// config/middlewares.js
module.exports = [
  // ...other middlewares
  {
    name: 'strapi::security',
    config: {
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'frame-src': [
            "'self'",
            'https://www.youtube.com',
            'https://player.vimeo.com',
            'https://platform.twitter.com',
            'https://www.instagram.com',
            'https://codepen.io',
            'https://imgur.com',
            'https://assets.pinterest.com',
            'https://miro.com',
            'https://www.figma.com',
            'https://www.facebook.com',
          ],
          'img-src': ["'self'", 'data:', 'blob:', 'https://market-assets.strapi.io', 'https:'],
        },
      },
    },
  },
  // ...other middlewares
];
```

Add only the services you use. Instead of `https:` in `img-src` you can list your image hosts; the notice then counts external images as allowed. GitHub gist embeds load a `data:` iframe that inherits the admin CSP and needs a remote script, so they stay blocked under a strict policy, and Imgur's embed URL uses `http:`, which an `https` admin blocks as mixed content.

## Troubleshooting

| Symptom                                                                                 | Cause                                                                                                                                                                                 | Fix                                                                                                                     |
| --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| The field shows "The editor could not be loaded."                                       | The role lacks `plugin::magic-editor-x.access`, or the server is unreachable                                                                                                          | Grant the action; check the server log.                                                                                 |
| No upload or "You do not have permission to upload files"                               | The role lacks `plugin::upload.assets.create`                                                                                                                                         | Grant Media Library create to the role.                                                                                 |
| No version history (clock) button                                                       | The entry was never saved                                                                                                                                                             | Save the entry once.                                                                                                    |
| Badge shows "Live editing unavailable"                                                  | No `collaborate` action, no read access to the document, or `collaboration.enabled: false`                                                                                            | Grant the action or check the Content Manager permissions.                                                              |
| Badge stays at "Connecting" or "Reconnecting"                                           | The proxy does not forward WebSocket upgrades on `collaboration.path`, or the origin is not allowed                                                                                   | Allow upgrades on the path; add the admin origin to `collaboration.allowedOrigins` when the admin runs on another host. |
| "Reload the page to keep editing live"                                                  | The browser still runs the admin of an older version after an update                                                                                                                  | Reload the page.                                                                                                        |
| Settings say the API key cannot be stored                                               | `MAGIC_EDITOR_X_ENCRYPTION_KEY` is missing or shorter than 32 characters                                                                                                              | Set the variable and restart, or use `ai.apiKey`.                                                                       |
| Settings say the stored key is unreadable                                               | The encryption key changed                                                                                                                                                            | Enter the provider key again.                                                                                           |
| AI error "The AI provider rejected the key."                                            | Wrong key for this provider                                                                                                                                                           | Enter the key again and use Test connection.                                                                            |
| Startup error `[magic-editor-x] invalid configuration for: <key>`                       | Wrong type or range in `config/plugins`                                                                                                                                               | Fix the named key (see the reference table).                                                                            |
| 400 "A Magic Editor X field contains invalid content"                                   | The value is not editor JSON, too large or too deep                                                                                                                                   | Send an Editor.js object within the limits.                                                                             |
| 400 "A Magic Editor X field does not match its field settings"                          | The content breaks the field's preset (`details.violations` lists rule codes and block ids)                                                                                           | Open the quality panel of the field and use Fix automatically, or change the content or the field options.              |
| 400 "Quality checks failed for a Magic Editor X field" on publish                       | The field has `publishGuard` and the quality checks report errors                                                                                                                     | Fix the errors listed in the quality panel (missing alternative texts, empty links).                                    |
| 400 with `details.param: 'mex'` from the Content API                                    | `mex` has another value than `html`, `text`, `markdown` or `json`, or is repeated                                                                                                     | Send one of the four values once.                                                                                       |
| `?mex=html` shows link text without the link                                            | The caller may not read the linked entry, it is missing, or it has no published version                                                                                               | Grant `find` on the target type to the token or role, publish the entry, or request `status=draft` where appropriate.   |
| A synced block renders nothing in my frontend                                           | Without `?mex` the API returns only `{ ref }`; the renderers need the sources                                                                                                         | Use `?mex=` or the GraphQL fields, or pass the sources with the `synced` render option.                                 |
| "Synced block removed" in the editor                                                    | Its source was deleted in Settings > Templates                                                                                                                                        | Delete the block, or insert another synced block.                                                                       |
| No Comments or Check grammar button                                                     | Comments: the role lacks `comments.read`, `comments.enabled` is false, or the entry was never saved. Grammar: the role lacks `grammar.use`, or LanguageTool is off or has no base URL | Grant the action, save the entry once, or turn the feature on.                                                          |
| "Alternative text suggestions are turned off."                                          | "Send images to the AI provider" is off (503 `IMAGES_DISABLED`)                                                                                                                       | Turn it on in Settings > Magic Editor X > Configuration, if you accept that images are sent.                            |
| "The grammar check is not configured yet."                                              | LanguageTool is on but has no base URL                                                                                                                                                | Enter the base URL and use Test LanguageTool.                                                                           |
| Startup error `invalid configuration for: qualityChecks.externalLinks.schedule.enabled` | The schedule is on but `qualityChecks.externalLinks.enabled` is off                                                                                                                   | Turn on both, or neither.                                                                                               |
| Strapi does not start, `NAME_TAKEN`                                                     | A block registered with the SDK has the same name as a Settings custom block                                                                                                          | Rename one of them.                                                                                                     |

## Upgrading from 2.2

2.3 is a minor release. Stored content, routes and configuration keep working.

1. Update and rebuild the admin: `npm install magic-editor-x@latest && npm run build`.
2. Grant the new actions to roles that need them: `comments.read`, `comments.write`, `comments.moderate`, `templates.manage`, `grammar.use`.
3. Optional: turn on the AI image and whole-field switches and LanguageTool in Settings, and the scheduled link check (`qualityChecks.externalLinks.enabled` and `qualityChecks.externalLinks.schedule.enabled`, plus `cron: { enabled: true }` in `config/server`).
4. Optional: use `?mex=` or the GraphQL fields, or the React and Vue components, in your frontend.

A custom block named `gallery`, `video`, `audio` or `synced` that you created before 2.3 keeps working as a custom block; new custom blocks cannot use these names.

## Migrating from 1.x

2.0 is a major release. Stored content keeps working; routes, permissions and configuration changed. The full guide is in the [CHANGELOG](./CHANGELOG.md). In short:

1. Update the package and rebuild the admin: `npm install magic-editor-x@2 && npm run build`.
2. Remove 1.x configuration keys (`enabledTools`, `linkPreviewTimeout`, `maxImageSize`, `maxFileSize`, `allowedImageTypes`, `collaboration.wsPath`, `wsUrl`, `sessionTTL`, `allowedAdminRoles`, `allowedAdminUserIds`, `cors`) and use the new keys above.
3. Grant the new actions to your roles: `collaborate`, `ai.use`, `custom-blocks.manage`, `settings.read`, `settings.update`. Collaboration grants from 1.x are replaced by Content Manager permissions; Strapi drops the old tables on the first start.
4. If you used the AI assistant, configure your own provider in Settings > Magic Editor X > Configuration.
5. If your raw HTML blocks need scripts or iframes, set `rawHtml: 'allow'`.

On the first start the plugin converts 1.x versions that only contained collaboration state and cleans custom block icons and templates. Both run once across all processes.

## Development and tests

```bash
npm ci
npm run lint
npm run format:check
npm test                  # unit tests, no Strapi host needed
npm run bench             # performance benchmark (500 to 5000 blocks) against fixed budgets
npm run build             # admin and server bundles, then a runtime check
npm run verify
MEX_HOST_URL=http://127.0.0.1:1421 MEX_CREDS=/path/to/creds.json npm run test:integration
```

[CONTRIBUTING.md](./CONTRIBUTING.md) explains the isolated acceptance host, the integration suite on SQLite and PostgreSQL and the multi-process acceptance run. [AGENTS.md](./AGENTS.md) is the contract for coding agents.

## Maintenance status

Actively maintained. Releases are made with semantic-release from `main`; every release runs lint, tests, build, package verification and a production dependency audit first. Supported line: Strapi 5.

## Languages

The admin is translated into English, German (formal Sie), French, Spanish and Portuguese.

## License

[MIT](./LICENSE) © 2025-2026 Schero D.
