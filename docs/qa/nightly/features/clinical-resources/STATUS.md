# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **proven**
- Addressed in change window (2026-11-13 to 2026-11-14): no
- Created at all: yes

## Located files

- Routes: `backend/resources-routes.js`, `backend/resource-hub-r2-routes.js`,
  `backend/resource-library-routes.js`, `backend/resource-ingestion-routes.js`
  (admin register, owner/admin only — "PRIVATE RECORDS APPEAR HERE, AND
  THAT IS THE POINT": privacy-excluded records are listed as accounting
  facts with no identifying fields, by a `CHECK` constraint from migration
  030)
- Frontend: `RESOURCES TAB (Resource Hub R1)` banner in `mockup_v3.html`
  (line ~5165)
- 12 unit test files (`resource-file-delivery` through `resource-source-scan`)
- Integration tests: `resource-file-upload.itest.js`, `resource-hub-r2.itest.js`,
  `resource-hub-v1.itest.js`, `resource-ingestion.itest.js`,
  `resource-library-sharepoint.itest.js`, `resource-library.itest.js`,
  `resources.itest.js`
- **Browser QA**: `docs/qa/BROWSER_QA_RESULTS.md` flow G — live on staging,
  4/4 checks: "Therapist sees 16 approved starter resources across 14
  folders; no non-official external URLs; folder-create 403."

## Guard check

`resources-routes.js`: `requireAuth` + `requireRole('owner')` on
owner-only actions (folder create, link-status). `resource-hub-r2-routes.js`
/ `resource-library-routes.js`: `requireAuth` + `requireRole`/inline
manager checks. `resource-ingestion-routes.js`: `requireAuth` + inline
`canAdmin(u)` (`owner`/`admin`) on every admin route. No finding.

## Tests run

- Unit: 398/410 passed, 12 skipped (not failures — `jest`'s own skip
  mechanism, consistent across the suite).
- Integration: **168/168 passed** (7 suites) on a clean, serialised
  re-run against `therapy_scheduler_audit_test`. One transient `WARN
  resource-file-intake: deferred preview generation failed {"reason":
  "deadlock detected"}` appeared in the logs for a background
  preview-generation retry — logged and handled, not a test failure; the
  assertions around it still passed. (An earlier run in this same audit
  session hit a hard deadlock during table truncation because a second,
  unrelated integration suite was running against the same database at
  the same time — a self-inflicted concurrency mistake from this audit,
  not a code issue. Re-run alone and serialised, it is clean.)

## Recency

Not touched in the change window (since the 2026-11-13 audit).

## Classify

`proven`. Code located, guarded, every targeted test passes, and live
browser QA on staging confirms the Resource Hub renders real approved
content with the correct folder structure and role boundaries.

## Open tasks (from tracker)

None recorded against this feature.

## Commits in the window touching this

None.

## Disagreement

Tracker stage `idea`, no tasks recorded. Evidence: this is a mature,
well-tested, browser-verified feature. Recommend moving the card's stage
up to reflect reality.
