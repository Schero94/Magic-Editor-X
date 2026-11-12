# Changelog

## [Unreleased]

Magic Editor X 2.2 makes one editor fit every field and every frontend: per-field presets enforced on the server, renderers with a published schema and types, clean paste and migrations, faster writing, version comparison and quality checks. No migration is needed; stored content keeps the same Editor.js JSON.

### Highlights

- **Field presets.** Each field gets its own rules in the Content-Type Builder: a preset (`full`, `article`, `basic`, `minimal`), allowed blocks and heading levels, block and character limits, required alternative text, allowed links (entries, web addresses, both or none), AI and live collaboration on or off, and a publishing guard. They are enforced on every save (Content Manager, Content API, imports, code) and over the live channel, not only in the editor. Content that no longer fits is listed with **Fix automatically**, and the Content Manager shows the reason on the field.
- **Render anywhere.** `magic-editor-x/render` renders stored content to HTML, plain text or Markdown in Node, browsers and edge runtimes, without dependencies and safe against XSS even for content that skipped the sanitiser; internal links can follow slug changes at render time, images get responsive `srcset` from the Media Library. `magic-editor-x/schema` (JSON Schema) and `magic-editor-x/types` (TypeScript) describe the stored data.
- **Paste and migrate.** Word, Google Docs, LibreOffice, web pages and Markdown paste as real blocks (headings, nested lists, checklists, tables, code, links), with images copied into the Media Library. `npx magic-editor-x migrate` converts Strapi Blocks, Markdown and HTML fields (dry run first, idempotent, report without content).
- **Write faster.** Markdown shortcuts, find and replace (regular expressions optional), a keyboard shortcut help (Ctrl/Cmd+/), focus mode, actions for several selected blocks (move, duplicate, delete, convert, copy as Markdown), characters and reading time with the field's limits, `lang` and right-to-left direction from the content locale.
- **Media.** Alternative text and "decorative image" on image blocks, required when the field asks for it; images keep their Media Library id and formats.
- **Versions.** Named versions, a comparison of any version with the current content (blocks and words, moves and formatting-only changes) and restore of a single block.
- **Quality checks.** An accessibility lint (alternative texts, heading order, link texts in five languages, table headers, contrast of custom colours) and a link check (internal entries with your permissions, Media Library files, external links only when the owner turns it on), with an optional publishing guard.

### Added

- Custom field options `preset`, `allowedBlocks`, `headingLevels`, `maxBlocks`, `maxCharacters`, `requireAlt`, `linkTargets`, `disableAi`, `disableCollaboration`, `publishGuard`.
- Package exports `magic-editor-x/render`, `magic-editor-x/schema`, `magic-editor-x/types`; the `magic-editor-x` CLI (`migrate`); services `migrate` (`run`) and `links.resolveHrefs`.
- Admin routes `PUT /magic-editor-x/history/:id` (rename a version) and `POST /magic-editor-x/quality/links`; `POST /history` accepts `label`; versions return `label`; `GET /config` returns `data.quality.externalLinks`.
- Config keys `qualityChecks.externalLinks` (`enabled` false, `timeoutMs` 5000, `perMinute` 30) and `collaboration.compaction` (`enabled` true, `idleSeconds` 60, `minBytes` 262144, `ratio` 4, `checkIntervalSeconds` 30).
- Stored data: `image.data.decorative`, `simpleImage.data.alt` and `simpleImage.data.decorative` (optional).
- Dependencies `marked` and `htmlparser2` (maintained; bundled into the server build).

### Changed

- `POST /magic-editor-x/ai/:action` requires `target: { uid, field }` (the field the text comes from); the admin sends it. Scripts that call this admin route directly must add it.
- Validation errors of Magic Editor X fields carry `details.errors` with the field path (next to `details.code`), so the Content Manager shows them on the field.
- Long-lived live rooms are rebuilt as a new generation when they are idle and much larger than their content; open editors switch without reconnecting.

### Fixed

- Internal links lost their entry reference (`data-mex-uid`) when content was shown again in the editor, so the next save stored a plain link (since 2.1).
- Opening a long document in a new live room froze the tab (about 40 s with 2,000 blocks); typing now stays responsive (25 keystrokes in under a second).
- An edit typed into a block that someone replaced at the same moment was acknowledged but not stored, and that editor's later edits did not reach other processes.
- Re-applying unsent edits after a room reset could drop or garble concurrent remote edits.
- `embed.service` and `codeFlask.language` only keep strings.
- The history dialog footer wraps at narrow widths; "Save current version" no longer overflows its button at 320 px (contrast finding of 2.1).
- The Content Manager no longer throws while showing a Magic Editor X validation error.

### Security

- See [docs/security-audit-2.2.md](./docs/security-audit-2.2.md): paste and import (MEX-22-01), renderers (MEX-22-02), server-side presets (MEX-22-03), AI per field (MEX-22-04), link check SSRF and existence leaks (MEX-22-05), migration (MEX-22-06), versions (MEX-22-07), internal-link integrity (MEX-22-08), lost edits (MEX-22-09), long documents (MEX-22-10).

### Migration

- No action needed. Rebuild the admin (`npm run build`) after updating. Fields without the new options behave as before (`full`).

# [2.1.0](https://github.com/Schero94/Magic-Editor-X/compare/v2.0.0...v2.1.0) (2026-11-11)


### Features

* conflict-free structured collaboration, presence and hardened realtime (2.1.0) ([#4](https://github.com/Schero94/Magic-Editor-X/issues/4)) ([edc2fac](https://github.com/Schero94/Magic-Editor-X/commit/edc2face5e1da174de8d95c86480792b411de86a))


Magic Editor X 2.1 makes live collaboration conflict-free for every kind of block, adds presence with carets, hardens the realtime server and closes the remaining limitations of 2.0. No migration is needed; stored content keeps the same Editor.js JSON.

### Highlights

- **Conflict-free structured collaboration.** Every table cell, list item, checklist entry, tune (alignment, text variant, indent) and custom block field is merged separately (collaboration schema 3). Two people can edit different cells of one table, different items of one list, or the text and alignment of one paragraph at the same time and both changes are kept. Same-value conflicts resolve the same way on every screen.
- **Presence.** Coloured carets and selections of the others, an "editing this block" marker, avatars with first name and last initial (never e-mail addresses), away state, polite screen-reader announcements of joins and leaves, light and dark theme, reduced motion respected.
- **Robust connections.** Offline editing with automatic resync, exponential backoff with jitter, immediate reconnect after sleep, tab switch or network return, no duplicated content after a reconnect or a room reset, clean leave on tab close, new states Reconnecting and Offline in the toolbar.
- **Per-user undo.** Undo and redo during live editing only revert your own changes.
- **Permission changes apply within about a second** on every process (role, permission and user changes); losing update access makes the editor read-only, losing read access ends live editing.
- **Hardened realtime server.** Every update is checked before it is stored or relayed (allowed structures only, dependencies present, valid blocks), remote content is sanitised before the editor renders it, rate limits per socket and per admin, protocol version check.
- **No lost work.** Rooms that are cleaned up with edits nobody saved get a final version first.
- **Cluster-wide limits.** The AI rate limit and the new session limit are shared by all processes.
- **Content Security Policy notice.** Settings > Magic Editor X > Configuration shows when the admin CSP blocks editor embeds (`frame-src`) or external images (`img-src`), with a ready-to-copy `config/middlewares.js` snippet. The plugin never changes the CSP. Blocked embeds and images show an accessible placeholder in the editor instead of a broken frame.
- **Internal links.** "Link to an entry" in the link tool searches entries of your content types and inserts a link; only types and entries you can read in the Content Manager appear. No paid add-on is needed.

### Added

- Admin routes `GET /magic-editor-x/links/types` and `GET /magic-editor-x/links/search`.
- `GET /magic-editor-x/settings` returns `data.environment.csp` (`active`, `frameSrcMissing`, `imgSrcMissing`, `snippet`).
- Config keys `collaboration.maxConnectionsPerAdmin` (20), `collaboration.maxRoomsPerAdmin` (20), `collaboration.revalidateSeconds` (60), `collaboration.rateLimit` (`sessionsPerMinute` 60, `updatesPer10s` 300, `bytesPer10s` 8 MiB) and `links.urlPattern` (placeholders `{documentId}`, `{locale}`, `{slug}`, `{collection}`, `{singular}`; default `/{collection}/{documentId}`).
- Internal links keep a plain `href` and carry `data-mex-uid`, `data-mex-document-id` and `data-mex-locale`; the shared sanitiser allows them on `<a>` only, with validated values.
- Table `magic_editor_x_counters` (created on startup) for cluster-wide rate limits.
- `scripts/soak.mjs` and a cluster acceptance run with process kills, network partitions, offline clients and 12 concurrent clients.

### Changed

- Collaboration protocol 3: the handshake carries `auth: { token, protocol: 3 }`; refusals arrive as `connect_error` with `data.code`. A browser tab still running the 2.0 admin is asked to reload.
- `POST /magic-editor-x/collaboration/session` also returns `seeded` and `protocol` and answers 429 above `collaboration.rateLimit.sessionsPerMinute`.
- `ai.requestsPerMinute` is counted per admin across all processes (was per process).
- Presence colours are Design System colour families instead of fixed hex values.

### Fixed

- Opening 1.x content no longer marks the form as changed.
- Enter in the link-preview and image-URL fields no longer adds an empty block.
- Automatic versions during live editing are taken when each period ends, not a few seconds after someone starts typing.
- The tamper check of the AES-GCM unit test no longer fails in 1 of 64 runs.

### Security

- See [docs/security-audit-2.1.md](./docs/security-audit-2.1.md): sanitising of remote content before rendering (MEX-21-01), update validation (MEX-21-02, -03), permission changes within seconds (MEX-21-04), rate limits (MEX-21-05, -06), protocol check (MEX-21-07), presence (MEX-21-08), no lost edits (MEX-21-09).

### Migration

- No action needed. Rebuild the admin (`npm run build`) after updating. Live rooms created by 2.0 keep working and are converted on the first edit; open 2.0 browser tabs show "Reload the page to keep editing live".

# [2.0.0](https://github.com/Schero94/Magic-Editor-X/compare/v1.6.0...v2.0.0) (2026-11-11)


* feat!: Magic Editor X 2.0 — free, Strapi-native, secure and multi-instance ([#3](https://github.com/Schero94/Magic-Editor-X/issues/3)) ([ea10d76](https://github.com/Schero94/Magic-Editor-X/commit/ea10d76258dc524a3f4f373dba2604637b2a3626))


### BREAKING CHANGES

* The license system, its settings pages and routes are
removed. Admin routes changed (collaboration sessions, history replaces
snapshots, collaboration grants removed), five new RBAC actions must be
granted to roles, configuration keys were renamed or removed, Raw HTML is
sanitised by default and values are validated and sanitised on save.
Requires Strapi 5.38+ and Node 22 or 24. See the 2.0 migration guide in
CHANGELOG.md.


Magic Editor X 2.0 is a major release. It is free and MIT licensed: the license system, tiers and limits are gone and every feature is available to everyone. Stored content from 1.x keeps rendering and editing. Routes, permissions and configuration changed; follow the migration guide below.

### Highlights

- Everything is free: custom blocks without limits, version history, live collaboration, import and export, AI assistant. No license keys, no calls to a license server.
- Strapi-native admin built with the Design System: the editor field, Settings > Magic Editor X > Configuration and Settings > Magic Editor X > Custom blocks, light and dark mode, five languages (en, de, fr, es, pt).
- Live collaboration rebuilt on Yjs with character-level merging. It works with several Node processes behind a load balancer without sticky sessions and keeps acknowledged edits through process restarts.
- Version history per field and locale with manual and automatic versions, preview and restore.
- AI assistant with your own provider: Anthropic, OpenAI or any OpenAI-compatible server, key stored encrypted on the server.
- Every Magic Editor X value is normalised and sanitised on save.
- Access to collaboration and version history follows Content Manager permissions per document, locale and field.

### Migrating from 1.x

#### 1. Update and rebuild

```bash
npm install magic-editor-x@2
npm run build
```

Requirements: Strapi 5.38 or later (tested with 5.61.1) and Node 22 or 24.

#### 2. License system removed

The license integration is removed completely: license keys, automatic free licenses, tiers, limits, the "Upgrade" and "License Details" settings pages, the plugin home page and every request to the license server and to the hosted AI service. Remove any license key from your environment; it is no longer read. These routes no longer exist: `/magic-editor-x/license/*`, `/magic-editor-x/custom-blocks/limits`, `/magic-editor-x/custom-blocks/can-create/:blockType`.

#### 3. Admin API

All routes are admin routes under `/magic-editor-x`. The plugin still has no Content API routes.

| 1.x | 2.0 |
| --- | --- |
| `GET /link` | `GET /link` (unchanged; private addresses rejected) |
| `POST /image/byFile`, `POST /image/byUrl`, `POST /file/upload` | unchanged paths; multipart field `image` (or `files.image`) and `file` |
| `POST /collab/session` | `POST /collaboration/session` with `{ uid, documentId, locale, field, initialValue }` |
| `GET/POST/PUT/DELETE /collaboration/permissions`, `GET /collaboration/users`, `GET /collaboration/check-access` | removed (Content Manager permissions decide) |
| `GET /snapshots/:roomId`, `POST /snapshots/:roomId`, `POST /snapshots/restore/:documentId` | `GET /history?uid&documentId&locale&field`, `POST /history`, `GET /history/:id` (restore happens in the editor) |
| `GET /custom-blocks/:id`, `POST /custom-blocks/:id/toggle`, `POST /custom-blocks/reorder` | removed; use `PUT /custom-blocks/:id` with `enabled` and `PUT /custom-blocks/order` |
| `GET /custom-blocks`, `POST /custom-blocks`, `PUT /custom-blocks/:id`, `DELETE /custom-blocks/:id`, `POST /custom-blocks/:id/duplicate`, `GET /custom-blocks/export`, `POST /custom-blocks/import`, `GET /content-types` | kept; strict validation, custom block ids are `documentId`s, `PUT` takes the full definition |
| | new: `GET /config`, `POST /ai/:action`, `GET /settings`, `PUT /settings`, `POST /settings/ai/test` |

Every route now requires an admin session and an RBAC action. The README lists the full table.

#### 4. Permissions

| Action | 1.x | 2.0 |
| --- | --- | --- |
| `plugin::magic-editor-x.access` | everything | editor features: configuration, link previews, uploads (plus `plugin::upload.assets.create`), custom block list, content type list, version history |
| `plugin::magic-editor-x.collaborate` | | new: join live rooms |
| `plugin::magic-editor-x.ai.use` | | new: AI assistant |
| `plugin::magic-editor-x.custom-blocks.manage` | | new: create, edit, delete, import and export custom blocks |
| `plugin::magic-editor-x.settings.read` / `settings.update` | | new: Settings > Configuration |

Grant the new actions to your roles in Settings > Administration Panel > Roles. Super Admins have them automatically.

Collaboration grants (viewer, editor, owner per user) are replaced by Content Manager permissions: an admin can join a room and see versions when they can read the document, locale and field, and can type, save versions and restore when they can update it. The `collaborate` action is required in addition. Strapi drops the 1.x tables `magic_editor_collab_sessions` and `magic_editor_collab_permissions` (and their link tables) on the first start of 2.0, because the content types no longer exist.

#### 5. Configuration

| 1.x key | 2.0 |
| --- | --- |
| `enabledTools` | removed; all tools are available |
| `linkPreviewTimeout` | `linkPreview.timeoutMs` (default 8000) |
| `maxImageSize` | `uploads.maxImageBytes` (default 10 MiB) |
| `maxFileSize` | `uploads.maxFileBytes` (default 20 MiB) |
| `allowedImageTypes` | removed; JPEG, PNG, GIF, WebP and AVIF are detected by content |
| `collaboration.enabled` | kept |
| `collaboration.wsPath` | `collaboration.path` |
| `collaboration.wsUrl`, `collaboration.sessionTTL`, `collaboration.allowedAdminRoles`, `collaboration.allowedAdminUserIds`, `collaboration.cors` | removed |
| `api.autoParseJSON` | kept (default `true`) |
| `debug` | kept |

New keys: `rawHtml`, `sanitizeOnSave`, `encryptionKey`, `linkPreview.enabled`, `ai.allowPrivateBaseUrl`, `ai.apiKey`, `ai.requestsPerMinute`, `ai.timeoutMs`, `collaboration.allowedOrigins`, `collaboration.pollIntervalMs`, `collaboration.roomTtlMinutes`, `collaboration.maxMessageBytes`, `collaboration.snapshotIntervalMinutes`, `collaboration.tokenTtlSeconds`, `history.maxSnapshotsPerField`, and the environment variable `MAGIC_EDITOR_X_ENCRYPTION_KEY`. Removed 1.x keys are ignored with a warning at startup. Wrong types or ranges stop the startup with a message naming the key.

#### 6. Stored content

- All block names are unchanged (`paragraph`, `header`, `list`, `checklist`, `quote`, `warning`, `alert`, `toggle`, `code`, `codeFlask`, `delimiter`, `table`, `embed`, `raw`, `image`, `simpleImage`, `linkTool`, `attaches`, `personality`, `button`, custom block names). Unmaintained community tools were replaced by in-repo tools that read and write the same data.
- 1.x stored values as JSON strings. 2.0 reads them and stores an object the next time an entry is saved. Until then `api.autoParseJSON` turns such strings into objects in Content API responses.
- `list` now uses `@editorjs/list` 2. It reads the 1.x nested-list data; after the next save list items also contain `meta` (`{ content, meta, items }`), a superset of the old shape.
- Values are sanitised on every save. Inline HTML keeps the tags the editor produces; scripts, event handlers and `javascript:` URLs are removed; `embed` URLs must be https.
- The Raw HTML block is sanitised by default (`rawHtml: 'sanitize'`), which removes scripts and iframes. Set `rawHtml: 'allow'` to store raw HTML as typed.
- Values larger than 5 MiB, with more than 5000 blocks or nested deeper than 24 levels are rejected with 400.

#### 7. Automatic migrations

On the first start one process runs these steps once and records them in the plugin store:

- `2.0.0-snapshots`: 1.x versions that only stored the collaboration state (`yjsSnapshot`) are converted to Editor.js JSON and sanitised. Versions that cannot be converted are kept and marked.
- `2.0.0-custom-blocks`: icons and templates of existing custom blocks are sanitised.

1.x live collaboration rooms are not carried over. Unsaved collaborative changes from 1.x sessions are not migrated; save entries before upgrading.

#### 8. AI assistant

The 1.x assistant used a hosted service tied to the license. 2.0 calls your own provider. Turn it on in Settings > Magic Editor X > Configuration, choose Anthropic, OpenAI or an OpenAI-compatible server, enter a model and a key, and grant `ai.use` to the roles that should use it. To store a key in the settings, set `MAGIC_EDITOR_X_ENCRYPTION_KEY`; otherwise pass it with `ai.apiKey`.

#### 9. Removed packages

`@calumk/editorjs-codeflask`, `@editorjs/nested-list` (replaced by `@editorjs/list`), `@editorjs/checklist`, `@editorjs/delimiter`, `@editorjs/link`, `@editorjs/marker`, `@editorjs/personality`, `@editorjs/simple-image`, `@editorjs/text-variant-tune`, `@editorjs/underline`, `@sotaproject/strikethrough`, `editorjs-alert`, `editorjs-drag-drop`, `editorjs-text-alignment-blocktune`, `editorjs-toggle-block`, `editorjs-tooltip`, `editorjs-undo`, `y-indexeddb`, `y-socket.io`, `@heroicons/react`. They were unmaintained or no longer needed. The Webtools link picker integration is removed.

# [1.6.0](https://github.com/Schero94/magic-editor-x/compare/v1.5.1...v1.6.0) (2026-11-11)


### Bug Fixes

* align CI installs with lockfile settings ([ada3976](https://github.com/Schero94/magic-editor-x/commit/ada3976ad7c9424d5091bbc7f24da139e64b3e69))
* make release failure notices tolerant of missing labels ([5232838](https://github.com/Schero94/magic-editor-x/commit/5232838540d682ad10ac53e2e1266be4827d09bb))


### Features

* secure editor routes and improve admin UX ([6801414](https://github.com/Schero94/magic-editor-x/commit/68014146e94dc28a7e81c3301002c2e4305f143b))

## [1.5.1](https://github.com/Schero94/magic-editor-x/compare/v1.5.0...v1.5.1) (2026-02-12)


### Bug Fixes

* apply Strapi v5 best practices and update dependencies ([7c004fe](https://github.com/Schero94/magic-editor-x/commit/7c004febd0b91a86c494228e87d4148126fc2863))

# [1.5.0](https://github.com/Schero94/magic-editor-x/compare/v1.4.0...v1.5.0) (2025-12-22)


### Features

* add image field type for Simple Blocks with Media Library integration ([61fa769](https://github.com/Schero94/magic-editor-x/commit/61fa7693e37be0cb54cfc56ce49d2a395f0d0d44))

# [1.4.0](https://github.com/Schero94/magic-editor-x/compare/v1.3.7...v1.4.0) (2025-12-22)


### Features

* Custom Blocks with Tier-based Limits (v1.4.0-alpha.1) ([b3e21c7](https://github.com/Schero94/magic-editor-x/commit/b3e21c7ee6bdefac5f3d6aa7f33e46e4029053db))

## [1.3.7](https://github.com/Schero94/magic-editor-x/compare/v1.3.6...v1.3.7) (2025-12-21)


### Bug Fixes

* center hyperlink modal on screen ([0e7e6be](https://github.com/Schero94/magic-editor-x/commit/0e7e6be5f7c9d347fb8086d961bc50860c610fad))

## [1.3.6](https://github.com/Schero94/magic-editor-x/compare/v1.3.5...v1.3.6) (2025-12-21)


### Bug Fixes

* improve inline toolbar and AI assistant UX ([660c916](https://github.com/Schero94/magic-editor-x/commit/660c91634af516da309b8dd7c69777f2d715ce3a))

## [1.3.5](https://github.com/Schero94/magic-editor-x/compare/v1.3.4...v1.3.5) (2025-12-21)


### Bug Fixes

* import CSS globally for custom field z-index fix ([185f35e](https://github.com/Schero94/magic-editor-x/commit/185f35e82aaf0db59e2efda411e230728f2486bf))

## [1.3.4](https://github.com/Schero94/magic-editor-x/compare/v1.3.3...v1.3.4) (2025-12-21)


### Bug Fixes

* increase z-index for all editor popovers and toolbars ([0c3a442](https://github.com/Schero94/magic-editor-x/commit/0c3a442b241c5d5c51fb1d60707d53a0304ffa54))

## [1.3.3](https://github.com/Schero94/magic-editor-x/compare/v1.3.2...v1.3.3) (2025-12-14)


### Bug Fixes

* disable npm provenance for private repository ([ac6f3ed](https://github.com/Schero94/magic-editor-x/commit/ac6f3ed9ffe0936fedf15679309219ea40aed977))

## [1.3.2](https://github.com/Schero94/magic-editor-x/compare/v1.3.1...v1.3.2) (2025-12-14)


### Bug Fixes

* enable npm provenance with OIDC trusted publishing ([99ab48b](https://github.com/Schero94/magic-editor-x/commit/99ab48b850c5b472dce1a0606983711edb1bb9b1))

## [1.3.1](https://github.com/Schero94/magic-editor-x/compare/v1.3.0...v1.3.1) (2025-12-14)


### Bug Fixes

* update readme with direct link editing feature ([cf9d21a](https://github.com/Schero94/magic-editor-x/commit/cf9d21a00671fffcf564135ff79e1f92ce87933a))

# [1.3.0](https://github.com/Schero94/magic-editor-x/compare/v1.2.2...v1.3.0) (2025-12-14)


### Features

* improve link editing UX and inline toolbar ([c9cfe8d](https://github.com/Schero94/magic-editor-x/commit/c9cfe8dbafae664a664fc3d51dc4f250589e8fab))

## [1.2.2](https://github.com/Schero94/magic-editor-x/compare/v1.2.1...v1.2.2) (2025-12-11)


### Bug Fixes

* Try release it ([6c1bbb6](https://github.com/Schero94/magic-editor-x/commit/6c1bbb66715d22ad7683721941698a4d03ad21f7))
* update copyright year to 2024-2025 ([71698bb](https://github.com/Schero94/magic-editor-x/commit/71698bb023920281d89de8625601602f97cb431e))

## [1.2.1](https://github.com/Schero94/magic-editor-x/compare/v1.2.0...v1.2.1) (2025-12-11)


### Bug Fixes

* Try release it ([5cf2b97](https://github.com/Schero94/magic-editor-x/commit/5cf2b971493a75376bccc8be285c0c36a0282022))

# [1.2.0](https://github.com/Schero94/magic-editor-x/compare/v1.1.1...v1.2.0) (2025-12-11)


### Features

* add Version History UI/UX with snapshot management ([4a0d06e](https://github.com/Schero94/magic-editor-x/commit/4a0d06e14afee82d38913153a1af9400fa56c78c))

## [1.1.1](https://github.com/Schero94/magic-editor-x/compare/v1.1.0...v1.1.1) (2025-12-09)


### Bug Fixes

* parse middleware context ([fdf3ada](https://github.com/Schero94/magic-editor-x/commit/fdf3adabe7f2a9eb0542c2d4764e4f198745bb6f))

# [1.1.0](https://github.com/Schero94/magic-editor-x/compare/v1.0.0...v1.1.0) (2025-12-09)


### Features

* add automatic JSON parsing middleware for API responses ([135e8bb](https://github.com/Schero94/magic-editor-x/commit/135e8bb9504630a30d176522cf15383c0a0bffeb))

# 1.0.0 (2025-12-09)


### Bug Fixes

* add freemium license system with collaborator limits ([3bcfee7](https://github.com/Schero94/magic-editor-x/commit/3bcfee71062d02e0a33a1cd83cf8582eef6b1deb))
* add prismjs override to resolve security vulnerabilities and add GitHub templates ([3d6ad2f](https://github.com/Schero94/magic-editor-x/commit/3d6ad2f457733effe100a5a882427cbfe0b1aefb))
* **ui:** Upload final version ([b098134](https://github.com/Schero94/magic-editor-x/commit/b0981345e7735ced312944248c59e10a70e83e4d))
* update package-lock.json with semantic-release dependencies ([cdfe678](https://github.com/Schero94/magic-editor-x/commit/cdfe678f21a12000ab8d27fe9d3224172b0ae92d))


### Features

* add comprehensive documentation and semantic-release configuration ([ad56b1e](https://github.com/Schero94/magic-editor-x/commit/ad56b1ee30837889986efea82f1538186a00251a))
* enhance GitHub issue templates with Editor.js specific fields and feature request template ([e08e5d9](https://github.com/Schero94/magic-editor-x/commit/e08e5d97db5e6c061eade72934bf123eb0bc451a))
* enhance pull request template with Editor.js specific sections and comprehensive checklist ([962b683](https://github.com/Schero94/magic-editor-x/commit/962b6832f476c8c9479013be2b25f8e4146247a6))
* Magic Editor X with real-time collaboration ([1250ec8](https://github.com/Schero94/magic-editor-x/commit/1250ec8a1a38ed3b2b5043d7290269db66f1db72))


### BREAKING CHANGES

* none
