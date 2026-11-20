# Changelog

## [2.8.3](https://github.com/Schero94/Magic-Editor-X/compare/v2.8.2...v2.8.3) (2026-11-20)


### Bug Fixes

* **admin:** accessible names, focus, panels and translations in the editor field ([#38](https://github.com/Schero94/Magic-Editor-X/issues/38)) ([cd9e7c7](https://github.com/Schero94/Magic-Editor-X/commit/cd9e7c7576696cb3b917148fe8a8b5601c72444f))


### Fixed (editor field: names, focus, panels, translations)

- **Names.** The editor of a field is a group named by the field label (as Strapi's Blocks field). Inline toolbar buttons are named after their tool, the component block switch after its attribute, and the repeated Accept, Reject, Edit, Reply, Resolve and Reopen buttons say whose comment or suggestion and which text they act on.
- **Inline toolbar by keyboard.** With text selected, Alt+F10 moves focus into the inline toolbar (as in the table and column tools), the arrow keys move between its buttons, and Escape goes back to the selected text. Escape in the link input returns to the text too. The shortcut timing (Ctrl/Cmd+I, U, Shift+M, K pressed within about 150 ms of selecting) is Editor.js behaviour: its inline tool shortcuts work only once the inline toolbar was built after the debounced selection change (Editor.js 2.31 `InlineToolbar.enableShortcuts`); it is left as is.
- **Focus.** After inserting a video, audio or attachment block, focus is on its Choose button. After the Media Library dialog (Confirm, Escape or Close), the caret is in the inserted image or back where the block was inserted. After posting a reply or cancelling an edit, after sending suggestions, after Replace and Replace all, after Check links and after a grammar check or fix, focus stays on a defined control. Cancel or Escape in the template replace and version restore confirmations returns to the button that opened them. The grammar panel takes focus, and Escape closes the quality, grammar, comments and suggestions panels also when the focused button shows its tooltip.
- **States.** A comments load error shows the error with Try again instead of read-only with zero counts. "No links were checked." replaces "Link check finished: no problems" when nothing was checked. The AI dialogs show their own messages for `UNREACHABLE`, `BAD_RESPONSE`, `RESPONSE_TOO_LARGE`, `EMPTY` and `PROVIDER_ERROR`.
- **Suggest mode.** More tools offers only the entries that work while suggesting (keyboard shortcuts); the others acted on the hidden field.
- **Presence.** Joining and leaving the entry is announced once per entry, not once per field.
- **Layout and dark mode.** A blocked person photo shows its Content Security Policy notice in its own row instead of the 72 px circle. Below 650 px the **+** and block menu handles use the DS surface and border (they were white in dark mode) and 32 px targets on phones; the bottom sheet's backdrop uses the DS overlay colour. The side panel's Check is a DS button. Native checkboxes, selects and inputs in blocks follow the admin theme (`color-scheme`), and the attachment download hover, the image tool, the loader and "Nothing found" no longer show Editor.js' light colours in dark mode.
- **Translations.** The indent block tune, the embed caption and attachment title placeholders and the code languages "Plain text" and "HTML and XML" are translated in all five admin languages.

## [2.8.2](https://github.com/Schero94/Magic-Editor-X/compare/v2.8.1...v2.8.2) (2026-11-20)


### Bug Fixes

* **admin:** keyboard block menu and block controls, fast typing in long documents, Word bold, safe room discard ([#36](https://github.com/Schero94/Magic-Editor-X/issues/36)) ([e8be99e](https://github.com/Schero94/Magic-Editor-X/commit/e8be99e252ecbc8ee4015626dde90867b2bd3a66))


### Fixed (editor field: keyboard, typing speed, paste, live session)

- **Keyboard path to the block menu.** Ctrl/Cmd+/ opened the plugin's shortcut help, which blocked Editor.js' own shortcut for the block menu, and the **+** and block menu (⋮⋮) handles had no role, name or tab stop. Ctrl/Cmd+/ opens the block menu of the current block again; the shortcut help moved to **Ctrl/Cmd+Alt+/** (also More tools > Keyboard shortcuts). Both handles are buttons with names ("Add a block", "Open the block menu") that open with Enter or Space. The shortcut help and the README list the keyboard path.
- **Controls inside blocks were not reachable by keyboard.** Editor.js moves Tab and the arrow keys only between text inputs, so the audio and video Choose buttons, the person photo, the toggle's show/hide, the column style and layout, the button block's style and "new tab", and the inputs, select and switch of component blocks were skipped. Tab and Shift+Tab now stop on them in document order, the arrow keys stop on a control Editor.js would skip (not on selects), tools that use Tab themselves (lists, tables, code) keep it, and every control in a block shows a focus ring.
- **Typing lag in long documents.** Every keystroke sanitised the whole document with DOMPurify several times (form value, rendered key, draft fingerprint) and compared it in canonical JSON: about 150 ms per key at 2,000 blocks. The inline sanitiser and the canonical JSON of blocks are cached by input (same output, so the same security; the server still sanitises on save), Editor.js' save and the form update run in separate tasks, the field's panels update as a React transition, and the draft fingerprints are only computed after signing in again. At 2,000 blocks a keystroke now takes p95 about 40 ms with no task over 50 ms (see the PR for the measurements).
- **Bold from Word was lost on paste.** Word writes `<b style='mso-bidi-font-weight:normal'>` and the check for Google Docs' `<b style="font-weight:normal">` wrapper matched the text `font-weight:normal` inside the other property. Inline styles are now read by exact property name, everywhere in the HTML import.
- **"Discard changes" in the live session notice removed other people's text without asking.** It now asks first in a Strapi confirmation that says it affects everyone editing the field, then shows a notice with **Undo** (focused) that puts the previous text back for everyone. People in the same session get a notice that the field went back to the saved content, with **Restore my text**.

## [2.8.1](https://github.com/Schero94/Magic-Editor-X/compare/v2.8.0...v2.8.1) (2026-11-20)


### Bug Fixes

* settings pages keep unsaved work and focus, DatePicker, keyboard row actions ([#34](https://github.com/Schero94/Magic-Editor-X/issues/34)) ([338a293](https://github.com/Schero94/Magic-Editor-X/commit/338a293c2eb95d96f275671288fc24ec1ca5bc91))


### Fixed

Settings pages (Configuration, Custom blocks, Templates, Audit trail), from an independent UI re-audit of 2.7.6:

- **The custom block dialog no longer throws away typed work.** Escape, a click outside, Close or Cancel closed "Create a custom block" and "Edit block" without asking, and focus went to the page body. A form with unsaved changes now asks "Discard your changes?" (Strapi's confirmation dialog): Cancel keeps the form and puts focus back where it was, "Discard changes" closes it. A clean form closes at once, and focus returns to the button that opened the dialog.
- **Focus after actions.** Focus no longer drops to the page body after Save, Discard changes, Test connection, Test LanguageTool and Try again on the Configuration page; after the "In toolbox" and "Offer in the editor" switches of the Custom blocks and Templates lists (they stay enabled while their change is saved, so a second Space works); after Duplicate, Move, Import and Export; after Refresh, Apply filters, Reset filters and Try again on the Audit trail; after Cancel or Escape in the "Restore version" dialog of a synced block; after Create template and Edit (focus goes to the new view); and after Try again on any load error. Focus stays on the control, or moves to the page title, the first highlighted field or the first filter when the control is gone or disabled.
- **Row actions in the desktop tables work from the keyboard.** In the Custom blocks and Templates tables, Enter and Space on Edit, Preview, Duplicate, Move and Delete did nothing: the Design System table cell treats a cell of buttons as one grid cell and cancels every key. The actions group now keeps Enter and Space for the focused button; arrow keys still move between the buttons.
- **"Test LanguageTool" without a base URL** said "Fix the highlighted fields" but highlighted nothing. The base URL field is now marked with "This field is required." and gets focus; the mark goes away as soon as you type a URL. Saving with an empty URL while the grammar check is off still works.
- **Out-of-range numbers are flagged when you leave the field.** "Maximum text length", "Maximum answer length", the model and the base URLs showed their errors only after Save. They now show when you leave the field and update as you type.
- **No 403 requests for people without access.** The Templates page (and Custom blocks) loaded its lists before the permission check, so reviewers saw two 403 errors in the console before "You don't have the permissions". Nothing is requested until the permission check allows it, as on the Configuration page since 2.7.4.
- **Audit trail date filters** use the Design System date picker in the admin language's date format instead of the browser's native date field. A filter without results offers "Reset filters", and events of templates and synced blocks show "Template or synced block" instead of the internal uid `plugin::magic-editor-x.template`.
- **Custom block import report.** A skipped entry without a name showed a literal "?"; it now reads "An entry without a name: the definition is not valid." The list of skipped entries is no longer nested inside the alert's paragraph (invalid HTML).
- **Smaller things.** The colour swatches of the palette section had native browser tooltips; the text next to them now names the light and dark theme values. "Save name" for a synced block version is disabled while the name is longer than 120 characters. New texts are translated into German, French, Spanish and Portuguese.

# [2.8.0](https://github.com/Schero94/Magic-Editor-X/compare/v2.7.7...v2.8.0) (2026-11-20)


### Features

* generate TypeScript types per field preset and custom block ([#37](https://github.com/Schero94/Magic-Editor-X/issues/37)) ([8bff3c9](https://github.com/Schero94/Magic-Editor-X/commit/8bff3c9b921a6da449e0f1a7feb1d02d56533e13))


### Added

- **`npx magic-editor-x types`: TypeScript types per field.** Run from the Strapi project root, it writes a TypeScript module with one discriminated block union per Magic Editor X field: only the block types the field's preset allows (resolved with the same code as the server, heading levels narrowed, component blocks only for the components the field lists), typed `data` for Settings custom blocks (from their field definitions) and for blocks registered with the block SDK (from their schema), and `MagicEditorXFieldValues` from uid and field name to the value type. Options `--out`, `--uid` (repeatable, includes the components a type uses) and `--import-from`. The command loads the project like `migrate`, only reads and makes no network requests (`fetch()` refuses every request while it runs, telemetry is off, scheduled jobs are stopped). Also available as `strapi.plugin('magic-editor-x').service('types').generate({ uids })`. See "TypeScript types per field" in the README.
- **"How Magic Editor X compares" in the README and on the site.** A table sets Magic Editor X against the paid plans of CKEditor 5 and TinyMCE, Strapi's Blocks field and the Growth and Enterprise features of Strapi, with short notes on Payload (Lexical) and Sanity. Every competitor claim links its vendor source and is dated 2026-11. The section also lists where Magic Editor X is weaker: block-level suggestions only, inline text only in table cells, no crop inside the editor, a fixed list of AI actions and no .docx file import. The site adds a matching FAQ entry (also in the FAQ structured data), and `llms.txt` and `llms-full.txt` point to the comparison.

## [2.7.7](https://github.com/Schero94/Magic-Editor-X/compare/v2.7.6...v2.7.7) (2026-11-20)


### Bug Fixes

* API and output re-audit findings (AI key endpoint, list start, GraphQL locale in components, Markdown output, imports, uploads) ([#33](https://github.com/Schero94/Magic-Editor-X/issues/33)) ([3e0236d](https://github.com/Schero94/Magic-Editor-X/commit/3e0236d66fa106ba25d6e1ab1ee90ad2bdfe8a1b))


### Security

- **The `ai.apiKey` key is bound to its endpoint.** An admin with the settings permissions could point the AI provider at another base URL (Settings, or `POST /magic-editor-x/settings/ai/test`) and the key from `config/plugins.js` was sent there, although a stored key already had this protection. The `ai.apiKey` key is now only sent to the base URL it is configured for: the new option `ai.apiKeyBaseUrl`, or, when that is unset, the official Anthropic (`https://api.anthropic.com`) and OpenAI (`https://api.openai.com`) APIs. Another base URL gets no key until an admin enters one (it is then stored encrypted and used only there); saving another base URL without a key answers 400 on `ai.apiKey`, a connection test sends no key, and the Configuration page opens the key field and says where the `ai.apiKey` key goes. A key entered for a connection test is now used as typed instead of the `ai.apiKey` key. Switching back to the configured base URL drops a key stored for the other endpoint. `GET /magic-editor-x/settings` adds `ai.hasStoredApiKey` and `ai.apiKeyEnvironmentBaseUrls`; `ai.apiKeyFromEnvironment` and `ai.hasApiKey` now describe the saved endpoint.
  - **Migration:** if you use `ai.apiKey` with an OpenAI-compatible server, a proxy or any base URL other than the official APIs, set `ai.apiKeyBaseUrl` to that base URL in `config/plugins.js`. Until then the AI actions answer 503 `NO_API_KEY` (Anthropic, OpenAI) or reach the server without a key (OpenAI-compatible).

### Fixed

- **Numbered lists from HTML started at 0.** An `<ol>` without a `start` attribute (also the plugin's own HTML output, paste and `magic-editor-x migrate --format html`) was imported with `meta.start: 0`, so `?mex=html` wrote `start="0"` and `?mex=markdown` numbered from `0.`. A missing, empty or invalid `start` now gives 1; an explicit `start="0"` is kept.
  - **Existing content:** lists imported before this fix keep `start: 0`. It cannot be told apart from a list that really starts at 0, so nothing is rewritten automatically. Check lists that show 0 as their first number and set the start number in the editor (or re-import the source).
- **Markdown output (`?mex=markdown`, `renderMarkdown`, GraphQL `MARKDOWN`) is valid CommonMark + GFM.** A line break at the end of a paragraph, heading, list item or table cell left a literal `\`; it is dropped now (a break at the end of a bold or link moves outside it). Adjacent or nested marks of one kind (`<b>a</b><b>b</b>`, `<s>…</s><s>…</s>`, `<i>…</i><i>…</i>`, adjacent code) produced `**a****b**` and similar text that is not formatted; they are written as one run. Italic inside a word uses `*` (`a*b*c`), bold before a strikethrough after punctuation uses `__`, and `!` before a link is escaped so it does not become an image. Two list blocks in a row were joined into one list; the second one now uses the other CommonMark marker (`*` or `1)`). Display math keeps TeX lines that start with `+`, `-`, `#` and similar inside the `$$` block (indented, which TeX ignores). A property test renders random content and parses it back with marked.
- **GraphQL output in components and dynamic zones used the default locale and published content.** `…Rendered` and `…Resolved` fields inside components and dynamic zones (also nested ones) ignored the locale and the `status: DRAFT` of the entry, so internal links, mentions and footnote ids pointed to the default locale's published entries while the top-level field and `?mex=` were right. The component and dynamic zone resolvers now pass the entry's locale and status down (a nexus plugin middleware around Strapi's own resolvers; `resolversConfig` is not touched). A populated relation uses its own entry.
- **Damaged JPEG, GIF and WebP images were stored.** Only PNG had an integrity check; a JPEG, GIF or WebP with a valid signature and broken data passed, because Strapi's upload service checks only images sharp can read the header of. `POST /magic-editor-x/image/byFile`, `/image/byUrl` and `/file/upload` now refuse them with 400 (`The image file is damaged`, or `The file is damaged or not a valid file of its type` for attachments) using the Media Library's own `image-manipulation` check (sharp `isImage` and `isFaultyImage`, which honours `plugin::upload.sharp.limitInputPixels`); AVIF and attachment PNGs are checked the same way.
- **`?mex=` with an invalid value broke routes of other plugins.** `/api/upload/files?mex=x` or `/api/i18n/locales?mex=x` answered 400 although the README says plugin routes are never changed. The value is now checked once the route is known: routes of `api::` content types still answer 400 (`details.param: 'mex'`/`'mexBlockIds'`), all other routes answer as without the parameter. (Without `api.rest.strictParams` an api route's controller now runs before that 400; with it, Strapi validates `mex` before the controller as before.)
- **AI error codes.** A provider answer over 1 MiB answered `502` "The AI provider is not available"; it now has its own code `RESPONSE_TOO_LARGE` ("The AI provider answer is too large"). An answer that is not JSON is `BAD_RESPONSE`, and `UNREACHABLE`, `EMPTY` and `PROVIDER_ERROR` have their own messages. The README lists every code with its status.
- **`uploads.allowPrivateOrigins` and metadata addresses.** A listed origin whose host name resolved to a link-local or cloud metadata address (169.254.169.254, fe80::/10) was fetched. Images and media by URL now use the same check as `ai.altText.allowPrivateOrigins` and the link check: the name is resolved once, link-local and metadata addresses are refused with 400, and the connection is pinned to the checked address.
- **`data-strapi-source` claimed a locale for types without i18n.** A populated relation to a type without i18n inherited the parent entry's `locale=` in `?mex=html&mexBlockIds=true` source maps; it now has only the entry's own locale.
- **Import fidelity.** `$$…$$` display math written by the Markdown renderer imports as a math block again (was a paragraph). The plugin's quote HTML (`<figure><blockquote>…</blockquote><figcaption>…</figcaption></figure>`) imports as one quote with its caption (the caption was a separate paragraph). Nested task lists (Markdown and HTML) become a `list` block with the `checklist` style and keep their nesting; flat task lists stay `checklist` blocks, which have no nesting.
- **Deeply nested Markdown.** Markdown that nests lists or quotes more than 32 levels deep (for example a list indented two more spaces per line) took minutes in marked or overflowed the stack. `markdownToBlocks` now refuses it at once (`report.skipped: [{ reason: 'too-deep' }]`, no blocks), on the server (`migrate`, the MCP tool answers `TOO_DEEP`) and in the editor, which then pastes the text unformatted.

## [2.7.6](https://github.com/Schero94/Magic-Editor-X/compare/v2.7.5...v2.7.6) (2026-11-20)


### Bug Fixes

* **admin:** focus after AI and resolved comments, reduced motion, leftover drop line ([#31](https://github.com/Schero94/Magic-Editor-X/issues/31)) ([c71db51](https://github.com/Schero94/Magic-Editor-X/commit/c71db517fd198499d7d662cf5b7de6ae3b59bce3))


### Fixed

- **Focus after the AI assistant.** Replace selection, Escape or Close in the inline AI dialog put focus on the page body. Focus now returns to the text (after Replace, behind the new text), or to More tools.
- **Focus after resolving a comment.** A resolved thread is hidden, so its Resolve button disappeared and focus fell to the page body. Focus now moves to the Comments heading.
- **Reduced motion.** With "reduce motion" turned on in the operating system, new blocks, the block menu, the toolbox and the toolbar buttons appear without the Editor.js animations, and the embed, image and editor loaders no longer spin without end.
- **Leftover drop line.** After dropping a file on the editor, Editor.js' drop mark (a dotted line with an arrow under a block) stayed visible until the next drag. It is now removed with the drop.

## [2.7.5](https://github.com/Schero94/Magic-Editor-X/compare/v2.7.4...v2.7.5) (2026-11-20)


### Bug Fixes

* **admin:** sub/sup, panel focus, target sizes, contrast, settings landmarks, unknown embeds, shortcut labels ([#30](https://github.com/Schero94/Magic-Editor-X/issues/30)) ([67c04ef](https://github.com/Schero94/Magic-Editor-X/commit/67c04efa72d04541c802fab4e07f2ff7c4cd99de))


### Fixed

- **Sub- and superscript kept.** Fields without the script buttons dropped stored `<sub>` (and plain `<sup>` without footnotes) on every save and on HTML paste, because Editor.js keeps only tags of the inline tools a block offers. Fields whose preset allows every inline tag now keep them without showing extra buttons. This also removes the phantom "Send 1 suggestion" in Suggest changes for such content.
- **Focus.** Quality checks, Comments and Suggestions opened from More tools move focus into the panel (and back to More tools when closed). The keyboard shortcuts dialog returns focus to the caret (Ctrl/Cmd+/) or to More tools. A new highlighted code block starts in the code, not the file name. A new component block starts in its first field.
- **Target sizes and contrast.** Checkbox labels in block forms, the code block's file name and language controls, the person block's photo button and the "How to allow it" link are at least 24 px; the audit trail shows page size and page links in two rows below 768 px so nothing runs off the screen. Numbers in highlighted code and the attachment file size now meet 4.5:1 in light and dark mode.
- **Settings pages.** Load errors, loading and missing permissions render one `main` landmark. The Configuration page no longer requests the settings before the permission check (no 403 in the console for reviewers).
- **Unknown embed services.** A stored embed whose service the editor does not configure shows a short note with its URL and is saved unchanged, instead of an Editor.js console error and a missing block.
- **Shortcut labels.** More tools and the shortcuts dialog use the notation of the Editor.js block menu (⌘ ⇧ ⌥ on a Mac, Ctrl ⇧ Alt elsewhere).

## [2.7.4](https://github.com/Schero94/Magic-Editor-X/compare/v2.7.3...v2.7.4) (2026-11-20)


### Bug Fixes

* **admin:** toggle freeze, unsaved room text, CSP link card, save race ([#29](https://github.com/Schero94/Magic-Editor-X/issues/29)) ([4d660c4](https://github.com/Schero94/Magic-Editor-X/commit/4d660c4f772e14108c922013dd3a42c7dc9d6b24))


### Fixed

- **Tab froze with a closed toggle.** editorjs-indent-tune 1.4.4 re-queued its layout step as a microtask for as long as a block measured 0 px wide. Children of a closed toggle are hidden, so a window resize or More tools > Suggest changes froze the browser tab. The indent tune wrapper now waits for such a block with a ResizeObserver and applies the indent when the toggle opens.
- **Link preview with a blocked image.** The Content Security Policy notice took the place of the preview image inside the card row and squeezed the title and description to one character per line. The notice now takes its own row under the text.
- **Unsaved live-session text looked saved.** A collaboration room keeps unsaved text for `roomTtlMinutes`. When an editor opened the entry within that time, the field showed the text with Save disabled, and saving other fields stored the old value. The field now marks the form as changed and shows a notice ("not saved yet") with Discard changes, which brings the stored value back for everyone in the room.
- **Last keystrokes before saving.** Text typed less than 40 ms before Ctrl/Cmd+Enter, Ctrl/Cmd+S or a Save click could be missing from the saved entry. The field now finishes handing its content to the form before the save runs.

## [2.7.3](https://github.com/Schero94/Magic-Editor-X/compare/v2.7.2...v2.7.3) (2026-11-20)


### Bug Fixes

* round-trip Markdown quote captions and keep Strapi Blocks code newlines ([#28](https://github.com/Schero94/Magic-Editor-X/issues/28)) ([54b525f](https://github.com/Schero94/Magic-Editor-X/commit/54b525fe72d9f4d65663fb23fa6c1d6dffb936e1))


Patch release: conversion fixes from the 2.7 API audit. No breaking changes, no migration.

### Fixed

- **Markdown quote captions round-trip.** `renderMarkdown` writes a quote caption as a last `> — Name` paragraph, but `markdownToBlocks` read it back as part of the quote text, so Markdown export and import (and Markdown paste) moved the caption into the text. A last quote paragraph that starts with an em dash and a space now becomes the quote caption again; quotes without that line are unchanged.
- **Strapi Blocks code keeps its trailing line break.** `strapiBlocksToEditor` (used by `magic-editor-x migrate --format blocks`) dropped the final line break of a code node. Strapi Blocks store the exact code, so it is now kept. Markdown fences and HTML `<pre>` still drop their formatting line break.

### Documentation

- Core Blocks bridge and migration: custom Blocks node types (for example a type registered for the bridge) are not converted to Editor.js blocks; they are left out and reported as `unsupported-node` with their type. The README says so and how to handle them.

## [2.7.2](https://github.com/Schero94/Magic-Editor-X/compare/v2.7.1...v2.7.2) (2026-11-20)


### Bug Fixes

* parse 1.x JSON strings only in Magic Editor X fields ([#27](https://github.com/Schero94/Magic-Editor-X/issues/27)) ([cfebf1d](https://github.com/Schero94/Magic-Editor-X/commit/cfebf1db7ba8b69b765d4c5e6b1cc38683225862))

## [2.7.1](https://github.com/Schero94/Magic-Editor-X/compare/v2.7.0...v2.7.1) (2026-11-20)


### Bug Fixes

* **security:** sanitise duplicated entries, clean mex=json output, safe upload names ([#26](https://github.com/Schero94/Magic-Editor-X/issues/26)) ([1e8634a](https://github.com/Schero94/Magic-Editor-X/commit/1e8634af541ab1604dd250f065d603787320d390))


Patch release: fixes from the 2.7 API audit. No breaking changes; one undocumented side effect of `api.autoParseJSON` is gone, see Migration.

### Migration

- Nothing to do for Magic Editor X fields. If a client relied on the old side effect (a text, string or JSON field, or another plugin's route, that held an Editor.js JSON string and came back as an object), it now receives the string as stored: parse it in the client, or store such content in a Magic Editor X field.

### Fixed

- A damaged PNG (valid signature, broken chunk checksum) uploaded to `/image/byFile` or `/image/byUrl` answers 400 `The image file is damaged` instead of 500 with an error log line. When the Media Library itself refuses a file (for example Strapi's faulty-image check), the editor routes answer 400 `The file is damaged or not a valid file of its type`; other upload failures stay 500 with a fixed message.
- **`api.autoParseJSON` parsed strings in fields that are not Magic Editor X fields.** The response middleware that turns 1.x JSON strings into objects walked every value of every Content API GET response and parsed any string that looked like an Editor.js document, also in text, string and JSON fields and on other plugins' routes. It now follows the content-type schema and parses only the values of Magic Editor X fields: top-level fields, components, dynamic zones and populated relations, in the flat and the v4 response format, on Content API routes of `api::` content types. For Magic Editor X fields the behaviour is identical.

### Security

- **Content Manager "Duplicate" stored editor content unsanitised.** The save sanitiser (a Document Service middleware) only ran for `create` and `update`; the Content Manager duplicate (`POST /content-manager/collection-types/:uid/clone/:id`, Document Service `clone` with `data`) stored script tags, event handlers, `javascript:` links and unsanitised raw HTML as sent. It now runs for every Document Service action that writes `data` (`create`, `update`, `clone`; checked against `@strapi/core` 5.63: `publish`, `unpublish` and `discardDraft` copy stored rows and take no `data`). Entries duplicated with an earlier version can still hold the unsanitised values: open and save them once (any update runs the sanitiser); `?mex=` output is cleaned in any case.
- **`?mex=json` output returned stored values as they were.** REST `?mex=json` and the GraphQL `<field>Resolved` fields now run every stored value through the same sanitiser as the save path (field preset, raw HTML mode) before references are resolved, like the rendered formats. Values written past the save middleware (older versions, direct database writes, imports) no longer reach the API unclean.
- **Image uploads kept the client's file extension.** `POST /magic-editor-x/image/byFile`, `/image/byUrl` and `/media/byUrl` stored a checked PNG sent as `poly.html` (or `.svg`, `.xhtml`) under that name, and the upload provider served it as `text/html` from the Strapi origin. The stored extension now always follows the content type detected from the file's bytes (`poly.html` becomes `poly.png`). Image routes accept raster images only (JPEG, PNG, GIF, WebP, AVIF); SVG and HTML are never stored through them.
- **Media Library upload security settings now apply to the editor's uploads.** `plugin::upload.security.deniedTypes` and `allowedTypes` (exact types or `*` patterns) are checked against the detected type of every image, media and attachment upload; a refused type answers 415.
- **Backslash URLs.** `sanitizeUrl` (the URL fields of blocks) accepted `/\evil.example`, which browsers read as the protocol-relative `//evil.example`. Any URL with a backslash is now refused, like the inline link policy already did.

# [2.7.0](https://github.com/Schero94/Magic-Editor-X/compare/v2.6.2...v2.7.0) (2026-11-19)


### Features

* Core Blocks bridge for custom blocks in Strapi's Blocks field ([#22](https://github.com/Schero94/Magic-Editor-X/issues/22)) ([ad8ba44](https://github.com/Schero94/Magic-Editor-X/commit/ad8ba445ea584f6ae8433ef3d01ff4fb069379b7))


Minor release (2.7.0): no breaking changes, no migration. The new feature is off by default.

### Added

- **Core Blocks bridge:** custom blocks in Strapi's own Blocks field can now be saved and published. Strapi's server rejects every block type it does not know (`Block node is of invalid type`), so blocks added to the core Blocks editor with the Content Manager API `addRichTextBlocks` could not be saved through the admin, REST or the Document Service ([strapi/strapi discussion 25546](https://github.com/strapi/strapi/discussions/25546#discussioncomment-19718520)).
  - Developers register a block type once on the server with `strapi.plugin('magic-editor-x').service('core-blocks').register({ type, validator })` (a Yup schema, or `(helpers) => schema` with `yup`, `textNodeValidator`, `linkNodeValidator`, `inlineNodeValidator`, `checkValidLink`) and add it to the editor with `app.getPlugin('magic-editor-x').apis.addCoreBlocks({ [type]: block })`, which wraps `addRichTextBlocks` (Strapi 5.46 and later).
  - Admins turn it on in Settings > Magic Editor X > Configuration > "Custom blocks in Strapi Blocks fields" (switch, then Save; no restart). Config: `coreBlocks.enabled` (default `false`); the saved switch wins.
  - Only registered types are validated by their own schema; built-in blocks and unregistered types go through Strapi's validation unchanged, and unregistered types keep Strapi's error. Stored custom nodes are the nodes the editor sent. With the bridge off nothing changes.
  - Limits per custom node (depth 32, 10,000 values, 256 KB of text, 1000 custom nodes per write), no prototype keys, plain JSON only.
  - A canary checks Strapi's validator at start; if Strapi changes the hook point, the bridge logs one error and stays out instead of weakening validation. **When Strapi validates custom blocks itself, the bridge turns itself off automatically** and hands the registered types to Strapi.
  - Settings shows the status, the registered block types and block types the editor offers without server rules.
  - Each registered type is probed against Strapi's own validator first: a type Strapi already validates itself (for example a block a later Strapi adds) is left to Strapi, logged once and listed in Settings.
  - The canary runs each time the bridge is switched on, so saving the switch as on retries after a Strapi fix. Shutting Strapi down cancels pending state changes, so no other Strapi instance in the same process inherits the bridge.
  - The audit trail records when the bridge is switched on or off.
- CI job `core-blocks`: the bridge tests run on Strapi's real entity validator and a Strapi boot (Document Service create, update, publish) on the peer floor (5.38.0) and the newest Strapi 5.x for every pull request.

### Changed

- `GET /settings` adds `data.coreBlocks` (status and registered type names, no content); `PUT /settings` accepts an optional `coreBlocks: { enabled }`.

### Security

- Validator examples end with `.noUnknown()`; hosts should validate every key their renderer reads.
- New review: [docs/security-audit-2.7.md](https://github.com/Schero94/Magic-Editor-X/blob/main/docs/security-audit-2.7.md).

## [2.6.2](https://github.com/Schero94/Magic-Editor-X/compare/v2.6.1...v2.6.2) (2026-11-19)


### Bug Fixes

* **columns:** keep concurrent edits when column items move ([#21](https://github.com/Schero94/Magic-Editor-X/issues/21)) ([d466a0b](https://github.com/Schero94/Magic-Editor-X/commit/d466a0bcc1b6513ca06a07bfcc80d35d9a5f406b))


### Fixed

- **Columns, live editing:** moving an item to another column no longer loses what someone else types into it at the same moment. This covers "Number of columns" with fewer columns, which moves the items of the removed columns into the last remaining column. Before, a move deleted the item and inserted a copy, so a concurrent edit of that item was lost. Now the item keeps its identity wherever it is placed:
  - typing, the text style and the heading level that someone changes while the item moves all arrive in the moved item;
  - when two people move the same item at the same moment, it ends up in one place on every screen, never twice (the first place in reading order wins);
  - when one person moves an item and another deletes it, the delete wins, as it does for blocks;
  - an item someone adds to a column that another person removes at the same moment is kept at the end of the last column;
  - undo of "Number of columns" brings the removed columns back with their items, also after others typed into them;
  - changes of several people that each stay within the limits are never refused when they meet, also near the limit of 50 items per column (for example one person chooses fewer columns while another adds an item). If a column then holds more than 50 items, saving moves the rest to the start of the next column, so nothing is cut off.
- Comments on text in a column item stay on that text when the item moves to another column, also when another item has the same text.
- Columns: "Number of columns" with fewer columns cut off the items beyond 50 in the last column. When the items do not fit, the number of columns now stays and the editor says that a column holds at most 50 items.
- Columns: when several people added a column at the same moment, the block could end up with more than four columns and every further change to it was refused (what was typed with it was lost). Columns beyond the fourth now show inside the fourth column, and choosing fewer columns tidies them up.
- Live editing: after the server refused a change, an editor that was about to show someone else's change could show an empty field for a moment, and typing in that moment removed every block of the field for everyone. The editor now waits for the room state before it shows anything.
- Columns: choosing the number of columns, the space between columns or the vertical alignment in the block menu did nothing when someone else typed in the same columns block while the menu was open. The choice now applies, and always to the block of the editor the menu belongs to (also in suggestion mode and when a repeatable component or dynamic zone entry was duplicated with its columns block).

### Migration notes

- No migration, and the stored JSON does not change: the Content API, the renderers and the JSON Schema give the same output for the same content.
- Editing rooms that were open while you updated move to the new layout by themselves, within a few seconds after a short pause in typing (like room compaction: everyone stays connected and nothing typed is lost).
- An editor tab that was opened before the update shows "Live editing unavailable" and "Reload the page to keep editing live"; after the reload it joins the room again.
- Clusters: update all processes together. A room that a process of the previous version still serves is moved to the new layout only once that process is gone, so a rolling deploy does not break it; but a process of the previous version cannot read columns blocks in the new layout, so do not run both versions against one database longer than the deploy takes.
- Cut and paste is not a move: cutting text and pasting it into another column removes the text and adds new text, as in any editor. What someone types into the cut text at the same moment is not carried over.

## [2.6.1](https://github.com/Schero94/Magic-Editor-X/compare/v2.6.0...v2.6.1) (2026-11-18)


### Bug Fixes

* **admin:** StrictMode-safe editor config, synced sources, presence and indent tune ([#19](https://github.com/Schero94/Magic-Editor-X/issues/19)) ([64234a8](https://github.com/Schero94/Magic-Editor-X/commit/64234a8bbabc3a4c98d84f657c164318956d62e4))


### Fixed

- An editor field that unmounted while the editor settings were still loading (React StrictMode does this once on every mount; the edit view can also remount fields) made every other Magic Editor X field on the page show "The editor could not be loaded", and custom blocks were missing until the page was reloaded. The settings and custom blocks are shared by all fields and are now loaded with a request that does not belong to one field.
- A synced block could show "The synced block could not be loaded" when another view of the same source unmounted while it was loading. Synced sources are now loaded the same way, shared and independent of the view that asked first.
- Each block left a window resize listener behind when its editor was closed (closing an entry, a remote change rendered again, a suggestion session). The indent tune (editorjs-indent-tune 1.4.4) never removes the listener it adds; Magic Editor X now removes these listeners when the editor is destroyed, and a listener of a block that left the page removes itself on the next resize.
- The entry side panel no longer sends a presence heartbeat followed at once by a leave when it mounts and unmounts right away (React StrictMode does this on every mount); the first heartbeat goes out on the next task.
- The audit trail page cancels its own requests when its filters change or it unmounts, so it never loads the list and the admins twice (seen with React 19).

### Tests

- `npm run test:admin`: every admin entry point (editor field with Editor.js, live collaboration, lazy start, signed-out state, version history, comments and templates; entry side panel; settings pages; homepage widgets; Content-Type Builder input; Redux middlewares) is rendered in `React.StrictMode` with the Strapi admin providers. It fails on a request sent twice, an Editor.js instance, Yjs document, socket, interval, listener or observer left after unmount, and on console errors or warnings. CI runs it on React 18 and in a required job on React 19.

# [2.6.0](https://github.com/Schero94/Magic-Editor-X/compare/v2.5.3...v2.6.0) (2026-11-18)


### Features

* component blocks, columns, session expiry and Live Preview (2.6) ([#17](https://github.com/Schero94/Magic-Editor-X/issues/17)) ([7474493](https://github.com/Schero94/Magic-Editor-X/commit/74744930b1b951bc8133e1f7c55e30f1d7679899))


### Features

- **Component blocks:** insert components from the Content-Type Builder as blocks inside a Magic Editor X field. In the Content-Type Builder, open the field's advanced settings and pick the components editors may insert ("Component blocks"); they then appear in the field's + menu and slash menu under their own names. Each block is a small form with the component's text, number, date, choice and on/off fields, checked while you type and again when the entry is saved. Off by default: a field without chosen components shows nothing new. Renderers output nothing for component blocks unless you pass `componentBlocks` (HTML, React, Vue) or an override, so existing front ends do not change. Live editing keeps every collaborator's change: two people typing in the same component block at once lose nothing.
- **Live Preview:** support for Magic Editor X fields, re-checked on Strapi 5.62 (details and sources in `docs/live-preview.md`, front-end guide in `docs/guides/live-preview.md`):
  - Renderer option `blockIds` (HTML, React, Vue) and `?mex=html&mexBlockIds=true` for Content API output mark each rendered block with `data-mex-block-id` and `data-mex-field-path`. With Strapi's preview header `strapi-encode-source-maps: true` (or `strapiSource` in the renderer option) the blocks also get `data-strapi-source`, so Strapi's preview highlights the field. Off by default; existing output does not change.
  - Click-to-locate: a click on a block in the preview opens the entry with the caret in that block (`editViewUrl` builds the link: `?mexField=<path>&mexBlock=<id>`), also for fields that start lazily. With the Live Preview side editor, `requestLocate` asks the field next to the preview to show the block without leaving the page. A block that no longer exists shows a short notice.
  - New helpers in `magic-editor-x/render`: `editViewUrl`, `requestLocate`, `locateMessage`, `isBlockId`, `isFieldPath`, `strapiSourceValue`.
- **Columns block:** insert "2 columns" or "3 columns" from the + menu or with `/col`, then type. Each column holds paragraphs, headings and list items with the field's inline formatting. A small toolbar above the columns sets the text style and the width (equal, wide left, wide right, wide middle for three columns); the block menu changes the number of columns (2 to 4), the space between them and their vertical alignment.
  - Keyboard: Enter starts a new paragraph or list item in the column, Backspace at the start of an empty item removes it, arrow keys move between items, columns and blocks, Tab and Shift+Tab jump to the next or previous column, Alt+F10 opens the toolbar. `## `, `- ` and `1. ` turn a paragraph into a heading or list item. Pasting several paragraphs creates items; pasted HTML keeps only the field's inline formatting.
  - Columns work with live collaboration (two people can type in different columns or the same item at once), undo and redo, "Copy block", templates, insert from another entry, drag and drop of the block, find and replace, AI actions, Strapi AI translations, comments on text in a column, suggestions (a columns block is suggested as one block), the quality panel (heading order across columns, empty columns, links) and field presets (`allowedBlocks`, heading levels). Columns stack in reading order when the editor is narrow.
  - Output: HTML and the React and Vue components render `div.mex-columns[data-mex-columns]` with one `div.mex-column` per column and no inline styles, so your site decides the layout (stack the columns on small screens). Plain text and Markdown flatten the columns in reading order; Markdown has no columns, so the layout is lost there. JSON Schema and TypeScript types (`ColumnsData`) describe the block.
- **Signed out while editing:** when the admin session ends (idle or absolute lifetime, signed out on another device, removed account), the entry shows one calm banner, "You were signed out. Your changes are kept on this device. Sign in again to save.", with one action, **Sign in again**. It opens the login in a new tab, which closes itself after you sign in; the entry stays open, the text you typed is back in the editor and Save works.
  - While signed out, typed text is kept on this device at once and with every change (also during live editing), live editing pauses instead of reconnecting, and presence, comment and suggestion polling stop, so the server is not asked again and again with an ended session.
  - If you click Save anyway and Strapi sends you to the login page, the text is still kept: open the entry again and restore it with one click (automatically when Strapi reloads the entry right after you signed in again).

### Fixed

- After signing in again, text kept on this device is no longer put over content someone else saved meanwhile in a field without live editing: Magic Editor X shows the Restore/Discard notice with the changes instead.
- Text typed after a short pause no longer jumps to the start of the paragraph. When another Magic Editor X field on the page started (fields start as they come near the screen, for example after the page scrolled), Editor.js cleared the caret of the field you were typing in, and the next keystrokes landed at the start of the paragraph. The caret now stays where it was. Present since 2.5.0.
- Live collaboration: when someone inserted a list item and edited another one while you edited that one too, your edit could land in the wrong item. Items that carry an id (column items) are now matched by id.

### Security

- A live editing connection now ends with the admin session it was opened in. Before, a connection opened before the session was revoked (signed out on another device, removed from the profile's session list, expired) kept accepting edits until the browser noticed the end. Edits are refused within at most 5 seconds of the end, the connection is closed, and the edit stays on your device until you sign in again. See [docs/security-audit-2.6.md](./docs/security-audit-2.6.md) (MEX-26-11).

### Migration notes

- No migration. A Settings custom block named `columns` keeps its data, its editor tool and its output; new custom blocks cannot take the name. A block registered in code under the name `columns` keeps working and replaces the built-in tool in that site.
- `component` and `columns` are built-in block names now. Data of these types that was written without the built-in marker (`_mex`) by an import, a script or the block SDK and has exactly the built-in shape (`component`: only `uid`, or `uid` and `values`; `columns`: only `columns` with optional `layout`, `gap`, `valign`) is read as the built-in block: renderers output nothing for such a component block unless you pass `componentBlocks`, and saving refuses it with `COMPONENT_NOT_ALLOWED` unless the field lists its uid. The server logs one hint when it refuses such a block. Data with any other key (all Settings custom blocks) keeps its tool and output. To keep such data as your own block, rename its type or add a field of your own to its data.
- If your site styles custom blocks by the class `mex-columns`, note that the built-in block uses the same class: select it with `[data-mex-columns]`.
- Session expiry: no new settings, routes or stored data. Logging out yourself still removes the kept text from this browser, as in 2.5.

### Notes

- Typing directly in the preview page is still not possible: Strapi offers no public API for it. A front end can re-render a Magic Editor X field on Strapi's public `strapiFieldChange` event while someone edits it (see the guide).

## [2.5.3](https://github.com/Schero94/Magic-Editor-X/compare/v2.5.2...v2.5.3) (2026-11-17)


### Bug Fixes

* **collaboration:** load one copy of Yjs in the ES module server entry ([#14](https://github.com/Schero94/Magic-Editor-X/issues/14)) ([58718e7](https://github.com/Schero94/Magic-Editor-X/commit/58718e7fdc672ac705549a8f2862ac51cdb79c37))


### Fixed

- The ES module server entry (`magic-editor-x/strapi-server` with `import`) loaded two copies of Yjs: the collaboration service used the CommonJS build and the shared document code the ES module build, so documents of one failed the other's constructor checks. CommonJS server code now takes Yjs from one shared module, and each entry loads exactly one build. Strapi itself loads the CommonJS entry, which was not affected.
- `npm run verify:runtime` loads each server bundle format in its own process and fails when a process prints "Yjs was already imported", instead of printing the warning as noise.

## [2.5.2](https://github.com/Schero94/Magic-Editor-X/compare/v2.5.1...v2.5.2) (2026-11-17)


### Bug Fixes

* **link-check:** show the next scheduled run on Strapi before 5.61 ([#13](https://github.com/Schero94/Magic-Editor-X/issues/13)) ([2228217](https://github.com/Schero94/Magic-Editor-X/commit/22282172f528840747a6f867546ab6d0c176af64))


### Fixed

- Settings > Configuration shows the next run of the scheduled link check on Strapi 5.38 to 5.60 again. Those releases schedule cron jobs with node-schedule, whose next run is a cron-parser date object instead of a `Date`, so `nextRunAt` was always empty there.

## [2.5.1](https://github.com/Schero94/Magic-Editor-X/compare/v2.5.0...v2.5.1) (2026-11-17)


### Bug Fixes

* **readme:** make images and links work on the Strapi marketplace ([#12](https://github.com/Schero94/Magic-Editor-X/issues/12)) ([85a95eb](https://github.com/Schero94/Magic-Editor-X/commit/85a95eb620ef8609de691f766cabf97bceaba7b4))


### Fixed

- The README now works outside GitHub, on npm and on the Strapi marketplace: images load from the docs site (absolute URLs) and links to the license, guides, security reviews and other repository files point to GitHub instead of relative paths that led nowhere. The Screenshots section shows eight chosen screens and links the full gallery on the docs site instead of 61 images. A test fails on any relative image or link in the README and caps the number of screenshots.

# [2.5.0](https://github.com/Schero94/Magic-Editor-X/compare/v2.4.0...v2.5.0) (2026-11-16)


### Features

* entry panel with presence, unsaved-work protection, reuse, palette colours, private media and MCP tools ([#9](https://github.com/Schero94/Magic-Editor-X/issues/9)) ([23d3127](https://github.com/Schero94/Magic-Editor-X/commit/23d31270a8d13aae90c91734af844be1171281d3))


Magic Editor X 2.5 shows who is editing an entry, keeps unsaved work, lets editors reuse content from other entries, starts long entries faster, adds palette colours, superscript, subscript and inline annotations, supports private upload providers and dropped files, and adds optional tools for Strapi's MCP server. Everything new is off by default or appears only when it is relevant; the field toolbar is unchanged.

### Features

- **Entry panel:** a Magic Editor X side panel in the Content Manager shows who else is editing the entry (names only, across processes, also without live collaboration), open comment threads and quality issues or broken links per field, each with a button that opens that field's panel. Optional soft lock `presence.softLock` (off): a dialog asks once per tab before you edit an entry someone else is editing; nobody is locked out. Homepage widgets **My open threads** and **Broken links**. Routes `POST /presence`, `GET /entry-summary`, `GET /widgets/open-threads`, `GET /widgets/broken-links`; config `presence.enabled` (true), `presence.softLock` (false), `presence.perMinute` (30).
- **Unsaved work is kept:** unsaved field content stays in your browser (IndexedDB) and is offered back after a reload, crash, closed tab or ended session with one notice: Restore (one Undo reverts it) or Discard. Never restored automatically over newer saved content. Removed on save, discard, expiry and logout. Config `drafts.enabled` (true), `drafts.ttlHours` (72).
- **Insert from another entry:** More tools > Write > Insert from another entry copies chosen blocks from any entry, field or language you can read, with a preview and one undo step. Blocks the field does not allow are listed with the reason; synced blocks stay synced; inserted blocks get new ids. Routes `GET /reuse/types`, `GET /reuse/source`; config `reuse.enabled` (true), `reuse.perMinute` (60).
- **Block clipboard:** blocks copied between Magic Editor X fields, entries and tabs keep all their data and alignment; new **Copy block** in the block menu.
- **Faster long entries:** Editor.js and the live room of a field start when the field comes near the screen or gets focus (`lazyInit.enabled`, `lazyInit.marginPx` 800). With 20 fields and a dynamic zone, 4 editors and live connections start instead of 20. The benchmark covers 20 fields and up to 250 repeatable and dynamic-zone items.
- **Palette colours, superscript, subscript, inline annotations:** text colour and highlight from named tokens in the new `palette` config (stored as `data-mex-color`/`data-mex-highlight`, rendered as classes, never inline styles), with a contrast check in Settings and the quality rule `color-contrast`; superscript and subscript; inline annotations with the built-in abbreviation and `registerInlineAnnotation` in `magic-editor-x/blocks` (server-side `resolve`, renderer options `annotations` and `resolveAnnotation`). Field options `inlineColors`, `inlineScript`, `inlineAnnotations`, all off by default.
- **Private upload providers:** Media Library files in Magic Editor X values are stored with their file id and unsigned URL and signed in batches on every Content API, GraphQL and `?mex=` read and in the editor. New route `POST /media/signed-urls`; `GET /config` adds `uploads.privateFiles`.
- **Drop files onto a field** (Strapi 5.61+): they are uploaded through Strapi's Media Library drop zone and inserted as image, video or audio blocks; older hosts keep the previous behaviour.
- **Tools for AI clients (MCP):** with `mcp.enabled` (false) and Strapi's `server.mcp.enabled`, tools `mex_from_markdown`, `mex_from_html`, `mex_validate`, `mex_render`, one JSON Schema resource per preset and the prompt `mex_content_guide`. Pure transformations in a worker thread with a time limit; new action `plugin::magic-editor-x.mcp.use` (no role gets it automatically).

### Bug Fixes

- Tab and other keys work in every Magic Editor X dialog and in other form fields while an editor has a current block (Editor.js handled keys typed anywhere on the page).
- Text typed into an empty field in a live room now reaches the other editors (0 of 1 edits arrived in 2.4.0), and other people's edits no longer move your focus.
- Discarding a draft keeps version history and comments of sections whose published version predates 2.4.
- A section emptied and saved keeps its history and comments (its `fieldKey` is remembered while the value is `null`).
- Saving a synced block without changes no longer creates a version.
- Mention e-mails use the recipient's admin language (en, de, fr, es, pt).
- The inline toolbar wraps inside the field on narrow screens instead of running off the left edge.
- Focus returns into gallery, video and audio blocks after the Media Library picker closes.
- No Radix accessibility warning in the console for the plugin's dialogs on Strapi 5.62 (Design System 2.3.1).
- Installing on Node 22 no longer warns with EBADENGINE (see the migration notes); CI installs the packed package on Node 22 and fails on any EBADENGINE.

### Deferred

- Component blocks (Content-Type Builder components as blocks) move to 2.6. They worked in single-editor tests, but a stress test of two editors in one live room (CPU throttled 4x) lost a collaborator's edit: the component form sent all its values on every keystroke, so a value that had arrived from the room but was not drawn yet was overwritten (3 of 8 rounds), and the same happened inside one attribute (1 of 4 rounds). The cause is found and a fix with regression tests is on the branch `feat/2.5-components`; it ships when the stress and cluster runs show no lost edit.
- Live Preview inline editing for Magic Editor X fields: in Strapi 5.61 the side editor and its messages are internal, live preview is experimental and needs a Growth or Enterprise plan, and content source maps skip JSON custom fields.
- Columns/layout block: the 2.5 spike measured blockers on Editor.js 2.31 (moving a block between columns while someone edits it loses the edit without a new collaboration schema; nested editors handle keys twice; comments, suggestions, quality, find/replace and AI address top-level blocks only). See `docs/engine-decision.md`.
- Session-expiry warning: Strapi does not expose to the browser when an admin session ends; local drafts cover lost sessions instead.

### Migration notes

- `engines.node` is now `>=22.12.0 <=26.x.x`. This declares the floor that the dependency sanitize-html 2.18 already required since 2.4.0; installs on Node 22.12 or later no longer warn with EBADENGINE.
- `@editorjs/embed` is pinned to 2.7.7, because 2.8.0 requires Node 24. YouTube Shorts and Figma embeds, which 2.8.0 added, are defined by the plugin, so nothing changes for editors; the Figma pattern now requires a Figma document URL.
- No breaking changes and nothing to do for public upload providers.
- With a private upload provider, migration `2.5.0-media-file-ids` adds `fileId` to media in Magic Editor X values once at startup (idempotent, under the migration lease). Dry run: `npx magic-editor-x media-file-ids`; apply again: `--apply`.
- Fields start lazily: scripts and tests that wait for `[data-mex-ready="true"]` must scroll the field into view first, or set `lazyInit.enabled: false`.
- New config keys `presence`, `drafts`, `lazyInit`, `reuse`, `palette` and `mcp` are optional.

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
