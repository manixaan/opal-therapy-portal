# Clinical resources

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in this change window: **yes** (resource-library backend/UI landed this window)
- Created (any located code): **yes** — large, mature subsystem

## Located files

- Backend: `resources-routes.js` (Resource Hub R1), `resource-library-routes.js` (any-depth
  folders, recycle bin, file versions), `resource-hub-r2-routes.js` (Learning/Knowledge/Standards),
  `resource-ingestion-routes.js` (650-record catalogue, owner/admin only), plus 14 supporting
  pure-logic modules (privacy scan, governance, file storage/quality, etc.).
- Frontend: `frontend/current/resourcehub.js/.css`, `resourcelibrary.js/.css`. Tab banner:
  `mockup_v3.html:5120` `RESOURCES TAB (Resource Hub R1)`.
- Guards: all guarded — `requireAuth` + `requireRole('owner')`/`requireRole('owner','admin')` on
  management routes; ingestion routes gate inline with `requireAdmin(req,res)`.

## Tests and results

- Unit: 13 suites / 444 tests (12 skipped) — **all pass**.
- Integration: `resources.itest.js`, `resource-hub-r2.itest.js`, `resource-library.itest.js` —
  **all pass**.

## Open tasks from the tracker

None recorded — zero tasks on this feature.

## Commits in the window that touched it

`06c6777` (SharePoint-style document library UI), `0195cb3` (document-library backend: folders,
recycle bin, versions), `dd958d0` (real upload body limit, restore clears archived_at, legacy
upload door removed).

## Browser QA

Yes — `docs/qa/BROWSER_QA_RESULTS.md:28`, but dated 2026-08-01, before the resource-library work
above landed: "Therapist sees 16 approved starter resources across 14 folders... folder-create
403." That QA covers R1 viewing only, not the newer Library upload/privacy-override/folder flow
the tracker's own `next_action` asks to walk.

## Disagreement

Tracker card is a bare one-line idea with no why/who/what/decisions — reads as a stale placeholder
from before this subsystem existed. The located code is mature and well-tested; evidence is ahead
of the tracker, not behind it.

## Findings

No code defects found. The only gap is proof: nothing shows the newer upload/privacy-override/
folder flow actually working in a browser, which is exactly what the tracker's `next_action` asks
a human to go and do.
