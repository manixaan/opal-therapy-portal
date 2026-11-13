# Nightly tracker audit — 2026-11-02

**Status:** RAN — 2026-11-02, 18:39 UTC. Commit audited: `e586d417` (develop).

Counts: proven 1 · needs-refinement 3 · broken 1 · tab-unproven 6 · untouched 2 · built-untested 0. (13 features) — unchanged from last night; no feature's code changed in this window.

## Do this first

1. **Don't re-do the onboarding contract work — it's already done** (correction, `needs-refinement`). Last night's brief, and the tracker's own `next_action`, both say the Stage 2 employee contract is "still a static junior OT template" and should be made dynamic. That's wrong: `backend/onboarding-contract-docx.js` has pulled remuneration, pay cycle, position, commencement date, superannuation and signatory from the Letter of Offer since commit `7e3f921` on 2026-09-21, and `tests/onboarding-contract-docx.test.js:79` proves it. Tick tracker checklist item `c5-nyyr` and redirect effort to the genuinely open Stage 2 items (SharePoint upload, button-flow check, the fixed-vs-dynamic team decision).
2. **Fix the Outlook categories error leak** (`broken`, unchanged). `GET /api/outlook/categories` still returns the raw internal error message when a user has no Outlook connection, and still has zero test coverage. Two weeks of surrounding work; this one line is still unfixed.
3. **Add a test for leave/CPD approval in My Profile** (`needs-refinement`, employee-sensitive, unchanged). The owner approve/reject workflow for leave and professional-development requests (`/api/profile/leave*`, `/api/profile/cpd*`) still has zero test coverage anywhere in the repo.
4. **Confirm the Finance tab in a browser** (`tab-unproven`, unchanged — biggest tracker/evidence gap). A mature, 86-test-passing, owner-gated Xero payroll sync and dashboard exists; the tracker still says "idea" and nobody has opened the tab.
5. **A new AI feature ("Opal Assist") shipped this window with no tracker card.** See "What changed" below — it's CRITICAL-risk (AI, clinical-adjacent data, two migrations) and worth its own card so it gets audited the way the other 13 features are.

(No feature in this snapshot claims more maturity than the evidence shows for the 13 cards already tracked — every disagreement in that set still goes the tracker-understates-it direction. Item 1 above is a different kind of disagreement: last night's own audit, not the tracker, overstated the remaining work.)

## Every feature

| Feature | Tracker stage | Evidence label | One-line reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Owner-gated Xero/payroll sync + Finance tab; fully tested, never confirmed in a browser | 86/86 pass (re-run, unchanged) |
| Update Opal Docs Register | idea | untouched | External Excel/SharePoint job, no portal code expected | none |
| Report Templates | idea | tab-unproven | FCA/Progress Letter/Client Agreement doc engine fully tested; no wizard confirmed in a browser | 120/120 pass (re-run, unchanged) |
| Password Master Document | idea | untouched | External OneDrive doc, needs its own scoped card before any code | none |
| Opa Mobile Companion | idea | proven | Case Noting + Calendar View guarded, AI-gateway-compliant, tested; not touched this window | 123/123 unit + 10/10 integration pass (re-run, unchanged) |
| Interactive Assessments | idea | tab-unproven | WHODAS engine fully tested and guarded; never confirmed in a browser | 81/81 pass (re-run, unchanged) |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Documents/credentials/work-schedule proven; leave + CPD approval untested anywhere | 66 pass (re-run); leave/CPD: none |
| Automated Reminders | idea | tab-unproven (split) | Therapist Snapshot built+tested, never browser-confirmed; client appt reminders untouched (no code at all) | Snapshot 6/6 pass (re-run); reminders: none |
| Professional Development | idea | needs-refinement | Self-logged CPD tracker proven; owner approve/reject workflow (shared with My Profile) untested | 33 pass (re-run); approval: none |
| Inductions | idea | tab-unproven | All three surfaces (Playground, Portal, Splose) built and tested; none confirmed in a browser | 84/84 pass (re-run, unchanged) |
| Clinical resources | idea | tab-unproven | Resource Hub Library rebuilt and tested last window; browser QA entry still predates the rebuild by 2+ months | 398+122/122 pass (re-run, unchanged) |
| Portal Onboarding Workflow | idea | needs-refinement | Stage 1 solid; Stage 2's "dynamic contract" gap was a false alarm (see Do this first #1) — real gaps are SharePoint upload + button flow + a team decision | 29/29 pass + 1 env-only OCR fail (unchanged) |
| Portal - Splose - Outlook \| Integration Works | idea | broken | Outlook categories endpoint still leaks error detail with zero test coverage; rest of subsystem passes | 273/273 unit + 75/75 integration pass (last night's single-test flake did not reproduce) |

## Prompts for the morning

**1. `/opal-fast-change`**
Tick off tracker checklist item `c5-nyyr` ("Make the employee contract dynamic, the way the Letter of Offer already is") under the "Portal Onboarding Workflow" → "Stage 2" task as done — `backend/onboarding-contract-docx.js` already pulls remuneration, pay cycle, position, commencement date, superannuation and signatory from the Letter of Offer (commit `7e3f921`, 2026-09-21), proven by `tests/onboarding-contract-docx.test.js:79`. No code change needed; this is a tracker correction. If you want one small follow-up: a one-line code comment pointing future readers at that test would save the next person from the same false alarm.

**2. `/opal-fast-change`**
Fix the Outlook-categories error leak in `backend/routes.js` (`GET /api/outlook/categories`, ~line 1487/1499): when `getValidAccessToken(user)` throws because the user has no Outlook connection, return a clean "not connected" response instead of `res.status(500).json({ error: ..., details: err.message })`. Add a test to `backend/tests/` covering both the connected and not-connected paths. Done when that new test passes and no route leaks `err.message`.

**3. `/opal-critical`**
Add an integration test for the leave and professional-development approve/reject round trip in My Profile (`backend/profile-routes.js`, routes `/api/profile/leave*` and `/api/profile/cpd*`; UI in `frontend/current/profile.js` / `mockup_v3.html` `PROFILE TAB`). Follow the pattern in `tests/integration/resource-hub-r2.itest.js` (the sibling CPD system) or `tests/integration/documents.itest.js`. Done when `tests/integration/<new-file>.itest.js` passes and exercises submit → owner approve → owner reject → employee sees updated status.

**4. `/opal-critical`**
Open the Finance tab (`frontend/current/mockup_v3.html`, `FINANCE TAB (owner-only)` ~line 5500) as Owner with a Xero sandbox connected, walk Dashboard → Payroll → Invoicing, and record a dated row in `docs/qa/BROWSER_QA_RESULTS.md` (or add an `e2e/tests/` spec). The backend (`backend/accounting-routes.js`, `backend/xero-payroll-*.js`) already passes 86 tests — this is a confirmation task, not a build task. Done when the new BROWSER_QA_RESULTS.md row (or E2E spec) is in place and the Finance tab's evidence label can move to `proven`.

**5. `/opal-critical`**
Open a new tracker card for "Opal Assist" (the rephrase/rewrite chat added this window: `backend/assist-routes.js`, `backend/assist/*`, `frontend/current/assist*.js/html`, migrations 084/085). It's CRITICAL-risk — an AI feature touching clinical-adjacent text with its own de-identification layer (`backend/assist/assist-deidentify.js`) — and currently has no tracker visibility at all, so it won't get audited alongside the other 13 cards. A card needs only a title; the audit will locate and verify the code once one exists.

## Ideas without a start

No feature folder's `START.md` changed tonight except `portal-onboarding-workflow/START.md`, which was corrected to stop pointing at already-finished work (see "Do this first" #1 and its `STATUS.md`). All thirteen folders already existed from last night's first run; none are new tonight.

## What changed since last audit

Window: 2026-11-01 18:58 UTC → 2026-11-02 18:39 UTC. 7 commits touching `backend/` or `frontend/current/`, none of which touch any of the 13 tracked features:

- **Opal Assist** (6 commits, 2026-11-02) — a new rephrase/rewrite AI chat: per-client conversations scoped to the caller's own Splose caseload, a document-shaped reply mode for case notes/FCAs/letters, an installable web app with its own manifest and icons, and a second server-side safety layer that pins the active client as a token so names stay hidden even if the browser's token map is cleared. Two new migrations (`084_assist_client_chats.sql`, `085_assist_message_documents.sql`). Goes through the AI gateway (confirmed no raw vendor SDK import outside `backend/ai/`). **Has no tracker feature** — see "Do this first" #5.
- **Maps / booking UI** (1 commit) — the address-autocomplete suggestion panel now anchors under the input itself instead of the bottom of its wrapper, fixing it for the booking panel's location field (which has label chips and an MMM zone below the input). Generic UI fix, touches `attachPlacesAutocomplete()` in `mockup_v3.html`; no behaviour change to any of the 13 tracked features.

No other subsystem changed in this window.

## Technical detail

**Commands run** (from `backend/`, PostgreSQL started manually this run — `service postgresql start`, as it was down at session start):

- Tracker fetch: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → `fetch-tracker: 13 features, 19 tasks`.
- Unit, batch 1 (30 suites / 565 tests): credential-surface-guards, smart-route-backend, induction-registry, induction-assistant, onboarding-offer-docx/pdf/template, onboarding-contract-docx, outlook-delta-preserve, outlook-mirror, splose-api-queue, splose-auto-sync-reset, splose-credentials, splose-draft-sync, splose-link-routes, splose-match, splose-poller, travel-cascade, travel-feasibility, travel-outlook-sync, travel-overlay-clamp, travel-physical-route, travel-sync-routes, travel-traffic, travel-work-location-gate, xero-payroll-api/mapping/sync, case-note-routes, mobile-routes → **all pass**.
- Unit, batch 2 (31 suites / 1378 tests, 12 intentionally skipped): resource-file-delivery/quality, resource-governance, resource-hub-badge-guards/final, resource-ingestion, resource-library-frontend-guards/rules, resource-privacy-reasons/scan, resource-seed-guards, resource-source-scan, whodas-external-completion/frontend-guards/scoring/templates, assessment-catalogue, fca-docx-engine/frontend-helpers/preview-lifecycle/preview-pages/resolve-scalars/wizard-behaviour, letter-docx-engine/frontend-helpers/template-map, templates-appendices/export-boundary/frontend-guards/routes/service-agreement-map → **all pass**.
- `npx jest tests/onboarding-document-reader.test.js` → 14/15 pass, 1 fail (`Cannot find module '@tesseract.js-data/eng/package.json'` — OCR language data not installed in this sandbox; same known environment gap as last night, not a code regression).
- Integration (each run alone or in its documented group, `DB_NAME=therapy_scheduler_audit` or `_audit2`, `DB_PASSWORD=audit`, `--runInBand`): snapshot (6/6), onboarding-pack (6/6), learning-admin+onboarding-induction+induction-assistant (35/35), documents+credential-scans (25/25), resource-hub-r2 (33/33), case-note-approval-edit+case-note-client-link+case-note-deidentification (10/10), resource-library (53/53 — first attempt hit `TRUNCATE ... deadlock detected`, a DB-concurrency race; clean re-run), resource-library-sharepoint (36/36), whodas (53/53), assessments (28/28), fca-reports (41/41), progress-note-letters (55/55), templates (24/24), accounting-phase2+accounting-routes+onboarding-payroll-xero (36/36), the 9-file Splose/Outlook/travel batch — calendar-local-first, event-travel-plan, outlook-claim, outlook-delta-preserve, splose-connection, splose-draft-sync, splose-link-ignore, travel-outlook-sync, travel-overrides (75/75 — last night's single-test flake in this exact batch did not reproduce tonight).
- `grep -rln "outlook/categories\|getValidAccessToken" backend/tests/` → no matches (confirms the Outlook-categories gap is still untested).
- Write-back: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json` → `post-tracker: 13 features posted, 0 already posted tonight, brief posted`.

**Not run tonight (by design):** `npm test`, `npm run test:integration`, `npm run test:all`, E2E — today is Monday UTC, not the Sunday deep-run night.

**Could not locate / open questions:**
- No portal code exists anywhere for the 24-hour client-appointment reminder (Automated Reminders) — this needs a build-from-scratch decision (SMS vs email, confirm-step UX), not a fix.
- The Opal Assist feature (see "What changed") has no tracker card, so it was reported here rather than given a feature folder — folders in this audit are keyed to tracker ideas only.
- `docs/qa/BROWSER_QA_RESULTS.md` has no entries newer than 2026-08-01 for any of the six `tab-unproven` features; a human browser pass across Finance, Inductions, Resource Library, WHODAS/Assessment, FCA/Letter/Templates and the Snapshot modal would clear most of this tracker's open items in one sitting.
