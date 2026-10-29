# Clinical resources

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed since the last audit: **no** — develop has not moved since last night's audit (2026-10-28, also commit `15acf0c`); tonight's true window is empty. The Library view and its privacy-override checklist were built over the preceding fortnight (historical context below), not tonight.
- Created (any located code): yes.

## Located

- `backend/resources-routes.js` — old flat resource list API (`/api/resources/*`).
- `backend/resource-hub-r2-routes.js` — Resource Hub R2 (catalogue, badges, bookmarks, CPD tracker, admin catalogue CRUD).
- `backend/resource-library-routes.js` — SharePoint-style document Library (`/api/rh2/library/*`: any-depth folders, recycle bin, file versions).
- `backend/instrument-register-routes.js`, `backend/resource-ingestion-routes.js` — assessment instrument register and admin ingestion register.
- Frontend: `frontend/current/resourcehub.js`/`.css`, `frontend/current/resourcelibrary.js`/`.css`. Tab banner: `RESOURCES TAB (Resource Hub R1)` (`mockup_v3.html:5104`).

## Guard check

All five route files mount under `requireAuth`; write/admin actions additionally gated by `requireRole('owner')` or `requireRole('owner','admin')`. The CPD tracker routes (`/api/rh2/cpd/*`) query `WHERE user_id = $1` only — self-scoped by design. No unguarded endpoint found. `node --check` clean on all five.

## Tests and results

| Command | Result |
|---|---|
| 12 resource unit test files (file-delivery, file-quality, governance, hub-badge-guards, hub-final, ingestion, library-frontend-guards, library-rules, privacy-reasons, privacy-scan, seed-guards, source-scan) | PASS — 398 passed, 12 skipped (environment-gated, e.g. OCR/PDF tooling — not failures) |
| 7 resource integration test files (file-upload, hub-r2, hub-v1, ingestion, library-sharepoint, library, resources) | PASS — 168 tests (two benign WARN log lines about a deliberately-missing fixture file, not failures) |

No test exercises the *browser rendering* of either the old flat list or the new Library UI. `e2e/tests/portal.spec.js` flow G only covers the old flat list ("16 approved starter resources ... no non-official external URLs, folder-create 403") and predates `resourcelibrary.js` entirely — that commit (`06c6777`) and the rest of the Library work land after the one existing QA record (`docs/qa/BROWSER_QA_RESULTS.md`, dated 2026-08-01).

## Relevant commits (historical — predate last night's audit, not new tonight)

`0195cb3`, `dd958d0`, `31d5008`, `896ace1`, `40d88a6`, `06c6777` — already several audit cycles old; none is from tonight's (empty) window.

## Open tracker tasks

None recorded against this feature.

## Disagreement / notes

Agree with the prior claude_update in full: the Library view and its privacy-override "Upload anyway" checklist are fully tested but unproven in a browser; the old flat resource list remains the one with a browser-QA record, but that record predates the Library entirely.
