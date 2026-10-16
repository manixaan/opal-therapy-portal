Feature: Portal Onboarding Workflow
Tracker stage: idea
Tracker environment: none
Evidence label: needs-refinement
Addressed in change window (2026-10-02 to 2026-10-16): no
Created (any located code): yes

## Located files
The `backend/onboarding-*.js` family (40+ files). Every route file mounted
under `/api/onboarding/*` is guarded consistently with `requireAuth` plus
`requirePermission('onboarding.*')`: `onboarding-employee-routes.js`,
`onboarding-workflow-routes.js`, `onboarding-journey-routes.js`,
`onboarding-pack-routes.js`, `onboarding-returns-routes.js`,
`onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`,
`onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`,
`onboarding-library-routes.js`, `onboarding-routes.js`.

## Guard check
Pass. No unguarded endpoint found across the whole onboarding family.

**SharePoint storage for finished onboarding documents: confirmed not
built.** Grepping all of `backend/*.js` for "sharepoint"/"SharePoint"
found only a Content-Security-Policy allowlist entry in `server.js:408` —
no actual SharePoint integration code anywhere. This matches the
tracker's own prior Claude update.

## Tests run
- Unit: `onboarding-accounts`, `onboarding-catalogue`,
  `onboarding-contract-docx`, `onboarding-crypto`,
  `onboarding-document-check`, `onboarding-document-reader`,
  `onboarding-email-markup`, `onboarding-engine`, `onboarding-extraction`,
  `onboarding-form-reader`, `onboarding-frontend-guards`,
  `onboarding-journey-frontend-guards`, `onboarding-journey`,
  `onboarding-offer-docx`, `onboarding-offer-pdf`,
  `onboarding-offer-template`, `onboarding-pack`, `onboarding-payroll`,
  `onboarding-reconcile`, `onboarding-returns-match`,
  `onboarding-returns-zip`, `onboarding-security`, `onboarding-starter-pack`,
  `onboarding-workflow-guards` → **24 suites: 23 passed, 1 FAILED. 598
  tests: 597 passed, 1 FAILED.**
  - Failing test: `onboarding-document-reader.test.js` → "the OCR language
    data is shipped with the portal, not fetched when a document arrives"
    — `Cannot find module '@tesseract.js-data/eng/package.json'`.
    **Root cause: an environment dependency gap, not a code defect.**
    `package.json` declares `"@tesseract.js-data/eng": "^1.0.0"` as a
    dependency, but it is physically missing from `backend/node_modules`
    in this sandbox. Per this audit's hard limits, `npm install` was not
    run to fix it. This needs attention in the environment's setup script,
    not in `onboarding-document-reader.js`.
- Integration (`DB_NAME=therapy_scheduler_audit`): `onboarding-defaults`,
  `onboarding-induction`, `onboarding-journey`, `onboarding-pack`,
  `onboarding-returns`, `onboarding-workflow`, `onboarding`,
  `stage1-launch-blockers`, `stage2-pilot-readiness` → 9 suites / 202
  tests, all PASS.

## Browser / E2E evidence
`e2e/tests/portal.spec.js` covers the invite → copy-link → registration
flow. `docs/qa/BROWSER_QA_RESULTS.md` flows B/C cover that same flow plus
the onboarding/profile setup card rendering truthfully — but not the
full Stage 1/2/3 document flow (editable preview, Send button, SharePoint
storage, dynamic contract).

## Open tasks from tracker
- Stage 1 [todo] — tracker checklist marks "editable preview", "PDF/doc
  downloads identical", "Send button", and "full flow test" as not done,
  but code + tests show the editable preview and identical-rendering
  pieces are built and tested.
- Stage 2 [todo] — tracker checklist marks SharePoint storage, flow
  checks, and the dynamic employee contract as not done. The dynamic
  contract (reading the Letter of Offer and filling in remuneration, etc.)
  IS built and tested; SharePoint storage genuinely is not.
- stage 3 [todo] — no detail recorded in the tracker.

## Commits in window touching this feature
None.

## Disagreement with tracker
The tracker's own checklists for Stage 1 and Stage 2 undersell what's
built (several items marked "not done" are in fact built and tested —
this is the tracker underclaiming, not overclaiming, so it isn't the
"tracker ahead of evidence" disagreement this audit flags, but it's worth
a person's attention so the checklists get updated). The one genuine gap
— SharePoint document storage — is real and matches what the tracker
already says.
