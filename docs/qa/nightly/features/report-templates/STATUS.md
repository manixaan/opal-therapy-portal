# Report Templates

- Tracker stage: `idea`
- Tracker environment: `none`
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-10-09): no
- Created (any located code at all): yes

## Located

- FCA: `backend/fca-routes.js` (covered under Interactive Assessments).
- Progress Letter: `backend/letter-routes.js` — `requireAuth` on `/api/letters` (line 166). Note: `file` reports this source file as non-ASCII ("data"); `node --check` still passes cleanly — unusual encoding, not a defect.
- `backend/templates-routes.js` — `requireAuth` on `/api/templates` (line 113).
- Client Agreement Form: **no distinct route or file found.** `backend/service-agreements/` contains only a `templates/` subfolder, nothing is mounted under that name in `server.js`. `tests/templates-service-agreement-map.test.js` exercises this mapping from inside `templates-routes.js` instead, which matches the tracker's own suspicion that this card is just the existing Service Agreement template.

## Tests

- Unit (9 files): **377/377 pass.**
- Integration (2 files): **79/79 pass.**
- e2e / browser QA: none — no mention of "progress letter" or "client agreement" anywhere in `e2e/tests/` or `docs/qa/BROWSER_QA_RESULTS.md`.

## Open tasks (from the tracker)

Tasks "FCA", "Progress Letter", "Client Agreement Form" are all `todo`.

## Commits since the last audit that touched it

None — no commits have landed on `develop` under `backend/` or `frontend/current/` since the last audit (2026-10-09). Code audited tonight is the same commit (`aacf8e6`) as the last several nights.

## Disagreement with the tracker

None.

