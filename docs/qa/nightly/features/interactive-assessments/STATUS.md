# Interactive Assessments

- Tracker stage: idea | Tracker environment: none
- Evidence label: **needs-refinement**
- Created: yes
- Addressed this window: no

## Located files
- Backend: backend/fca/ (client-search, data-layers, docx-engine, letter-blocks, resolve-scalars, etc.),
  backend/whodas/ (scoring.js, instrument.js, completed-pdf.js, template-registry.js),
  backend/assessments/ (availability.js, definitions.js, share.js)
- Routes: assessments-routes.js (2 guards), fca-routes.js (2), whodas-routes.js (2), letter-routes.js (2)

## Guard check
All four route files guarded. OK.

## Tests
- Unit: 12 suites / 738 tests — PASS
- Integration: 3 suites / 122 tests — PASS (DB_NAME=therapy_scheduler_audit_assess). WARN logged
  ("splose client list unavailable (splose down)") — an exercised fallback path, not a failure.
- Tab coverage: NONE found. No e2e spec for FCA/WHODAS/assessments; no pass entry in
  docs/qa/BROWSER_QA_RESULTS.md (only an unrelated mention of "Assessment" in an error-log table).

## Open tasks (from tracker)
- "Assessment Review" — todo.

## Commits in window touching this
None directly.

## Disagreement
None — the gap (no browser proof of WHODAS 2.0 scoring for a real client) matches exactly what the
tracker's own next_action already asks for.
