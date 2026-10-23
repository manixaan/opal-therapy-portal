# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven** (downgraded from `proven` on 2026-10-22 — see Disagreement; unchanged tonight)
- Addressed in change window (since last audit, 2026-10-22): no — zero commits in the window; develop is frozen at the commit audited last night. Last night's rebuild (see "Recent history" below) predates this window.
- Created (code exists): yes

## Recent history (2026-10-22, not tonight)
The Resource Hub's "Library" view (folder browsing) was rebuilt from scratch as a
SharePoint-*styled* document library — new UI, new backend, two new migrations.
None of this changed again tonight; re-verified below against the same code:
- `06c67779` feat(resource-library): new frontend module `frontend/current/resourcelibrary.js`
  (1,959 lines) + `resourcelibrary.css`. Mounted into `#rhl-root` by `resourcehub.js`
  whenever the Library is browsed (search/filter/Saved/All Resources stay in
  `resourcehub.js`'s flat list, unchanged). **The old folder grid, owner bar,
  right-click menu, move panel and upload code in `resourcehub.js` are removed.**
- `0195cb3` feat(resource-library): new backend `backend/resource-library-routes.js`
  (1,178 lines, `/api/rh2/library/*`), `backend/resource-library-rules.js`,
  `backend/resource-recycle-bin.js` (new, 512 lines); migrations `077_resource_library_recycle_bin.sql`,
  `078_resource_file_versions.sql`. Any-depth folders, recycle bin (Owner/Admin
  delete-to-bin, Owner-only permanent delete/empty), file version history with
  restore, Owner+Admin management, a daily 90-day bin purge job.
- `dd958d0` fix(resource-library): real upload body limit (new `backend/body-limits.js`),
  restore clears `archived_at`, no ghost uploads on a mid-write failure, the old
  unused upload door (`POST /api/resources/:id/files`) removed.
- `40d88a6` fix(resources): calmer header/toolbar, document page simplified to
  Preview + Download.

**Important: "SharePoint-style" is a UI/UX description, not an integration.**
Grepped `resource-library-routes.js`, `resource-recycle-bin.js` and
`resource-file-intake.js` for `sharepoint`/`graph.microsoft` — the only hit is a
comment ("SharePoint-style") describing the look of the folder browser. Storage
is this portal's own DB/blob layer, same as before. This module does **not**
satisfy Portal Onboarding Workflow's separate "store finished documents in
SharePoint" gap (see that feature's folder) — the two are unrelated despite the
similar wording.

## Located files
- Backend: `backend/resources-routes.js` (flat list/search/Saved — unchanged),
  `backend/resource-library-routes.js`, `backend/resource-library-rules.js`,
  `backend/resource-recycle-bin.js`, `backend/resource-file-intake.js`,
  `backend/body-limits.js` — all mounted in `server.js`.
- Frontend: `frontend/current/resourcehub.js` (flat list),
  `frontend/current/resourcelibrary.js` + `.css` (the folder-browsing UI),
  Resource Hub section under the `RESOURCES TAB (Resource Hub R1)` banner in
  `mockup_v3.html` (line ~5092). Pins verified again tonight: `resourcehub.js` r56,
  `resourcehub.css` r31, `resourcelibrary.js` 2, `resourcelibrary.css` 2 (all
  confirmed via `node scripts/check-asset-pins.js` tonight — every pin matches).

## Guard check
`router.use('/api/rh2/library', requireAuth, ...)` on the whole module; every
mutating route (`folders` POST/PATCH, `delete`, `move`, `upload`, `replace`,
`versions/:n/restore`, recycle-bin restore) additionally requires `requireManager`
(`requireRole('owner', 'admin')`); permanent delete and empty-bin additionally
require `requireOwnerOnly`. Read routes (`browse`, `folders/:id`, `versions`,
`details`) sit on `requireAuth` alone, consistent with the base query's own
content filter (excludes `archived`/`excluded-private` for everyone, not a
per-role gate) — matches the file's own comment: "the server enforces every
permission; the client only hides what would be refused." No unguarded
endpoint found. `backend/resources-routes.js`'s pre-existing guard (admin
hard-denied, owner/therapist differentiated) is unchanged.

## Tests and results
Unit (re-run tonight, 2026-10-23): `tests/resource-library-rules.test.js`,
`tests/resource-library-frontend-guards.test.js`, `tests/resource-seed-guards.test.js`,
`tests/resource-hub-badge-guards.test.js`, `tests/resource-governance.test.js`,
`tests/resource-privacy-scan.test.js`, `tests/resource-source-scan.test.js`,
`tests/resource-file-delivery.test.js`, `tests/resource-file-quality.test.js`,
`tests/resource-hub-final.test.js`, `tests/resource-ingestion.test.js` —
**all pass**.

Integration (re-run tonight, 2026-10-23, `DB_NAME=therapy_scheduler_auditnight1023`):
`tests/integration/resources.itest.js`, `resource-hub-v1.itest.js`,
`resource-library.itest.js`, `resource-file-upload.itest.js`,
`resource-ingestion.itest.js`, `resource-library-sharepoint.itest.js` (despite
its name, this covers the body-limit/B1–B3/B8 fixes, not an actual
SharePoint integration) — **all pass**; the one pre-existing,
unrelated `readonly-and-hardening.itest.js` root/chmod environmental
artifact reproduced again tonight too — see Employee Personal Page's folder
— not in any resource-library file.

No TODO/FIXME found in any resource-library file.

## Browser QA is still stale for the rebuilt view — the reason for the downgrade
`docs/qa/BROWSER_QA_RESULTS.md` row G ("Therapist sees 16 approved starter
resources across 14 folders; no non-official external URLs; folder-create
403") tested exactly the folder-browsing UI that `06c67779` removed on
2026-10-22 ("the old folder grid, owner bar, right-click menu, move panel
and upload code are removed"). That proof still does not describe any
screen that exists.
The replacement — `resourcelibrary.js`'s tree/breadcrumbs/list-and-tiles/drag-
and-drop/recycle-bin/version-history UI — has **no browser or E2E proof at
all**. Row J's read-only permission-matrix proof (resources 200 for
read-only) still stands; it exercises the API, not this screen. The flat
Saved/All Resources list in `resourcehub.js` is unchanged and still covered
by row G's original intent for that part, but the Library (folder) view
itself is unproven.

## Open tasks from the tracker
None recorded.

## Commits in window that touched it
None tonight (zero commits since last audit). Last night's `06c677792`
(frontend rebuild), `0195cb30` (backend rebuild + migrations), `dd958d0c9`
(fixes), `40d88a6ec` (UI polish) predate this window — see "Recent history"
above. None are recorded against this card in the tracker, which still has
no tasks listed for it.

## Disagreement
Two, in opposite directions:
1. **Downgrade**: 2026-10-21's `proven` rested partly on a browser proof
   (row G) of a UI that was removed the following night. The evidence for
   the replacement screen is currently code + tests only, no browser/E2E —
   `tab-unproven` is the honest label until someone opens the new Library
   view for real.
2. **Tracker still behind on stage**: whatever the browser-proof state of the
   newest screen, the card is still `idea` in the tracker despite a year's
   worth of real, tested functionality (flat list, search, Saved, and now a
   full document-library subsystem) sitting behind it. The stage itself has
   been behind the evidence for several nights running and remains so.
