---
name: strapi-plugin-maintenance
description: Maintain Magic Editor X 2.x (Strapi 5 Editor.js field, uploads, custom blocks, version history, multi-process collaboration, AI proxy) with API security checks and Playwright UI evidence.
---

# Magic Editor X maintenance

Read AGENTS.md first; it is the contract for routes, data format, the collaboration protocol and the rules. Use Node 22 or 24. Before touching an API, read the docs and installed types of the version in package-lock.json (Strapi 5.61, Editor.js 2.31, Yjs 13.6, Socket.IO 4.8, Design System 2.2.4). Keep credentials, collaboration tokens, browser auth state and user media out of skill text and Git; do not push without an explicit request.

Server: routes in `server/src/routes/index.js` (admin only, every route has `admin::isAuthenticatedAdmin` plus `admin::hasPermissions`), Content Manager access checks in `services/access.js`, SSRF guard in `utils/url-security.js`, sanitising in `utils/sanitizer.js` and `shared/sanitize-policy.mjs`, collaboration in `services/collaboration.js` and `services/store.js`. Test anonymous, unprivileged admin, authorised admin, document owner and other-user outcomes with `npm run test:integration` against an isolated host on SQLite and PostgreSQL. Run `scripts/cluster-acceptance.mjs` after changes to collaboration.

Admin: Strapi Design System components and theme tokens only, light and dark, five locales, keyboard access. Check the editor field, version history, AI dialog, Settings > Configuration and Settings > Custom blocks with Playwright at 1440, 1024, 768, 390 and 320 px. Run `npm run lint`, `npm run format:check`, `npm test`, `npm run build`, `npm run verify` and `npm pack --dry-run` before committing. Do not call live AI providers or fetch untrusted remote URLs during tests; use the fake provider and blocked egress.
