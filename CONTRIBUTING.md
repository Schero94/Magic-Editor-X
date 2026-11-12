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

1. Create an app folder with `@strapi/strapi` 5.61.x, `@strapi/plugin-users-permissions`, `better-sqlite3`, `pg`, `react` 18, `react-dom` 18, `react-router-dom` 6 and `styled-components` 6, and add the plugin as `"magic-editor-x": "file:./pkg/magic-editor-x-<version>.tgz"`.
2. Pack the plugin into it: `npm run build && npm pack --pack-destination <app>/pkg`, then `npm install` in the app. `npm ls react styled-components` must show one version each.
3. Configure the app:
   - `config/server`: `host: '127.0.0.1'`, a port of its own (not 1337), `logger: { updates: { enabled: false } }`.
   - `config/admin`: `auth.secret`, `apiToken.salt`, `transfer.token.salt`, `secrets.encryptionKey` from the environment, and `rateLimit: { max: 20 }` (the suite logs in once per test file; Strapi's default allows 5 logins per 5 minutes).
   - `config/api`: `rest: { strictParams: true }` (the output tests check that `?mex=` is a registered parameter).
   - `config/database`: SQLite file in the app folder, or PostgreSQL from `DATABASE_URL`.
   - `config/plugins`: `'magic-editor-x': { enabled: true, config: { ai: { allowPrivateBaseUrl: true }, languageTool: { allowPrivateBaseUrl: true }, qualityChecks: { externalLinks: { enabled: true, allowPrivateOrigins: ['http://127.0.0.1:1578'], schedule: { enabled: true } } } } }` so the tests can use a fake AI provider, a fake LanguageTool server and fake link targets on 127.0.0.1 (`tests/integration/link-schedule.test.mjs` starts link servers on `MEX_LINK_PORT`, default 1578, which must match the listed origin, and on `MEX_LINK_DENIED_PORT`, default 1579, which must stay unlisted). Make `languageTool.allowPrivateBaseUrl` follow an environment variable: `tests/integration/ai-23.test.mjs` runs a second time against the app started with it off and `MEX_LT_PRIVATE=false` to check the refusal of private grammar servers.
   - `src/index.js`: register the example block of the block SDK (`tests/fixtures/callout-card.mjs`) in `register()` with `strapi.plugin('magic-editor-x').service('blocks').register(calloutCard)` (`tests/integration/sdk.test.mjs`).
   - Content types for the tests: `api::article.article` (localised, Draft & Publish) with `title` (string), `slug` (uid of `title`), `body` (Magic Editor X), `summary` (Magic Editor X with the options `{ "preset": "basic", "requireAlt": true, "maxCharacters": 400, "linkTargets": "internal", "disableAi": true, "disableGrammar": true, "disableCollaboration": true, "publishGuard": true }`), `teaser` (Magic Editor X with `{ "preset": "minimal" }`), `legacy` (Blocks), `notes` (Rich text, Markdown), `migrated` (Magic Editor X) and a repeatable component `sections` with a Magic Editor X field `body`; `api::homepage.homepage` (single type) with `intro` (Magic Editor X); `api::category.category` (Draft & Publish) with `name` (string), `slug` (uid of `name`), `secretNote` (private string) and `body` (Magic Editor X); on the article also a `category` relation (many to one) and a dynamic zone `zone` with `blocks.text-section`. Add `@strapi/plugin-graphql` 5.61.x and set `links.urlPattern` to `'/{locale}/{collection}/{slug}'` in the plugin config.
4. Generate every secret with `crypto.randomBytes` into `.env` (mode 600), including `MAGIC_EDITOR_X_ENCRYPTION_KEY`. Never print or commit them.
5. Start the app with outgoing network blocked: `NODE_OPTIONS="-r ./block-egress.cjs" npx strapi start` (a preload that only allows loopback connections).
6. Seed it through the admin API: register the first admin with `POST /admin/register-admin` (Super Admin, which also has `templates.manage`), create five admins (`editor@example.test` with the Editor role plus `access`, `collaborate`, `ai.use`, `grammar.use`, `comments.read` and `comments.write`; `author@example.test` with the Author role and no plugin actions; `reviewer@example.test` with a role that can only read articles (fields `title`, `body`, `sections`, locales `en` and `de`) and the homepage and has `access`, `collaborate`, `comments.read` and `comments.write`; `reader@example.test` with a role that can only read articles and has `access` and `comments.read`; `writer@example.test` with a role that can read and update articles (locales `en` and `de`) and has `access`, `ai.use` and `grammar.use` but no Media Library permission), add the locale `de`, and write the credentials to a `creds.json` with mode 600:

```json
{
  "admin": { "email": "...", "password": "..." },
  "users": { "editor": {}, "author": {}, "reviewer": {}, "reader": {}, "writer": {} }
}
```

Use synthetic data only (`*.example.test`, RFC 5737 addresses).

## Integration tests

```bash
MEX_HOST_URL=http://127.0.0.1:<port> MEX_CREDS=<app>/creds.json npm run test:integration
```

The suite fails, never skips, when the variables are missing. It covers anonymous and role-based access, sanitising on save, custom blocks, version history with Content Manager permissions, collaboration over Socket.IO (two editors converging, read-only viewers, single-use and forged tokens, foreign origins), upload checks, the SSRF guard, the AI proxy against a local fake provider and the Content API output.

Block comments of deleted entries must be gone afterwards; on the host database `select count(*) from magic_editor_comments c where not exists (select 1 from articles a where a.document_id = c.entry_id and a.locale = c.entry_locale)` returns 0.

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
