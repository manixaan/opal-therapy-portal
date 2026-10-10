# Portal Onboarding Workflow

- Tracker stage: `idea`
- Tracker environment: `none`
- Evidence label: **needs-refinement**
- Addressed since the last audit (2026-10-09): no
- Created (any located code at all): yes

## Located

- 11 route files under `backend/onboarding-*-routes.js` (plus the legacy `onboarding-routes.js`), all guarded with `requireAuth` at minimum; 10 of 11 add `requireRole`/`requirePermission` on top for sensitive actions.
- SharePoint document storage (the rest of Stage 2): **confirmed not started** — the only `sharepoint` hit anywhere in `backend/` is a CSP allowlist domain in `server.js`, no implementation code exists.
- Frontend: `ONBOARDING TAB` banner (`mockup_v3.html:4162`), `frontend/current/onboarding.js`.

## Tests

- Unit (24 files): **597 passed, 1 failed, 598 total.** The one failure (`tests/onboarding-document-reader.test.js`, "the OCR language data is shipped with the portal, not fetched when a document arrives") is an **environment gap in this sandbox**, not a code regression: the `@tesseract.js-data/eng` npm package is entirely absent from this container's `node_modules` (confirmed: `require.resolve` fails, the package directory does not exist on disk). The assertion itself is sound; it just needs that optional dependency actually installed to run.
- Integration (7 files): **180/180 pass.**
- e2e: `e2e/tests/portal.spec.js` Flow B (invite → copy-link → registration) and Flow C (onboarding/profile chain) — real coverage of Stage 1 and parts of Stage 3.

## Open tasks (from the tracker)

Tasks "Stage 1", "Stage 2", "Stage 3" are all `todo`.

## Commits since the last audit that touched it

None — no commits have landed on `develop` under `backend/` or `frontend/current/` since the last audit (2026-10-09). Code audited tonight is the same commit (`aacf8e6`) as the last several nights.

## Disagreement with the tracker

None — tracker stage `idea` undersells how much is built, but doesn't overclaim.

