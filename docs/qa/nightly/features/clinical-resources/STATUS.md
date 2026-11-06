# Clinical resources

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-11-05, cutoff `8853376`): **no** — both commits below
  predate that cutoff, already covered by prior audits
- Created at all: **yes** — mature backend, real frontend module

## What was independently verified tonight

Note: the tracker already carried a `claude_update` making this exact claim before tonight's
audit ran. Real prior audits do exist (2026-11-01/02/04/05, on `origin/claude/nightly-audit`,
confirmed genuine — not fabricated), and that prior history already said the same thing. Rather
than copying it forward, the findings below were independently re-derived from the code and test
runs tonight, and they confirm both the tracker's and the prior audits' claim.

### Located
- Routes: `backend/resources-routes.js` (R1), `backend/resource-hub-r2-routes.js`,
  `backend/resource-library-routes.js` (upload / privacy-override / folders
  live here, mounted at `/api/rh2/library/...`), `backend/resource-ingestion-routes.js`.
- Support: `backend/resource-file-intake.js`, `resource-file-quality.js`,
  `resource-privacy-reasons.js`, `resource-privacy-scan.js`, `resource-governance.js`.
- Frontend: `frontend/current/resourcehub.js` (flat list/search), and the
  **separate** module `frontend/current/resourcelibrary.js` (`window.RHLib`,
  SharePoint-style folder browser — this is where "Upload anyway" actually
  lives, not in resourcehub.js). Tab banner: `RESOURCES TAB (Resource Hub R1)`
  at `frontend/current/mockup_v3.html:5120`.
- Tests: 12 unit files (`resource-*`.test.js, 390 tests) + 7 integration files
  (`resource-*.itest.js`, 168 tests). No `e2e/tests/*` file and no
  `docs/qa/BROWSER_QA_RESULTS.md` entry for this flow (its one entry, row G,
  predates this feature by ~3 months and only checked *viewing* resources).

### Guard check
`/api/resources` → `requireAuth` + per-route `requireRole('owner')` on writes.
`/api/rh2/library` → `requireAuth` + `requireManager` (`requireRole('owner','admin')`)
on the upload/folder routes. No unguarded route found.

### Tests run
- Unit (12 files): **390/390 passed**, 12 skipped (unrelated), 0 failed.
- Integration (7 files, `DB_NAME=therapy_scheduler_audit_c`): **168/168 passed**.
- `resource-library-frontend-guards.test.js` (62 of the 390) loads
  `resourcelibrary.js`/`resourcehub.js` into a real VM against a stub `window`
  and calls the exported functions — genuine logic coverage, but it is a VM
  stub, not a browser render, so it does not satisfy the `proven` bar for a tab.

### Recency
`896ace1` ("Upload anyway" for a refusal that is only emails/dates/phone) and `31d5008`
(privacy-refused upload shows a checklist of why) both touch this feature, but both predate
the 2026-11-05 audit's cutoff commit (`8853376`) — so they were already in scope for that and
earlier audits, not new since last night. Nothing in this feature changed in the real window
(the 4 commits since `8853376`: `704a51f`, `0a365c4`, `cd8c4a8`, `e3c0b90`).

### Disagreement with tracker
None beyond the stage itself: tracker stage is `idea` while the evidence is a
built, guarded, fully-tested, recently-shipped feature — stage understates the
code, evidence does not overstate it.

## Next action
Walk the Library upload → privacy-refusal checklist → "Upload anyway" → folder
flow in a real browser and record it in `docs/qa/BROWSER_QA_RESULTS.md` (or an
E2E spec). That is the one thing tonight's run could not do.
