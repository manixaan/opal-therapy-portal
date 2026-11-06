# Report Templates

- Tracker stage: idea · Tracker environment: none
- Evidence label: **tab-unproven** (feature-level; see per-area split below)
- Addressed since the last audit (2026-11-05, cutoff `8853376`, 4 commits since: `704a51f`,
  `0a365c4`, `cd8c4a8`, `e3c0b90`): **no** — none of the 4 touches
  `backend/fca-routes.js`, `backend/fca/`, `backend/letter-routes.js`,
  `backend/assessments-routes.js`, `backend/assessments/`,
  `backend/service-agreements/`, `frontend/current/fca.js`, `letter.js`
- Created at all: **yes, all 3 of 3 tasks** (correction below — an earlier pass tonight
  wrongly called the third "untouched"; re-checked and fixed before this brief)

## Correction made during tonight's run

The tracker's `claude_update` reads "the FCA, Progress Letter and Client Agreement wizards are
all built, guarded and pass their tests... but nothing proves any of the three completes end to
end for a real user." Real prior audits of this repo do exist (2026-11-01/02/04/05 on
`origin/claude/nightly-audit`, confirmed genuine) and already said the same thing. An initial
pass tonight looked only for a dedicated `backend/service-agreement-routes.js` (the file named in
`CLAUDE.md`'s own repository map), didn't find one, and wrongly concluded Client Agreement Form
was `untouched`. Checking further (as the real 2026-11-05 brief had already done) found it: the
Client Agreement Form is **not** a dedicated wizard, it's served through the generic Templates
engine (`backend/templates-routes.js` → `backend/templates/catalogue.js`, which registers
`id: 'service_agreement'` → `backend/templates/service-agreement-map.js`, which maps the real
master file `backend/service-agreements/templates/service-agreement-v2.2.docx`). **CLAUDE.md's
repository map is itself stale here** — it names a `service-agreement-routes.js` that doesn't
exist; the real implementation is under `templates-routes.js`/`templates/`. Worth a doc fix, not
a code gap. All three sub-items are in fact built, guarded and tested:

## FCA — located, guarded, tested

- Routes: `backend/fca-routes.js`, mounted `/`; support in `backend/fca/`
  (docx-engine, template-map, resolve-scalars, etc).
- Frontend: `frontend/current/fca.js` + `fca.css`, rendered into
  `#fca-root`/`#fca-hub-entry` in `mockup_v3.html` — not a top-level tab, an
  overlay opened from the Book flow (`data-leaf="fca"`, line 4638) and NDIS
  Cases.
- Guard: every route (`/api/fca/template`, `/clients`, `/drafts*`,
  `/presets*` …) carries `requireAuth` (router-wide) **and** a per-route
  `requireClinicalRead`/`requireClinicalWrite` (therapist/owner write,
  +read_only read, admin excluded — matches the file's own documented Roles
  section). No unguarded route.
- Tests: unit `fca-docx-engine`, `fca-frontend-helpers`, `fca-preview-lifecycle`,
  `fca-preview-pages`, `fca-resolve-scalars`, `fca-wizard-behaviour` — **257/257
  passed**. Integration `fca-reports.itest.js` — **41/41 passed**.

## Progress Letter — located, guarded, tested

- Routes: `backend/letter-routes.js`, mounted `/`.
- Frontend: `frontend/current/letter.js` + `letter.css`, overlay like FCA.
- Guard: `requireAuth` router-wide + per-route `requireClinicalRead`/`requireClinicalWrite`.
- Tests: unit `letter-docx-engine`, `letter-frontend-helpers`, `letter-template-map`
  — **159/159 passed**. Integration `progress-note-letters.itest.js` — **55/55 passed**.

## Client Agreement Form — located, guarded, tested

- Served by the generic Templates engine, not a dedicated route file:
  `backend/templates-routes.js` (mounted `/api/templates`) →
  `backend/templates/catalogue.js` (`id: 'service_agreement'`) →
  `backend/templates/service-agreement-map.js` → real master
  `backend/service-agreements/templates/service-agreement-v2.2.docx`.
- Frontend: `frontend/current/templates.js` (`window.OpalTemplates`), generic editor/preview
  that handles FCA, Letter and Service Agreement template types alike (field counts documented
  in the file's own header comment — "a service agreement 82" fields).
- Guard: `router.use('/api/templates', requireAuth)` + per-route `requireTemplateRead`/
  `requireTemplateWrite`. No unguarded route.
- Tests: unit `templates-appendices`, `templates-export-boundary`, `templates-frontend-guards`,
  `templates-routes`, `templates-service-agreement-map` — **153/153 passed**. Integration
  `templates.itest.js` — **24/24 passed**.

## Nothing proves any browser completion

No file under `e2e/tests/` and no row in `docs/qa/BROWSER_QA_RESULTS.md`
mentions FCA, the Progress Letter, WHODAS, the Templates engine, or an assessment wizard. All
verification tonight was at the unit/integration level.

## Open tracker tasks
`FCA`, `Progress Letter`, `Client Agreement Form` — all `status: todo`, no
`explanation`/`notes` recorded for any of the three.

## Next action
1. Add an E2E spec (or a `docs/qa/BROWSER_QA_RESULTS.md` entry) that completes all three —
   FCA, Progress Letter, and a Service Agreement document via the Templates engine — end to
   end as a therapist/owner.
2. Fix `CLAUDE.md`'s repository map: it names `backend/service-agreement-routes.js`, which
   doesn't exist; the real file is `backend/templates-routes.js` (+ `backend/templates/`).
