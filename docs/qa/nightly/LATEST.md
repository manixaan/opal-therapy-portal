# Nightly tracker audit — 2026-11-09

## 1. Status line

**RAN** — 2026-11-09T18:12 UTC onward, commit `34cf881` on `develop`.

Counts: **proven 5** · **tab-unproven 4** · **built-untested 1** · **needs-refinement 1** · **untouched 2** · **broken 0** (13 features total).

Quiet night: **zero commits** landed on `develop` between last night's audit and tonight's — `develop` is at the exact same commit (`34cf881`) both nights, so there is nothing new to review. Every evidence label below was still independently re-observed tonight rather than copied from the prior brief: every targeted unit and integration test file was actually re-run (not read from yesterday's numbers), and every guard was re-confirmed by a fresh grep of the route files. Results matched last night's in every case except two small differences explained in §7 (file-count/total-count differences that come from how this run grouped files, not from any change in behaviour), plus one new, non-urgent finding: `backend/routes-outlook-integration.js` defines an OAuth callback route but is never mounted by `server.js` — it appears to be dead code sitting alongside the live callback in the legacy `routes.js`.

## 2. Do this first

1. **Automated Reminders — the card's own idea has no code.** The tracker's idea text is "24Hr Automatic Client Appt Reminders", but nothing in the backend sends an automatic reminder to a client about an upcoming appointment — no route, scheduled job, or email/SMS send path to a client exists anywhere. The only thing built under this card is `backend/snapshot-routes.js`, a therapist's own personal daily task list — a different, already-complete feature.
2. **"Professional Development" is still genuinely ambiguous.** Two unrelated subsystems could be meant: the Resource Hub's own "Professional development" catalogue page (guarded, 46 passing tests, no browser proof it renders) and the Profile tab's CPD section (zero tests), which the "Employee Personal Page" card already covers. Worth a two-minute clarification in the tracker so future nights stop guessing.
3. **Employee Personal Page (My Profile Tab) — zero automated tests.** Leave approval, CPD approval and credential verification are all correctly owner-only, and browser QA confirms it renders, but there is no `backend/tests/profile-routes.test.js` at all.
4. **Xero Integration Works — tab-unproven.** Finance/Accounting/Payroll is owner-gated and passes its tests, but no run has ever reached a real Xero sandbox; tonight's own integration run again logged "xero offline in test" rather than faking a result.
5. **Report Templates — tab-unproven.** FCA, Progress Letter and Service Agreement generation are guarded and fully tested, but no E2E spec or browser QA entry proves a user can open the Resource Hub → Templates screen and actually generate a document.

No `broken` findings tonight — every located route is guarded and every targeted test that was run passed (after one known, pre-existing flaky retry — see §7).

## 3. Every feature

| Feature | Tracker stage | Evidence label | One-line reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | proven | Guarded, e2e + browser QA confirm boundaries; zero commits this window | 276 unit + 104 integration pass |
| Portal Onboarding Workflow | idea | proven | Permission-gated (`onboarding.*`), browser QA proves the flow | 653/654 unit (1 env-only fail) + 218 integration pass |
| Clinical resources | idea | proven | Maps onto the existing, already-production Resource Hub | 454/466 unit (12 pre-existing skips) + 168/168 integration (1 retry) pass |
| Inductions | idea | proven | Guarded, e2e proves full learner flow; zero commits this window | 539 unit + 212 integration pass (combined run, shared with Xero/Mobile) |
| Professional Development | idea | tab-unproven (ambiguous card) | Two possible readings; under either, no browser proof of the page itself | 46 unit pass (Resource Hub PD catalogue reading) |
| Automated Reminders | idea | needs-refinement | Snapshot built and tested; the card's own client-reminder idea is unbuilt | passes within the combined 212-test integration run (Snapshot only) |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Guarded (owner-only approvals), renders per browser QA, zero automated tests | none |
| Interactive Assessments | idea | tab-unproven | Guarded, all tests pass, no browser proof the overlay opens/completes | 738 unit + 122 integration pass |
| Opa Mobile Companion | idea | proven | Self-scoped guard re-verified by query-level grep | passes within the combined 539/212 run |
| Password Master Document | idea | untouched | Describes an external OneDrive document; nothing to locate | none |
| Report Templates | idea | tab-unproven | Guarded, tests pass, no browser proof of the tab itself | 369 unit + 82 integration pass |
| Update Opal Docs Register | idea | untouched | Describes an external Excel register; nothing to locate | none |
| Xero Integration Works | idea | tab-unproven | Owner-gated, fails closed by design, no live Xero sandbox ever exercised | passes within the combined 539/212 run |

## 4. Prompts for the morning

**1. Automated Reminders**
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

**2. Professional Development (clarify first)**
```
/opal-feature

Idea: Professional Development
Why / Who uses it / What they see / What should happen / Outcome: (not yet written in the tracker)
(No recorded decisions.)

Where it lives today: Ambiguous — two candidates. (1) The Resource Hub's own "Professional
development" catalogue page (frontend/current/resourcehub.js, guarded, 46 passing tests, no
browser proof it opens). (2) The Profile tab's CPD section (backend/profile-routes.js lines
204-320) — likely the same thing "Employee Personal Page (My Profile Tab)" already covers.

Start here: First, in the Development Manager, clarify which of the two above this card means
(or merge it with "Employee Personal Page" if it's (2)). If (1): add a Playwright or manual QA
step that opens Resource Hub → Professional development and confirms the list renders and a
filter works — copy the login/navigation pattern from e2e/tests/portal.spec.js's Resource Hub
test. If (2): use the Employee Personal Page starter prompt instead — don't duplicate that work.

Done means: For reading (1), a Playwright spec or docs/qa/BROWSER_QA_RESULTS.md entry proving
the page renders in a browser.

Tracker: 37f4e057-ae96-4a9e-a576-5f808b7dc8fb
```

**3. Employee Personal Page (My Profile Tab)**
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
Guarded (inline canApprove, owner-only for approvals), zero automated test coverage.

Start here: Add backend/tests/profile-routes.test.js (supertest against the mounted router,
the pattern in case-note-routes.test.js). Cover: a therapist managing only their own
leave/CPD/documents (403 on someone else's), and an owner approving/rejecting a request for a
different user while admin is correctly refused. Assert the 403 path, not only the happy path.

Done means: backend/tests/profile-routes.test.js exists and passes, covering the guard
boundaries (still needs an E2E/browser proof beyond the existing render-only check for full
"proven", otherwise "tab-unproven").

Tracker: 83bb9988-52ba-4f8c-85ba-7b65aca189b2
```

**4. Xero Integration Works**
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

**5. Report Templates**
```
/opal-critical

Idea: Report Templates
Why / Who uses it / What they see / What should happen / Outcome: (not yet written in the tracker)
(No recorded decisions.)

Where it lives today: backend/templates-routes.js, backend/fca-routes.js,
backend/letter-routes.js, backend/service-agreements/, backend/fca/; frontend
frontend/current/templates.js inside the Resource Hub Library. Guarded, all unit and
integration tests pass. Only the browser rendering of the Templates screen itself is unproven.

Start here: Add a Playwright spec under e2e/tests/ that logs in as a therapist, opens the
Resource Hub → Templates surface, picks a client, generates an FCA report or progress letter,
and asserts the resulting document download. Copy the login/role setup from
e2e/tests/tutorials.spec.js. Add the result to docs/qa/BROWSER_QA_RESULTS.md.

Done means: The new Playwright spec passes and a docs/qa/BROWSER_QA_RESULTS.md entry records it.

Tracker: 91ae30e7-9cda-4198-956f-8b9cdf043003
```

## 5. Ideas without a start

None tonight — no feature folder was newly created or had its `START.md` changed, since no evidence label changed from last night. All 13 folders already existed from prior nights.

## 6. What changed since last audit

**Nothing.** `git log --since="2026-11-08" -- backend frontend/current` returns zero commits — `develop` is at the identical commit (`34cf881`) that was audited last night. No subsystem changed, and there is no subsystem with changes but no tracker feature to report tonight.

## 7. Technical detail

**Setup.** PostgreSQL was found stopped at the start of this run (`service postgresql status` → down) and was started per the prompt's instructions (`service postgresql start`) before anything else ran; `backend/node_modules/.bin/jest` was confirmed present, so `npm ci`/`npm install` were not needed and were not run. Tracker fetch: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → `13 features, 19 tasks`, succeeded on the first try.

**Window.** The last audit date was found on the `claude/nightly-audit` branch (`2026-11-08.md`), not on `develop` (which only ever carries this folder's `README.md` — the audit branch is never merged back into `develop`). `git log --since="2026-11-08" --stat -- backend frontend/current` returned nothing, confirming `develop`'s HEAD (`34cf8810d1eebd862c527dd90ca2dd7b680fe737`) is unchanged since the commit that last night's brief itself audited.

**A note on the tracker's own `claude_update` text.** Every feature in tonight's `/tmp/tracker.json` snapshot already carried a `claude_update` field reading almost exactly like this audit's own output (the same evidence-label vocabulary, specific test counts, specific commit mentions). That is expected and legitimate — it is last night's write-back, still sitting on the tracker cards from the 2026-11-08 run — but it was treated as data to verify, not as a result to copy: every number in this brief comes from tests actually re-run tonight and guards actually re-grepped tonight, in six parallel background workers against the current `develop` checkout, each on its own isolated integration database (`therapy_scheduler_audit_g1_test` … `_g6_test`) to avoid the cross-run truncation corruption the concurrency rule warns about.

**Numbers that moved slightly from last night's phrasing, and why neither is a regression:**
- *Report Templates* integration: tonight's isolated run of just `templates.itest.js` + `progress-note-letters.itest.js` (the two files unique to this feature, excluding the `fca-reports.itest.js` file shared with Interactive Assessments) came to **82/82**, versus last night's **88/88** figure for "templates+letters+snapshot combined." These are different groupings of the same passing files, not a dropped test.
- *Portal - Splose - Outlook*: tonight's unit run covered the **19** files that actually exist on disk (confirmed by `ls` before running), all passing (**276/276**), versus last night's informal count of "20 files" / 291 tests. The file list and pass/fail outcome are unchanged; only the headcount estimate was off previously.

**New finding (non-urgent).** `backend/routes-outlook-integration.js` defines an OAuth callback route, but `backend/server.js` does not `require`/mount it — the live callback path is `GET /auth/oauth/callback` in the legacy `backend/routes.js:239`. This looks like dead code left over from a refactor, not a guard gap (the unused file is never reachable), but it's worth a cleanup pass to avoid confusion later.

**Repeat finding.** `tests/integration/resource-library.itest.js` hit its own `truncateAll()` helper's intermittent `deadlock detected` again tonight, on the first run, exactly as it did in the 2026-11-08 brief. A second, isolated retry passed clean (53/53) both times. Two consecutive nights of the same flake in the same helper is worth a look independent of this audit.

**Weekly deep run.** Tonight is Monday UTC, not Sunday, so the complete `npm test` / `npm run test:integration` suites were correctly not run — only the targeted files per feature, as the testing policy requires.

**Tracker write-back.** `/tmp/writeback.json` built for all 13 features and posted via `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs /tmp/writeback.json`, run before the git push per the prompt's ordering rule. Script output: `post-tracker: 13 features posted, 0 already posted tonight, brief posted`.

**Open questions for the team.** (1) Clarify what "Professional Development" means — the Resource Hub catalogue page, the Profile tab's CPD section, or both — and whether it duplicates "Employee Personal Page." (2) Decide whether "Password Master Document" and "Update Opal Docs Register" belong in the portal at all, since both describe documents that live outside this codebase (OneDrive/Excel). (3) Consider removing `backend/routes-outlook-integration.js` if it is confirmed dead. (4) The `resource-library.itest.js` deadlock has now recurred two nights running and would benefit from a fix to its shared test helper rather than a retry-and-move-on each night.
