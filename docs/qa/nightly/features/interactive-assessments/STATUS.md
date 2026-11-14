# Interactive Assessments

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (2026-11-13 to 2026-11-14): no
- Created at all: yes

## Located files

- Routes: `backend/whodas-routes.js`, `backend/assessments-routes.js`,
  `backend/fca-routes.js` (FCA is also an assessment-adjacent report, shared
  with the Report Templates feature)
- Frontend: `frontend/current/whodas.js`, `frontend/current/assessment.js`.
  Could not find a standalone top-nav "Assessment" tab banner in
  `mockup_v3.html` — the client's own task text calls it "the Assessment
  tab," so it is most likely a sub-view inside a client record (same
  pattern as Report Templates), not a `data-tab="..."` entry of its own.
- Unit tests: `tests/assessment-catalogue.test.js`,
  `tests/assessment-surface-guards.test.js`,
  `tests/whodas-external-completion.test.js`,
  `tests/whodas-frontend-guards.test.js`, `tests/whodas-scoring.test.js`,
  `tests/whodas-templates.test.js`
- Integration tests: `tests/integration/assessments.itest.js`,
  `tests/integration/whodas.itest.js`

## Guard check

`whodas-routes.js`: `requireAuth` + inline `CLINICAL_ROLES` role check
(therapist/owner write, read_only read). `assessments-routes.js`: same
pattern. No finding.

## Tests run

- Unit: 481/481 passed (6 suites).
- Integration: 81/81 passed (2 suites), against `therapy_scheduler_audit_test`.

## Recency

Not touched in the change window (since the 2026-11-13 audit).

## Why tab-unproven

Code, guards and tests all check out, but nothing in `e2e/tests/` or
`docs/qa/BROWSER_QA_RESULTS.md` proves the assessment UI renders and scores
correctly in a real browser.

## Open tasks (from tracker)

- Assessment Review — todo. The task's own text is explicit that this is a
  **human curation task, not a coding task**: "This task is about
  reviewing, not building... Only Hudas 2.0 is fully set up today; the rest
  are pending or unconfirmed. Ann sorts them into keep or remove..." That
  matches the evidence — WHODAS 2.0 (`whodas-routes.js`) has the deepest
  test coverage (4 of the 8 located test files are WHODAS-specific); the
  general `assessments-routes.js`/`assessment.js` surface is thinner and
  its scope is still an open product decision, not an engineering gap.

## Commits in the window touching this

None.

## Disagreement

Tracker stage `idea`, task `todo`. Evidence: WHODAS 2.0 is solidly built
and tested; the rest of "Interactive Assessments" is deliberately
unconfirmed per the task's own description, and that decision is correctly
still open in the tracker — no disagreement there. The gap that IS worth
flagging is the missing browser proof for the WHODAS/assessment UI that
already exists.
