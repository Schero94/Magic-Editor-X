---
name: strapi-plugin-maintenance
description: Maintain Magic Editor X Strapi 5 editor, upload and collaboration features with API security and Playwright UI evidence.
---

# Magic Editor X maintenance

Use Node 22; fetch current Strapi 5 plugin routes, upload, admin permissions and Design System docs with Context7 and compare the installed 5.x version. Read local rules. Keep credentials, collab tokens, browser auth state and user media out of skill text and Git; do not push without an explicit request.

Inspect `server/src/routes/admin.js` and `content-api.js`, `editor-controller.js`, `editor-service.js`, realtime/collaboration handlers and admin menu registration. Public link-preview and file/URL-upload routes currently declare `auth: false`: treat this as an explicit security review gate. Trace URL parsing, DNS/redirect handling, private-address blocking, response and file limits, MIME validation, safe filenames/temp cleanup and media ownership before exposing the routes. Test anonymous, unprivileged admin, authorised admin, owner and other-user outcomes; frontend permission checks cannot replace server checks. Preserve legitimate editor flows only after negative tests prove the intended boundary.

Use Strapi 5 Design System semantics, accessible EditorJS controls and keyboard navigation; check settings, custom blocks, collaboration, empty/error states and desktop/mobile overflow via Playwright CLI in the local app. Run `npm run build`, `npm run verify`, focused regression tests, shared app build/boot and negative-access checks. Do not connect a live collaboration provider or import untrusted remote URLs during smoke tests.
