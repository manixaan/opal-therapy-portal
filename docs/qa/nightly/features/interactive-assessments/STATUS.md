# Interactive Assessments

- Tracker stage: idea | Tracker environment: none
- Evidence label: **tab-unproven**
- Created: yes
- Addressed this window: no

## Located files
- Backend: backend/fca/ (client-search, data-layers, docx-engine, letter-blocks, resolve-scalars, etc.),
  backend/whodas/ (scoring.js, instrument.js, completed-pdf.js, template-registry.js),
  backend/assessments/ (availability.js, definitions.js, share.js)
- Routes: assessments-routes.js (2 guards), fca-routes.js (2), whodas-routes.js (2), letter-routes.js (2)

## Guard check
All four route files guarded. OK (re-confirmed tonight).

## Tests (re-run fresh tonight)
- Unit: 12 suites / 738 tests — PASS (fca-docx-engine, fca-frontend-helpers, fca-preview-lifecycle,
  fca-preview-pages, fca-resolve-scalars, fca-wizard-behaviour, whodas-external-completion,
  whodas-frontend-guards, whodas-scoring, whodas-templates, assessment-catalogue,
  assessment-surface-guards).
- Integration: 3 suites / 122 tests — PASS (assessments, fca-reports, whodas;
  DB_NAME=therapy_scheduler_audit_assess). Same benign WARN logged as last night ("splose client
  list unavailable (splose down)") — an exercised fallback path, not a failure.
- Tab coverage: NONE found. No e2e spec for FCA/WHODAS/assessments; no pass entry in
  docs/qa/BROWSER_QA_RESULTS.md (unchanged since last night).

## Open tasks (from tracker)
- "Assessment Review" — todo.

## Commits in window touching this
None.

## Disagreement
None — the gap (no browser proof of WHODAS 2.0 scoring for a real client) matches exactly what the
tracker's own next_action already asks for.

## Note
No change from the 2026-11-16 audit. Independently re-verified fresh tonight (separate parallel
audit pass, its own throwaway database) — same code, same tests, same result. Also confirmed two
near-miss window commits are non-matches: `554fcea` ("Writing an FCA report" induction pack) is
content only, and `24aee93` (Report Templates' clinical-letter-templates merge) touched
`backend/fca/docx-engine.js` as shared composition machinery without regressing any FCA/WHODAS test.
