# Changelog

# [2.4.0](https://github.com/Schero94/Magic-Editor-X/compare/v2.3.1...v2.4.0) (2026-11-12)


### Features

* stable component field ids, tables v2, math, footnotes, range comments, suggest mode, audit trail and a simpler toolbar ([#8](https://github.com/Schero94/Magic-Editor-X/issues/8)) ([080d5af](https://github.com/Schero94/Magic-Editor-X/commit/080d5af4a4ca775560c42656956eb863a9bcfbcc))


Magic Editor X 2.4 adds better tables, math and footnotes, comments on selected text with @mentions, block suggestions, an audit trail and block-scoped AI, gives fields in repeatable components and dynamic zones their history, comments and live editing back, and fixes a collaboration bug that could delete blocks. The field toolbar is now short: undo, redo, **More tools** and full screen. There are no breaking changes; stored content keeps working and Editor.js stays at 2.31.7.

### Features

- **Fields in repeatable components and dynamic zones** have version history, comments and live editing again. Their values carry a stable `fieldKey`, so history and comments follow their entry when entries are moved, added or removed. A new section gets them after its first save; until then the toolbar shows a hint. New optional `fieldKey` on `GET|POST /history`, `GET|POST /comments`, `POST /collaboration/session`, `GET /quality/link-report` and the new mention and suggestion routes; `meta.fieldKey`, `meta.positionalVersions`, `meta.positionalThreads`.
- **Tables** have a header row and a header column, per-column alignment, merged cells and a caption. Select cells with Shift+click and merge them, or use merge right/down from one cell. Tab moves between cells and Alt+F10 opens the table toolbar. Pasting from a spreadsheet fills the cells; pasting from Word or a web page keeps merged cells, header cells and alignment. New optional data keys `headerColumn`, `align`, `merges`, `caption`; renderers output `<caption>`, `<th scope>`, `colspan`/`rowspan` and `mex-align-*` classes, Markdown a GFM alignment row. Quality rule `table-empty-header`.
- **Math:** formulas in TeX as a block (`math`) or inside text (Ctrl/Cmd+Shift+E), with a live preview. The API and the renderers output MathML (Temml 0.14, MathML allow-list); new render option `math` and export `magic-editor-x/math` (`renderMath`, `checkMath`, `MATH_SETTINGS`). Markdown `$…$` / `$$…$$`. Quality rule `math-invalid`.
- **Footnotes** with Ctrl/Cmd+Alt+F, numbered in reading order and listed under the field. The note lives in its marker, so copy, move, undo and delete keep them together. Render option `footnotes`, GFM footnotes in Markdown. Quality rule `footnote-empty`.
- **Comments on selected text:** select text and choose Comment (Ctrl/Cmd+Alt+M); Magic Editor X highlights the passage and keeps the thread on the text while people edit. Ctrl/Cmd+Alt+N moves to the next comment. Read-only reviewers get a floating Comment button.
- **@mentions and notifications:** type `@` in a comment to mention a colleague who can read the field. They see it in the comments panel and in the **Mentions and replies** widget on the admin home page; replies notify the other people in the thread. Optional e-mails through the Strapi email plugin (`comments.notifications.email`, default `false`; `emailPerHour` 10), never with the comment text. Routes `GET /comments/mentionable`, `GET /notifications`, `POST /notifications/read-all`, `POST /notifications/:id/read|unread`; config `comments.mentionsPerMinute` (60).
- **Block suggestions:** give a role **Suggest block changes** (`suggestions.create`) and its members can choose Suggest changes even in fields they cannot edit. Their edits stay in a separate copy until they send them; each changed, new or removed block becomes one suggestion that editors with **Review block suggestions** (`suggestions.review`) accept or reject in the Suggestions panel. Accepted changes go into the field like any edit; save the entry to keep them. Routes `GET|POST /suggestions`, `POST /suggestions/:id/accept|reject`, `DELETE /suggestions/:id`; config `suggestions.enabled` (true), `suggestions.perMinute` (20).
- **AI for chosen blocks:** select blocks, or open a block's menu, and choose AI to rewrite, shorten, translate or change the tone of just those blocks (Ctrl/Cmd+Shift+G). Only their text is sent; a word diff shows the change before it is applied and one Undo reverts it. Route `POST /ai/blocks/:action`. The assistant for selected text now also keeps formatting the selection crosses, limits its answer to the field's inline tools and shows a word diff.
- **Audit trail:** Settings > Magic Editor X > Audit trail and an Activity tab in the version history show who changed which field, version, comment, suggestion, template, synced block or setting, and when, with counts and block ids but never content. Permission `audit.read`; routes `GET /audit`, `GET /audit/actors`; config `audit.enabled` (true), `audit.retentionDays` (180). Events are also sent to Strapi's Enterprise audit logs when that feature exists.
- **Versions of synced blocks:** every save of a synced source keeps a version; preview, compare, rename and restore them in Settings > Templates. Routes `GET /templates/:id/versions[/:versionId]`, `PUT /templates/:id/versions/:versionId`, `POST /templates/:id/versions/:versionId/restore`.
- **Scheduled link check:** **Run now** in Settings > Configuration and a time zone for the rule (`qualityChecks.externalLinks.schedule.tz`); `GET /quality/link-schedule` adds `tz` and `nextRunAt`.
- **`@` in text** opens entry suggestions at the caret and inserts a mention; e-mail addresses never trigger it.
- **Code file names:** the highlighted code block has an optional file name (`codeFlask.filename`), rendered as a caption and as ` ```lang title="…" ` in Markdown.
- **Pasted video and audio** from web pages become video and audio blocks: the file, poster and caption tracks are copied into the Media Library through the new SSRF-safe `POST /media/byUrl`. Config `uploads.maxMediaBytes` (50 MiB) and `uploads.allowPrivateOrigins` (`[]`, also used by images by URL).
- **Alt text from private image storage:** `ai.altText.allowPrivateOrigins` (`[]`) lists exact origins of upload storage inside your network that alt text suggestions may read.
- **Strapi AI translations** no longer corrupt Magic Editor X fields: only text is sent to the provider, and other locales are rebuilt from the source structure. A value that cannot be matched is refused with `AI_TRANSLATION_UNSAFE`.
- **Releases** show entries blocked by the publishing guard as "Not ready to publish".
- **Field toolbar:** undo, redo, a **More tools** menu (Review, Write, View) and full screen. Every other tool moved into the menu and appears only where it can work; keyboard shortcuts are unchanged.

### Fixes

- Collaboration: an editor that joined a room diffed its first edits against room content it had not rendered yet, which deleted the blocks it had not shown, including other people's acknowledged edits inside them; edits typed before the first sync were dropped. The base of every edit is now what the editor shows until it has rendered the room, and early edits are merged onto the room (present since 2.0).
- Live sessions without changes created a version when they ended, because Editor.js writes default settings (alignment left, no indent) into every block. Default settings now count as no setting in version comparisons.
- Collaboration: a data key removed by a collaborator stayed on other screens (Editor.js `blocks.update` merges data); after a remote change the caret returned only to the first input of a block.
- `@editorjs/table` dropped line breaks in cells.
- Copying blocks between editor fields went through HTML conversion and lost data; the Editor.js block clipboard is now used when the blocks fit the target field.
- Ctrl/Cmd+Enter in the footnote dialog and in comment boxes triggered the Content Manager save (403 for reviewers without update rights).
- The embed renderer computed the caption before deciding to render nothing.
- The block selection bar was not reachable with the keyboard.
- AI for selected text nested bold tags when the selection crossed formatting.
- The translate validator accepted the id `"01"` for `"1"`.
- Block menus opened under the next editor field.
- Collaboration: text typed in the first moments after a field with existing room content opened could lose its last characters (same cause as the first fix above).
- Code blocks: tokens without their own colour took the colours of the global code theme loaded by Strapi's Blocks field, some below the contrast minimum (for example Python builtins at 2.93:1); every token now has its own colour (present since 2.3).
- After "Leave focus mode" keyboard focus fell to the page; it now returns to More tools.
- Dialogs with icon buttons needed several Escape presses while a tooltip was open.

### Security

- See [docs/security-audit-2.4.md](./docs/security-audit-2.4.md): field identities (MEX-24-01), rows saved by position (MEX-24-02), tables (MEX-24-03), math (MEX-24-04), footnotes (MEX-24-05), video and audio by URL (MEX-24-06), the `@` trigger and code file names (MEX-24-07), AI for chosen blocks (MEX-24-08), alt text from private storage (MEX-24-09), audit trail (MEX-24-10), synced source versions (MEX-24-11), link check Run now and time zone (MEX-24-12), comment anchors (MEX-24-13), mentions, notifications and e-mail (MEX-24-14), suggestions (MEX-24-15), Strapi AI translations (MEX-24-16), Releases readiness and the published-status bypass (MEX-24-17) and the collaboration data-loss fix (MEX-24-18).
- `documents().create/update({ status: 'published' })`, which the Content API uses for `?status=published`, published without running the publishing guard. These writes are now refused with 400 `QUALITY_GATE` when a guarded field has errors.
- Dependencies: `temml` 0.14.0 added (MIT), `@editorjs/table` removed; `npm audit --omit=dev` reports 0 vulnerabilities.

### Notes

- **`fieldKey`:** values of editor fields inside repeatable components and dynamic zones get a top-level `fieldKey` (16 to 32 URL-safe characters) when they are saved. It is additive: renderers ignore it, the JSON Schema and `MagicEditorXData.fieldKey?` describe it, and Content API and GraphQL output include it. Top-level fields and fields in single components never get one.
- **Versions and comments saved by position before 2.4** are mapped to their entry when their block ids prove it, the first time that field's history or comments are opened. Rows that cannot be mapped stay readable but read-only ("Older versions saved by position", 409 `POSITIONAL_READ_ONLY`). Nothing is deleted.
- **`@editorjs/table` is replaced** by the plugin's own table tool. The stored `table` data is compatible: tables saved before 2.4 keep their exact shape and renderer output, and renderers that do not know the new keys show a full grid.
- **Content API `?status=published`** creates and updates now run the publishing guard. This is a behaviour change that matches what `publishGuard` always promised.
- **`math`:** the name is a built-in block now. Settings custom blocks named `math` from before 2.4 keep their data and tool; new ones cannot take the name. Blocks registered in code with the SDK may still be named `math`, so hosts that registered one with 2.3 keep starting.
- **Editor.js stays at 2.31.7:** 2.32.0 is still a release candidate on npm (`next` tag `2.32.0-rc.3`, checked 2026-11-12). [docs/engine-decision.md](./docs/engine-decision.md) explains why the plugin stays on Editor.js for 2.x.
- **Review workflows** are not supported: Strapi registers them only with an Enterprise or Growth plan, so a stage hook cannot be tested end to end and none ships.
- Known issues: an Editor.js toolbar handler swallows the first Tab presses in dialogs opened from an editor (also the keyboard shortcuts dialog); an empty field's first live catch-up can move focus into that field; discarding a draft whose published version predates 2.4 drops keys added to the draft.

### Migration

- No action needed. Rebuild the admin (`npm run build`) after updating.
- Grant the new permissions to roles that should use them: `suggestions.create`, `suggestions.review`, `audit.read`. No role gets them automatically.
- API clients that write values inside repeatable components or dynamic zones should send the stored `fieldKey` back (or the component `id`); otherwise each write gives the value a new key and its history and comments start fresh.
- Clients that create or update entries with `?status=published` on types with `publishGuard` must handle 400 `QUALITY_GATE`.
- Optional: `comments.notifications.email: true` (needs a working email provider), `qualityChecks.externalLinks.schedule.tz`, `uploads.allowPrivateOrigins`, `ai.altText.allowPrivateOrigins`. The audit trail is on by default; set `audit.enabled: false` to turn it off.

## [2.3.1](https://github.com/Schero94/Magic-Editor-X/compare/v2.3.0...v2.3.1) (2026-11-12)


### Bug Fixes

* no live room, history or comments for editor fields with positional paths ([#7](https://github.com/Schero94/Magic-Editor-X/issues/7)) ([4663f82](https://github.com/Schero94/Magic-Editor-X/commit/4663f82a82088a931cd3ca9b51c418075e1fc2a2))


### Fixed

- Version history and block comments are no longer offered for editor fields inside a repeatable component or a dynamic zone. Versions and comments are keyed by the positional path, so after an entry was removed or moved a version of another entry was listed, and restoring it would have put that entry's content into the editor. In 2.2 these fields had no version history (the routes answered 404). Keying versions and comments by component entry is planned for a later release.
- Editor fields inside a repeatable component or a dynamic zone no longer use live collaboration. Their path is positional (`sections.0.body`): after an entry whose editor had been opened was removed or moved before saving, the next entry joined the old room and showed the removed entry's content, and typing there would have saved it into the wrong entry. These fields are now edited without a live room; top-level fields and fields in single components keep live collaboration.

# [2.3.0](https://github.com/Schero94/Magic-Editor-X/compare/v2.2.0...v2.3.0) (2026-11-12)


### Features

* framework renderers, API output, block SDK, media, templates, synced blocks and comments (2.3.0) ([#6](https://github.com/Schero94/Magic-Editor-X/issues/6)) ([2256161](https://github.com/Schero94/Magic-Editor-X/commit/2256161ef99b1eee504d7a012df00808d60f4fb7))


Magic Editor X 2.3 connects the editor to the rest of your stack: React and Vue components, rendered and resolved Content API and GraphQL output, a block SDK, media blocks, templates, patterns and synced blocks, block comments, mentions and a table of contents, plus optional AI and grammar assistants. No migration is needed; stored content keeps the same Editor.js JSON and every new output is opt-in.

### Highlights

- **React, Vue, Nuxt and Astro.** `magic-editor-x/react` and `magic-editor-x/vue` render content with real components (per-block components or slots) from the same render tree as `renderHtml`; guides for Astro, React and Vue/Nuxt are in `docs/guides/`.
- **Rendered and resolved API output.** `?mex=html|text|markdown|json` on Content API GET requests, and `<field>Rendered(format)` / `<field>Resolved` in GraphQL. Internal links, mentions, embedded entries, Media Library files and synced blocks are resolved with the caller's permissions; draft-only or unreadable targets are never revealed.
- **Block SDK.** Define a block once with `defineBlock` (`magic-editor-x/blocks`), register it on the server and in the admin, and it is sanitised, preset-checked, collaborative and rendered everywhere.
- **Media.** Gallery, video and audio blocks from the Media Library (alternative texts, captions, poster, WebVTT tracks, no autoplay) and a focal point for images.
- **Templates, patterns and synced blocks.** Reusable starting content and block sequences per field or preset, inserted from the editor toolbar; synced blocks are edited in one place and every field that references them shows the change.
- **In-field preview.** The rendered output of the field next to the editor (toolbar or Ctrl/Cmd+Alt+P), also for read-only users.
- **Block comments.** Threads per block with reply, resolve and reopen, live across servers, with their own permissions.
- **Structure.** A table of contents block with stable heading anchors, and mentions of other entries.
- **Assistants (off until enabled).** AI alternative text for images (image and gallery blocks), whole-field translate and summarize, and a LanguageTool grammar check (self-hosted or hosted).
- **Operations.** Scheduled external link checks (one process in a cluster runs each check), code blocks with line numbers and a copy button in the renderers, and a performance benchmark in CI.

### Added

- Package exports `magic-editor-x/react`, `magic-editor-x/vue` and `magic-editor-x/blocks`; render functions `renderTree`, `serializeNodes`, `enhanceCodeBlocks`, `copyText`; render options `code`, `focalPoint`, `headingIds`, `toc`, `blocks` and `synced`. `vue` (`^3.5.0`) is an optional peer dependency; the React peer range is `^18.0.0 || ^19.0.0`.
- Content API query parameter `mex` (registered with `strapi.contentAPI.addQueryParams`, so it also passes with `api.rest.strictParams`); GraphQL fields `<field>Rendered(format: HTML|TEXT|MARKDOWN)` and `<field>Resolved` when `@strapi/plugin-graphql` is installed; service `references.transform`. Synced blocks are expanded in this output.
- Blocks `gallery`, `video`, `audio`, `toc` and `synced`; `focalPoint` on `image` data and gallery images; mention links (`data-mex-mention="true"`).
- Templates and block patterns (content type `plugin::magic-editor-x.template`, `kind: 'template' | 'pattern'`) with Settings > Magic Editor X > Templates, the "Insert template" dialog, "Save as pattern" for selected blocks and "Save content as template".
- Synced blocks: template rows with `kind: 'synced'`, inserted as `{ type: 'synced', data: { ref } }` from the "Insert template" dialog, with "Edit source" and "Detach" in the editor and a usage count in Settings (`GET /magic-editor-x/templates/:id/usage`).
- In-field preview of the rendered field (toolbar button, Ctrl/Cmd+Alt+P).
- Block comments (content type `plugin::magic-editor-x.comment`) with the Comments panel and per-block markers.
- AI alternative text suggestions for image blocks and gallery images (`POST /magic-editor-x/ai/image/alt-text`), whole-field translate and summarize (`POST /magic-editor-x/ai/field/:action`) and the LanguageTool grammar check (`POST /magic-editor-x/grammar/check`).
- Permissions `comments.read`, `comments.write`, `comments.moderate`, `templates.manage` and `grammar.use`.
- Admin routes for comments, templates (including usage), the link report and the link schedule, AI alternative text and field actions, the grammar check and the LanguageTool connection test (see the README route table).
- Config keys `comments.enabled`, `comments.perMinute`, `qualityChecks.externalLinks.allowPrivateOrigins`, `qualityChecks.externalLinks.schedule`, `languageTool.allowPrivateBaseUrl`, `languageTool.requestsPerMinute`, `languageTool.timeoutMs`; settings `ai.allowImages`, `ai.allowFieldActions` and `languageTool`.
- Quality rules `video-no-captions` and `toc-no-headings`; `npm run bench`.
- Custom field option `disableGrammar` (Content-Type Builder > Advanced settings): the field shows no "Check grammar" button and `POST /magic-editor-x/grammar/check` answers 403 for it, so its text is never sent to LanguageTool. It is independent of `disableAi`.

### Changed

- Block select controls (gallery layout and columns, caption track kind, table of contents levels and style, code language, custom block selects) look like Strapi Design System selects in light and dark mode.
- The editor stylesheet is added once per page instead of once per field, which removes multi-second freezes when opening or leaving edit views with several editor fields.
- Heading ids `mex-h-<blockId>` are written when the document has a table of contents (or with `headingIds: true`). Without a `toc` block and without the new options, `renderHtml` output is the same as in 2.2.
- Code blocks keep a valid language that is not in the editor's list instead of resetting it to `plaintext`; one language list (`shared/code-languages.mjs`) serves the editor, the highlighting and the renderers.
- The image caption in the editor follows in normal flow instead of overlapping the controls below the image.
- The 2.3 built-in block names (`toc`, `gallery`, `video`, `audio`, `synced`) and the `mention` tool never change the stored data of an existing custom block with the same name: it keeps its own editor tool, sanitising, rendering and API output, byte for byte as in 2.2. Built-in blocks of these types store the marker `_mex: 1` in their data to tell them apart; new custom blocks cannot use these names.

### Fixed

- Pressing Enter on a block select (gallery layout, table of contents levels, code language, custom block selects) submitted the Content Manager form.
- Text typed into an editor field right after saving a new entry (or while the edit view was still loading) reached the editor but not the form, so Save stayed disabled and the edit could be lost. The field now reports edits made while it starts and marks its holder with `data-mex-ready="true"` when typing is safe.
- Collaboration: edits re-applied after a room compaction or a reconnect could split another person's text typed at the same spot (for example two inserts became interleaved). Re-applied inserts now stay whole (present since 2.1).
- Version history: blocks whose tunes differed only in key order were reported as changed; tune changes are now shown readably ("Alignment: left → center").
- Version history, live collaboration and the link report answered 404 for editor fields inside components (MEX-23-12).
- Admin error handling read no HTTP status from Strapi's fetch client errors, so the 400 and 404 branches of the editor and the settings pages never ran (`readApiError`).
- Seeding a live room was quadratic in the number of blocks (5,000 blocks: about 467 ms to 75 ms).
- Editor.js dropped internal-link references from alert, warning and toggle fields on save.
- The editor hint said Tab chooses a block; in Editor.js 2.31 it is "/".

### Security

- See [docs/security-audit-2.3.md](./docs/security-audit-2.3.md): API output and reference resolution (MEX-23-01, MEX-23-02), React/Vue renderers (MEX-23-03), block SDK (MEX-23-04), media blocks (MEX-23-05), mentions (MEX-23-06), block comments (MEX-23-07), scheduled link check (MEX-23-08), AI alternative text and field actions (MEX-23-09), LanguageTool (MEX-23-10), templates and preview (MEX-23-11), synced blocks (MEX-23-14), component field permissions (MEX-23-12) and live room seeding (MEX-23-13).

### Migration

- No action needed. Rebuild the admin (`npm run build`) after updating.
- Grant the new permissions to roles that should comment (`comments.read`, `comments.write`, `comments.moderate`), manage templates, patterns and synced blocks (`templates.manage`) or use the grammar check (`grammar.use`).
- Features that send content to a provider stay off until the owner turns them on in Settings (`ai.allowImages`, `ai.allowFieldActions`, LanguageTool). The scheduled link check needs `qualityChecks.externalLinks.enabled` and `qualityChecks.externalLinks.schedule.enabled` in `config/plugins`.
- Custom blocks created before 2.3 under the names `toc`, `gallery`, `video`, `audio`, `synced` or `mention` need nothing: their stored data is never rewritten and they stay editable under their name. New custom blocks cannot use these names.
- Editor.js stays at 2.31.7: 2.32.0 is still a release candidate on npm (`next` tag 2.32.0-rc.3, no final release).

# [2.2.0](https://github.com/Schero94/Magic-Editor-X/compare/v2.1.0...v2.2.0) (2026-11-12)


### Features

* field presets, renderers, paste cleanup, versions diff and quality checks ([#5](https://github.com/Schero94/Magic-Editor-X/issues/5)) ([583b86b](https://github.com/Schero94/Magic-Editor-X/commit/583b86b0f1a3eccbcc43099cd09c025f1e21f670))


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
