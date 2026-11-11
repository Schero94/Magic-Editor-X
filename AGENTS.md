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
  ydoc.mjs                   Editor.js <-> Yjs mapping (schema 3), 1.x state conversion
  ydoc-guard.mjs             server-side checks of collaboration updates
  collab-replica.mjs         client replica: shared doc + shadow, per-user undo
  csp.mjs                    admin CSP inspection (strapi::security) and violation matching
admin/src/
  index.js                   custom field, settings links, translations
  components/EditorField/    field input, toolbar, history modal, AI dialog, collaboration hook
  editor/                    tools, styles, sanitize, collab client, apply-remote
  pages/                     ConfigurationPage, CustomBlocksPage
  components/ui/             shared page building blocks
  translations/<area>/<locale>.json   areas: common, editor, tools, settings
tests/                       unit tests (node --test), tests/integration needs a host
scripts/                     server bundle, runtime check, llms-full, release plugin, cluster acceptance, soak
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
| POST   | `/collaboration/session`       | access, collaborate            | `collaboration.createSession` | `{ uid, documentId, locale?, field, initialValue? }`                                     | `{ data: { token, path, canEdit, seeded, protocol, expiresAt } }`; 429 above `rateLimit.sessionsPerMinute`                                                                                                                                                                             |
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
- Settings `environment.csp`: `{ active, frameSrcMissing: string[], imgSrcMissing, snippet }` from `shared/csp.mjs` `inspectCsp(strapi.config.get('middlewares'))`, computed once at bootstrap. Only CSP sources are returned. The plugin never changes the CSP; `admin/src/editor/tools/csp-guard.js` shows a DOM-only placeholder (`data-mutation-free`) for blocked embeds and images.
- Settings: changing `provider` or `baseUrl` while a key is stored requires `apiKey` in the same request. `apiKey: ''` removes the stored key. Storing a key needs `MAGIC_EDITOR_X_ENCRYPTION_KEY` (or `encryptionKey`) with 32+ characters.

## Collaboration protocol (3)

1. The admin calls `POST /collaboration/session`. The server checks the shared per-admin session limit (`magic_editor_x_counters`, `collaboration.rateLimit.sessionsPerMinute`, 429), access (`services/access.js` `checkField`), seeds the room once from the stored draft (or `initialValue` when nothing is stored and the caller can edit; lease `seed:<room>`; every seed gets a new `meta.epoch`) and returns an HMAC-signed token (`admin.auth.secret`, HKDF purpose `magic-editor-x:collaboration-token`) with `{ room, target, userId, name, color, canEdit, protocol: 3, nonce, exp }`. Response `{ data: { token, path, canEdit, seeded, protocol, expiresAt } }`.
2. The browser opens Socket.IO on `path` with `transports: ['websocket']` and `auth: { token, protocol: 3 }`. A handshake middleware checks the origin (upgrade), protocol, signature, expiry, consumes the nonce once (`tok:<nonce>` lock) and the per-admin caps (`maxConnectionsPerAdmin`, `maxRoomsPerAdmin`, counted from fresh presence rows across processes). Refusals arrive as `connect_error` with `data.code`: `UPGRADE_REQUIRED`, `INVALID_TOKEN`, `TOO_MANY_CONNECTIONS`, `UNAVAILABLE`. Every reconnect requests a new token.
3. Events:

| Direction        | Event         | Payload                                                                                                                                                                                              |
| ---------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| server -> client | `mx:welcome`  | `{ canEdit, presenceId, color, name, epoch, protocol }`                                                                                                                                              |
| server -> client | `mx:sync`     | `{ update, stateVector, epoch }` (full room state, or the missing part after `mx:resync`)                                                                                                            |
| client -> server | `mx:update`   | Yjs update bytes, ack `{ ok: true, id }` (`id` 0 when nothing new) or `{ ok: false, code: 'READ_ONLY' \| 'INVALID_UPDATE' \| 'RETRY' \| 'RATE_LIMITED' \| 'ROOM_FULL' \| 'STORE_FAILED' }`           |
| server -> client | `mx:update`   | Yjs update bytes from others                                                                                                                                                                         |
| client -> server | `mx:resync`   | client state vector (every 20 s, after reconnects and wake-ups; at most one per second)                                                                                                              |
| client -> server | `mx:cursor`   | `{ blockId, anchor, focus, idle }` (character offsets in the block's text; at most one per 50 ms)                                                                                                    |
| server -> client | `mx:presence` | `[{ id, name, color, canEdit, idle, cursor: { blockId, anchor, focus } \| null }]`; `color` is a Design System colour family (`primary`, `danger`, `success`, `warning`, `secondary`, `alternative`) |
| server -> client | `mx:role`     | `{ canEdit }` after a permission change                                                                                                                                                              |
| server -> client | `mx:error`    | `{ code: 'ACCESS_REVOKED' \| 'ROOM_RESET' \| 'INVALID_UPDATE' }` (the socket is closed after it)                                                                                                     |

4. Every process keeps an in-memory Y.Doc per room with local sockets. An update is checked by `shared/ydoc-guard.mjs` `applyCheckedUpdate` (allowed structures, dependencies present, touched blocks valid), appended to `magic_editor_x_collab_updates`, then acknowledged and relayed. `RETRY` means missing dependencies (nothing stored). Five refused updates close the socket. Per-socket budgets: `rateLimit.updatesPer10s`, `rateLimit.bytesPer10s`. Other processes poll rows with `id` above their watermark every `collaboration.pollIntervalMs` (rows of the last 5 seconds are re-read to tolerate commit order), apply them to their room and relay them; `compact` rows are not relayed; a `seed` row with a new epoch ends the room's sockets with `ROOM_RESET`. Rooms with 200+ rows are compacted under a lease.
5. Automatic versions: lock `snap:<room>:t<bucket>` per `snapshotIntervalMinutes` bucket and `snap:<room>:end<lastId>` when the last local socket leaves; the lease is released when creating the version fails. Maintenance (under the `maintenance` lease) prunes presence, locks and counters and deletes rooms idle for `roomTtlMinutes` without presence after a final version (`end<lastId>`, skipped when equal to the saved draft).
6. Permissions: a lifecycle subscriber on `admin::permission`, `admin::role` and `admin::user` sets the lock row `signal:permissions` to a new value; every process compares it every second and re-checks all sockets (`mx:role` or `ACCESS_REVOKED`). Full re-check every `collaboration.revalidateSeconds`.
7. Client (`admin/src/editor/collab-client.js`): one update in flight, later edits merged; unacknowledged edits kept across disconnects; backoff 0.5 s to 15 s with jitter and a manual reconnect after handshake refusals; `online`, `offline`, `visibilitychange` and `pagehide` handled; idle after 60 s or when hidden; a new epoch or `INVALID_UPDATE` starts over with fresh documents (unsent edits are rebased onto the new room after a new epoch). Undo/redo use the replica's Y.UndoManager (own changes only).

Tables (created in `services/store.js`, not content types):

- `magic_editor_x_collab_updates (id, room, kind 'seed'|'update'|'compact', data base64, size, created_at)`
- `magic_editor_x_collab_presence (id, room, user_id, name, color, can_edit, cursor, updated_at)`
- `magic_editor_x_locks (key, owner, expires_at)` (leases, one-time keys, `signal:*` rows)
- `magic_editor_x_counters (key, count, expires_at)` (fixed-window counters: `session:<adminId>`, `ai:<adminId>`)

Room key: `<uid>|<documentId>|<locale or ->|<field>`, the same as `roomId` of versions.

## Collaboration document model (schema 3, `shared/ydoc.mjs`)

```text
Y.Doc
├─ meta   Y.Map   { schema: 3, time: number, version: string, epoch: string }
├─ order  Y.Array<string>                 block ids in document order (duplicates from concurrent moves keep the first position)
└─ blocks Y.Map<blockId, Y.Map>           entries are never deleted; `order` decides visibility
     └─ { type: string,
          tunes: Y.Map  (structured like data),
          data:  Y.Map  JSON object -> Y.Map, array -> Y.Array, string -> Y.Text, number/boolean/null -> plain value }
```

- Inline formatting stays HTML inside the Y.Text (the Editor.js string), so the stored JSON and the tool contracts are unchanged. Range anchors (`Y.RelativePosition`) on these texts are possible; they point into the HTML source. Formatting as Yjs attributes is not used (the guard refuses `ContentFormat`).
- Writing: `applyLocalChanges(doc, base, local, origin)` applies the change `base -> local` structurally (text diff on Y.Text, LCS alignment for arrays with in-place merges of changed items, key-wise for maps). `applyEditorDataToDoc` is the two-way form. `createSeedUpdate(data, epoch)`, `epochOf(doc)`, `docToEditorData(doc)`, `createDocReader(doc)` (incremental), `readShared`/`toShared` (depth-bounded).
- `shared/collab-replica.mjs`: `doc` (shared state) plus `shadow` (what the editor shows). Local edits are diffed against the shadow and applied to `doc` as a Yjs update (origin `LOCAL_ORIGIN`), so Yjs merges them by item identity. `snapshot()` / `markShown(catchUp, shown)` / `rebase(from, data)` / `undo()` / `redo()`.
- Schema 2 rooms (2.0) read with the same reader; values are converted to their structured form on the first local change. 1.x states: `legacyStateToEditorData(update)`.

## Version history

Content type `plugin::magic-editor-x.document-snapshot` (table `magic_editor_doc_snapshots`, 1.x columns kept): `roomId`, `contentType`, `entryId`, `entryLocale`, `fieldName`, `version`, `trigger` (`manual` \| `auto` \| `restore` \| `legacy`), `contentHash`, `jsonContent`, `yjsSnapshot` (1.x only), `createdBy`. Versions are numbered under the lease `snapver:<room>`; a version identical to the latest one is not stored. Old versions beyond `history.maxSnapshotsPerField` are deleted. Restoring replaces the editor content in the browser; the normal Content Manager save stores it.

## Configuration

Defaults and validation in `server/src/config/index.js` (the README has the table): `debug`, `rawHtml`, `sanitizeOnSave`, `encryptionKey`, `uploads.maxImageBytes`, `uploads.maxFileBytes`, `linkPreview.enabled`, `linkPreview.timeoutMs`, `api.autoParseJSON`, `ai.allowPrivateBaseUrl`, `ai.apiKey`, `ai.requestsPerMinute`, `ai.timeoutMs`, `collaboration.enabled`, `collaboration.path`, `collaboration.allowedOrigins`, `collaboration.pollIntervalMs`, `collaboration.roomTtlMinutes`, `collaboration.maxMessageBytes`, `collaboration.snapshotIntervalMinutes`, `collaboration.tokenTtlSeconds`, `collaboration.maxConnectionsPerAdmin`, `collaboration.maxRoomsPerAdmin`, `collaboration.revalidateSeconds`, `collaboration.rateLimit.sessionsPerMinute`, `collaboration.rateLimit.updatesPer10s`, `collaboration.rateLimit.bytesPer10s`, `history.maxSnapshotsPerField`, `links.urlPattern` (validated by `isValidLinkPattern`). Environment: `MAGIC_EDITOR_X_ENCRYPTION_KEY`. Read config inside functions, never at module load. Arrays have empty defaults because Strapi merges config arrays by index.

## Admin and i18n

- Build every screen with `@strapi/design-system` and the admin `Page`/`Layouts`; colours and spacing from theme tokens only (no hex, no `var(--colors-*)`; 1rem = 10px). Destructive actions use `ConfirmDialog`. No `window.confirm`, no `console.log`, no emoji.
- Translation keys live in four areas, `admin/src/translations/{common,editor,tools,settings}/{en,de,fr,es,pt}.json`, prefixed with the area (`editor.history.title`). Every key exists in all five locales; German uses formal "Sie". The `defaultMessage` in code equals the English text. `tests/admin-i18n.test.mjs` enforces parity, ICU validity and no orphans.
- Editor tools in `admin/src/editor/tools` keep the 1.x block names and data. Untrusted strings reach `innerHTML` only through `sanitizeInline`, `sanitizeTemplate` or `sanitizeSvg` from `admin/src/editor/sanitize.js`.

## Releases

Conventional commits (angular preset). A breaking change needs a `BREAKING CHANGE:` footer; `!` alone is not counted by the commit analyzer. semantic-release publishes from `main`; the hand-written `## [Unreleased]` section of CHANGELOG.md is folded into the release notes by `scripts/release-unreleased.mjs`.
