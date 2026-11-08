# Report Templates

Tracker stage: idea · Tracker environment: none
Evidence label: **tab-unproven**
Addressed in this change window: **yes** · Created: **yes**

## Located files

`backend/templates-routes.js`, `backend/fca-routes.js`, `backend/letter-routes.js`. No standalone service-agreement route file — service agreements are a template inside this subsystem (`backend/templates/service-agreement-map.js` + `backend/service-agreements/templates/*.docx|*.pdf`). `backend/fca/` holds the docx engine + progress-report/support-letter templates. Frontend: not a separate shell tab — `frontend/current/templates.js` renders into `#templates-root` inside the Resource Hub's Library view, alongside sibling `#fca-hub-entry`/`#letter-hub-entry` (deliberately kept outside `#rh2-root`, per a comment, because `resourcehub.js` rebuilds that subtree wholesale and would erase live forms).

Guarded: all three route files use the same inline-role-guard pattern as Interactive Assessments — `router.use('/api/<x>', requireAuth)` then per-route `requireClinicalRead`/`requireClinicalWrite` against `CLINICAL_ROLES = {therapist, owner}` (admin explicitly excluded: "Admin is a non-clinical scheduling role here. NO ACCESS"). No bare unguarded route found. No TODO/FIXME.

## Tests

- Unit (15 files): `fca-docx-engine`, `fca-frontend-helpers`, `fca-preview-lifecycle`, `fca-preview-pages`, `fca-resolve-scalars`, `fca-wizard-behaviour`, `letter-docx-engine`, `letter-frontend-helpers`, `letter-template-map`, `templates-appendices`, `templates-clinical-maps`, `templates-export-boundary`, `templates-frontend-guards`, `templates-routes`, `templates-service-agreement-map` — **369/369 pass** (ran templates/letters subset; FCA-specific files already counted under Interactive Assessments' 738)
- Integration (3 files): `templates.itest.js`, `progress-note-letters.itest.js`, `fca-reports.itest.js` (shared with Interactive Assessments) — **88/88 pass** for templates+letters+snapshot combined run

## Browser / E2E proof

**None found.** `e2e/tests/portal.spec.js` has one Resource Hub test (folder content + 403) that does not touch Templates. `tutorials.spec.js` has zero matches for "template". `docs/qa/BROWSER_QA_RESULTS.md` has zero matches for "template". No end-to-end flow proves a user can open Resource Hub → Templates and generate an FCA report, progress letter or service agreement.

## Open tasks from the tracker

"FCA" (todo), "Progress Letter" (todo), "Client Agreement Form" (todo) — no further detail text.

## Commits in the window touching this feature

`24aee93` (Support Letter and Progress Report masters — new docx engine content, `templates-routes.js`, migration 087), `0561d91` (live side-by-side preview, no Splose round-trip per keystroke — `templates-routes.js`, `templates.js`, the `mockup_v3.html` `?v=` pin), `64e432f` (merge of `clinical-letter-templates`, union of both plus `templates.css`).

## Disagreement

None.
