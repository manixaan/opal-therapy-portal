# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in this change window (since 2026-10-18): **yes, heavily** — the window's commit log is dominated by onboarding work: `f143965 feat(onboarding): Stage 2/3 run through the portal — release, invitation, induction, Activate`, `96324d9 feat(onboarding): Owner-only activation, Owner-only waivers, no placeholder documents`, `db8fb6c fix(onboarding): validated forms, a permission-tiered audited profile, gated scans`, `41e8178 feat(onboarding): the practice's details are Owner-edited settings`, `fba7efa fix(onboarding): an onboarding acts only on its own pre-employee account`, plus the first-login wizard commits (`a968e90`, `74444eb`, `0779da3`) on 2026-10-19.
- Created (any located code): yes — this is the most heavily built subsystem in the whole tracker (~50 backend files)

## Located files (representative, not exhaustive)

- Stage 1 (Letter of Offer): `backend/onboarding-offer-letter.js`, `-offer-docx.js`, `-offer-pdf.js`, `-offer-template.js`, `-offer-email.js`
- Stage 2 (packages, contract, SharePoint/portal defaults): `backend/onboarding-pack.js`, `-pack-routes.js`, `-pack-db.js`, `-pack-email.js`, `-contract-docx.js`, `-catalogue.js`, `-document-reader.js`, `-ocr.js`
- Stage 3 (release/invitation/induction/activate): `backend/onboarding-journey.js`, `-journey-routes.js`, `-returns-routes.js`, `-returns-zip.js`, `-account-guard.js`, `-accounts.js`
- Guards: `backend/onboarding-routes.js` (header: "first feature in the portal to use `requirePermission`" — gates on named permissions like `onboarding.view`, `onboarding.manage_compliance`, `onboarding.manage_packages`, not role alone)
- Frontend: `frontend/current/onboarding.js`, ONBOARDING TAB (`mockup_v3.html:4289`)

## Guard check

Spot-checked `onboarding-routes.js`, `onboarding-pack-routes.js`, `onboarding-employee-routes.js`: every router mounts `requireAuth`, and `onboarding-routes.js` additionally names a specific `onboarding.*` permission per route. `/api/onboarding/me*` is self-scoped by design (own pre-employee record only — matches the `snapshot-routes.js` exception). No defect found.

## Tests run

| Test | Result |
|---|---|
| `npx jest tests/onboarding-offer-docx.test.js tests/onboarding-offer-pdf.test.js tests/onboarding-offer-template.test.js tests/onboarding-contract-docx.test.js` | ✅ 29 passed — Stage 1 Letter of Offer is solid |
| `npx jest tests/onboarding-document-reader.test.js` | ❌ 1 failed / 14 passed — `Cannot find module '@tesseract.js-data/eng/package.json'`. This is a sandbox packaging gap (OCR language data not installed here, not fetchable without `npm install`), not a code regression — same failure the tracker's own prior note already recorded. Needs confirming only in the real Azure deployment. |
| `DB_NAME=therapy_scheduler_audit2 ... tests/integration/onboarding-pack.itest.js --runInBand` | ✅ 6 passed |

Given the size of this subsystem, only the files most relevant to the three open tasks were run (not every onboarding test file) — see the many other `onboarding-*.test.js`/`.itest.js` files for additional coverage not re-verified tonight.

## Open tracker tasks

- Stage 1 — `todo` (code says otherwise: Letter of Offer is built and tested; task is stale)
- Stage 2 — `todo`, and genuinely incomplete: the employee contract is still a static "junior OT" template, not dynamic from the Letter of Offer the way Stage 2's own notes ask for
- stage 3 — `todo`, no explanation/notes recorded in the tracker

## Commits in window

See list above — this is the single most-touched subsystem in the 2026-10-18→2026-11-01 window.

## Disagreement

Tracker stage is "idea" (lowest) for a subsystem that just had a dedicated merge ("onboarding production-ready — portal route, Owner-only activation, safety fixes") land in this window — evidence is well ahead of the tracker stage, not behind it, so this isn't the overclaiming direction the audit flags, but it is worth a human re-reading the card. `docs/qa/BROWSER_QA_RESULTS.md` already has a passing "Onboarding/profile chain" row (✅ 7/7), so this is not `tab-unproven`.
