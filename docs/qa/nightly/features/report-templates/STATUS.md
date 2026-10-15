# Report Templates

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **tab-unproven**
- Addressed this window: no (no commits since 2026-09-27)
- Created at all: yes

## Located files

- FCA: `backend/fca-routes.js` + `backend/fca/` (client-search.js,
  data-layers.js, docx-engine.js, letter-blocks.js, template-map.js,
  templates/). Tests: `fca-docx-engine.test.js`, `fca-frontend-helpers.test.js`,
  `fca-preview-lifecycle.test.js`, `fca-preview-pages.test.js`,
  `fca-resolve-scalars.test.js`, `fca-wizard-behaviour.test.js` (unit);
  `fca-reports.itest.js` (integration). Frontend: `/fca.js?v=5`, `#fca-root`
  overlay.
- Progress Letter: `backend/letter-routes.js` (logic split across
  `backend/fca/letter-blocks.js` and `letter-template-map.js`, reused by the
  letter route — no separate `backend/letter/` directory). Tests:
  `letter-docx-engine.test.js`, `letter-frontend-helpers.test.js`,
  `letter-template-map.test.js` (unit); `progress-note-letters.itest.js`
  (integration). Frontend: `/letter.js?v=2`, `#letter-root`.
- Client Agreement Form (**our inference, not a verbatim tracker
  statement**): `backend/service-agreement-routes.js` /
  `backend/service-agreements/` named in CLAUDE.md's repo map **do not exist
  on disk**. What does exist and genuinely matches "Client Agreement Form"
  is the Service Agreement, implemented inside the generic **Templates**
  engine: `backend/templates-routes.js` + `backend/templates/service-agreement-map.js`
  (describing `service-agreement-v2.2.docx`), reused via the same export
  pipeline as FCA/letters. Tests: `templates-service-agreement-map.test.js`,
  `templates-routes.test.js`, `templates-export-boundary.test.js` (unit);
  `templates.itest.js` (integration). Frontend: `/templates.js?v=7`.

## Guard status

`fca-routes.js` → `requireAuth` + `CLINICAL_ROLES`+read_only role check.
`letter-routes.js` → `requireAuth` (role check present in the same file —
confirmed via `grep -a` since the file has a non-UTF8 byte that makes plain
grep misreport it as binary; not a functional issue). `templates-routes.js`
→ `requireAuth` + `CLINICAL_ROLES` role checks. All three properly guarded.

## Tests run

- `npx jest tests/fca-wizard-behaviour.test.js tests/fca-docx-engine.test.js tests/letter-docx-engine.test.js tests/letter-template-map.test.js` (run jointly with Interactive Assessments' files) → included in the 9 suites / 612 tests passed, 0 failed, reported there.
- `npx jest tests/templates-service-agreement-map.test.js tests/templates-routes.test.js tests/templates-export-boundary.test.js` → 3 suites / 116 tests passed, 0 failed.
- `DB_NAME=therapy_scheduler_auditA DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/fca-reports.itest.js tests/integration/progress-note-letters.itest.js --runInBand` → included in the 4 suites / 177 tests passed reported under Interactive Assessments (both logged a benign `WARN ... splose client list unavailable`, an expected degraded-mode path in a test env with no Splose, not a failure).
- `...tests/integration/templates.itest.js --runInBand` → 1 suite / 24 tests passed, 0 failed.
- No TODO/FIXME found in `fca-routes.js`, `letter-routes.js`,
  `templates-routes.js`, `templates/service-agreement-map.js`.

## Browser-QA gap

`portal.spec.js`/`tutorials.spec.js` never mention fca/letter/templates/
service-agreement, and `docs/qa/BROWSER_QA_RESULTS.md` explicitly excludes
the FCA wizard and Service Agreement from what staging QA exercised. All
three document types are solidly built and pass unit + integration tests,
but none has browser/E2E proof.

## Open tasks from the tracker

- "FCA" (todo, bare title), "Progress Letter" (todo, bare title), "Client
  Agreement Form" (todo, bare title) — all three have empty checklists; no
  engineering gap found for any of them, the gap is proof, not code.

## Commits in the window

None.

## Disagreement note

Confirms the substance of the previous `claude_update`, corrects a
file-path detail. The guessed files `backend/service-agreement-routes.js` /
`backend/service-agreements/` do not exist — the real implementation lives
in the generic `backend/templates-routes.js` + `templates/service-agreement-map.js`,
a materially different location for anyone picking this up next.
