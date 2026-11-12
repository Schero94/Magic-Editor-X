# Editor engine decision (2.4 gate)

Status: decided for the 2.x line, 2026-11-12. Revisit only on the triggers at the end.

Question: should Magic Editor X stay on Editor.js, or move to a ProseMirror-based engine (ProseMirror directly or Tiptap) or to Lexical?

**Decision: stay on Editor.js 2.31.7 for 2.x. Do not start a migration now.** The stored format, the published JSON Schema, the renderers and the admin API are an engine-neutral contract, so a later move stays possible. A ProseMirror/Tiptap engine (MIT core packages only) behind the same stored format is the candidate for a 3.0, and only if character-level suggestions, nested blocks or columns, or rich content in table cells become hard requirements.

Each statement below is marked **[verified]** (measured or read on 2026-11-12, with the source named) or **[judgement]** (an assessment by the maintainers, not a measurement).

## What Editor.js costs us today

These are the limits the 2.1 to 2.4 work ran into, with what each one cost. Sources: the 2.4 feature agents' reports, AGENTS.md and the tests named.

| Limit                                                                                                   | Effect on features                                                                                                                                                                                                                            | What we did                                                                                                       | Mark                                                 |
| ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| Inline content is one HTML string per block field                                                       | Ranges (comment anchors, grammar matches, find and replace) map DOM offsets to HTML source offsets. Comments needed a dedicated text map (`htmlTextMap`, `domTextMap`) and a quote fallback; rendered math can only be anchored by its quote. | `shared/comment-anchor.mjs`, `tests/comment-anchors.test.mjs`                                                     | [verified]                                           |
| No change marks in saved data, every tool owns its DOM                                                  | Character-level track changes are not possible.                                                                                                                                                                                               | Block-level suggestions in a separate Editor.js instance (`SuggestEditor.jsx`), word diff per block               | [verified]                                           |
| No nested blocks                                                                                        | Tables cannot hold lists, images or several paragraphs per cell; no columns.                                                                                                                                                                  | Tables are an own tool with a cell model (merges, header row and column, alignment, caption), inline content only | [verified]                                           |
| `blocks.update` merges data                                                                             | Keys removed by a collaborator survived on other screens.                                                                                                                                                                                     | `apply-remote.js` unsets removed keys (2.4 fix)                                                                   | [verified]                                           |
| `save()` writes default tune values into every block                                                    | Content looked changed when it was not: spurious versions after idle live sessions, wrong suggestion hashes.                                                                                                                                  | `shared/default-tunes.mjs` (`comparableBlocks`), `blockHash` ignores defaults                                     | [verified]                                           |
| `onChange` timing and the current block index lag after a remote re-render                              | Lookups by index broke after collaborators' edits.                                                                                                                                                                                            | Blocks are found by `.ce-block[data-id]`                                                                          | [verified]                                           |
| Edits can happen before the room is rendered                                                            | A client diffed against a room it had not shown yet and deleted blocks (data loss).                                                                                                                                                           | `getInitialView` in the collaboration client (2.4 fix, `tests/collab-client.test.mjs`)                            | [verified]                                           |
| Keyboard handling on `document`                                                                         | Tab is captured while a block is current; the first Tab presses (three measured) are swallowed in dialogs opened from an editor.                                                                                                              | Workarounds per dialog; not fully solved (known issue)                                                            | [verified]                                           |
| Popovers render inside `.ce-toolbar`                                                                    | Block menus appeared under the next field.                                                                                                                                                                                                    | `:has()` z-index lift (2.4 fix)                                                                                   | [verified]                                           |
| Per-tool sanitize rules replace inline-tool rules per tag                                               | Internal-link attributes were dropped from some fields.                                                                                                                                                                                       | One shared `LINK_SANITIZE` config for every tool that allows `a`                                                  | [verified]                                           |
| Read-only instances have no inline toolbar, and `save()` of a read-only instance did not return content | Comments on selected text needed a floating button for reviewers; suggest mode starts from the content the field shows.                                                                                                                       | Own floating Comment button; own base snapshot                                                                    | [verified]                                           |
| `data-mutation-free` elements are not saved                                                             | Tool UI must live outside saved DOM.                                                                                                                                                                                                          | Synced blocks and CSP placeholders render through portals                                                         | [verified]                                           |
| No virtualisation                                                                                       | Every block is a live DOM subtree; very long documents cost DOM time that CI does not measure.                                                                                                                                                | Data paths measured (below); the 5000-block content limit stays                                                   | [verified] that there is none; DOM cost not measured |

## Performance (data paths)

`npm run bench -- --json` on the `feat/2.4-docs` worktree, 2026-11-12, Node 22.23.1, Apple M3 Pro, median of 7 samples, no budget breaches (`failures: []`). **[verified]**

| Operation, 5000 blocks | Median  |
| ---------------------- | ------- |
| normalise + sanitise   | 45.3 ms |
| `renderHtml`           | 42.9 ms |
| `renderText`           | 22.9 ms |
| `renderMarkdown`       | 26.1 ms |
| `diffDocuments`        | 20.4 ms |
| find and replace       | 14.4 ms |
| Yjs seed + apply       | 76.4 ms |
| lint                   | 10.6 ms |
| preset check           | 0.1 ms  |
| audit field changes    | 4.6 ms  |

At 500 blocks every operation is under 6 ms; at 2000 blocks under 32 ms. The server, renderer and Yjs paths scale linearly and are not a reason to change engines. **[judgement]** The browser DOM cost of Editor.js with thousands of blocks is not measured in CI; it would be measured before any decision that depends on it.

## Maintenance

npm registry and GitHub, queried 2026-11-12 with `npm view <pkg> time --json`, `npm view <pkg> version license` and `gh api repos/<owner>/<repo>`. **[verified]**

| Package                                  | Latest stable       | Licence    | Releases in the last 12 months                                                                                                                | Last activity                                                                      |
| ---------------------------------------- | ------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `@editorjs/editorjs`                     | 2.31.7 (2026-09-17) | Apache-2.0 | 7 stable patches (2.31.1 to 2.31.7), 3 release candidates of 2.32.0 (`next` tag `2.32.0-rc.3`, 2026-11-01), plus a stray `0.0.0` (2026-10-08) | GitHub `codex-team/editor.js`: not archived, last push 2026-11-01, 708 open issues |
| `@tiptap/core`, `@tiptap/pm`             | 3.33.1              | MIT        | 70                                                                                                                                            | GitHub `ueberdosis/tiptap`: last push 2026-11-12, 934 open issues                  |
| `prosemirror-view` / `prosemirror-model` | 1.42.9 / 1.25.13    | MIT        | 16 stable (`prosemirror-view`)                                                                                                                | npm modified 2026-11-09 / 2026-11-08                                               |
| `y-prosemirror`                          | 1.3.7               | MIT        | none (last publish 2025-07-03)                                                                                                                | GitHub `yjs/y-prosemirror`: last push 2026-11-04                                   |
| `lexical`, `@lexical/yjs`                | 0.53.0              | MIT        | 15 stable (245 including pre-releases)                                                                                                        | GitHub `facebook/lexical`: last push 2026-11-12, 511 open issues                   |

Reading of these numbers **[judgement]**:

- Editor.js is maintained but slow: one minor line (2.31) with patches, 2.32 in release candidates for weeks, and the 3.0 document model that would add nesting is reported by the agents as work in progress without a date (not re-verified here). It is good enough for a block editor whose data contract we own, and it is not the engine to wait for if nesting or track changes become requirements.
- ProseMirror and Tiptap release often and have a mature Yjs binding (`y-prosemirror`). Lexical is active but still 0.x, so its API can change in any release.

## Options

|                             | Stay on Editor.js                                                                                                             | ProseMirror / Tiptap (MIT core)                                                                                                                      | Lexical                                          |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Collaboration               | Works today: own Yjs schema 3 mapping per block field, server guard, cluster tested. Inline formatting is HTML inside Y.Text. | `y-prosemirror` maps the whole document to Yjs; formatting as marks. Our server guard, compaction and room model would be rebuilt on the new schema. | `@lexical/yjs`; same rebuild as for ProseMirror. |
| Ranges and comments         | Text map plus quote fallback; works, with the limits above.                                                                   | Native positions and decorations; anchors map through transactions.                                                                                  | Native selection and node keys.                  |
| Suggestions / track changes | Block level only.                                                                                                             | Character-level suggestions are possible (marks or steps); several open-source approaches exist, none in the MIT core.                               | Possible with custom nodes; no core support.     |
| Tables                      | Own tool, inline cell content, merges.                                                                                        | `prosemirror-tables` (in `@tiptap/pm`) with cell selection, merges and nested content.                                                               | Table plugin with nested content.                |
| Nested blocks, columns      | Not possible in 2.x.                                                                                                          | Native (schema).                                                                                                                                     | Native (node tree).                              |
| Stored format               | Editor.js JSON, published schema, every renderer.                                                                             | New document model; we would keep storing Editor.js-shaped JSON through a converter or migrate every value.                                          | Same as ProseMirror.                             |
| Risk                        | Known limits, slow upstream.                                                                                                  | Large rewrite; mature engine.                                                                                                                        | Large rewrite; 0.x API.                          |

All rows except the "works today" facts are **[judgement]** based on the engines' documented features; no prototype was built for this decision.

## Cost of migrating

What a move would touch **[judgement, from the 2.4 code base]**:

- A stored-format migration for every installation (or a permanent two-way converter), with the 2.3 compatibility rules (custom blocks named like built-ins, `_mex` markers, `fieldKey`) carried over.
- About 25 block and inline tools (`admin/src/editor/tools` has 32 modules), the admin sanitiser and its Editor.js-specific rules, paste handling, Markdown shortcuts, find and replace, the block selection bar.
- The Yjs document model (schema 3), the server guard, compaction, the collaboration client and the cross-process protocol.
- Version history and the block diff, AI segments (selection, blocks, whole field, Strapi AI translations), comment anchors, suggestions, the quality lint and presets on the live channel.
- The block SDK's admin side (`registerBlock`, `createReactTool`) and every custom block defined in code by users.
- Three framework renderers would survive: the render tree works on the stored JSON and does not depend on the editor engine **[verified: `tests/render-tree.test.mjs` checks the renderer import graph]**.

**[judgement]** This is a 3.0 by itself, several times the size of 2.4, with real risk for stored content. The gain today would be character-level suggestions, nesting and rich table cells, none of which users have asked for as hard requirements.

## Recommendation

1. Stay on Editor.js for 2.x. Keep the stored format, schema, renderers and admin API stable, because they are what makes a later engine change possible.
2. Do not adopt Editor.js 2.32 while it is a release candidate. Re-check when it is tagged `latest`.
3. Keep recording Editor.js limits with measurements in AGENTS.md and here.
4. If a trigger below fires, start with a spike: a ProseMirror/Tiptap (MIT packages only) editor that reads and writes the existing stored JSON for a subset of blocks, behind the same field, with the collaboration guard ported, before any migration is announced.

## Triggers that reopen the decision

- Character-level suggestions or track changes become a hard requirement.
- Nested blocks, columns or rich content in table cells (lists, images, several paragraphs) become a hard requirement.
- Editor.js stops publishing: no release or commit for 12 months (the workbench's maintained-package floor), the repository is archived, or a security issue stays unfixed.
- Editor.js 3.0 ships with a document model that changes the stored format or the tool API, so we would migrate anyway.
- A measured DOM performance problem with long documents that the 5000-block limit does not cover.
- Strapi ships an editor API or an official engine that makes a different choice clearly cheaper to maintain.
