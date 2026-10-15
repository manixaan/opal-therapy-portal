# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven** (backend/API level — see browser-QA caveat below)
- Addressed this window: no (no commits since 2026-09-27)
- Created at all: yes

## Located files

- Routes: `backend/resources-routes.js` (R1 foundation, `/api/resources`),
  `backend/resource-hub-r2-routes.js` (R2, `/api/rh2` — header: "Learning,
  Knowledge, Standards & Clinical Excellence"; adds clinical population/
  setting vocab, a clinical-review workflow state, owner-only "clinical
  attestation"), `backend/resource-library-routes.js` (`/api/rh2/library`).
- Supporting: `backend/resource-governance.js` (clinical-review state
  machine), `resource-instrument-map.js`, `resource-official-links.js`,
  `resource-ingestion*.js`.
- Frontend: `frontend/current/resourcehub.js` (`/resourcehub.js?v=r52`),
  rendered into `#rh2-root` (RESOURCES TAB banner, mockup_v3.html:4954). The
  live tab calls `/api/rh2/*` exclusively — R1 is only kept mounted for
  legacy file downloads.
- Tests: unit `resource-governance.test.js`, `resource-hub-final.test.js`,
  `resource-hub-badge-guards.test.js`, `resource-library-frontend-guards.test.js`
  (+5 more); integration `resource-hub-r2.itest.js`, `resource-hub-v1.itest.js`,
  `resource-library.itest.js`, `resources.itest.js`, `resource-ingestion.itest.js`,
  `resource-file-upload.itest.js`.

## Guard status

All three route files guard `requireAuth` plus role checks (owner-only
folder-create/upload/approve/reject/archive, owner-only clinical
attestation). No unguarded route found.

## Tests run

- `npx jest tests/resource-governance.test.js tests/resource-hub-final.test.js tests/resource-hub-badge-guards.test.js tests/resource-library-frontend-guards.test.js` → 4 suites, 233 tests, all passed.
- `DB_NAME=therapy_scheduler_auditB DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/resource-hub-r2.itest.js --runInBand` → 33/33 passed.
- `... tests/integration/resource-hub-v1.itest.js --runInBand` → 5/5 passed —
  the most clinically-direct test: a therapist-authored draft with a
  `clinicalRationale`, owner sees it in full, admin's list strips it, and
  `publication_state` reaches `'clinical-review'` before publish.
- `node --check` clean on all three route files. No TODO/FIXME found.

## Browser-QA gap (the reason for the caveat)

`docs/qa/BROWSER_QA_RESULTS.md` never mentions the word "clinical", and its
one Resource Hub flow (G) tested the legacy `/api/resources` (R1) endpoint
directly, not the live R2 tab's clinical classification/governance.
`e2e/tests/portal.spec.js`'s Resource Hub test does the same (fetches
`/api/resources`, asserts nothing clinical). So: strong API-level proof, but
no browser/E2E evidence specifically exercises clinical content in the UI a
user actually sees — if graded strictly on "confirmed in manual browser
checks," this slice would be `tab-unproven` rather than `proven`.

## Open tasks from the tracker

None recorded.

## Commits in the window

None.

## Disagreement note

Refines, partially contradicts the previous `claude_update`. That guess said
clinical content was "confirmed working in both automated and manual
browser checks" — the "manual browser checks" half is not supported; the
one browser-QA pass of the Resource Hub tested the superseded R1 API, not
the live R2 clinical-review/classification feature. The "guarded, heavily
tested" half is confirmed true.
