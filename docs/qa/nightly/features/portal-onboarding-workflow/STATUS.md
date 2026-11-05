# Portal Onboarding Workflow

- Tracker stage: idea · Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in this change window: **no** — zero commits since the 2026-11-04 audit's cutoff
  (`8853376a`, unchanged tonight)
- Created (any located code): **yes** — large, mature subsystem

## Located files

- Backend: `backend/onboarding-pack-routes.js`, `backend/onboarding-defaults-routes.js`,
  `backend/onboarding-offer-{letter,pdf,docx,template,email}.js`, `backend/onboarding-pack-db.js`.
  (Note: `backend/letter-routes.js` is a *different* feature — clinical Progress Letters — not
  the onboarding Letter of Offer.)
- Frontend: `frontend/current/onboarding.js/.css/.html`, `onboarding-journey.js/.css`. Tab banner:
  `mockup_v3.html:4297` `ONBOARDING TAB`.
- Guards: all routes guarded (`requireAuth` + `requirePermission('onboarding.view'|'onboarding.assign'|'onboarding.manage_packages')`).

## Tests and results

- Unit: 27 suites — **26 pass, 1 fails**: `tests/onboarding-document-reader.test.js` fails because
  `node_modules` is missing the `@tesseract.js-data/eng` OCR training-data sub-package. This looks
  like an environment/dependency gap (no `npm install` was run, per the hard limits), not a code
  defect — flagging rather than classifying the whole feature `broken` on this alone.
- Integration: `onboarding-journey.itest.js`, `onboarding-pack.itest.js`,
  `onboarding-payroll-xero.itest.js` — **all pass**.

## Open tasks from the tracker

- Stage 1 (Letter of Offer): mostly done (3/7 checked) — editable preview, PDF/doc download and
  Send-by-email remain `todo` on the checklist, though the code for all three already exists
  (see below) — the checklist looks stale against the code.
- Stage 2 (finalise docs, SharePoint, dynamic contract): mostly `todo` — only "show documents under
  default categories" is checked.
- Stage 3: empty, no explanation recorded.

## Commits in the window that touched it

None tonight. Last window's activity (`273de15` onboarding production-ready, `db8fb6c` validated
forms/audited profile/gated scans, `41e8178` practice details as Owner settings, `f143965` Stage
2/3 through the portal, `96324d9` Owner-only activation/waivers, `fba7efa` acts only on own
pre-employee account) was already reported by the 2026-11-01/02/04 audits.

## Disagreement

Tracker's `next_action` ("decide whether SharePoint upload is still wanted") is a genuine open
human decision — the code confirms the current implementation is entirely DB-backed (`file_data`/
`storage_key`/`storage_backend` columns in `onboarding-pack-db.js`), no SharePoint/Graph calls
anywhere in `backend/onboarding-*.js`. Not a disagreement so much as a decision waiting on a
person, which is why this is `needs-refinement` rather than `proven`.

## Findings

1. The Letter of Offer preview/PDF/download/send-email flow is implemented
   (`onboarding-defaults-routes.js:139,156`, `onboarding-pack-routes.js:796,784`) even though the
   tracker checklist marks those items `todo` — checklist is stale, not the evidence of a gap.
2. Stage 2's "dynamic employee contract" is genuinely built and confirmed again tonight:
   `onboarding-contract-docx.js:62-81` pulls `EMPLOYEE_FULL_NAME`, `POSITION_TITLE`,
   `REMUNERATION`, `PAY_CYCLE`, `SUPERANNUATION` and more straight from the Letter of Offer's own
   `buildScalars()` output, proven by `tests/onboarding-contract-docx.test.js` (passing). The
   tracker checklist item `c5-nyyr` ("Make the employee contract dynamic...") is still unticked —
   this was flagged as a false alarm by the prior audit (2026-11-02) too, and remains unticked
   tonight. This is a tracker-maintenance item for a human, not an engineering gap.
