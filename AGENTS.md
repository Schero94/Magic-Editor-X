# AGENTS.md: Magic Editor X

Contract for coding agents (Claude Code, Codex, Cursor) working on this repository. The README is the user manual; this file is the exact technical contract. When code and this file disagree, fix one of them in the same change.

## Rules

- **Docs first.** Before using any package or Strapi API, read the documentation and the installed types of the version in `package-lock.json` (Editor.js 2.31 and its tools, Yjs 13.6, Socket.IO 4.8, Strapi 5.61, Design System 2.2.4, styled-components 6, zod 4). Record what you read in the commit or PR.
- **Lint as configured.** `npm run lint` and `npm run format:check` must pass before every commit. No new `eslint-disable` without a one-line reason; never weaken the config.
- **Maintained packages only.** Check release activity before adding a dependency. Keep the versions the Strapi admin provides (React 18, react-dom 18, react-router-dom 6, react-intl 6, styled-components 6, `@strapi/design-system` and `@strapi/icons` 2.2.x).
- **Free software.** There is no license, tier, quota or upgrade logic and no telemetry. Do not add any. The plugin makes outgoing requests only for link previews, image by URL and the AI provider the owner configured.
- **Security.** Every admin route has `admin::isAuthenticatedAdmin` and `admin::hasPermissions` with the actions below; handlers that touch a document check Content Manager access through `services/access.js` and answer 404 when it is denied. Validate input with strict, bounded zod schemas. Never log content, tokens, keys, URLs with queries, user ids or email addresses. Never return secrets.
- **Compatibility.** Stored block names and data shapes must keep working. A change to a stored shape needs a migration in `server/src/services/migrations.js` and tests with real-shaped fixtures.
- **Synthetic data only** in tests, fixtures and screenshots (`*.example.test`, RFC 5737 addresses).

## Repository layout

```text
server/src/
  index.js, register.js, bootstrap.js, destroy.js
  config/index.js            defaults and zod validator
  permissions.js             RBAC actions
  routes/index.js            admin routes (no Content API routes)
  controllers/*.js           config, editor, custom-blocks, collaboration, history, ai, settings
  services/*.js              store, access, editor, settings, ai, custom-blocks, history, collaboration, migrations
  middlewares/parse-editor-fields.js
  content-types/index.js     document-snapshot, custom-block
  utils/                     sanitizer, url-security, crypto, validation, editor-fields, rate-limit, logger
shared/                      pure ESM used by server and admin
  editor-data.mjs            normalise stored values, limits, stats
  sanitize-policy.mjs        per-block content policy
  ydoc.mjs                   Editor.js <-> Yjs mapping (schema 2), 1.x state conversion
admin/src/
  index.js                   custom field, settings links, translations
  components/EditorField/    field input, toolbar, history modal, AI dialog, collaboration hook
  editor/                    tools, styles, sanitize, collab client, apply-remote
  pages/                     ConfigurationPage, CustomBlocksPage
  components/ui/             shared page building blocks
  translations/<area>/<locale>.json   areas: common, editor, tools, settings
tests/                       unit tests (node --test), tests/integration needs a host
scripts/                     server bundle, runtime check, llms-full, release plugin, cluster acceptance
docs/site/                   GitHub Pages
```

## Commands

| Command                    | What it does                                                                                                                |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint`             | ESLint flat config over the repository                                                                                      |
| `npm run format:check`     | Prettier check                                                                                                              |
| `npm test`                 | Unit tests in `tests/*.test.mjs`                                                                                            |
| `npm run test:integration` | Integration suite against a running host; needs `MEX_HOST_URL` and `MEX_CREDS` (see CONTRIBUTING.md) and fails without them |
| `npm run build`            | `strapi-plugin build`, esbuild server bundle (CJS and ESM), then `verify:runtime`                                           |
| `npm run verify`           | `strapi-plugin verify`                                                                                                      |
| `npm pack --dry-run`       | Tarball contents: `dist`, `strapi-admin.js`, `strapi-server.js`, README, LICENSE, CHANGELOG                                 |
| `npm run docs:llms`        | Regenerate `docs/site/llms-full.txt`                                                                                        |

## Field

- Custom field uid `plugin::magic-editor-x.richtext`, type `json`. Options in the Content-Type Builder: `options.placeholder` (text), `options.minHeight` (number, 120 to 2000).
- Value: Editor.js document `{ time, blocks: [{ id, type, data, tunes? }], version }`, stored as an object. `null` means empty.
- `shared/editor-data.mjs` `normalizeEditorData(value)` accepts objects, 1.x JSON strings, double-encoded strings, plain text or HTML strings and bare block arrays. It gives blocks without an id a deterministic id, drops invalid blocks and prototype-polluting keys, and throws `EditorDataError` (`TOO_LARGE`, `TOO_MANY_BLOCKS`, `TOO_DEEP`, `INVALID_SHAPE`) above 5 MiB, 5000 blocks or depth 24.
- `shared/sanitize-policy.mjs` `BLOCK_POLICIES` defines the stored data of every built-in block (the README has the table). Unknown block types (custom blocks) go through a generic policy: strings are inline HTML, keys named `url`, `href`, `link`, `src`, `photo`, `source` or `embed` are URLs. Tunes: `alignmentTune`, `textVariant`, `indentTune`.
- `register.js` adds a Document Service middleware: on `create` and `update` every Magic Editor X field (also inside components and dynamic zones) is replaced with `cleanEditorValue(value, { rawHtml })`. Invalid values throw `ValidationError` (400).

## Permissions

| Action                                        | uid in `registerMany`  |
| --------------------------------------------- | ---------------------- |
| `plugin::magic-editor-x.access`               | `access`               |
| `plugin::magic-editor-x.collaborate`          | `collaborate`          |
| `plugin::magic-editor-x.ai.use`               | `ai.use`               |
| `plugin::magic-editor-x.custom-blocks.manage` | `custom-blocks.manage` |
| `plugin::magic-editor-x.settings.read`        | `settings.read`        |
| `plugin::magic-editor-x.settings.update`      | `settings.update`      |

`admin/src/permissions.js` mirrors them for links and screens (UX only).

## Admin API

Prefix `/magic-editor-x`. `upload` = `plugin::upload.assets.create`.

| Method | Path                           | Actions                        | Handler                       | Input                                                                                    | Output                                                                                                                                                                                                                                                                                 |
| ------ | ------------------------------ | ------------------------------ | ----------------------------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/config`                      | access                         | `config.get`                  |                                                                                          | `{ data: { collaboration: { enabled, path }, ai: { enabled, actions, languages, tones, maxInputChars }, uploads: { maxImageBytes, maxFileBytes, attachmentTypes }, linkPreview, rawHtml, permissions: { collaborate, ai, upload, mediaLibrary, customBlocksManage, settingsRead } } }` |
| GET    | `/link`                        | access                         | `editor.linkPreview`          | `?url=`                                                                                  | `{ success: 1, link, meta: { title, description, site_name, image? } }`; errors `{ success: 0, message }` 400/404/413/415/502/504                                                                                                                                                      |
| POST   | `/image/byFile`                | access, upload                 | `editor.uploadImageFile`      | multipart `image`                                                                        | `{ success: 1, file: { url, id, documentId, name, alt, size, width, height, mime, formats } }`                                                                                                                                                                                         |
| POST   | `/image/byUrl`                 | access, upload                 | `editor.uploadImageUrl`       | `{ url }`                                                                                | same as byFile                                                                                                                                                                                                                                                                         |
| POST   | `/file/upload`                 | access, upload                 | `editor.uploadAttachment`     | multipart `file`                                                                         | `{ success: 1, file: { url, name, title, size, extension } }`                                                                                                                                                                                                                          |
| GET    | `/content-types`               | access                         | `editor.contentTypes`         |                                                                                          | `{ data: [{ uid, kind, displayName, attributes }] }` (API types the caller can read)                                                                                                                                                                                                   |
| GET    | `/links/types`                 | access                         | `links.types`                 |                                                                                          | `{ data: [{ uid, kind, displayName, localized }] }` (API types the caller can read)                                                                                                                                                                                                    |
| GET    | `/links/search`                | access (+ CM read)             | `links.search`                | `?uid&q&locale&page` (`uid` `api::` only, `q` max 100, `page` 1-500, strict)             | `{ data: [{ documentId, uid, locale, title, href, status? }], meta: { pagination: { page, pageSize: 20, pageCount, total } } }`; unknown or unreadable type 404                                                                                                                        |
| GET    | `/custom-blocks`               | access                         | `customBlocks.list`           | `?all=true` (needs custom-blocks.manage, else enabled only)                              | `{ data: [block] }`                                                                                                                                                                                                                                                                    |
| GET    | `/custom-blocks/export`        | custom-blocks.manage           | `customBlocks.export`         |                                                                                          | `{ data: { format: 'magic-editor-x/custom-blocks', version: 2, exportedAt, blocks } }`                                                                                                                                                                                                 |
| POST   | `/custom-blocks/import`        | custom-blocks.manage           | `customBlocks.import`         | export document (max 200 blocks)                                                         | `{ data: { created: [name], skipped: [{ name, reason: 'invalid' \| 'exists' }] } }`                                                                                                                                                                                                    |
| PUT    | `/custom-blocks/order`         | custom-blocks.manage           | `customBlocks.reorder`        | `{ ids }` (all block ids once)                                                           | `{ data: [block] }`                                                                                                                                                                                                                                                                    |
| POST   | `/custom-blocks`               | custom-blocks.manage           | `customBlocks.create`         | definition                                                                               | 201 `{ data: block }`                                                                                                                                                                                                                                                                  |
| PUT    | `/custom-blocks/:id`           | custom-blocks.manage           | `customBlocks.update`         | full definition                                                                          | `{ data: block }`                                                                                                                                                                                                                                                                      |
| DELETE | `/custom-blocks/:id`           | custom-blocks.manage           | `customBlocks.remove`         |                                                                                          | `{ data: { id } }`                                                                                                                                                                                                                                                                     |
| POST   | `/custom-blocks/:id/duplicate` | custom-blocks.manage           | `customBlocks.duplicate`      |                                                                                          | 201 `{ data: block }`                                                                                                                                                                                                                                                                  |
| POST   | `/collaboration/session`       | access, collaborate            | `collaboration.createSession` | `{ uid, documentId, locale?, field, initialValue? }`                                     | `{ data: { token, path, canEdit, expiresAt } }`                                                                                                                                                                                                                                        |
| GET    | `/history`                     | access                         | `history.list`                | `?uid&documentId&locale&field`                                                           | `{ data: [version], meta: { canRestore, canCreate } }`                                                                                                                                                                                                                                 |
| GET    | `/history/:id`                 | access                         | `history.findOne`             |                                                                                          | `{ data: { id, version, trigger, createdAt, createdBy, stats, restorable, content } }`                                                                                                                                                                                                 |
| POST   | `/history`                     | access (+ CM update)           | `history.create`              | `{ uid, documentId, locale?, field, content }`                                           | 201 created, 200 with `meta.created: false` when identical to the latest version                                                                                                                                                                                                       |
| POST   | `/ai/:action`                  | access, ai.use                 | `ai.run`                      | `{ text (1-60000), language?, tone? }`                                                   | `{ data: { text } }`                                                                                                                                                                                                                                                                   |
| GET    | `/settings`                    | settings.read                  | `settings.get`                |                                                                                          | `{ data: { ai: {..., hasApiKey, apiKeyFromEnvironment, apiKeyUnreadable, canStoreApiKey}, environment } }`                                                                                                                                                                             |
| PUT    | `/settings`                    | settings.read, settings.update | `settings.update`             | `{ ai: { enabled, provider, baseUrl, model, maxInputChars, maxOutputTokens, apiKey? } }` | same as GET                                                                                                                                                                                                                                                                            |
| POST   | `/settings/ai/test`            | settings.read, settings.update | `settings.testAi`             | `{ ai: {...} }`                                                                          | `{ data: { ok: true } }`                                                                                                                                                                                                                                                               |

Details:

- Ids in paths are `documentId`s (`/^[a-z0-9]{1,64}$/`). Field targets: `uid` `api::x.y` or `plugin::x.y`, `field` a dotted path (`body`, `sections.0.body`) that must resolve to a Magic Editor X attribute, `locale` a locale code (required in effect for localised types; defaults to the default locale).
- Validation errors: `ValidationError` 400 with `details: { formErrors, fieldErrors }`, keys are dotted paths (`ai.apiKey`, `fields.2.name`).
- Access denied or missing document: 404. Viewer trying to write a version: 403.
- Internal links (`services/links.js`): the search combines the permission checker's `sanitizedQuery.read({})` filters (conditions, locale permissions) with `{ <title>: { $containsi: q } }` (Strapi escapes LIKE wildcards), reads draft versions with the Document Service (`fields` limited to `documentId`, title and the first `uid` attribute, each only when `pc.cannot.read(null, field)` is false), and passes every row through `sanitizeOutput`. Title: Content Manager `mainField` when it is a text attribute, else the first text attribute; without a readable title `q` only matches an exact `documentId`. `status` (`draft` \| `published`) only for Draft & Publish types. `href` is `renderLinkPattern(links.urlPattern, ...)` from `shared/link-pattern.mjs`.
- Stored internal link: `<a href data-mex-uid data-mex-document-id data-mex-locale>`. `shared/sanitize-policy.mjs` `cleanInternalLinkAttributes` keeps the three attributes only on `<a>`, only with valid values (`api::` uid, documentId, locale) and only when uid and documentId are both present; the server (sanitize-html `transformTags.a`) and the admin (DOMPurify `afterSanitizeAttributes`) both use it. The hyperlink tool's Editor.js `sanitize` config allows them too.
- Custom block definition: `name` (`/^[a-zA-Z][a-zA-Z0-9_-]{1,49}$/`, not a built-in tool name, unique case-insensitively), `label`, `blockType` (`simple` \| `embedded-entry`), `description`, `icon` (SVG, sanitised), `contentType`, `displayFields`, `titleField`, `previewFields`, `fields` (max 20: `name`, `label`, `type` text \| textarea \| url \| number \| select \| checkbox \| image \| color, `required`, `placeholder`, `default`, `options`), `template` (HTML with `{{field}}`, sanitised), `placeholder`, `styles` (allow-listed CSS properties), `inlineToolbar`, `tunes`, `shortcut`, `sortOrder`, `enabled`. Unknown keys are rejected.
- AI actions: `improve`, `grammar`, `shorten`, `expand`, `summarize`, `simplify`, `translate` (`language` one of English, German, French, Spanish, Portuguese, Italian, Dutch, Polish, Turkish, Japanese, Chinese), `tone` (`tone` one of professional, friendly, casual, confident, formal, persuasive), `continue`. Unknown action 404, text over `maxInputChars` 413, rate limit 429. Provider errors: `{ error: { name: 'AIProviderError', details: { code } } }` with codes `DISABLED` 503, `NOT_CONFIGURED` 503, `NO_API_KEY` 503, `AUTH_FAILED` 502, `PROVIDER_RATE_LIMIT` 503, `TIMEOUT` 504, `REFUSED` 422, `PROVIDER_ERROR`/others 502.
- Settings: changing `provider` or `baseUrl` while a key is stored requires `apiKey` in the same request. `apiKey: ''` removes the stored key. Storing a key needs `MAGIC_EDITOR_X_ENCRYPTION_KEY` (or `encryptionKey`) with 32+ characters.

## Collaboration protocol

1. The admin calls `POST /collaboration/session`. The server checks access (`services/access.js` `checkField`), seeds the room once from `initialValue` when the caller can edit and the room is empty (lease `seed:<room>`), and returns an HMAC-signed token (`admin.auth.secret`, HKDF purpose `magic-editor-x:collaboration-token`) with `{ room, target, userId, name, color, canEdit, nonce, exp }`.
2. The browser opens Socket.IO on `path` with `transports: ['websocket']` and `auth: { token }`. The server checks the origin, the signature, the expiry and consumes the nonce once (`tok:<nonce>` lock). A reconnect requests a new token.
3. Events:

| Direction        | Event         | Payload                                                                                                                                  |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| server -> client | `mx:welcome`  | `{ canEdit, presenceId, color }`                                                                                                         |
| server -> client | `mx:sync`     | `{ update, stateVector }` (full room state, or the missing part after `mx:resync`)                                                       |
| client -> server | `mx:update`   | Yjs update bytes, with ack `{ ok: true, id }` or `{ ok: false, code: 'READ_ONLY' \| 'INVALID_UPDATE' \| 'ROOM_FULL' \| 'STORE_FAILED' }` |
| server -> client | `mx:update`   | Yjs update bytes from others                                                                                                             |
| client -> server | `mx:resync`   | client state vector (sent every 20 s and after reconnect)                                                                                |
| client -> server | `mx:cursor`   | `{ blockId, offset }` or `null` (throttled to 150 ms)                                                                                    |
| server -> client | `mx:presence` | `[{ id, name, color, canEdit, cursor }]`                                                                                                 |
| server -> client | `mx:role`     | `{ canEdit }` after a permission change                                                                                                  |
| server -> client | `mx:error`    | `{ code: 'INVALID_TOKEN' \| 'ACCESS_REVOKED' }`                                                                                          |

4. Every accepted update is appended to `magic_editor_x_collab_updates` before the ack and the local broadcast. Other processes poll rows with `id` above their watermark every `collaboration.pollIntervalMs` (re-reading the last 5 seconds to tolerate commit order) and relay them; `compact` rows are not relayed. Rooms with 200+ rows are compacted under a lease. Automatic versions use the lock `snap:<room>:t<bucket>` per interval and `snap:<room>:end<lastId>` when the last local socket leaves. Maintenance (presence and lock pruning, deleting rooms idle for `roomTtlMinutes` without presence) runs under the `maintenance` lease.
5. Access is re-checked every 5 minutes per socket.

Tables (created in `services/store.js`, not content types):

- `magic_editor_x_collab_updates (id, room, kind 'seed'|'update'|'compact', data base64, size, created_at)`
- `magic_editor_x_collab_presence (id, room, user_id, name, color, can_edit, cursor, updated_at)`
- `magic_editor_x_locks (key, owner, expires_at)`

Room key: `<uid>|<documentId>|<locale or ->|<field>`, the same as `roomId` of versions.

## Yjs schema 2 (`shared/ydoc.mjs`)

- `meta` Y.Map `{ schema: 2, time, version }`
- `order` Y.Array of block ids (duplicates from concurrent moves keep the first position)
- `blocks` Y.Map id -> Y.Map `{ type, tunes, data }`; `data` is a Y.Map where string values are Y.Text (character-level merge through `applyTextDiff`) and other values are plain JSON (last writer wins per key)
- Block entries are never deleted; `order` decides visibility.
- `applyEditorDataToDoc(doc, data, origin)`, `docToEditorData(doc)`, `createSeedUpdate(data)`, `legacyStateToEditorData(update)` for 1.x states (`blocks` JSON strings, `text` Y.Text with formatting attributes, `meta.blockOrder`).

## Version history

Content type `plugin::magic-editor-x.document-snapshot` (table `magic_editor_doc_snapshots`, 1.x columns kept): `roomId`, `contentType`, `entryId`, `entryLocale`, `fieldName`, `version`, `trigger` (`manual` \| `auto` \| `restore` \| `legacy`), `contentHash`, `jsonContent`, `yjsSnapshot` (1.x only), `createdBy`. Versions are numbered under the lease `snapver:<room>`; a version identical to the latest one is not stored. Old versions beyond `history.maxSnapshotsPerField` are deleted. Restoring replaces the editor content in the browser; the normal Content Manager save stores it.

## Configuration

Defaults and validation in `server/src/config/index.js` (the README has the table): `debug`, `rawHtml`, `sanitizeOnSave`, `encryptionKey`, `uploads.maxImageBytes`, `uploads.maxFileBytes`, `linkPreview.enabled`, `linkPreview.timeoutMs`, `api.autoParseJSON`, `ai.allowPrivateBaseUrl`, `ai.apiKey`, `ai.requestsPerMinute`, `ai.timeoutMs`, `collaboration.enabled`, `collaboration.path`, `collaboration.allowedOrigins`, `collaboration.pollIntervalMs`, `collaboration.roomTtlMinutes`, `collaboration.maxMessageBytes`, `collaboration.snapshotIntervalMinutes`, `collaboration.tokenTtlSeconds`, `history.maxSnapshotsPerField`, `links.urlPattern` (validated by `isValidLinkPattern`). Environment: `MAGIC_EDITOR_X_ENCRYPTION_KEY`. Read config inside functions, never at module load. Arrays have empty defaults because Strapi merges config arrays by index.

## Admin and i18n

- Build every screen with `@strapi/design-system` and the admin `Page`/`Layouts`; colours and spacing from theme tokens only (no hex, no `var(--colors-*)`; 1rem = 10px). Destructive actions use `ConfirmDialog`. No `window.confirm`, no `console.log`, no emoji.
- Translation keys live in four areas, `admin/src/translations/{common,editor,tools,settings}/{en,de,fr,es,pt}.json`, prefixed with the area (`editor.history.title`). Every key exists in all five locales; German uses formal "Sie". The `defaultMessage` in code equals the English text. `tests/admin-i18n.test.mjs` enforces parity, ICU validity and no orphans.
- Editor tools in `admin/src/editor/tools` keep the 1.x block names and data. Untrusted strings reach `innerHTML` only through `sanitizeInline`, `sanitizeTemplate` or `sanitizeSvg` from `admin/src/editor/sanitize.js`.

## Releases

Conventional commits (angular preset). A breaking change needs a `BREAKING CHANGE:` footer; `!` alone is not counted by the commit analyzer. semantic-release publishes from `main`; the hand-written `## [Unreleased]` section of CHANGELOG.md is folded into the release notes by `scripts/release-unreleased.mjs`.
