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
`backend/onboarding-employee-routes.js`, `onboarding-workflow-routes.js`, `onboarding-journey-routes.js`, `onboarding-pack-routes.js`, `onboarding-returns-routes.js`, `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`, `onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`, `onboarding-library-routes.js`, `onboarding-routes.js`; data access in `onboarding-db.js`/`onboarding-engine.js`/`onboarding-crypto.js`; frontend `frontend/current/onboarding.js` + `onboarding-journey.js`. This is onboarding/migration/employment-record territory — CRITICAL level, not FAST or FEATURE.

## Start here
Two separate pieces of work, don't conflate them:
1. Confirm `@tesseract.js-data/eng` is genuinely present in the real Azure deployment's `node_modules` (this sandbox cannot install it). If missing there too, add it to `backend/package.json` dependencies as a CRITICAL-level fix.
2. Separately, walk the admin package/compliance UI (Stage 1/2/3 admin screens under the Onboarding tab) in a browser as Owner, then add a browser or E2E check — none exists today beyond the basic invite→register path in `e2e/tests/portal.spec.js`.

## Done means
(1) `npx jest tests/onboarding-document-reader.test.js tests/onboarding-document-check.test.js` passes 22/22 against the real deployment's dependencies. (2) A new E2E spec or browser-QA entry exercises the admin package/compliance Stage 1–3 flow. Evidence label should move from `broken` to `tab-unproven`, then to `proven`.

Tracker: 32b768b1-8bf3-40a6-9669-a8908922aa21
