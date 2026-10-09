# Interactive Assessments

- Tracker stage: `idea`
- Tracker environment: `none`
- Evidence label: **tab-unproven**
- Addressed since the last audit (2026-10-08): no
- Created (any located code at all): yes

## Located

- `backend/fca-routes.js`, `backend/whodas-routes.js`, `backend/assessments-routes.js` — all guarded with `requireAuth` on their router.

## Tests

- Unit (12 files, shared with the FCA/Letter half of Report Templates): **738/738 pass.**
- Integration (3 files): **122/122 pass.**
- e2e / browser QA: none — no mention of `whodas` or `fca` anywhere in `e2e/tests/` or `docs/qa/BROWSER_QA_RESULTS.md`.

## Open tasks (from the tracker)

Tracker task "Assessment Review" is `todo`, but per the card's own context this is a human curation job, not a coding task — it doesn't block the evidence label.

## Commits since the last audit that touched it

None — no commits have landed on `develop` under `backend/` or `frontend/current/` since the last audit (2026-10-08). Code audited tonight is the same commit (`aacf8e6`) as the last several nights.

## Disagreement with the tracker

None.

