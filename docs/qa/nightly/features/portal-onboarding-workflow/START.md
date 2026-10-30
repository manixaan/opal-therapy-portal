/opal-critical

## Idea
Portal Onboarding Workflow

## Why
(not yet written in the tracker)

## Who uses it
(not yet written in the tracker)

## What they see
(not yet written in the tracker)

## What should happen
(not yet written in the tracker)

## Outcome
(not yet written in the tracker)

## Decisions
(none recorded)

## Where it lives today
Backend routers (mounted `backend/server.js:557-574`): `backend/onboarding-employee-routes.js`, `onboarding-workflow-routes.js`, `onboarding-journey-routes.js`, `onboarding-pack-routes.js`, `onboarding-returns-routes.js`, `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`, `onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`, `onboarding-library-routes.js`, `onboarding-routes.js`. Data access/support: `onboarding-db.js`, `onboarding-engine.js`, `onboarding-crypto.js`, `onboarding-document-reader.js`, `onboarding-ocr.js` (53 `onboarding-*.js` files in total). Frontend: `frontend/current/onboarding.js`, `onboarding-journey.js`, matching `.css`/`.html`; tab banner `ONBOARDING TAB` (`mockup_v3.html:4289`). This is onboarding/employment-record territory touching OCR'd documents and payroll/tax data — CRITICAL level, not FAST or FEATURE.

## Start here
Two separate pieces of work, don't conflate them:
1. Confirm `@tesseract.js-data/eng` is genuinely present in the real Azure deployment's installed `node_modules` (this sandbox cannot install it, and `backend/package.json`/`package-lock.json` already declare it correctly — so a normal `npm ci` there should pull it; the open question is only whether that deployment step actually ran). If it is missing there too, that is the real fix: ensure the deploy's dependency install step is not skipping it, re-run `npx jest tests/onboarding-document-reader.test.js tests/onboarding-document-check.test.js` to confirm 22/22.
2. Separately, and only once (1) is resolved or ruled out, walk the admin package/compliance UI (Stage 1-3 admin screens under the Onboarding tab, in `frontend/current/onboarding.js`/`onboarding-journey.js`) in a browser as Owner, then add a browser-QA entry (`docs/qa/BROWSER_QA_RESULTS.md`) or an E2E spec — neither exists today beyond the basic invite→register→redirect-to-/onboarding path in `e2e/tests/portal.spec.js`.
3. Separately again (not blocking either above): Stage 2's "finalise documents and store in SharePoint" checklist item has zero code anywhere in `backend/onboarding-*.js` — confirm with the team whether this is still wanted before treating it as a gap to close.

## Done means
(1) `npx jest tests/onboarding-document-reader.test.js tests/onboarding-document-check.test.js` passes 22/22 against the real deployment's installed dependencies. (2) A new E2E spec or browser-QA entry exercises the admin package/compliance Stage 1-3 flow. Evidence label should move from `broken` to `tab-unproven`, then to `proven` once both land.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
