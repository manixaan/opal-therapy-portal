# Nightly tracker audit — 2026-11-01

**Status:** RAN — 2026-11-01, 18:58 UTC. Commit audited: `b770207` (develop).

Counts: proven 1 · needs-refinement 3 · broken 1 · tab-unproven 6 · untouched 2 · built-untested 0. (13 features)

## Do this first

1. **Fix the Outlook categories error leak** (`broken`). `GET /api/outlook/categories` returns the raw internal error message when a user has no Outlook connection, and nothing tests it. Unfixed despite a full week of work on the surrounding sync code.
2. **Add a test for leave/CPD approval in My Profile** (`needs-refinement`, employee-sensitive). The owner approve/reject workflow for leave and professional-development requests (`/api/profile/leave*`, `/api/profile/cpd*`) has zero test coverage anywhere in the repo.
3. **Finish the dynamic employee contract in onboarding Stage 2** (`needs-refinement`). The contract generator is still a static "junior OT" template rather than pulling from the Letter of Offer, even though the rest of onboarding Stage 2/3 shipped this week.
4. **Confirm the Finance tab in a browser** (`tab-unproven`, biggest tracker/evidence gap). A mature, 86-test-passing, owner-gated Xero payroll sync and dashboard exists; the tracker still says "idea" and nobody has opened the tab.
5. **Correct the Inductions tracker note and confirm in a browser** (`tab-unproven`). The tracker's own note says "Splose Inductions has no code at all yet" — that's wrong, it's built and tested; all three induction surfaces just need a browser/E2E check.

(No feature in this snapshot claims more maturity than the evidence shows — every disagreement this run goes the other way: a card still marked "idea" while the code is already built and tested.)

## Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Owner-gated Xero/payroll sync + Finance tab; fully tested, never confirmed in a browser | 86/86 pass |
| Update Opal Docs Register | idea | untouched | External Excel/SharePoint job, no portal code expected | none |
| Report Templates | idea | tab-unproven | FCA/Progress Letter/Client Agreement doc engine fully tested; no wizard confirmed in a browser | 120/120 pass (3 itest files, run individually) |
| Password Master Document | idea | untouched | External OneDrive doc, needs its own scoped card before any code | none |
| Opa Mobile Companion | idea | proven | Case Noting + Calendar View guarded, AI-gateway-compliant, tested; addressed this window | 83/83 unit + 10/10 integration pass |
| Interactive Assessments | idea | tab-unproven | WHODAS engine fully tested and guarded; never confirmed in a browser | 81/81 pass |
| Employee Personal Page (My Profile Tab) | idea | needs-refinement | Documents/credentials/work-schedule proven; leave + CPD approval untested anywhere | 66 pass; leave/CPD: none |
| Automated Reminders | idea | tab-unproven (split) | Therapist Snapshot built+tested, never browser-confirmed; client appt reminders untouched (no code at all) | Snapshot 6/6 pass; reminders: none |
| Professional Development | idea | needs-refinement | Self-logged CPD tracker proven; owner approve/reject workflow (shared with My Profile) untested | 33 pass; approval: none |
| Inductions | idea | tab-unproven | All three surfaces (Playground, Portal, Splose) built and tested; none confirmed in a browser; tracker wrongly says Splose has no code | 84/84 pass |
| Clinical resources | idea | tab-unproven | Resource Hub Library rebuilt and tested this window; browser QA entry predates the rebuild by 2 months | 398+122/122 pass |
| Portal Onboarding Workflow | idea | needs-refinement | Heaviest-built subsystem this window; Stage 1 solid, Stage 2 contract genuinely incomplete; one unrelated OCR-package test failure | 35/36 pass (1 env-only fail) |
| Portal - Splose - Outlook \| Integration Works | idea | broken | Outlook categories endpoint leaks error detail with zero test coverage; rest of the heavily-worked subsystem passes | 273/273 unit pass; 1 itest false-fail on rerun, true pass alone |

## Prompts for the morning

**1. `/opal-fast-change`**
Fix the Outlook-categories error leak in `backend/routes.js` (`GET /api/outlook/categories`, ~line 1487): when `getValidAccessToken(user)` throws because the user has no Outlook connection, return a clean "not connected" response instead of `res.status(500).json({ error: ..., details: err.message })`. Add a test to `backend/tests/` covering both the connected and not-connected paths. Done when that new test passes and no route leaks `err.message`.

**2. `/opal-critical`**
Add an integration test for the leave and professional-development approve/reject round trip in My Profile (`backend/profile-routes.js`, routes `/api/profile/leave*` and `/api/profile/cpd*`; UI in `frontend/current/profile.js` / `mockup_v3.html` `PROFILE TAB`). Follow the pattern in `tests/integration/resource-hub-r2.itest.js` (the sibling CPD system) or `tests/integration/documents.itest.js`. Done when `tests/integration/<new-file>.itest.js` passes and exercises submit → owner approve → owner reject → employee sees updated status.

**3. `/opal-critical`**
Make the onboarding Stage 2 employee contract dynamic: have `backend/onboarding-contract-docx.js` pull from the employee's actual Letter of Offer data instead of the current static "junior OT" template. Check `backend/onboarding-offer-template.js` for the pattern already used for the Letter of Offer. Done when `tests/onboarding-contract-docx.test.js` (and a new test for the dynamic-fill case) passes.

**4. `/opal-critical`**
Open the Finance tab (`frontend/current/mockup_v3.html`, `FINANCE TAB (owner-only)` ~line 5500) as Owner with a Xero sandbox connected, walk Dashboard → Payroll → Invoicing, and record a dated row in `docs/qa/BROWSER_QA_RESULTS.md` (or add an `e2e/tests/` spec). The backend (`backend/accounting-routes.js`, `backend/xero-payroll-*.js`) already passes 86 tests — this is a confirmation task, not a build task. Done when the new BROWSER_QA_RESULTS.md row (or E2E spec) is in place and the Finance tab's evidence label can move to `proven`.

**5. `/opal-feature`**
Open the Induction Playground, Portal Inductions and Splose Inductions (`frontend/current/induction*.js`, backed by `backend/learning-routes.js` lines ~649-748 and `backend/induction-assistant-routes.js`) in a browser and record what you see in `docs/qa/BROWSER_QA_RESULTS.md` (or add an E2E spec). The code for all three is already built and tested (84 passing tests, including `tests/induction-registry.test.js:186` "the Splose induction group") — the tracker's claim that Splose Inductions has no code is incorrect and can be corrected once this browser check lands.

## Ideas without a start

Every feature folder under `docs/qa/nightly/features/` was created tonight — this is the first run of the nightly audit in this repository, so there is no prior-night baseline to diff against. Thirteen folders were created; twelve carry a full `START.md` starter prompt (the thirteenth, Opa Mobile Companion, is `proven` so its `START.md` is the two-line "already proven" form). Two folders (`update-opal-docs-register`, `password-master-document`) describe work with no portal code and are documented as such rather than given a coding starter prompt.

## What changed since last audit

First run — window taken as the last 14 days (2026-10-18 to 2026-11-01), 48 commits touching `backend/` or `frontend/current/`, grouped by subsystem:

- **Onboarding** (12 commits, 2026-10-19 & 2026-10-22) — first-login wizard, Stage 2/3 through the portal, owner-only activation, permission-tiered audited profile, Graph-mail fix. Covered by *Portal Onboarding Workflow*.
- **Travel / calendar sync / Splose / Outlook** (13 commits, 2026-10-22 to 2026-10-30) — traffic-aware travel, desk-work scheduling, Splose auto-sync reset fix, Outlook webhook token decryption, Calendar sync settings, Splose reconcile. Covered by *Portal - Splose - Outlook | Integration Works*.
- **Resource Hub / document library** (7 commits, 2026-10-19 to 2026-10-25) — SharePoint-style library rebuild, privacy-refusal messaging, AI Resource Studio removed. Covered by *Clinical resources*.
- **Case notes / mobile** (4 commits, 2026-10-30) — editable note + Copy/Download PDF, approval-on-edit fix, phone diary matches portal calendar. Covered by *Opa Mobile Companion*.
- **Booking "Make room"** (5 commits, 2026-10-24/25) — shorten flexible blocks, Split evenly, category-aware judgement. **No tracker feature covers this** — it's a substantial scheduling feature with no card.
- **Email infrastructure** (2 commits, 2026-10-19/22) — send through Microsoft Graph, Sent Items fix. **No tracker feature covers this** — supporting infrastructure, not itself a product feature, but worth a card if more work is planned here.
- **Dependency security patches** (4 commits) — follow-redirects, qs/express, body-parser/nodemailer. Routine maintenance, no feature impact observed.

## Technical detail

**Setup.** PostgreSQL was down at session start (`service postgresql status` → down) and was started per the audit's own setup step; no other environment issue.

**Tracker fetch.** `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → `fetch-tracker: 13 features, 19 tasks`. Succeeded on the first attempt.

**Verification.** Delegated to four parallel sub-agents by subsystem, each running only the targeted unit/integration tests named in its STATUS.md and writing that feature's `STATUS.md`/`START.md` directly. No full suite was run per feature (per the testing policy).

**Cross-file state bleeding in integration tests — worth a backlog item.** Running `fca-reports.itest.js`, `progress-note-letters.itest.js`, `templates.itest.js`, `whodas.itest.js` and `assessments.itest.js` together in one `jest --runInBand` invocation produced 13 spurious failures (401-vs-409, missing audit rows, an immutability trigger not firing); every one of those files passes 100% run alone. The same pattern showed up on a smaller scale in the Splose/Outlook batch (`outlook-delta-preserve.itest.js` failed in a 9-file batch, passed 11/11 alone). **This means the weekly full `npm run test:integration` run below should be read with real suspicion of false failures** — a file reported as failing there has not been independently confirmed broken unless it also failed when run alone.

**Weekly deep run (today is Sunday UTC) — both complete suites run once, in full, as required.**

- `npm test` (complete unit suite): **173 passed, 1 failed, 174 total** test suites; **5240 passed, 12 skipped, 1 failed, 5253 total** tests. The one failure is `tests/onboarding-document-reader.test.js` → `Cannot find module '@tesseract.js-data/eng/package.json'` — a missing OCR language-data package in this sandbox, not a code regression (confirmed independently by the onboarding sub-agent, which saw the same failure in isolation and 14/15 other tests in that file passing).
- `DB_NAME=therapy_scheduler_weekly DB_PASSWORD=audit npm run test:integration` (complete integration suite, all 76 files, one `--runInBand` process, ~31 minutes): **75 passed, 1 failed, 76 total** test suites; **1189 passed, 1 failed, 1190 total** tests. The one failure is `tests/integration/readonly-and-hardening.itest.js` → "D-6/D-7: storage failure behaviour ... write failure → 5xx with NO orphaned row" — the test simulates an unwritable storage directory with `fs.chmodSync(dir, 0o000)` and expects the next write to fail with ≥500; it got `201` instead. This session runs as `root` (`whoami` confirmed), and the kernel does not enforce permission bits against root, so the simulated write-failure never actually fails here — **a sandbox/environment artifact, not a code regression.** It would need re-checking in an environment that runs as a non-root user to be a real signal either way.
- No other failures in either complete suite. The cross-file state-bleeding pattern flagged above (small hand-picked batches of itest files run together) did **not** reproduce across the full, naturally-ordered 76-file run — worth noting as a data point for that backlog item, not a contradiction of it.

**Open questions for the team.**
- Should "Booking (Make room)" and "Email infrastructure (Microsoft Graph)" get their own tracker cards, given the amount of live work going into them with no card to track it?
- Is the cross-file integration-test state bleeding (above) worth its own investigation ticket, independent of tonight's audit?
