# Report Templates

- Tracker stage: idea | Tracker environment: none
- Evidence label: **tab-unproven**
- Created: yes
- Addressed this window: no (last window's template commits were already accounted for in the
  2026-11-15 audit; zero commits since)

## Located files
- Backend: letter-routes.js (2 guards), templates-routes.js (3 guards; per-route
  requireTemplateRead/requireTemplateWrite — a named permission, stricter than plain requireAuth),
  fca-routes.js (already verified under Interactive Assessments), backend/service-agreements/templates/
  (Client Agreement Form).
- NOTE (carried forward, still true tonight): CLAUDE.md's repo map lists
  "backend/service-agreement-routes.js" — this file does not exist. Service agreements are actually
  handled through templates-routes.js + service-agreements/templates/. Reported for whoever maintains
  CLAUDE.md, not corrected by this audit (out of scope per the hard limits).

## Guard check
OK — letter-routes.js and templates-routes.js both guarded; templates-routes.js uses named
permissions rather than plain requireAuth, which is stricter (re-confirmed tonight).

## Tests (re-run fresh tonight)
- Unit: 5 suites / 184 tests — PASS (letter-docx-engine, letter-frontend-helpers,
  letter-template-map, onboarding-contract-docx, templates-service-agreement-map).
- Integration: tests/integration/progress-note-letters.itest.js — 1 suite / 55 tests PASS
  (DB_NAME=therapy_scheduler_audit_templates). fca-reports.itest.js already run and passing under
  Interactive Assessments tonight.
- Tab coverage: NONE — no e2e spec, no docs/qa/BROWSER_QA_RESULTS.md entry for templates/letters/
  FCA/agreement (confirmed unchanged tonight).

## Open tasks (from tracker)
- "FCA" — todo.
- "Progress Letter" — todo.
- "Client Agreement Form" — todo.

## Commits in window touching this
None.

## Disagreement
None — the gap (no hand-check of the three document flows through to a downloaded file) matches the
tracker's own next_action exactly.

## Note
No change from the 2026-11-15 audit. Re-verified fresh tonight: same code, same tests, same result.
