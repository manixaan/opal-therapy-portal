# Nightly tracker audit — 2026-11-07

## 1. Status line

**RAN** — 2026-11-07T18:00–18:27 UTC, commit `1fd6157` on `develop`.

Counts: **proven 5** · **tab-unproven 3** · **built-untested 2** · **needs-refinement 1** · **untouched 2** · **broken 0** (13 features total).

This is the first run of this audit found in `docs/qa/nightly/` (only a `README.md` existed), so the change window is the last 14 days rather than "since the last audit." The Opal Development Manager tracker itself already carried a `claude_update` on the Xero card dated 2026-11-06 referencing a prior nightly run — that run's output is not in this repository, so tonight's findings were built independently rather than diffed against it.

## 2. Do this first

1. **Automated Reminders — the card's own idea has no code.** "24Hr Automatic Client Appt Reminders" is the headline idea, but nothing in the codebase sends a client-facing appointment reminder. The only thing built under this card is `snapshot-routes.js`, a therapist's personal daily task list — a different feature entirely. See `docs/qa/nightly/features/automated-reminders/`.
2. **Professional Development and Employee Personal Page (My Profile Tab) look like duplicate cards.** Both point at the same CPD code in `backend/profile-routes.js`, and neither has a single automated test. Worth merging the cards or giving them distinct scope, and either way `backend/tests/profile-routes.test.js` does not exist yet.
3. **Xero Integration Works — tab-unproven.** Finance/Accounting/Payroll is owner-gated and passes 116 tests, but no run here has ever reached a real Xero sandbox; the integration suite logs "xero offline in test" throughout.
4. **Report Templates — tab-unproven.** FCA, Progress Letter and Client Agreement Form generation pass 689 tests and are guarded, but no E2E spec or browser QA entry proves a user can open the Resource Hub → Templates screen and actually generate a document.
5. **Interactive Assessments — tab-unproven.** The assessment overlay passes 154 tests and is guarded, but nothing proves it opens and completes in a real browser.

No `broken` findings tonight — every located route is guarded and every targeted test that was run passed.

## 3. Every feature

| Feature | Tracker stage | Evidence label | One-line reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Owner-gated, 116 tests pass, no live Xero sandbox ever exercised | 77 unit + 39 integration pass |
| Update Opal Docs Register | idea | untouched | An Excel sheet kept outside the portal; nothing to locate | none |
| Report Templates | idea | tab-unproven | FCA/Letter/Templates guarded and pass 689 tests, no browser proof of the tab itself | 569 unit + 120 integration pass |
| Password Master Document | idea | untouched | Describes an external OneDrive document; nothing to locate | none |
| Opa Mobile Companion | idea | proven | Self-scoped API guard, 50 unit tests pass; the mobile app's own UI is outside this repo | 50 unit pass |
| Interactive Assessments | idea | tab-unproven | Guarded, 154 tests pass, no browser proof the overlay opens/completes | 126 unit + 28 integration pass |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Guarded (canApprove), renders per browser QA, zero automated tests | none |
| Automated Reminders | idea | needs-refinement | Therapist Snapshot built and tested; the card's own client-reminder idea is unbuilt | 6 integration pass (Snapshot only) |
| Professional Development | idea | built-untested | Same untested CPD code as Employee Personal Page; likely a duplicate card | none |
| Inductions | idea | proven | Guarded, 288 tests pass, e2e proves full learner flow end to end | 223 unit + 65 integration pass |
| Clinical resources | idea | proven | Maps onto the existing, already-production Resource Hub | 65 unit pass (sampled) |
| Portal Onboarding Workflow | idea | proven | Permission-gated, 299 tests pass, browser QA proves the onboarding flow | 203 unit + 96 integration pass |
| Portal - Splose - Outlook \| Integration Works | idea | proven | Guarded, actively maintained this window, browser QA + e2e confirm boundaries | 203 unit + 96 integration pass (shared run) |

## 4. Prompts for the morning

**1. Automated Reminders**
```
/opal-feature
Decide where client-facing appointment reminders should send from (email via the
existing mailer, or Outlook) and build a new scheduled job for them — there is
nothing to extend in backend/snapshot-routes.js, which only serves the
therapist's own personal task list. Look at backend/credential-reminder.js for
the house pattern on a reminder job (schedule, dedupe, audit), then write the
client-facing equivalent as a new file, e.g. backend/appointment-reminder.js.
Done means: a new test proves a reminder is generated ~24 hours before a booked
appointment and not duplicated.
```

**2. Professional Development / Employee Personal Page (My Profile Tab)**
```
/opal-critical
backend/profile-routes.js (Leave requests, CPD/professional development
activities and documents, Credentials) has no backend/tests/profile-routes.test.js
at all, despite guarding leave approval with an inline canApprove(owner/admin)
check. Add that test file (supertest against the mounted router, the pattern in
case-note-routes.test.js) covering: a therapist managing only their own leave/CPD,
and an owner/admin approving/rejecting someone else's — assert the 403 path, not
only the happy path. Also flag to the team that "Professional Development" and
"Employee Personal Page (My Profile Tab)" appear to be the same underlying card.
```

**3. Xero Integration Works**
```
/opal-critical
Open the Finance tab (frontend/current/finance.js) as an Owner with a real Xero
sandbox connected via backend/accounting-routes.js's OAuth callback, and confirm
backend/finance-routes.js's profit-and-loss and recurring-invoice calls succeed
instead of logging "xero offline in test". Follow tests/integration/finance-routes.itest.js
for the request shapes, then add one integration test asserting a populated
dashboard payload.
```

**4. Report Templates**
```
/opal-critical
Add a Playwright spec under e2e/tests/ that logs in as a therapist, opens the
Resource Hub -> Templates surface in frontend/current/mockup_v3.html's RESOURCES
TAB block, picks a client, generates an FCA report or progress letter, and
asserts the resulting document download. Copy the login/role setup from
e2e/tests/tutorials.spec.js. Add the result to docs/qa/BROWSER_QA_RESULTS.md.
```

**5. Interactive Assessments**
```
/opal-critical
Add a Playwright case that opens a client's Assessment Review from the client
workspace, loads frontend/current/assessment.js's full-page surface, answers an
instrument, and asserts the saved result. Use backend/tests/assessment-surface-guards.test.js
to see which endpoint triggers the overlay. Add the result to
docs/qa/BROWSER_QA_RESULTS.md.
```

## 5. Ideas without a start

Every feature folder under `docs/qa/nightly/features/` was created tonight (this is the first run). Five became `proven` and got a two-line START.md instead of a starter prompt: Opa Mobile Companion, Inductions, Clinical resources, Portal Onboarding Workflow, and Portal - Splose - Outlook | Integration Works. The other eight kept a full starter prompt — see "Prompts for the morning" above for the five most urgent, and `docs/qa/nightly/features/README.md` for the rest (Update Opal Docs Register, Password Master Document).

## 6. What changed since last audit (14-day window)

Grouped by subsystem, from `git log --since=14.days.ago -- backend frontend/current` (41 commits):

- **AI gateway / Opal Assist** (largest group): request queue for Bedrock concurrency (`1fd6157`), de-identification history cleanup (`27f324d`), composer rebuild with attachments/dictation/context ring (`cd8c4a8`), reply-shape auto-detection (`8853376`), night mode + per-client chats + AI mark animation (`22f58c1`, `5671dff`, `a5a6607`, `a069b78`, `1d7d1e0`). None of these map to a tracker feature in tonight's snapshot — Opal Assist has no card at all.
- **Calendar / booking / travel**: block-review classifier for unclassified Outlook/Splose events (`3c85f54`, `e3c0b90`), night-mode calendar contrast (`704a51f`), Make room block-shortening (`ac4912e`, `c86355b`, `58f3fec`, `94dad51`), travel traffic/desk-work (`08da79d`, `6a124db`), maps picker naming (`26ae223`, `75eae1e`). No tracker card covers Calendar/Booking/Travel either.
- **Splose/Outlook sync**: covered under "Portal - Splose - Outlook | Integration Works" above (`971cac1`, `11aa73f`, `ab75330`, `0a365c4`).
- **Case notes**: editable note + Copy/Download PDF (`22e68b7`), approval-on-edit fix (`a56173c`), approval-notice revert (`dc5dbc4`). No tracker card for Case Notes.
- **Dependency patches**: `follow-redirects`, `qs`/`express`, `body-parser`/`nodemailer` security advisories (`b770207`, `15acf0c`, `0628bda`).
- **Mobile**: phone diary matching the portal calendar (`e1af24e`) — relevant to Opa Mobile Companion, just outside the 14-day window by one day.

Subsystems with real activity but no tracker card at all: **Opal Assist (AI)**, **Calendar/Booking/Travel**, **Case Notes**. Worth asking whether those should get cards so future nightly runs have something to audit them against.

## 7. Technical detail

**Setup**
- `backend/node_modules/.bin/jest` present; PostgreSQL `16/main` already online.
- Tracker fetch: `fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json` (no errors).
- Change window: no prior `docs/qa/nightly/YYYY-MM-DD.md` existed, so used the last 14 days per the first-run rule.

**Commands run (all from `backend/`)**
```
npx jest tests/finance-flags.test.js tests/finance-routes.test.js tests/onboarding-payroll.test.js \
  tests/xero-payroll-api.test.js tests/xero-payroll-mapping.test.js tests/xero-payroll-sync.test.js
  → 6 suites, 77 passed

DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js \
  tests/integration/accounting-phase2.itest.js tests/integration/accounting-routes.itest.js \
  tests/integration/finance-routes.itest.js tests/integration/onboarding-payroll-xero.itest.js --runInBand
  → 4 suites, 39 passed

npx jest tests/fca-docx-engine.test.js tests/fca-frontend-helpers.test.js tests/fca-preview-lifecycle.test.js \
  tests/fca-preview-pages.test.js tests/fca-resolve-scalars.test.js tests/fca-wizard-behaviour.test.js \
  tests/letter-docx-engine.test.js tests/letter-frontend-helpers.test.js tests/letter-template-map.test.js \
  tests/templates-service-agreement-map.test.js tests/templates-appendices.test.js \
  tests/templates-export-boundary.test.js tests/templates-frontend-guards.test.js tests/templates-routes.test.js
  → 14 suites, 569 passed

DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js \
  tests/integration/fca-reports.itest.js tests/integration/progress-note-letters.itest.js \
  tests/integration/templates.itest.js --runInBand
  → 3 suites, 120 passed

npx jest tests/mobile-routes.test.js  → 1 suite, 50 passed
DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js \
  tests/integration/snapshot.itest.js --runInBand  → 1 suite, 6 passed

npx jest tests/assessment-catalogue.test.js tests/assessment-surface-guards.test.js  → 2 suites, 126 passed
DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js \
  tests/integration/assessments.itest.js --runInBand  → 1 suite, 28 passed

node --check profile-routes.js  → OK (no automated test exists for this file)

npx jest tests/assign-learning-guards.test.js tests/learning-admin-routes.test.js tests/learning-content.test.js \
  tests/learning-routes.test.js tests/induction-assistant.test.js tests/induction-registry.test.js
  → 6 suites, 223 passed
DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js \
  tests/integration/learning-admin.itest.js tests/integration/learning.itest.js \
  tests/integration/induction-assistant.itest.js tests/integration/onboarding-induction.itest.js --runInBand
  → 4 suites, 65 passed

npx jest tests/resource-hub-final.test.js  → 1 suite, 65 passed (sampled; many more resource-*.test.js exist)

npx jest tests/onboarding-workflow-guards.test.js tests/onboarding-journey-frontend-guards.test.js \
  tests/sync-preferences.test.js tests/sync-safety.test.js tests/sync-status-route.test.js tests/sync.test.js
  → 6 suites, 203 passed
DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js \
  tests/integration/onboarding-workflow.itest.js tests/integration/sync-settings.itest.js --runInBand
  → 2 suites, 96 passed
```
No complete-suite command (`npm test`, `npm run test:integration`, `npm run test:all`, E2E) was run — today is Saturday, not the Sunday deep-run window, and FEATURE/CRITICAL-level targeted testing is the ceiling for a nightly run regardless.

**Could not locate**
- A dedicated `service-agreement-routes.js` named in `CLAUDE.md`'s repository map does not exist; the Client Agreement Form lives inside `templates-routes.js`'s generic document engine instead (see `tests/templates-service-agreement-map.test.js`). `CLAUDE.md` may be slightly stale on this point.
- No code anywhere implements client-facing automatic appointment reminders (Automated Reminders' own stated idea).
- No frontend page for Opa Mobile Companion inside this repository — the mobile client app is external.

**Open questions for the team**
- Should "Professional Development" and "Employee Personal Page (My Profile Tab)" be merged into one card?
- Should "Therapist Snapshot" move out of "Automated Reminders" into its own card, since it is unrelated to client appointment reminders?
- Should Opal Assist, Calendar/Booking/Travel, and Case Notes get tracker cards, given how much of the 14-day change window landed in those three subsystems with no card to audit them against?
- Is `sync-settings-routes.js` really what "Multi Calendar Rules" refers to, or is there a different, not-yet-built feature behind that task name?

**Write-back to the tracker**:
```
NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json
→ post-tracker: 13 features posted, 0 already posted tonight, brief posted
```
