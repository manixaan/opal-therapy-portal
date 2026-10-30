# Clinical resources

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed since the last audit: **no** — the audit window (`15acf0c`..`338f5dc`,
  last audit 2026-10-29 → tonight 2026-10-30) holds exactly 5 commits
  (`08da79d`, `e1af24e`, `a56173c`, `dc5dbc4`, `338f5dc`), touching only
  travel/traffic-alerts, mobile diary sync, and case-notes approval-on-edit
  code/tests. None touches any `resource-*`, `instrument-register-routes.js`,
  `resource-ingestion*`, `resourcehub.js`, or `resourcelibrary.js` file.
  Re-verified by grepping the commit diffs' file lists directly — confirmed
  empty intersection with this feature's located files.
- Created (any located code): yes.

## Located

- `backend/resources-routes.js` — old flat resource list API (`/api/resources/*`).
- `backend/resource-hub-r2-routes.js` — Resource Hub R2 (catalogue, badges, bookmarks, CPD tracker, admin catalogue CRUD).
- `backend/resource-library-routes.js` — SharePoint-style document Library (`/api/rh2/library/*`: any-depth folders, recycle bin, file versions).
- `backend/instrument-register-routes.js`, `backend/resource-ingestion-routes.js` — assessment instrument register and admin ingestion register.
- Frontend: `frontend/current/resourcehub.js`/`.css`, `frontend/current/resourcelibrary.js`/`.css`. Tab banner: `RESOURCES TAB (Resource Hub R1)` (`mockup_v3.html:5104`).

## Guard check

Re-checked tonight. All five route files mount under `requireAuth`; write/admin
actions additionally gated by `requireRole('owner')` or
`requireRole('owner','admin')`. `resource-library-routes.js:71` confirms
`router.use('/api/rh2/library', requireAuth, ...)` plus its own role checks
inline. The CPD tracker routes (`/api/rh2/cpd/*`) query `WHERE user_id = $1`
only — self-scoped by design, not broken. No unguarded endpoint found.
`node --check` clean on all five files, re-run tonight.

## Tests and results

| Command | Result |
|---|---|
| 12 resource unit test files: `resource-file-delivery`, `resource-file-quality`, `resource-governance`, `resource-hub-badge-guards`, `resource-hub-final`, `resource-ingestion`, `resource-library-frontend-guards`, `resource-library-rules`, `resource-privacy-reasons`, `resource-privacy-scan`, `resource-seed-guards`, `resource-source-scan` | PASS — 12 suites, 398 passed, 12 skipped (environment-gated, e.g. OCR/PDF tooling — not failures), 0 failed |
| 7 resource integration test files: `resource-file-upload`, `resource-hub-r2`, `resource-hub-v1`, `resource-ingestion`, `resource-library-sharepoint`, `resource-library`, `resources` (run with `DB_NAME=therapy_scheduler_auditg7 DB_PASSWORD=audit`) | PASS — 7 suites, 168 passed, 0 failed (WARN log lines about a deliberately-missing fixture file and a retried-then-succeeded deferred preview job are logged noise, not failures) |

Total: **566 tests passing, 0 failing** — independently re-run tonight from a
clean invocation (not taken on trust from last night's number; the count
matches exactly).

No test exercises the *browser rendering* of either the old flat list or the
new Library UI. Re-checked tonight:
- `docs/qa/BROWSER_QA_RESULTS.md` is dated 2026-08-01, build `188334d`/`b7e3308`.
  Its only resource-hub entry (flow G) asserts against `/api/resources` (the
  old flat list: "16 approved starter resources ... no non-official external
  URLs, folder-create 403"). `resourcelibrary.js` was introduced by commit
  `06c6777` on 2026-10-25 — nearly three months *after* that browser QA run,
  so the Library UI could not have been covered by it.
- `e2e/tests/portal.spec.js` line 116 ("Resource Hub shows approved starter
  content...") also hits `/api/resources` only — the old flat list.
  `e2e/tests/tutorials.spec.js` drives `tab: 'resources', view: 'learning'`,
  a different view (tutorials/learning), not the Library.
- No spec anywhere references `/api/rh2/library`, `resourcelibrary.js`, or a
  Library folder/recycle-bin/version-history flow.

## Commits in window touching located files

None. The 5 commits in `15acf0c..338f5dc` touch
`backend/routes.js`, `backend/tests/assessment-surface-guards.test.js`,
`backend/tests/integration/event-travel-plan.itest.js`,
`backend/tests/travel-traffic.test.js`, `frontend/current/mockup_v3.html`,
`frontend/current/travel-alerts.css`, `frontend/current/travel-alerts.js`,
`frontend/current/travel.js`, `backend/database.js`,
`backend/mobile-routes.js`, `backend/tests/mobile-routes.test.js`,
`backend/ai/ai-audit.js`, `backend/case-note-routes.js`,
`backend/tests/case-note-routes.test.js`,
`backend/tests/integration/case-note-approval-edit.itest.js`,
`frontend/current/casenotes.js` — none of these is a Clinical Resources file.

## Open tracker tasks

None recorded against this feature (`tasks: []` in the tracker snapshot).

## Disagreement / notes

Agree with the tracker's current `claude_update` in full, and confirm it
independently tonight rather than taking it on trust: the Library view and its
privacy-override "Upload anyway" checklist are fully tested at the unit/
integration level (566 passing, re-run fresh) but unproven in a browser or
E2E spec. The old flat resource list remains the one with a browser-QA
record, but that record (2026-08-01) predates the Library feature (introduced
2026-10-25) by about three months, so it cannot stand in for Library
coverage. No new disagreement found tonight; nothing in the window moved
this feature.
