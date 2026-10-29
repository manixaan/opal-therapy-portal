# Portal Onboarding Workflow

- Tracker stage: idea · Tracker environment: none
- Evidence label: **broken** (one real test failure; everything else is tab-unproven — see breakdown below)
- Addressed since the last audit: **no** — develop has not moved since last night's audit (2026-10-28, also commit `15acf0c`); tonight's true window is empty. The commits listed below predate last night's audit and are historical context (the onboarding "production-ready" rebuild landed over the preceding fortnight), not new activity.
- Created (any located code): yes, extensively.

## Located

Backend routers (all mounted in `backend/server.js:557-574`): `onboarding-employee-routes.js`, `onboarding-workflow-routes.js`, `onboarding-journey-routes.js`, `onboarding-pack-routes.js`, `onboarding-returns-routes.js`, `onboarding-payroll-routes.js`, `onboarding-defaults-routes.js`, `onboarding-package-docs-routes.js`, `onboarding-assignment-routes.js`, `onboarding-library-routes.js`, `onboarding-routes.js`.
Data access: `onboarding-db.js`, `onboarding-engine.js`, `onboarding-audit.js`, `onboarding-crypto.js`, `onboarding-seed.js`, `onboarding-expiry.js`, `onboarding-induction.js`.
Frontend: `frontend/current/onboarding.js` (4810 lines), `onboarding-journey.js` (3287 lines), plus matching `.css`/`.html`. Tab banner: `ONBOARDING TAB` (`mockup_v3.html:4281`).

The tracker's three tasks map to real subsystems, not literal modules:
- **Stage 1** = offer (`onboarding-journey-routes.js` + `onboarding-pack-routes.js`)
- **Stage 2** = documentation (`onboarding-workflow-routes.js` returned-documents/extraction + `onboarding-returns-routes.js` + `onboarding-library-routes.js`)
- **Stage 3** = induction (shared with the "Inductions" feature: `onboarding-induction.js`, `learning-routes.js`, `induction-assistant-routes.js`, tutorial/walkthrough routes)

## Guard check

Pass, no gaps. Every management router applies `requireAuth` plus `requirePermission`/`requireAnyPermission` (`onboarding.view`/`.assign`/`.review`/`.activate`/`.manage_packages`/`.manage_documents`/`.manage_compliance`) or `ownerOnly`. Two deliberately-unauthenticated routes (`/api/onboarding-invite/*`, `/api/onboarding/starter-pack/download`) are documented with a security rationale (no account yet; single-use hashed, expiring token). `onboarding-employee-routes.js`'s `/api/onboarding/me/*` is `requireAuth`-only but documented self-scoped-by-design (every query keys off `req.user.id`). All 15 files pass `node --check`.

## Tests and results

| Command | Result |
|---|---|
| 24 onboarding unit test files (accounts, catalogue, contract-docx, crypto, email-markup, engine, extraction, form-reader, frontend-guards, journey(-frontend-guards), offer-docx/pdf/template, pack, payroll, placeholder-check, practice, reconcile, returns-match/zip, security, starter-pack, wizard-link, workflow-guards) | PASS — 25 suites, 632 tests |
| `tests/onboarding-document-reader.test.js tests/onboarding-document-check.test.js` | **FAIL — 1 of 22** |
| 10 onboarding integration files (defaults, induction, journey, pack, payroll-xero, portal-route, returns, wizard-link, workflow, onboarding) | PASS — 10 suites, 218 tests |

The one failure, quoted verbatim:
```
● no model reads a returned document › the OCR language data is shipped with the portal, not fetched when a document arrives
Cannot find module '@tesseract.js-data/eng/package.json' from 'tests/onboarding-document-reader.test.js'
```
This is a missing `node_modules` package in this sandbox, not a code defect — per the hard limits this audit must not run `npm install` to fix it. It must be confirmed present in the real deployment.

Note: `tests/integration/stage1-launch-blockers.itest.js` and `stage2-pilot-readiness.itest.js` are **not** about this tracker card's "Stage 1/2/3" — they're an unrelated pre-pilot RBAC/identity audit. Not run for this feature to avoid a misleading match.

## Breakdown

- **Document reading / OCR extraction (part of Stage 2): broken** — a guarded, otherwise-passing test fails on the missing `@tesseract.js-data/eng` dependency.
- **Everything else (offer, package/compliance admin, account provisioning, Stage 1, the rest of Stage 2, onboarding's side of Stage 3): tab-unproven** — 850 tests pass, but nothing current proves the admin package/compliance UI renders in a browser. `docs/qa/BROWSER_QA_RESULTS.md` (2026-08-01, build `188334d`) Flow C only walks a new starter's basic onboarding entry, and predates the "production-ready" release/activation/package-admin rebuild (`273de15`, `f143965`, `96324d9`, all inside this window). `e2e/tests/portal.spec.js` only exercises invite→register→first-login, not the package-admin UI.

## Open tracker tasks

`[todo]` Stage 1, `[todo]` Stage 2, `[todo]` stage 3 — all open. Stage 2's concrete blocker is the OCR dependency; Stage 1/3's blocker is missing browser/E2E proof, not missing code.

## Relevant commits (historical — predate last night's audit, not new tonight)

`273de15` (Merge: onboarding production-ready — portal route, Owner-only activation, safety fixes), `51f585b` (a disagreeing returned document reopens an applied value as a conflict), `db8fb6c` (validated forms, a permission-tiered audited profile, gated scans), `41e8178` (the practice's details are Owner-edited settings), `f143965` (Stage 2/3 run through the portal — release, invitation, induction, Activate), `96324d9` (Owner-only activation, Owner-only waivers, no placeholder documents), `fba7efa` (an onboarding acts only on its own pre-employee account), `5eef761` (never mint an Owner, never demote an existing account, fresh session on accept). All of these are already several audit cycles old; none is from tonight's (empty) window.

## Disagreement / notes

Prior claude_update: *"Broken, 2nd night running: a reproducible test failure (missing @tesseract.js-data/eng OCR package) is unconfirmed against the real deployment. Stage 2's SharePoint-storage gap is unchanged; Stage 2/3 otherwise run through the portal."*
- **Agree** on the OCR/tesseract failure, independently reproduced.
- **Disagree / correction:** "Stage 2's SharePoint-storage gap" does not refer to anything in the onboarding code (`grep -ri sharepoint backend/onboarding-*.js` — zero hits). "SharePoint-style" is the *Resource Library* feature (`06c6777`), a different tracker card ("Clinical resources"). This looks like a misattribution carried over from a previous night.
- **Disagree / addition:** "Stage 2/3 otherwise run through the portal" overstates settledness — the admin package/compliance UI has no current browser or E2E proof, which is a separate gap from the OCR defect.
