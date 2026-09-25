# Portal Onboarding Workflow

- Tracker stage: idea
- Tracker environment: none
- Evidence label: **needs-refinement**
- Addressed in this change window (2026-09-24 → 2026-09-25): no — zero commits landed in this window at all
- Created (any located code): yes — by far the largest subsystem in the codebase

## Located files

- Stage 1 (Letter of Offer / Outlook draft): `backend/onboarding-journey-routes.js`, `onboarding-journey.js`, `onboarding-journey-db.js`, `onboarding-offer-letter.js`/`-offer-docx.js`/`-offer-pdf.js`/`-offer-template.js`/`-offer-email.js`, `onboarding-email-markup.js`. Frontend: `frontend/current/onboarding-journey.js`/`.css`.
- Stage 2 (finalise + store documents): `backend/onboarding-pack-routes.js`/`-pack.js`/`-pack-db.js`/`-pack-email.js`, `onboarding-returns-routes.js`/`-returns-db.js`/`-returns-zip.js`, `onboarding-document-check.js`/`-document-reader.js`/`-extraction.js`/`-form-reader.js`/`-ocr.js`/`-ocr-worker.js`, `onboarding-contract-docx.js` (dynamic Contract of Employment). Storage is `backend/storage/index.js` — three backends only: `db` (Postgres, default), `local`, `blob` (Azure). **No SharePoint backend exists anywhere in code** — the only "sharepoint" hit in the whole backend/frontend is a CSP allowlist entry for the unrelated Opal Assist Office add-in.
- Stage 3 (internal induction): `backend/onboarding-induction.js`, `onboarding-learning-bridge.js`, `onboarding-workflow-routes.js` (`send_induction_in_outlook` step). Frontend: `frontend/current/induction.js`, `induction-modules.js`.
- Shared/management: `backend/onboarding-routes.js`, `onboarding-assignment-routes.js`, `onboarding-defaults-routes.js`, `onboarding-package-docs-routes.js`, `onboarding-library-routes.js`, `onboarding-employee-routes.js` (self-scoped), `onboarding-workflow-db.js`, `onboarding-db.js`. Frontend shell: `frontend/current/onboarding.js`, `onboarding.html`, `onboarding-invite.html`.
- Note: `backend/onboarding-policies/` (named in CLAUDE.md's own repo map) does not exist on disk — stale entry in the repo map.

## Guard check

All `onboarding-*-routes.js` apply `requireAuth` at `router.use()` plus per-route `requirePermission('onboarding.*')` (view/assign/review/payroll/manage_compliance/manage_packages/manage_documents/audit). `onboarding-employee-routes.js` is `requireAuth`-only but self-scoped by design (every route resolves strictly from `req.user.id`, no user-id parameter anywhere). No unguarded onboarding endpoint found.

## Tests (re-run fresh tonight)

- Unit: `npx jest tests/onboarding-*.test.js` — 24 files, 23 passed / 1 failed (597/598 individual tests). The one failure (`onboarding-document-reader.test.js`, "the OCR language data is shipped with the portal") is `@tesseract.js-data/eng` being declared in `backend/package.json` but missing from `backend/node_modules` in this sandbox — a missing-dependency environment artifact, not a code defect (this audit cannot run `npm install`). Confirmed identical to every prior audit night since 2026-09-20.
- Integration: `onboarding-defaults.itest.js`, `onboarding-journey.itest.js`, `onboarding-pack.itest.js`, `onboarding-payroll-xero.itest.js`, `onboarding-workflow.itest.js`, `onboarding.itest.js` — run tonight, 6 suites / 168 tests, all pass. (`onboarding-induction.itest.js` and `onboarding-returns.itest.js` were run in a separate batch alongside other features — both clean, see Inductions/Employee Personal Page STATUS.)
- Browser/E2E: `docs/qa/BROWSER_QA_RESULTS.md` row C proves the **employee self-service** flow (login → `/onboarding` → review → profile → setup card) live — 7/7. It does not cover the admin Stage 1/2/3 management console (journey board, Outlook-draft creation, document-return verification). No e2e spec covers onboarding management specifically.

## Open tasks from the tracker (all `status: todo`)

- **Stage 1** — "Send button emails it" is still an Outlook-draft-then-manual-send, not a direct send (`graphMail.createDraft(...)` is the only path, in `onboarding-journey-routes.js`, `onboarding-pack-routes.js`, `onboarding-workflow-routes.js`). This is a mature, consistently-applied pattern across all three stages, not an open experiment — but the team should confirm it's still the wanted final design.
- **Stage 2, dynamic contract** — built (`onboarding-contract-docx.js` composes the Contract of Employment from the same offer terms the Letter of Offer uses; `onboarding-document-reader.js` reads it back). Passing tests. The tracker's own checklist items for this are still shown unchecked.
- **Stage 2, SharePoint storage** — not implemented anywhere in code (see Located files). This audit reads the open tracker question ("is SharePoint storage still wanted") as genuinely open at the decision level, not reflected as an in-progress fork in the code — there is no partial SharePoint scaffolding to point to either way.
- **stage 3** — no further tracker detail recorded.

## Commits in the window that touched it

None — `develop` sits on `74601fc` again tonight (fourth night running). Re-verified fresh: unit (597/598, same known artifact) and integration (168/168 in this session's own grouping) both re-run tonight — no regression.

## Disagreement

1. Stage 1's "Send button emails it" does not match a literal-send reading of the tracker text — it is Outlook-draft-then-manual-send. Confirmed intentional and consistently applied, but worth a fresh decision now that Stage 2 has moved forward.
2. SharePoint storage: the tracker asks whether it's "still wanted." The code shows no trace of it ever having been started — this is a live open decision, not a stalled build.
