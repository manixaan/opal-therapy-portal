# Report Templates

- Tracker stage: idea | Tracker environment: none
- Evidence label: **tab-unproven**
- Created: yes
- Addressed this window: yes — heavily touched (Support Letter + Progress Report templates, live preview)

## Located files
- Backend: letter-routes.js (2 guards), templates-routes.js (3 guards; per-route
  requireTemplateRead/requireTemplateWrite — a named permission, stricter than plain requireAuth),
  fca-routes.js (already verified under Interactive Assessments), backend/service-agreements/templates/
  (Client Agreement Form).
- NOTE: CLAUDE.md's repo map lists "backend/service-agreement-routes.js" — this file does not exist.
  Service agreements are actually handled through templates-routes.js + service-agreements/templates/.
  The repo map is stale on this one point — reported for whoever maintains CLAUDE.md, not corrected by
  this audit (out of scope per the hard limits: only docs/qa/nightly/ may be changed).

## Guard check
OK — letter-routes.js and templates-routes.js both guarded; templates-routes.js uses named permissions
rather than plain requireAuth, which is stricter.

## Tests
- Unit: 5 suites / 184 tests — PASS (letter-docx-engine, letter-frontend-helpers, letter-template-map,
  onboarding-contract-docx, templates-service-agreement-map).
- Integration: tests/integration/progress-note-letters.itest.js — 1 suite / 55 tests PASS
  (DB_NAME=therapy_scheduler_audit_templates). fca-reports.itest.js already run and passing under
  Interactive Assessments.
- Tab coverage: NONE — no e2e spec, no docs/qa/BROWSER_QA_RESULTS.md entry for templates/letters/
  FCA/agreement.

## Open tasks (from tracker)
- "FCA" — todo.
- "Progress Letter" — todo.
- "Client Agreement Form" — todo.

## Commits in window touching this
64e432f (merge: Support Letter + Progress Report templates, live preview), 0561d91 (live side-by-side
preview, no Splose round-trip per keystroke), 24aee93 (Support Letter and Progress Report masters).

## Disagreement
None — the gap (no hand-check of the three document flows through to a downloaded file) matches the
tracker's own next_action exactly.

## Correction note
This audit's first pass called this `needs-refinement`. Corrected to `tab-unproven` before delivery,
matching how the 2026-11-14 audit classified this same card: the gap is purely "no browser proof of
any composer page", not a functional code gap.
