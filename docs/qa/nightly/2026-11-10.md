# Nightly tracker audit — 2026-11-10

## 1. Status line

**RAN** — 2026-11-10T18:12 UTC onward, commit `40669e7` on `develop`.

Counts: **proven 5** · **tab-unproven 4** · **built-untested 1** · **needs-refinement 1** · **untouched 2** · **broken 0** (13 features total).

One commit landed on `develop` since last night's audit (`34cf881` → `40669e7`): "feat(booking): Travel block booking type; drop Local/Remote home bases; client name in event panel." It lands entirely inside the already-`proven` "Portal - Splose - Outlook | Integration Works" card (the Smart Booking/calendar surface) and, for one small piece (the retired Local/Remote home-base picker), inside "Employee Personal Page (My Profile Tab)". Both were re-verified against the new code tonight — see §2 and §7. Every other feature was independently re-observed as well: every targeted unit and integration test file below was actually re-run tonight (not copied from last night's numbers), and every guard was re-confirmed by re-reading the relevant handler. All results matched last night's exactly, with one pleasant difference: the resource-library integration suite's `deadlock detected` flake, seen two nights running, did not reproduce tonight — ran clean on the first try.

## 2. Do this first

1. **Travel block booking type has no browser/E2E proof yet.** The server-side rule (`booking-rules.js`, both ends required) and the frontend module (`travel-block.js`, address autocomplete → Google Maps route → block length) are both unit/jsdom-tested tonight and pass (115 new/changed test cases across `booking-rules.test.js`, `travel-block-frontend.test.js`, `assessment-surface-guards.test.js`), but nothing proves a real user can pick "Travel block" in the Smart Booking panel in an actual browser and see it land on the calendar. Worth a quick manual check or an E2E addition before relying on it operationally.
2. **Automated Reminders — the card's own idea has no code.** Unchanged from last night: the tracker's idea is a 24-hour client appointment reminder; only the unrelated, already-built "Therapist Snapshot" exists.
3. **"Professional Development" is still genuinely ambiguous.** Unchanged — two unrelated subsystems could be meant; worth a two-minute clarification in the tracker.
4. **Employee Personal Page (My Profile Tab) — zero automated backend tests, and tonight's home-base change landed into that gap.** The Local/Remote picker retirement in `profile.js` is only source-checked by `travel-block-frontend.test.js`, not by any `profile-routes` test — there is still no `backend/tests/profile-routes.test.js` covering the Work Schedule API itself.
5. **Xero Integration Works — tab-unproven.** Unchanged: owner-gated, all tests pass, but no run has ever reached a real Xero sandbox.

No `broken` findings tonight — every located route is guarded (including the new travel-block path, which correctly refuses `read_only`/`pre_employee` accounts and a route with a missing address) and every targeted test that was run passed.

## 3. Every feature

| Feature | Tracker stage | Evidence label | One-line reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | proven | Guarded (incl. the new travel-block rule); e2e + browser QA confirm the tab's existing boundaries; the new booking type itself is only unit-proven | 324 unit + 104 integration pass |
| Portal Onboarding Workflow | idea | proven | Permission-gated (`onboarding.*`), browser QA proves the flow; zero commits this window | 653/654 unit (1 env-only fail) + 218 integration pass |
| Clinical resources | idea | proven | Maps onto the existing, already-production Resource Hub; zero commits this window | 454/466 unit (12 pre-existing skips) + 168/168 integration pass (clean, no flake tonight) |
| Inductions | idea | proven | Guarded, e2e proves full learner flow; zero commits this window | 539 unit + 212 integration pass (combined run, shared with Xero/Mobile) |
| Professional Development | idea | tab-unproven (ambiguous card) | Two possible readings; under either, no browser proof of the page itself | 46 unit pass (Resource Hub PD catalogue reading) |
| Automated Reminders | idea | needs-refinement | Snapshot built and tested; the card's own client-reminder idea is unbuilt | passes within the combined 212-test integration run (Snapshot only) |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Guarded (owner-only approvals), renders per browser QA; tonight's home-base change is source-checked only, no `profile-routes` test exists | none (profile-routes); source check only via travel-block-frontend.test.js |
| Interactive Assessments | idea | tab-unproven | Guarded, all tests pass, no browser proof the overlay opens/completes | 738 unit + 122 integration pass |
| Opa Mobile Companion | idea | proven | Self-scoped guard re-verified by query-level grep | passes within the combined 539/212 run |
| Password Master Document | idea | untouched | Describes an external OneDrive document; nothing to locate | none |
| Report Templates | idea | tab-unproven | Guarded, tests pass, no browser proof of the tab itself | 369 unit + 82 integration pass |
| Update Opal Docs Register | idea | untouched | Describes an external Excel register; nothing to locate | none |
| Xero Integration Works | idea | tab-unproven | Owner-gated, fails closed by design, no live Xero sandbox ever exercised | passes within the combined 539/212 run |

## 4. Prompts for the morning

**1. Prove the Travel block booking type in a browser**
```
/opal-feature

Idea: Portal - Splose - Outlook | Integration Works (task: Multi Calendar Rules)
Why: (not yet written in the tracker)
Who uses it: (not yet written in the tracker)
What they see: (not yet written in the tracker)
What should happen: (not yet written in the tracker)
Outcome: (not yet written in the tracker)
(No recorded decisions.)

Where it lives today: backend/booking-rules.js (server-side rule, both ends required),
frontend/current/travel-block.js (panel logic: address autocomplete, Google Maps route,
block length), wired into frontend/current/mockup_v3.html's Smart Booking panel. Fully
unit/jsdom-tested tonight (backend/tests/booking-rules.test.js,
backend/tests/travel-block-frontend.test.js) but never exercised in a real browser.

Start here: Log in to the Calendar tab, open Smart Booking, pick "Travel block", enter a
start and end address, and confirm the Google Maps round-trip sets a sensible duration and
the resulting tile shows up correctly (category Travel, correct length). Add either a
Playwright spec (copy the login/booking pattern in e2e/tests/portal.spec.js) or a
docs/qa/BROWSER_QA_RESULTS.md entry recording what you saw.

Done means: An E2E spec or a BROWSER_QA_RESULTS.md entry proves the Travel block type can be
booked end to end in a real browser.

Tracker: eba1c6a7-3ba4-420f-acf4-1c5838991138
```

**2. Automated Reminders**
```
/opal-feature

Idea: 24Hr Automatic Client Appt Reminders
Why: (not yet written in the tracker)
Who uses it: (not yet written in the tracker)
What they see: (not yet written in the tracker)
What should happen: (not yet written in the tracker)
Outcome: (not yet written in the tracker)
(No recorded decisions.)

Where it lives today: Nothing for the client-facing reminder itself. backend/snapshot-routes.js
is a different, already-built feature (a therapist's own personal daily task/reminder list,
self-scoped, guarded, tested) — there is nothing in it to extend for a client-facing reminder.

Start here: Decide where client-facing appointment reminders should send from (email via the
existing mailer, or Outlook/SMS). Look at backend/credential-reminder.js for the house pattern
on a reminder job (pure decide() function, surfaced via a notification-bell sync, no cron of
its own). Write the client-facing equivalent as a new file, e.g. backend/appointment-reminder.js,
scheduled the way backend/server.js's existing setInterval jobs are scheduled.

Done means: A new test proves a reminder is generated ~24 hours before a booked appointment and
not duplicated on a second run.

Tracker: 398a0b36-a12f-4190-83e4-b3a8932b3b46
```

**3. Professional Development (clarify first)**
```
/opal-feature

Idea: Professional Development
Why / Who uses it / What they see / What should happen / Outcome: (not yet written in the tracker)
(No recorded decisions.)

Where it lives today: Ambiguous — two candidates. (1) The Resource Hub's own "Professional
development" catalogue page (frontend/current/resourcehub.js, guarded, 46 passing tests, no
browser proof it opens). (2) The Profile tab's CPD section (backend/profile-routes.js lines
204-320) — likely the same thing "Employee Personal Page" already covers.

Start here: First, in the Development Manager, clarify which of the two above this card means
(or merge it with "Employee Personal Page" if it's (2)). If (1): add a Playwright or manual QA
step that opens Resource Hub → Professional development and confirms the list renders and a
filter works — copy the login/navigation pattern from e2e/tests/portal.spec.js's Resource Hub
test. If (2): use the Employee Personal Page starter prompt instead — don't duplicate that work.

Done means: For reading (1), a Playwright spec or docs/qa/BROWSER_QA_RESULTS.md entry proving
the page renders in a browser.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
```

**4. Employee Personal Page (My Profile Tab)**
```
/opal-critical

Idea: Employee Personal Page (My Profile Tab)
Why / Who uses it / What they see / What should happen / Outcome: (not yet written in the tracker)
(No recorded decisions.)

The tracker's one task, "Review Portal Structure", says: "This is a hands-on testing job, not
a documentation job. You will walk through every part of the My Profile tab and click every
button to confirm each one works. You will also test the parts that connect to the owner
portal, like leave and professional development approval, to confirm both sides talk to each
other. No note-taking or written report is needed."

Where it lives today: backend/profile-routes.js (Leave, CPD, documents, Credentials, work
schedule, notifications) and frontend/current/profile.js / the Profile tab in mockup_v3.html.
Guarded (inline canApprove, owner-only for approvals). Tonight's commit (40669e7) retired the
Local/Remote home-base picker in profile.js — source-checked by
backend/tests/travel-block-frontend.test.js, but the backend route file itself still has zero
automated test coverage.

Start here: Add backend/tests/profile-routes.test.js (supertest against the mounted router,
the pattern in case-note-routes.test.js). Cover: a therapist managing only their own
leave/CPD/documents (403 on someone else's), an owner approving/rejecting a request for a
different user while admin is correctly refused, and the work-schedule endpoint's home-base
save/load round trip now that Local/Remote no longer exists. Assert the 403 path, not only the
happy path.

Done means: backend/tests/profile-routes.test.js exists and passes, covering the guard
boundaries (still needs an E2E/browser proof beyond the existing render-only check for full
"proven", otherwise "tab-unproven").

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
```

**5. Xero Integration Works**
```
/opal-critical

Idea: Xero Integration Works
Why / Who uses it / What they see / What should happen / Outcome: (not yet written in the tracker)
(No recorded decisions.)

Where it lives today: backend/accounting-routes.js, backend/finance-routes.js,
backend/invoicing-routes.js, the xero-*.js layer, and frontend/current/finance.js plus the
owner-only Accounting/Finance/Invoicing/Billing tabs. Owner-gated, all unit and integration
tests pass, fails closed when Xero isn't connected. Only a real Xero sandbox connection is
unproven.

Start here: Open the Finance tab (frontend/current/finance.js) as an Owner with a real Xero
sandbox connected via backend/accounting-routes.js's OAuth callback, and confirm
backend/finance-routes.js's profit-and-loss and recurring-invoice calls succeed instead of
logging "xero offline in test". Follow tests/integration/finance-routes.itest.js for the
request shapes, then add one integration test asserting a populated dashboard payload.

Done means: An integration test proves a populated dashboard payload from a real (or
realistically mocked) Xero sandbox connection, and a browser QA entry records the owner's live
view.

Tracker: 3d5da727-ee76-4195-8954-2a6486844d77
```

## 5. Ideas without a start

None tonight — every feature already has a `START.md` from prior nights, and only the already-`proven` "Portal - Splose - Outlook" card's `START.md` changed content (updated test counts and the new travel-block caveat); it stays a two-line proven note.

## 6. What changed since last audit

**1 commit** on `develop` (`34cf881` → `40669e7`), all under `backend/` and `frontend/current/`:

- **Booking / Calendar** (feat): `40669e7` — adds a billable Travel block booking type (`backend/booking-rules.js`, `frontend/current/travel-block.js`), retires the Local/Remote home-base picker (`frontend/current/profile.js`), and makes the event detail panel prefer the event row's `client_name` (`frontend/current/mockup_v3.html`). Maps onto "Portal - Splose - Outlook | Integration Works" (primary) and "Employee Personal Page (My Profile Tab)" (the home-base piece only). No subsystem changed tonight that lacks a tracker feature.

## 7. Technical detail

**Setup**: `backend/node_modules` present (verified `ls backend/node_modules/.bin/jest`). PostgreSQL was down at session start (`service postgresql status` → `16/main (port 5432): down`) and was started with `service postgresql start` per the runbook; came up clean. Tracker snapshot fetched successfully: `NODE_USE_ENV_PROXY=1 SUPABASE_URL=... node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → "13 features, 19 tasks". Last audit date found from the `claude/nightly-audit` branch's `docs/qa/nightly/` (not `develop`, which carries no dated briefs — this branch is where the nightly docs actually accumulate): newest was `2026-11-09.md`, auditing commit `34cf881`. Change window = `34cf881..HEAD` on `develop` (one commit, `40669e7`), not the 14-day fallback, since a genuine last-audit date was found.

**Commands run tonight** (all targeted — no complete suite):
- `npx jest tests/booking-rules.test.js tests/travel-block-frontend.test.js tests/assessment-surface-guards.test.js` → 115/115 pass.
- `npx jest` across the 19 pre-existing Splose/Outlook/calendar unit files + the 2 new ones (22 total) → 324/324 pass.
- `DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js` across the 10 Splose/Outlook/calendar integration files → 104/104 pass (~51s).
- Resource Hub + Professional Development unit group (14 files) → 454/466 pass, 12 pre-existing skips, matches last night exactly.
- Inductions + Interactive Assessments + Opa Mobile Companion + Xero unit group (28 files) → 1195/1195 pass.
- Report Templates unit group (9 files) → 369/369 pass.
- Portal Onboarding Workflow unit group (27 files) → 653/654 pass (1 known environment-only failure: `Cannot find module '@tesseract.js-data/eng/package.json'` — the package is declared in `backend/package.json` but absent from `backend/node_modules` in this sandbox; did not run `npm ci`/`npm install`, which are out of scope for this audit).
- Interactive Assessments integration group (3 files, isolated DB `therapy_scheduler_audit_g1_test`) → 122/122 pass.
- Report Templates integration group (2 files, isolated DB `therapy_scheduler_audit_g2_test`) → 82/82 pass.
- Portal Onboarding Workflow integration group (10 files, isolated DB `therapy_scheduler_audit_g3_test`, ~357s) → 218/218 pass.
- Combined Xero + Inductions + Opa Mobile Companion + Automated Reminders integration group (17 files, isolated DB `therapy_scheduler_audit_g6_test`, ~156s) → 212/212 pass.
- Resource Hub integration group (7 files, isolated DB `therapy_scheduler_audit_g5_test`, ~117s) → 168/168 pass, clean — the `resource-library.itest.js` `deadlock detected` flake seen on 2026-11-08 and 2026-11-09 did not reproduce tonight.
- `node --check backend/booking-rules.js backend/block-review.js` → clean. Repo-wide grep for `TODO`/`FIXME` in the three files touched by tonight's commit → none.
- `node scripts/check-asset-pins.js` → "Every pin matches the shell this commit would ship" (confirms `profile.js?v=13` and the new `travel-block.js?v=1` are both correctly pinned in `mockup_v3.html`).
- Grep of `e2e/tests/*.spec.js` and `docs/qa/BROWSER_QA_RESULTS.md` for "travel block"/"travel-block" → zero matches (the gap noted in §2.1).

**Could not locate / open questions**: same as prior nights — "Password Master Document" and "Update Opal Docs Register" describe external documents (OneDrive, an Excel sheet) outside this repository; "Professional Development" remains ambiguous between two subsystems (see §4.3). No new open questions tonight.

**Weekly deep run**: not applicable — tonight (2026-11-10) is a Tuesday UTC, not Sunday.

**Write-back**: `NODE_USE_ENV_PROXY=1 SUPABASE_URL=... node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json` → `post-tracker: 13 features posted, 0 already posted tonight, brief posted`. Ran before the `git push` below, per the rule.
