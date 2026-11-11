# Magic Editor X 2.0 acceptance (2026-11-11)

Build under test: branch `feat/v2`, packed with `npm pack` (the package version stays 1.6.0 until semantic-release sets 2.0.0) and installed from the tarball into an isolated Strapi 5.61.1 host. The host's installed `dist/` was compared file by file with the repository build before every run.

Host: own ports (1421 SQLite, 1431 PostgreSQL 16, 1441 upgraded 1.5.1 database), random `.env` secrets, outgoing network blocked in the Strapi process (`-r block-egress.cjs`), synthetic admins (Super Admin, Editor, Author, a custom Reviewer role) and synthetic content only. The AI provider is a local fake OpenAI-compatible server; no live provider was called.

## Automated gates

| Gate                                       | Command                                   | Result                                                                                                            |
| ------------------------------------------ | ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Lint                                       | `npm run lint`                            | 0 problems                                                                                                        |
| Format                                     | `npm run format:check`                    | clean                                                                                                             |
| Unit tests                                 | `npm test`                                | 84 / 84                                                                                                           |
| Build + runtime verify                     | `npm run build` (runs `verify:runtime`)   | OK                                                                                                                |
| Package                                    | `npm pack --dry-run`                      | `dist/admin`, `dist/server`, `strapi-admin.js`, `strapi-server.js`, README, LICENSE, CHANGELOG, package.json only |
| Production audit                           | `npm audit --omit=dev`                    | 0 vulnerabilities                                                                                                 |
| Lockfile                                   | `npm ci --dry-run` with npm 10 and npm 11 | OK                                                                                                                |
| Integration, SQLite                        | `MEX_HOST_URL=… npm run test:integration` | 10 / 10                                                                                                           |
| Integration, PostgreSQL                    | same against the PostgreSQL host          | 10 / 10                                                                                                           |
| Cluster (8 processes, non-sticky balancer) | `scripts/cluster-acceptance.mjs`          | 9 / 9, see [2026-11-11-cluster.md](./2026-11-11-cluster.md)                                                       |

## Browser acceptance (Playwright 1.65, Chromium)

### Function matrix

Every control was used in the browser and the stored value was read back from the database.

| Area               | Controls                                                                                                                                                                           | Result                                                                                                    |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Text blocks        | paragraph, heading, list, checklist, quote, warning, alert, toggle, code, highlighted code, delimiter, table, raw HTML                                                             | ✅ stored, same block count after reload, form clean                                                      |
| Inline tools       | bold, italic, underline, marker, strikethrough, inline code, link, tooltip, AI                                                                                                     | ✅ (tooltip: stored markup checked by hand; the scripted check compares text with a trailing space)       |
| Tunes              | alignment, text variant, indent                                                                                                                                                    | ✅ (alignment alone, without typing, fixed in this run: `fix(admin): save block menu changes right away`) |
| Media              | image upload, image by URL, Media Library picker (select and cancel), attachment upload, embed by paste (YouTube URL), link preview (card rendered from a mocked preview response) | ✅                                                                                                        |
| Strapi blocks      | person, button, embedded entry (search + pick), custom simple block, custom component block                                                                                        | ✅                                                                                                        |
| Editing            | undo / redo (buttons and Cmd+Z), drag and drop, full screen (Escape closes)                                                                                                        | ✅                                                                                                        |
| History            | save version, list, preview, restore (form stays dirty until saved)                                                                                                                | ✅                                                                                                        |
| Collaboration      | two editors on one document, presence, live convergence, remote change marks the other form dirty, read-only reviewer                                                              | ✅ 7/7 on SQLite and PostgreSQL                                                                           |
| AI                 | settings test connection, save settings, inline suggestion replaces the selection, no key in any response                                                                          | ✅ 3/3 on SQLite and PostgreSQL                                                                           |
| Settings           | configuration page (AI provider, limits, uploads, link preview), unsaved-changes blocker                                                                                           | ✅                                                                                                        |
| Custom blocks page | create in modal, edit, toggle, duplicate, export, cancel delete, delete, import (created / skipped report)                                                                         | ✅                                                                                                        |
| Publish            | draft and publish with editor content                                                                                                                                              | ✅                                                                                                        |
| Removed            | Webtools link picker (paid add-on, not on npm, cannot be verified); collaboration grants (replaced by Content Manager permissions); license screens                                | removed                                                                                                   |

### Viewports, themes, measurements

- Editor, history dialog, configuration, custom blocks list and block modal at 1440, 1024, 768, 390 and 320 px, light and dark (`measure-light.json`, `measure-dark.json`): no horizontal overflow, no clipped text, no low-contrast plugin text.
- Remaining `smallTargets` belong to Design System or Content Manager controls (Switch, NumberInput steppers, Checkbox with its label as target, the CM back link); `offScaleGaps` belong to the Content Manager edit view layout.
- German, French, Spanish and Portuguese at 1440 and 320 px: no untranslated plugin strings, no overflow.

### Keyboard

- Every toolbar button, the history dialog and both settings pages are reachable by Tab with a visible focus ring.
- Escape then Tab (or Shift+Tab) leaves the editor; Tab alone keeps Editor.js block navigation.
- Closing the history dialog returns focus to the history button.

### Console

No console errors from plugin code. Remaining messages come from Strapi core and also appear on native Content Manager pages: 404 for preview / AI localisation endpoints, the `useRBAC` warning, the styled-components `attribute` prop warning, and CSP refusals for YouTube frames in the admin preview (the admin CSP has no `frame-src`; see README "Content Security Policy").

### Migration from 1.5.1

A database written by 1.5.1 (JSON strings, plain text values, nested lists, checklists, tunes, a component field, a single type, a second locale, Yjs-only snapshots, a custom block with a script in its SVG icon and template) was upgraded to 2.0: 17 / 17 checks — old collaboration tables dropped, snapshots converted to JSON (including Yjs-only ones), the custom block icon and template sanitised, every 1.x value opens and saves unchanged.

## Screenshots

Synthetic content only: `docs/site/img/*.png` (editor light/dark 1440, mobile 390, collaboration, history, AI, configuration, custom blocks, block modal).

## Not covered

- Time-bucket snapshots in the multi-process run (they use the same lease as the session-end snapshots that were proven exactly once).
- Live AI providers (by design; the request format follows the providers' API references and is covered by unit tests with a fake server).
