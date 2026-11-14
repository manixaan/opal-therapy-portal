# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed in change window (2026-11-13 to 2026-11-14): no — the two
  template-engine commits below (`24aee93`, `0561d91`) are from
  2026-11-07, predating this window
- Created at all: yes

## Located files

- Routes: `backend/fca-routes.js`, `backend/letter-routes.js`,
  `backend/templates-routes.js` (the general "complete a master, take an
  independent document away" engine that FCA, Progress Letter and Service
  Agreement all share)
- Supporting: `backend/fca/` (client-search, data-layers, docx-engine,
  template-map, letter-template-map, preview-pagination, resolve-scalars),
  `backend/templates/catalogue.js` (maps Service Agreement, Support Letter,
  Progress Report and FCA to their master `.docx` files),
  `backend/templates/service-agreement-map.js`, `backend/service-agreements/
  templates/` (the actual `.docx`/`.pdf` masters)
- Frontend: `frontend/current/fca.js`, `frontend/current/letter.js`,
  `frontend/current/templates.js`
- Unit tests: `tests/fca-docx-engine.test.js`,
  `tests/fca-frontend-helpers.test.js`, `tests/fca-preview-lifecycle.test.js`,
  `tests/fca-preview-pages.test.js`, `tests/fca-resolve-scalars.test.js`,
  `tests/fca-wizard-behaviour.test.js`, `tests/letter-docx-engine.test.js`,
  `tests/letter-frontend-helpers.test.js`, `tests/letter-template-map.test.js`,
  `tests/templates-appendices.test.js`, `tests/templates-clinical-maps.test.js`,
  `tests/templates-export-boundary.test.js`,
  `tests/templates-frontend-guards.test.js`, `tests/templates-routes.test.js`,
  `tests/templates-service-agreement-map.test.js`
- Integration tests: `tests/integration/fca-reports.itest.js`,
  `tests/integration/progress-note-letters.itest.js`,
  `tests/integration/templates.itest.js`

## Guard check

All three route files: `requireAuth` on the whole router plus an inline
`CLINICAL_ROLES`/`requireTemplateRead`/`requireTemplateWrite` role check
(therapist/owner write, read_only read, admin excluded outright from client
data) — not a `requireRole` middleware, but a real role gate on every
handler. No finding.

## Tests run

- Unit: 626/626 passed (15 suites).
- Integration: 123/123 passed (3 suites), against
  `therapy_scheduler_audit_test`. Splose client lookups correctly reported
  unavailable in test (`WARN ...: splose client list unavailable {"error":
  "splose down"}`) — expected, not a failure.

## Recency

Not touched in the change window (since the 2026-11-13 audit). The
template-engine work below predates the window:
- `24aee93` (2026-11-07) feat(templates): Support Letter and Progress
  Report masters
- `0561d91` (2026-11-07) perf(templates): live side-by-side preview, no
  Splose round-trip per keystroke

## Why tab-unproven

All three document kinds (FCA, Progress Letter, Service Agreement — mapped
in `templates/catalogue.js`) are built, guarded and heavily tested at the
API/unit level, but nothing proves the composer pages actually render and
produce a correct document in a real browser: no `e2e/tests/*.spec.js`
covers FCA, Letter or Service Agreement, and `docs/qa/BROWSER_QA_RESULTS.md`
does not mention any of the three.
`tests/templates-frontend-guards.test.js` only pins the asset-version
numbers — it is not a render proof.

## Open tasks (from tracker)

- FCA — todo.
- Progress Letter — todo.
- Client Agreement Form — todo (maps to the Service Agreement master; no
  dedicated frontend file, reuses `templates.js`).

## Commits in the window touching this

None (see Recency for predating template-engine work).

## Disagreement

Tracker stage `idea`, all three tasks `todo`. Evidence: a shared,
well-tested document-generation engine already serves all three document
types end to end at the API layer. The real gap is browser proof, not
missing functionality.
