# Clinical resources

- Tracker stage: `idea`
- Tracker environment: `none`
- Evidence label: **proven**
- Addressed since the last audit (2026-10-09): no
- Created (any located code at all): yes

## Located

- `backend/resources-routes.js`, `backend/resource-hub-r2-routes.js`, `backend/resource-library-routes.js` — the "Clinical Excellence" category lives in `backend/migrations/011_resource_hub_r2.sql` and is served from `resource-hub-r2-routes.js`.
- Frontend: `frontend/current/resourcehub.js`, `RESOURCES TAB` banner (`mockup_v3.html:4954`).

## Tests

- Unit (10 files): **370 passed, 12 skipped, 0 failed.**
- Integration (6 files): **133/133 pass.**
- e2e: `e2e/tests/portal.spec.js:116` ("Resource Hub shows approved starter content, no authoring, no public URLs"), `e2e/tests/tutorials.spec.js`.
- Browser QA: `docs/qa/BROWSER_QA_RESULTS.md` row G — 4/4 pass (16 approved resources across 14 folders, no public URLs, folder-create 403).

## Open tasks (from the tracker)

No tasks recorded against this card.

## Commits since the last audit that touched it

None — no commits have landed on `develop` under `backend/` or `frontend/current/` since the last audit (2026-10-09). Code audited tonight is the same commit (`aacf8e6`) as the last several nights.

## Disagreement with the tracker

None.

