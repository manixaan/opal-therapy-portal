# Nightly tracker audit — 2026-11-08

## 1. Status line

**RAN** — 2026-11-08T18:11–18:50 UTC, commit `34cf881` on `develop`.

Counts: **proven 5** · **tab-unproven 4** · **built-untested 1** · **needs-refinement 1** · **untouched 2** · **broken 0** (13 features total).

This is the first run of this audit found under `docs/qa/nightly/` on `develop` (only a `README.md` exists there — the audit branch `claude/nightly-audit` is never merged back, so prior nights' briefs aren't visible from here), so the change window is the last 14 days rather than "since the last audit." The Opal Development Manager tracker already carries a `claude_update` on every card referencing a prior nightly run with almost identical wording to parts of tonight's findings — that run's output is not reachable from this checkout, so tonight's findings were built independently, by actually locating code and actually running the targeted tests, rather than trusted or copied from the tracker's existing text.

## 2. Do this first

1. **Automated Reminders — the card's own idea has no code.** The tracker's own idea text is "24Hr Automatic Client Appt Reminders", but nothing anywhere in the backend sends an automatic reminder to a client about an upcoming appointment — no route, no scheduled job, no email/SMS send path. The only thing built under this card is `backend/snapshot-routes.js`, a therapist's own personal daily task list — a different feature entirely, already complete and tested.
2. **"Professional Development" is genuinely ambiguous, and it may not mean what last time's run assumed.** There are two unrelated "professional development" subsystems: the Resource Hub's own "Professional development" catalogue page (`frontend/current/resourcehub.js`, guarded, 46 passing tests, no browser proof it renders) and the Profile tab's CPD section (`backend/profile-routes.js`, zero tests) which "Employee Personal Page (My Profile Tab)" already covers. The tracker card has no detail text to tell which is meant — worth a two-minute clarification in the tracker.
3. **Employee Personal Page (My Profile Tab) — zero automated tests.** Leave approval, CPD approval and credential verification are all correctly owner-only (an inline `canApprove` check), and `docs/qa/BROWSER_QA_RESULTS.md` confirms it renders, but there is no `backend/tests/profile-routes.test.js` at all.
4. **Xero Integration Works — tab-unproven.** Finance/Accounting/Payroll is owner-gated and passes 133 tests (70 unit + 63 integration), but no run anywhere has ever reached a real Xero sandbox; tonight's integration run logged "xero offline in test" directly.
5. **Report Templates — tab-unproven.** FCA, Progress Letter and Service Agreement generation pass 457 tests (369 unit + 88 integration) and are guarded, but no E2E spec or browser QA entry proves a user can open the Resource Hub → Templates screen and actually generate a document — and this subsystem had real code changes this window (new Support Letter/Progress Report masters, a live preview rewrite).

No `broken` findings tonight — every located route is guarded and every targeted test that was run passed (after discarding one contaminated run, see §7).

## 3. Every feature

| Feature | Tracker stage | Evidence label | One-line reason | Tests run |
|---|---|---|---|---|
| Portal - Splose - Outlook \| Integration Works | idea | proven | Guarded, actively maintained this window (5 fixes), e2e + browser QA confirm boundaries | 291 unit + 104 integration pass |
| Portal Onboarding Workflow | idea | proven | Permission-gated (`onboarding.*`), browser QA proves the flow | 653/654 unit (1 env-only fail) + 218 integration pass |
| Clinical resources | idea | proven | Maps onto the existing, already-production Resource Hub | 408/420 unit (12 skip) + 168 integration pass |
| Inductions | idea | proven | Very active this window (6 new/edited packs), e2e proves full learner flow | 306 unit + 133 integration pass |
| Professional Development | idea | tab-unproven (ambiguous card) | Two possible readings; under either, no browser proof of the page itself | 46 unit pass (Resource Hub PD catalogue reading) |
| Automated Reminders | idea | needs-refinement | Snapshot built and tested; the card's own client-reminder idea is unbuilt | 88 integration pass (Snapshot only, shared run) |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Guarded (owner-only approvals), renders per browser QA, zero automated tests | none |
| Interactive Assessments | idea | tab-unproven | Guarded, 860 tests pass, no browser proof the overlay opens/completes | 738 unit + 122 integration pass |
| Opa Mobile Companion | idea | proven | Self-scoped guard verified by spot-check, actively maintained this window | 163 unit + 10 integration pass |
| Password Master Document | idea | untouched | Describes an external OneDrive document; nothing to locate | none |
| Report Templates | idea | tab-unproven | Guarded, 457 tests pass, active this window, no browser proof of the tab itself | 369 unit + 88 integration pass |
| Update Opal Docs Register | idea | untouched | Describes an external Excel register; nothing to locate | none |
| Xero Integration Works | idea | tab-unproven | Owner-gated, 133 tests pass, no live Xero sandbox ever exercised; fail-closed by design | 70 unit + 63 integration pass |

## 4. Prompts for the morning

**1. Automated Reminders**
```
/opal-feature
Decide where client-facing appointment reminders should send from (email via the
existing mailer, or Outlook/SMS) and build a new scheduled job for them — there is
nothing to extend in backend/snapshot-routes.js, which only serves the therapist's
own personal task list. Look at backend/credential-reminder.js for the house
pattern on a reminder job (decide/notify, no cron of its own), then write the
client-facing equivalent as a new file, e.g. backend/appointment-reminder.js,
scheduled the way backend/server.js's existing setInterval jobs are.
Done means: a new test proves a reminder is generated ~24 hours before a booked
appointment and not duplicated on a second run.
```

**2. Professional Development**
```
/opal-feature
Before writing any code, clarify in the Development Manager whether "Professional
Development" means the Resource Hub's own "Professional development" catalogue
page (frontend/current/resourcehub.js, already built, guarded, 46 passing tests in
backend/tests/pd-catalogue-guards.test.js — just needs a browser/E2E proof it
renders) or the Profile tab's CPD section in backend/profile-routes.js (which
"Employee Personal Page (My Profile Tab)" already covers — if so, merge the
cards). Don't duplicate work on both readings.
```

**3. Employee Personal Page (My Profile Tab)**
```
/opal-critical
backend/profile-routes.js (Leave requests, CPD/professional development activities
and documents, Credentials) has no backend/tests/profile-routes.test.js at all,
despite guarding leave/CPD approval and credential verification with an inline
canApprove(owner-only) check. Add that test file (supertest against the mounted
router, the pattern in case-note-routes.test.js) covering: a therapist managing
only their own leave/CPD/documents (403 on someone else's), and an owner
approving/rejecting a different user's request while admin is correctly refused.
Assert the 403 path, not only the happy path.
```

**4. Xero Integration Works**
```
/opal-critical
Open the Finance tab (frontend/current/finance.js) as an Owner with a real Xero
sandbox connected via backend/accounting-routes.js's OAuth callback, and confirm
backend/finance-routes.js's profit-and-loss and recurring-invoice calls succeed
instead of logging "xero offline in test". Follow tests/integration/finance-routes.itest.js
for the request shapes, then add one integration test asserting a populated
dashboard payload.
```

**5. Report Templates**
```
/opal-critical
Add a Playwright spec under e2e/tests/ that logs in as a therapist, opens the
Resource Hub -> Templates surface in frontend/current/mockup_v3.html's RESOURCES
TAB block, picks a client, generates an FCA report or progress letter, and
asserts the resulting document download. Copy the login/role setup from
e2e/tests/tutorials.spec.js. Add the result to docs/qa/BROWSER_QA_RESULTS.md.
```

## 5. Ideas without a start

Every feature folder under `docs/qa/nightly/features/` was created or rewritten tonight (first run reachable from this branch's history). Five reached `proven` and got a two-line START.md instead of a starter prompt: Portal - Splose - Outlook | Integration Works, Portal Onboarding Workflow, Clinical resources, Inductions, and Opa Mobile Companion. The other eight kept a full starter prompt — see "Prompts for the morning" above for the five most urgent, and `docs/qa/nightly/features/README.md` for the rest (Password Master Document, Update Opal Docs Register — both need a team decision, not code).

## 6. What changed since last audit

14-day window (2026-10-25 to 2026-11-08), 52 commits touching `backend`/`frontend/current`. By subsystem:

- **Inductions / learning** (very active): 6 new or rewritten induction packs, auto-placement of packs at server start, Progress Report tour switched to the new template, "sections unlock in order" redesign, tour steps that open their own screen.
- **Assist (Opal Assist chat)** (very active): client-grouped sidebar, instant Hide/Not-a-person review, a Splose 502 fix via the queue, fewer false "is this a person?" candidates, a Claude-style composer, night mode, an AI "breathing" brand mark.
- **Templates / clinical letters**: Support Letter and Progress Report masters, a live side-by-side preview (no per-keystroke Splose round-trip).
- **Splose / Outlook sync**: webhook token decrypt fix, auto-sync-after-reset fix, stuck change-alert dialog fix, Calendar sync settings (per-direction, sync-from dates, preview).
- **Case notes / mobile**: editing an approved note resends it for approval, one editable note with Copy/Download-PDF, the phone diary matches the portal calendar.
- **Travel**: traffic at each drive's own time, right-click "Not driving this", desk-work-at-home scheduling, a maps picked-place naming fix.
- **Calendar / review blocks**: review blocks booked straight into Outlook or Splose, night-mode calendar contrast.
- **Dependency patches**: `follow-redirects`, `qs`/`express` security patches (GHSA advisories).

**Subsystems with recent commits but no tracker feature of their own**: Opal Assist (the AI chat/composer) has no tracker card at all despite being the single most actively developed area this window — worth adding as its own tracked feature. The brand/AI mark animation work is purely cosmetic and probably doesn't need one.

## 7. Technical detail

**Commands run** (from `backend/`, `DB_PASSWORD=audit` for integration):
- `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → 13 features, 19 tasks fetched successfully.
- `npx jest <targeted files>` per feature group (see each feature's STATUS.md for the exact file list and pass counts).
- `DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npx jest --config jest.integration.config.js <targeted files> --runInBand` per feature group.
- No complete suite (`npm test`, `npm run test:integration`, `npm run test:all`) was run — tonight is not a Sunday-UTC deep run.

**Environment note — PostgreSQL was down at the start of this run** (`service postgresql status` → `down`); started it per the audit's own setup step (`service postgresql start`) before any integration test.

**Discarded contaminated run**: this agent briefly ran two integration-test invocations against the same `therapy_scheduler_audit_test` database concurrently (onboarding + resource-hub) for a few seconds before catching and stopping the second one. The onboarding run that had been running alone before the overlap still showed 35 failures (mostly 500s) when it finished — consistent with truncate-table contention from the overlap, not real defects. Re-ran clean immediately after confirming no other process was touching the database: **218/218 pass**. Treat any nightly-audit process as needing its own `_test` database if this recurs.

**Pre-existing environment gap, not a code defect**: `backend/tests/onboarding-document-reader.test.js` fails because `@tesseract.js-data/eng` (declared in `backend/package.json`, needed for OCR language data) is absent from `backend/node_modules` in this sandbox. This agent could not run `npm install` to fix it (hard limit). Worth adding to the environment's setup script.

**Pre-existing flaky test, not a regression**: `backend/tests/integration/resource-library.itest.js` hit an intermittent `deadlock detected` in its own `truncateAll()` helper on two separate isolated runs (no other process touching the database either time), then passed clean (53/53) on a third attempt. Looks like an unclosed connection/transaction left open by an earlier test in that file — worth a look independent of this audit.

**Could not verify**: whether `docs/qa/BROWSER_QA_RESULTS.md` (dated 2026-08-01, staging build `188334d`/`b7e3308`) still reflects the current build for the subsystems it covers — it predates all 52 commits in this window. No fresher manual browser QA record exists for Inductions, Templates, Assessments or Xero despite the Inductions/Templates activity this window; the existing entries (C, E, F, G, H, I) were taken as still-valid evidence per the audit's own instructions, since nothing in this window's commits touches what they specifically checked.

**Write-back to tracker**: see the result of `post-tracker.mjs` below (run before the git push, per instructions).

```
post-tracker: 13 features posted, 0 already posted tonight, brief posted
```
