# Clinical resources

- Tracker stage: **idea** · Tracker environment: **none**
- Evidence label: **proven**
- Addressed since last audit (2026-09-17T18:21Z UTC): **no**
- Created (any located code): **yes**

## Located files

- `backend/resource-hub-r2-routes.js`, `backend/resource-library-routes.js`, `backend/resources-routes.js`, `backend/resource-ingestion-routes.js`, `backend/instrument-register-routes.js` and their data-access counterparts — explicitly described in `backend/server.js` as "Resource Hub (governed clinical resource repository; backend-enforced RBAC)."
- Frontend: `frontend/current/resourcehub.js`, mounted at the `RESOURCES TAB` banner in `mockup_v3.html`.

This remains the closest and best-fit existing implementation for the tracker's "Clinical resources" idea; no other code matches the title.

## Guard check

Every resource route still sits behind `requireAuth` plus a permission/role check (`requireAuth` on `/api/resources`, `/api/rh2`, `/api/rh2/library`, each with an additional inline check). Confirmed via the passing RBAC-focused integration tests below, which explicitly assert 403s for unauthorised roles. No unguarded route found.

## Tests run

Re-run fresh tonight, on a session-private database (`therapy_scheduler_qaaudit_res`) to avoid the cross-session DB contention flagged mid-audit:

- Unit (10 files: `resource-file-delivery`, `resource-file-quality`, `resource-governance`, `resource-hub-badge-guards`, `resource-hub-final`, `resource-ingestion`, `resource-library-frontend-guards`, `resource-privacy-scan`, `resource-seed-guards`, `resource-source-scan`) — **370/382 passed, 12 intentionally skipped** (not failures).
- Integration (6 files: `resource-file-upload.itest.js`, `resource-hub-r2.itest.js`, `resource-hub-v1.itest.js`, `resource-ingestion.itest.js`, `resource-library.itest.js`, `resources.itest.js`) — **133/133 passed**.
- Browser QA: `docs/qa/BROWSER_QA_RESULTS.md` flow G, still dated 2026-08-01 (48 days stale, unchanged from last audit) — therapist sees 16 approved starter resources across 14 folders, no non-official external URLs, folder-create correctly 403s.

## Recency check on `resourcehub.js`/`.css`

`resourcehub.js`/`.css` were bumped again tonight to `?v=r52`/`?v=r30` (up from last night's `r46`/`r25`) by six more Learning/induction-library commits (`22fddf1`, `e15e5a5`, `0f19b1e`, `7bc1f37`, `9ae5fbe`, `ba26286`). Read the actual diff (`git diff b6a8ad4..HEAD -- frontend/current/resourcehub.js`, 209 lines changed) to check whether any of it touches the resource-file/folder code this feature's evidence rests on: it does not — every changed line is in the `rh2-course`/induction-library/workshop-assistant/rich-text-builder code, a different tracker feature (Learning) that happens to share this same JS file's `RH2` namespace. No line touching folders, resource governance, approved-resource lists, or external-URL handling changed. The stale-but-still-valid browser QA judgement from last night stands unchanged.

## Disagreement

Tracker stage is idea; the Resource Hub is a mature, RBAC-correct, thoroughly-tested subsystem that already serves what "Clinical resources" describes.
