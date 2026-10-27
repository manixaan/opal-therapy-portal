# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven** (unchanged label, but the gap grew tonight — see below)
- Addressed in change window (since last audit, 2026-10-24): **yes** — two commits tonight extended the Library's upload-refusal flow.
- Created (code exists): yes

## Tonight's change (2026-10-25, in this window)
Two commits extended the Library's privacy-refusal flow — the same unproven
screen this card already flags, not a new one:
- `31d5008` feat(resources): a privacy-refused upload now carries `reasons` —
  one item per kind of finding (title, count, PDF pages, a repeats-on-every-page
  hint, the fix to make). New module `backend/resource-privacy-reasons.js`
  (`buildChecklist`); `resource-file-quality.js` gained per-page `locateFindings()`.
  Client identifiers are listed first and marked as never-overridable; blunt
  patterns (any email/date/phone) are marked "often harmless, but the check
  cannot tell". Also touches `backend/resource-hub-r2-routes.js` — confirmed
  one line only (the Admin rh2 file route's error response now also returns
  `reasons`), not the CPD-logbook endpoints Professional Development covers.
- `896ace1` feat(resources): "Upload anyway" — a refusal is `overridable` only
  when every checklist item is a bare pattern (never for a client identifier,
  never for an unexplainable refusal). The person ticks each item and retries
  with `privacyAcknowledged`; the server re-scans the file server-side and
  only lets it through if the same rule still holds and every item is
  acknowledged. Confirmed tonight: both routes that offer this
  (`POST /api/rh2/library/folders/:id/upload`, `POST /api/rh2/library/resources/:id/replace`,
  `resource-library-routes.js:1137`/`:1290`) still sit behind `requireManager`
  — no guard regression. Every override is audited as
  `resource_library.upload_privacy_overridden` with item ids/counts/pages,
  never file content (confirmed by reading the audit call site, not just the
  commit message).
- `resourcelibrary.js`/`.css` pin bumped 2 → 3 tonight, confirmed via
  `node scripts/check-asset-pins.js`.

## Recent history (2026-10-22)
The Library view (folder browsing) was rebuilt from scratch as a
SharePoint-*styled* document library — new UI, new backend, two new
migrations. Unchanged again tonight beyond the two commits above:
- `06c67779` feat(resource-library): new frontend module `frontend/current/resourcelibrary.js`
  + `resourcelibrary.css`. Mounted into `#rhl-root` by `resourcehub.js`.
  **The old folder grid, owner bar, right-click menu, move panel and upload
  code in `resourcehub.js` are removed.**
- `0195cb3` feat(resource-library): new backend `backend/resource-library-routes.js`
  (`/api/rh2/library/*`), `backend/resource-library-rules.js`,
  `backend/resource-recycle-bin.js`; migrations `077_resource_library_recycle_bin.sql`,
  `078_resource_file_versions.sql`. Any-depth folders, recycle bin, file
  version history with restore, Owner+Admin management, a daily 90-day bin
  purge job.
- `dd958d0` fix(resource-library): real upload body limit, restore clears
  `archived_at`, no ghost uploads on a mid-write failure.
- `40d88a6` fix(resources): calmer header/toolbar, document page simplified.

**"SharePoint-style" is still a UI/UX description, not an integration** —
re-confirmed tonight (grep for `sharepoint`/`graph.microsoft` in the library
files: only the one descriptive comment). Does not satisfy Portal Onboarding
Workflow's separate, genuine SharePoint gap — see that feature's folder.

## Located files
- Backend: `backend/resources-routes.js` (flat list/search/Saved — unchanged),
  `backend/resource-library-routes.js`, `backend/resource-library-rules.js`,
  `backend/resource-recycle-bin.js`, `backend/resource-file-intake.js`,
  `backend/resource-file-quality.js`, `backend/resource-privacy-reasons.js` (new
  tonight), `backend/body-limits.js` — all mounted in `server.js`.
- Frontend: `frontend/current/resourcehub.js` (flat list),
  `frontend/current/resourcelibrary.js` + `.css` (the folder-browsing UI,
  now including the privacy-override checklist), Resource Hub section under
  the `RESOURCES TAB (Resource Hub R1)` banner in `mockup_v3.html`
  (line ~5092). Pins verified tonight: `resourcehub.js` r56, `resourcehub.css`
  r31, `resourcelibrary.js` 3, `resourcelibrary.css` 3 — all match via
  `node scripts/check-asset-pins.js`.

## Guard check (re-run tonight)
`router.use('/api/rh2/library', requireAuth, ...)` on the whole module; every
mutating route (`folders` POST/PATCH, `delete`, `move`, `upload`, `replace`,
`versions/:n/restore`, recycle-bin restore) additionally requires
`requireManager` (`requireRole('owner', 'admin')`), including tonight's two
touched routes; permanent delete and empty-bin additionally require
`requireOwnerOnly`. Read routes sit on `requireAuth` alone, matching the base
query's own content filter. No unguarded endpoint found, including in
tonight's changed code.

## Tests and results
Unit (re-run tonight): `tests/resource-library-rules.test.js`,
`tests/resource-library-frontend-guards.test.js`, `tests/resource-seed-guards.test.js`,
`tests/resource-hub-badge-guards.test.js`, `tests/resource-governance.test.js`,
`tests/resource-privacy-scan.test.js`, `tests/resource-source-scan.test.js`,
`tests/resource-file-delivery.test.js`, `tests/resource-file-quality.test.js`,
`tests/resource-hub-final.test.js`, `tests/resource-ingestion.test.js`,
`tests/resource-privacy-reasons.test.js` (new tonight) — **all pass**.

Integration (re-run tonight, `DB_NAME=therapy_scheduler_auditnight1026`):
`tests/integration/resources.itest.js`, `resource-hub-v1.itest.js`,
`resource-library.itest.js`, `resource-file-upload.itest.js`,
`resource-ingestion.itest.js`, `resource-library-sharepoint.itest.js` —
**all pass**. `resource-library.itest.js` hit a Postgres "deadlock detected"
on its first run tonight inside the 35-file batch (`TRUNCATE ... CASCADE` in
`truncateAll()`); re-run alone it was clean, 53/53 — a batch-concurrency
flake, not a defect in this module (see the morning brief §7). The one
pre-existing, unrelated `readonly-and-hardening.itest.js` root/chmod
environmental artifact reproduced again tonight too — not in any
resource-library file.

No TODO/FIXME found in any resource-library file.

## Browser QA is still stale for the rebuilt view — the reason the gap grew tonight
`docs/qa/BROWSER_QA_RESULTS.md` row G tested the folder-browsing UI that
`06c67779` removed on 2026-10-22. That proof still does not describe any
screen that exists. The replacement — now including tonight's "Upload
anyway" privacy checklist — has **no browser or E2E proof at all**. Row J's
read-only permission-matrix proof still stands; it exercises the API, not
this screen.

## Open tasks from the tracker
None recorded.

## Commits in window that touched it
`31d5008`, `896ace1` tonight (see above). The 2026-10-22 commits
(`06c677792`, `0195cb30`, `dd958d0c9`, `40d88a6ec`) predate this window —
see "Recent history" above.

## Disagreement
Two, in opposite directions:
1. **Downgrade, deepening**: `tab-unproven` since 2026-10-22; tonight's two
   commits added real, tested, guarded functionality (the privacy-override
   checklist) to the same screen nobody has opened yet. The gap a browser
   check would need to close is now slightly larger than it was last night,
   though the classification itself hasn't changed.
2. **Tracker still behind on stage**: the card is still `idea` despite a
   year's worth of real, tested functionality sitting behind it, now
   including a deliberately-scoped privacy-control relaxation that a human
   should be aware exists.

## Re-verified 2026-10-27
No commit since last night's audit (`896ace1`) touched this feature's files — the true window (`896ace1..41f45ed`) holds only Calendar sync-settings/Outlook/Splose work (see Portal - Splose - Outlook's folder). Re-ran the full unit suite listed above tonight: 398 passed, 12 skipped, 0 failed — same as last night. Evidence label unchanged.
