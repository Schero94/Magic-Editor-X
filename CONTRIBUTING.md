# Contributing to Magic Editor X

Thanks for helping. Read [AGENTS.md](./AGENTS.md) first: it is the technical contract (routes, data format, collaboration protocol) and lists the rules every change follows.

## Setup

Requirements: Node 22 or 24, npm 10 or 11.

```bash
git clone https://github.com/Schero94/Magic-Editor-X.git
cd Magic-Editor-X
npm ci
npm run lint
npm run format:check
npm test
npm run build
npm run verify
```

`npm test` runs the unit tests and needs no Strapi host. `npm run build` builds the admin and the server bundles (CJS and ESM) and checks that both load.

## Isolated acceptance host

Integration and browser tests run against a separate Strapi 5 app that installs the packed plugin. Keep it outside this repository.

1. Create an app folder with `@strapi/strapi` 5.61.x, `@strapi/plugin-users-permissions`, `@strapi/provider-email-nodemailer` 5.61.x, `better-sqlite3`, `pg`, `react` 18, `react-dom` 18, `react-router-dom` 6 and `styled-components` 6, and add the plugin as `"magic-editor-x": "file:./pkg/magic-editor-x-<version>.tgz"`.
2. Pack the plugin into it: `npm run build && npm pack --pack-destination <app>/pkg`, then `npm install` in the app. `npm ls react styled-components` must show one version each.
3. Configure the app:
   - `config/server`: `host: '127.0.0.1'`, a port of its own (not 1337), `logger: { updates: { enabled: false } }`.
   - `config/admin`: `auth.secret`, `apiToken.salt`, `transfer.token.salt`, `secrets.encryptionKey` from the environment, and `rateLimit: { max: 60 }` (the suite logs in once per test file and user, the Super Admin in almost all of its 24 files; Strapi's default allows 5 logins per user and 5 minutes).
   - `config/api`: `rest: { strictParams: true }` (the output tests check that `?mex=` is a registered parameter).
   - `config/database`: SQLite file in the app folder, or PostgreSQL from `DATABASE_URL`.
   - `config/plugins`: `'magic-editor-x': { enabled: true, config: { ai: { allowPrivateBaseUrl: true }, languageTool: { allowPrivateBaseUrl: true }, qualityChecks: { externalLinks: { enabled: true, allowPrivateOrigins: ['http://127.0.0.1:1578'], schedule: { enabled: true } } } } }` so the tests can use a fake AI provider, a fake LanguageTool server and fake link targets on 127.0.0.1 (`tests/integration/link-schedule.test.mjs` starts link servers on `MEX_LINK_PORT`, default 1578, which must match the listed origin, and on `MEX_LINK_DENIED_PORT`, default 1579, which must stay unlisted). Make `languageTool.allowPrivateBaseUrl` follow an environment variable: `tests/integration/ai-23.test.mjs` runs a second time against the app started with it off and `MEX_LT_PRIVATE=false` to check the refusal of private grammar servers. 2.4 adds (each switch follows an environment variable of the host, shown in brackets):
     - `ai.altText.allowPrivateOrigins: ['http://127.0.0.1:1590']` (`MEX_ALT_PRIVATE`, default on): `tests/integration/ai-24.test.mjs` starts the fake AI provider on 1589 and the fake private image storage on 1590 and runs a second time against the app started with the list empty and `MEX_ALT_PRIVATE=false`;
     - `uploads: { allowPrivateOrigins: ['http://127.0.0.1:1587'], maxMediaBytes: 1048576 }`: `tests/integration/authoring.test.mjs` starts the fake media server on `MEX_MEDIA_PORT` (1587) and checks the size cap with a 2 MiB file;
     - `audit: { enabled: true, retentionDays: 180 }` and `qualityChecks.externalLinks.schedule.tz` (`MEX_LINK_TZ`): start the app with `MEX_LINK_TZ=Europe/Berlin` for `tests/integration/ops-24.test.mjs`;
     - `comments: { notifications: { email: <MEX_MENTION_EMAIL, default false> } }` and the Strapi email plugin with the `nodemailer` provider pointing at a fake SMTP server on 127.0.0.1:1591 (`{ host: '127.0.0.1', port: 1591, secure: false, ignoreTLS: true }`, `defaultFrom: 'strapi@example.test'`) that appends every message as a JSON line to a log file. `tests/integration/comment-mentions.test.mjs` reads that log from `MEX_MAIL_LOG`: run the suite with `MEX_MAIL_EXPECTED=off`, then that file again against the app started with `MEX_MENTION_EMAIL=true` and `MEX_MAIL_EXPECTED=on`.
   - `src/index.js`: register the example block of the block SDK (`tests/fixtures/callout-card.mjs`) in `register()` with `strapi.plugin('magic-editor-x').service('blocks').register(calloutCard)` (`tests/integration/sdk.test.mjs`).
   - `src/index.js` `bootstrap()`: when `process.env.MEX_PRIVATE_FILES === 'true'` (integration runs; in browser checks the rows would crowd the Media Library), create the Media Library rows of `tests/integration/ai-24.test.mjs` once, the way an S3/MinIO upload provider on a private network stores them (query engine `plugin::upload.file`, `provider: 'aws-s3'`, `mime: 'image/png'`, 16 x 16): `mex24-private-<case>.png` with the URL `http://127.0.0.1:1590/bucket/ok.png` (ok), `…/ok.png?X-Amz-Signature=synthetic` (signed), `…/redirect.png` (redirect), `…/same-redirect.png` (same-redirect), `https://127.0.0.1:1590/bucket/ok.png` (scheme), `http://127.0.0.1:1589/bucket/ok.png` (port) and `http://localhost:1590/bucket/ok.png` (host).
   - `src/index.js` `bootstrap()`: when `process.env.MEX_LEGACY_BLOCKS === 'true'` and no custom block named `toc` exists, write one the way the 2.2 service did, because 2.3 refuses the name for new blocks: `strapi.db.query('plugin::magic-editor-x.custom-block').create({ data: { name: 'toc', label: 'Legacy contents box', blockType: 'simple', fields: [{ name: 'title', label: 'Title', type: 'text' }], displayFields: [], previewFields: [], tunes: [], styles: {}, inlineToolbar: true, enabled: true, sortOrder: 900 } })`. Start the host with `MEX_LEGACY_BLOCKS=true` for the integration suite (`tests/integration/reserved-names.test.mjs` fails with a hint otherwise). It replaces the built-in table of contents tool in that host's editor, so leave it off for browser checks of the built-in `toc` block. 2.4: the same switch also writes a Settings custom block named `math` (fields `[{ name: 'formula', label: 'Formula', type: 'text' }]`, `sortOrder: 901`) for `tests/integration/math-footnotes.test.mjs`; delete it (`DELETE /magic-editor-x/custom-blocks/:id`) before browser checks of the built-in math block, because its own tool replaces the built-in one.
   - Content types for the tests: `api::article.article` (localised, Draft & Publish) with `title` (string), `slug` (uid of `title`), `body` (Magic Editor X), `summary` (Magic Editor X with the options `{ "preset": "basic", "requireAlt": true, "maxCharacters": 400, "linkTargets": "internal", "disableAi": true, "disableGrammar": true, "disableCollaboration": true, "publishGuard": true }`), `teaser` (Magic Editor X with `{ "preset": "minimal" }`), `legacy` (Blocks), `notes` (Rich text, Markdown), `migrated` (Magic Editor X) and a repeatable component `sections` with a Magic Editor X field `body`; `api::homepage.homepage` (single type) with `intro` (Magic Editor X); `api::category.category` (Draft & Publish) with `name` (string), `slug` (uid of `name`), `secretNote` (private string) and `body` (Magic Editor X); on the article also a `category` relation (many to one) and a dynamic zone `zone` with `blocks.text-section`, `blocks.quote-card` (`caption` string, `body` Magic Editor X) and `blocks.group` (`title` string, `items` repeatable `blocks.text-section`), plus a localised repeatable component `groups` of `blocks.group` (`tests/integration/field-identity.test.mjs` uses nested components and a dynamic zone with several component types). Add `@strapi/plugin-graphql` 5.61.x and set `links.urlPattern` to `'/{locale}/{collection}/{slug}'` in the plugin config.
4. Generate every secret with `crypto.randomBytes` into `.env` (mode 600), including `MAGIC_EDITOR_X_ENCRYPTION_KEY`. Never print or commit them.
5. Start the app with outgoing network blocked: `NODE_OPTIONS="-r ./block-egress.cjs" npx strapi start` (a preload that only allows loopback connections).
6. Seed it through the admin API: register the first admin with `POST /admin/register-admin` (Super Admin, which also has `templates.manage`), create six admins (`editor@example.test` with the Editor role plus `access`, `collaborate`, `ai.use`, `grammar.use`, `comments.read`, `comments.write`, `suggestions.create` and `suggestions.review`; `author@example.test` with the Author role and no plugin actions; `reviewer@example.test` with a role that can only read articles (fields `title`, `body`, `sections`, locales `en` and `de`) and the homepage and has `access`, `collaborate`, `comments.read`, `comments.write` and `suggestions.create`; `reader@example.test` with a role that can only read articles and has `access`, `comments.read` and `suggestions.review`; `writer@example.test` with a role that can read and update articles (locales `en` and `de`) and has `access`, `ai.use` and `grammar.use` but no Media Library permission; `outsider@example.test` with a role that can only read the homepage and has `access`, `comments.read` and `comments.write`, so it is never mentionable on articles), add the locale `de`, and write the credentials to a `creds.json` with mode 600:

```json
{
  "admin": { "email": "...", "password": "..." },
  "users": { "editor": {}, "author": {}, "reviewer": {}, "reader": {}, "writer": {}, "outsider": {} }
}
```

Use synthetic data only (`*.example.test`, RFC 5737 addresses).

## Integration tests

```bash
MEX_HOST_URL=http://127.0.0.1:<port> MEX_CREDS=<app>/creds.json npm run test:integration
```

The suite fails, never skips, when the variables are missing. It covers anonymous and role-based access, sanitising on save, custom blocks, version history with Content Manager permissions, collaboration over Socket.IO (two editors converging, read-only viewers, single-use and forged tokens, foreign origins), upload checks, the SSRF guard, the AI proxy against a local fake provider and the Content API output.

Block comments of deleted entries must be gone afterwards; on the host database `select count(*) from magic_editor_comments c where not exists (select 1 from articles a where a.document_id = c.entry_id and a.locale = c.entry_locale)` returns 0. The same holds for block suggestions (`magic_editor_suggestions`, same `entry_id` / `entry_locale` columns), and every row of `magic_editor_comment_notifications` must still point at a comment (`comment_id` is the comment's `document_id`).

Run it on SQLite and on PostgreSQL: start the same app with `DATABASE_CLIENT=postgres DATABASE_URL=postgres://<user>@127.0.0.1:<port>/<database>` on a fresh database, seed it and run the suite again. The AI test uses the per-admin rate limit; wait a minute before running the suite twice against the same process.

## Performance benchmark

`npm run bench` (`scripts/bench.mjs`) builds synthetic documents of 500, 2000 and 5000 blocks from `tests/fixtures/editor-2x-all-blocks.json` (every block type, nested lists, tables, inline formatting, links) and measures the median of seven samples after a warm-up for normalise + sanitise, the three renderers, the version diff, find and replace, Yjs seed + apply, the quality lint and the preset check. Fast operations repeat inside a sample until it lasts 25 ms, so medians of small documents are stable. `--json` prints machine-readable results. CI runs it in the `bench` job.

Thresholds live in `scripts/bench-thresholds.json` and are chosen so that the job does not flake on shared CI runners but still catches real regressions:

- `budgetMs5000`: an absolute budget per operation at 5000 blocks, about ten times the median measured on a developer laptop (Apple M-series, Node 22) and at least 250 ms. A slower runner or a busy machine stays far below it; an accidental algorithmic change or a pathological slowdown does not.
- `maxScaling`: the bound for `time(5000 blocks) / time(500 blocks)`. Linear work gives about 10; a quadratic step gives about 100. The bound is 30 for linear operations, so noise of a factor 2 to 3 passes and O(n²) fails.
- `counters`: deterministic results (blocks kept by normalise + sanitise, find matches equal to replacements, blocks after the Yjs round trip, diff entries, lint issues, preset violations). A change here means the operation now does different work and the threshold file must be updated deliberately with the reason in the commit.

When a change makes an operation legitimately slower, re-measure with `npm run bench -- --json` at least five times, update the numbers in the JSON and explain the change in the commit body.

## Several processes

`scripts/cluster-acceptance.mjs` starts several Strapi processes of an existing acceptance app on one PostgreSQL database behind a non-sticky round-robin balancer, then proves that two clients connected to different processes edit the same field and converge, that automatic versions are created exactly once and that acknowledged edits survive a process restart:

```bash
node scripts/cluster-acceptance.mjs --app <app folder> --pg postgres://<user>@127.0.0.1:<port>/<database> [--base 1480]
```

Ports start at `--base`. Records of earlier runs are in `docs/acceptance/`.

## Commits

Conventional commits with the angular preset: `feat:`, `fix:`, `docs:`, `test:`, `chore(deps):`, `ci:`. A breaking change needs a `BREAKING CHANGE:` footer in the commit body; `!` alone does not trigger a major release. Describe migrations in the `## [Unreleased]` section of CHANGELOG.md.

Before you commit: `npm run lint`, `npm run format:check`, `npm test`, `npm run build`.

## Releases

Merges to `main` run `.github/workflows/release.yml`: the full quality gate, then semantic-release. It decides the version from the commits, folds `## [Unreleased]` into the release notes, updates CHANGELOG.md, tags `v<version>`, creates the GitHub release and publishes `magic-editor-x` to npm with provenance. npm trusted publishing (OIDC) is used when it is configured on npmjs.com; otherwise the `NPM_TOKEN` secret is the fallback. When staged publishing is enabled for the package, the owner approves the staged version on npmjs.com before it becomes public.

Dependabot proposes updates after a cooldown (7 days, 14 for majors). Patch and minor updates are merged automatically when every check passes; majors wait for review.
