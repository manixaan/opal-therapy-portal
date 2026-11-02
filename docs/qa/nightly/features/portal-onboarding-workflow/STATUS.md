# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in this change window (since 2026-11-01): No — tonight's 7 commits are all "Opal Assist" plus an unrelated maps fix; none touch onboarding. (Last window, 2026-10-18→2026-11-01, was heavy: `f143965`, `96324d9`, `db8fb6c`, `41e8178`, `fba7efa`, plus the first-login wizard commits.)
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
| `npx jest tests/onboarding-offer-docx.test.js tests/onboarding-offer-pdf.test.js tests/onboarding-offer-template.test.js tests/onboarding-contract-docx.test.js` | ✅ 29 passed (re-run 2026-11-02, unchanged) — Stage 1 Letter of Offer is solid |
| `npx jest tests/onboarding-document-reader.test.js` | ❌ 1 failed / 14 passed — `Cannot find module '@tesseract.js-data/eng/package.json'`. This is a sandbox packaging gap (OCR language data not installed here, not fetchable without `npm install`), not a code regression — same failure the tracker's own prior note already recorded. Needs confirming only in the real Azure deployment. |
| `DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js tests/integration/onboarding-pack.itest.js --runInBand` | ✅ 6 passed (re-run 2026-11-02, unchanged) |

Given the size of this subsystem, only the files most relevant to the open tasks were run (not every onboarding test file) — see the many other `onboarding-*.test.js`/`.itest.js` files for additional coverage not re-verified tonight.

### Correcting last night's audit: the employee contract is already dynamic

Last night's brief said *"the employee contract generator is still a static 'junior OT' template rather than pulling from the Letter of Offer"* and told the morning team to go make it dynamic. **That is incorrect, and the tracker's own `next_action` field repeats the same error.** Reading `backend/onboarding-contract-docx.js` tonight: its header states the contract is "filled from the same facts as the Letter of Offer — the offer terms the Owner entered in Stage 1, the practice signatory, and the offer's stated defaults — so the letter and the contract can never disagree," and `buildScalars()` calls `offerDocx.buildScalars(...)` and reuses its remuneration, pay-cycle, position, commencement-date, superannuation and signatory values directly. `tests/onboarding-contract-docx.test.js:79` (passing) asserts `OPAL_COE_REMUNERATION === OPAL_LOO_REMUNERATION` — i.e. there is a dynamic-fill test and it's green. `git log` shows this landed in commit `7e3f921` on **2026-09-21**, over five weeks before last night's audit, not something that regressed since. The genuinely open Stage 2 items are: finalise/upload documents to SharePoint (`c0-2f02`), check every Stage 1→2 button (`c2-phtc`), simplify the layout (`c6-8xpz`), and the human decision on which contract clauses are fixed vs per-applicant (`c7-02w9`) — the code-level "make it dynamic" checklist item (`c5-nyyr`) itself appears already satisfied by the code and should be tickable in the tracker once a person confirms it.

## Open tracker tasks

- Stage 1 — `todo` (code says otherwise: Letter of Offer is built and tested; task is stale)
- Stage 2 — `todo`; the dynamic-contract item is effectively done in code (see correction above), but SharePoint upload, button flow check, and layout simplification are genuinely still open
- stage 3 — `todo`, no explanation/notes recorded in the tracker

## Commits in window

None since 2026-11-01. The 2026-10-18→2026-11-01 window (see last night's brief) was the single most-touched subsystem.

## Disagreement

Two, in opposite directions:
1. (Unchanged from last night) Tracker stage is "idea" (lowest) for a subsystem with a dedicated "onboarding production-ready" merge behind it — evidence is well ahead of the tracker stage. `docs/qa/BROWSER_QA_RESULTS.md` already has a passing "Onboarding/profile chain" row (✅ 7/7), so this is not `tab-unproven`.
2. (New tonight) The tracker's `next_action` ("Make the Stage 2 employee contract dynamic...") and last night's brief both overstate how much work remains — the dynamic-fill is already built and tested, five weeks before last night's audit ran. See the correction above.
