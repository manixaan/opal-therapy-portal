# Clinical resources

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Created (any code located): yes
- Addressed in this change window (2026-10-18 → 2026-11-01): **yes** — the Library view was rebuilt during this window

## Located files

- `backend/resources-routes.js` (R1 foundation — folders/tags/favourites/approve/reject)
- `backend/resource-hub-r2-routes.js` (R2 — home/resources/clinical-vocabulary/governance state)
- `backend/resource-library-routes.js` (the rebuilt SharePoint-style library — folders, browse, upload, move, versions, recycle bin)
- `backend/resource-ingestion-routes.js`, `backend/resource-privacy-scan.js`, `backend/resource-privacy-reasons.js`, `backend/resource-governance.js`, `backend/resource-recycle-bin.js`, `backend/resource-file-storage.js`
- `frontend/current/resourcehub.js` / `resourcehub.css` (pinned `?v=r56`), banner `<!-- ============ RESOURCES TAB (Resource Hub R1) ============ -->` at `mockup_v3.html:5112`

## Guard check

`resources-routes.js` and `resource-library-routes.js` both sit behind `router.use(..., requireAuth, <role gate>)` (admin explicitly denied; owner/admin via `requireManager`/`requireOwnerOnly` for mutations). `resource-hub-r2-routes.js` sits behind `router.use('/api/rh2', requireAuth, <role gate>)`, with mutation routes (approve/reject/archive/request-changes) gated by an in-handler `requireApprover(req, res)` check rather than a middleware wrapper — functionally equivalent, confirmed by reading the handler. No unguarded route found.

## Tests

| Test | Result |
|---|---|
| `tests/resource-file-delivery.test.js`, `resource-file-quality`, `resource-governance`, `resource-hub-badge-guards`, `resource-hub-final`, `resource-ingestion`, `resource-library-frontend-guards`, `resource-library-rules`, `resource-privacy-reasons`, `resource-privacy-scan`, `resource-seed-guards`, `resource-source-scan` | pass — 398 passed, 12 intentionally skipped |
| `tests/integration/resource-library.itest.js` (run alone) | pass — 53/53 |
| `tests/integration/resource-library-sharepoint.itest.js` (run alone) | pass — 36/36 |
| `tests/integration/resource-hub-r2.itest.js` (run alone) | pass — 33/33 |

Browser QA row G (`docs/qa/BROWSER_QA_RESULTS.md`, dated 2026-08-01, build `b7e3308`) only covers the old starter-resources list — it predates the Library rebuild (commits `0195cb3`, `06c6777`, `dd958d0`, `40d88a6`, 2026-10-22) and the privacy-override checklist (`31d5008`, `896ace1`, 2026-10-25) by two months, so it does not prove the current Library view. No E2E spec names the Library tab.

## Open tracker tasks

None recorded.

## Commits in window touching this feature

- `dd958d0` fix(resource-library): real upload body limit, restore clears archived_at, no ghost uploads, legacy upload door removed
- `0195cb3` feat(resource-library): document-library backend — any-depth folders, recycle bin, file versions, Owner+Admin management
- `06c6777` feat(resource-library): SharePoint-style document library UI (resourcelibrary.js)
- `40d88a6` fix(resources): calmer library header and toolbar; document page is Preview + Download
- `31d5008` feat(resources): a privacy-refused upload says why — a checklist of what, where, and the fix
- `896ace1` feat(resources): "Upload anyway" for a refusal that is only emails, dates or phone numbers

## Disagreement note

None — the tracker's own `claude_update` already correctly identifies this as built-and-tested-but-not-browser-confirmed.
