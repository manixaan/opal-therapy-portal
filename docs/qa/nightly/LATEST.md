# Nightly tracker audit — 2026-11-23

## 1. Status line

**RAN** · 2026-11-23 18:35 UTC · commit `403964c` (origin/develop) · proven: 1, built-untested: 2,
needs-refinement: 5, broken: 0, untouched: 2, tab-unproven: 3 (13 features total).

**The quietest night this audit has seen.** Zero commits landed in `backend/` or `frontend/current/`
between the last audit (2026-11-22 18:13 UTC) and tonight's run — `origin/develop`'s HEAD is the exact
same commit (`403964c`) this audit checked last night. The Development Manager tracker is also
byte-for-byte unchanged (every feature's `updated_at` is last night's own write-back timestamp, not a
newer human edit). Every targeted unit and integration test for every one of the 13 features was still
re-run fresh tonight, not assumed — 129 unit files / 3,471 passing (1 known environment-artifact
failure, unchanged); 43 integration files / 712 passing (1 known test-isolation flake, confirmed clean on
an isolated re-run). No classification changed from last night. No disagreement was resolved. One
genuine new finding tonight: a stale browser-QA row (row I, "Leave/CPD/documents") that covers the My
Profile tab had been missed by prior audit nights — it exists but only confirms the tab renders and that
disabled features honestly read "Preview only — not saved" rather than faking success, so it does not
move Employee Personal Page or Professional Development toward `proven`. Also found: a prior-night claim
that `e2e/tests/portal.spec.js` has "zero calendar/booking/travel/sync references" was a loose grep —
`async` contains the substring `sync`. A corrected check finds two genuine Splose-related tests there,
but both are RBAC/permission-boundary checks, not proof the booking/travel sync workflow itself works; the
underlying finding (no functional E2E coverage of that subsystem) stands.

## 2. Do this first

1. **[/opal-feature] Automated Reminders — tracker ahead of the evidence, 9 nights running.** The
   Therapist Snapshot task's own checklist still marks "Create minimise function on snapshot" as
   done, but no matching code exists in `frontend/current/reports.js` or anywhere else — only a
   narrower "Completed" sub-list collapse (`swCompletedCollapsed()`) and an unrelated minimise on the
   separate Opa AI chat widget. Confirmed again tonight, 2026-11-15 through 2026-11-23.
2. **[/opal-critical] Portal - Splose - Outlook — one checklist item still open, after the quietest
   night yet.** Zero commits touched this subsystem tonight (the first such night since this audit
   began); guards and all targeted tests pass fresh. The one tracker task, Multi Calendar Rules,
   remains a human checklist against the live portal, untouched by this run.
3. **[/opal-critical] Xero Integration Works — still never confirmed against a real Xero sandbox.**
   Unchanged tonight (no billing/invoicing/Xero commits landed) — 215 unit + 90 integration tests still
   pass, every one of them against a mocked Xero client. The live-sandbox-in-a-browser gap is unchanged.
4. **[/opal-critical] Opa Mobile Companion — not actually proven.** Don't close its two tracker tasks
   on test counts alone (171 unit + 13 integration backend tests prove the API, not the device
   experience). Run the manual device walkthrough the task itself asks for.
5. **[/opal-critical] Employee Personal Page & Professional Development — the same untested gap,
   possibly the same card.** Neither tracker card has a test proving the leave/CPD approval round
   trip (`/api/profile/leave`, `/api/profile/cpd`). A stale browser-QA entry (row I, found tonight)
   confirms the tab renders but not that the round trip works. Still unresolved; worth deciding whether
   these are the same piece of work tracked twice.

No `broken` feature was found anywhere in this run — no unguarded routes, no `node --check` failures
across all 25 re-checked route/core files. The one unit failure (`tests/onboarding-document-reader.test.js`,
a missing OCR package) is a ninth-night-running environment artifact, not a code defect. One integration
test (`resource-library.itest.js`) and one unit test (`fca-wizard-behaviour.test.js`) each failed once
under the load of their combined batch run tonight and passed clean (53/53 and 58/58) on an immediate
isolated re-run — both are confirmed test-isolation/timing flakiness, not regressions; see Technical detail.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Unchanged tonight — every Xero call in every test is still mocked; a real sandbox connection is still never confirmed live. | 12u/215✓, 6i/90✓ |
| Update Opal Docs Register | idea | untouched | Organising/SharePoint task — no code expected. | none |
| Report Templates | idea | tab-unproven | FCA/Letter/Agreement generation built & tested (625 tests); three document flows never hand-checked. One unit file flaked under load, clean on isolated re-run. | 14u/598✓, 1i/27✓ |
| Password Master Document | idea | untouched | Tracker says to keep this on OneDrive — no portal action. | none |
| Opa Mobile Companion | idea | needs-refinement | AI-governed case-note path built & tested; device walkthrough not yet done. | 5u/171✓, 4i/13✓ |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0 built & tested (484 tests); no browser proof of the tab. | 6u/484✓, 2i/81✓ |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Built & guarded; no test proves the leave/CPD approval round trip. A stale browser-QA row confirms the tab renders, not the round trip. | 4u/94✓, 0i |
| Automated Reminders | idea | needs-refinement | Appt reminders: no code at all. Snapshot: built & tested but a checklist/code mismatch persists. | 0u, 1i/6✓ |
| Professional Development | idea | built-untested | Lives inside My Profile's CPD section; shares Employee Personal Page's code and its untested round trip. | 4u/94✓ (indirect), 0i |
| Inductions | idea | needs-refinement | Learner side proven by E2E; builder/AI-helper/photo-step work still open. | 3u/92✓, 2i/7✓, E2E✓ |
| Clinical resources | idea | proven | Built, guarded, fully tested, E2E-proven, no open task — tracker underclaims this one. | 12u/398✓, 7i/168✓, E2E✓ |
| Portal Onboarding Workflow | idea | needs-refinement | Extensively built/tested (604/605 tests); real gap is SharePoint storage for Stage 2. | 24u pass/1u env-artifact, 8i/208✓ |
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | First fully quiet night for this subsystem — zero commits; guards and tests all still pass. The one open item is the Multi Calendar Rules human checklist. | 50u/954✓, 12i/112✓ |

## 4. Prompts for the morning

**1. Automated Reminders (tracker-ahead disagreement)**
```
/opal-feature
Check whether the Development Manager tracker's "Create minimise function on snapshot" checklist item under
the Therapist Snapshot task (feature 398a0b36-a12f-4190-83e4-b3a8932b3b46) has a real whole-panel implementation
anywhere in frontend/current/reports.js or its CSS. A narrower "Completed" sub-list collapse already exists
(swCompletedCollapsed()/swToggleCompleted()) but nothing minimises the whole Snapshot widget. Either build the
whole-panel minimise or un-tick the checklist item to match what exists. Done means: the checklist and the code
agree.
```

**2. Portal-Splose-Outlook — Multi Calendar Rules checklist**
```
/opal-critical
Walk the Multi Calendar Rules checklist against the live portal: book a session, confirm the "changes saved
but not synced" indicator, check travel-time calculation, and confirm Portal/Splose match in both directions.
This is a verification pass against the live portal, not a build task — guards and the full targeted test
suite for this subsystem all pass fresh tonight, and the subsystem has had its first fully quiet night (zero
commits) since this audit began. Done means: each checklist item is manually confirmed with no bug found.
```

**3. Xero Integration Works — confirm a real sandbox connection**
```
/opal-critical
Confirm a real Xero sandbox connection live in a browser and record it in docs/qa/BROWSER_QA_RESULTS.md.
215 unit + 90 integration tests all pass, but every one of them mocks the Xero client
(backend/xero-api.js, backend/xero-payroll-connection.js). No test here can prove a real Xero call works; only
a browser session against a sandbox tenant can. Done means: a sandbox connection is confirmed working and
recorded.
```

**4. Opa Mobile Companion — device walkthrough**
```
/opal-critical
On the test device, dictate a case note through the Opa Mobile Companion app and confirm it reaches
backend/case-note-routes.js's generateGovernedDraft() (linked by voiceNoteId) and produces a usable draft
linked to the right client. This is a manual walkthrough first — only write code if the walkthrough finds a
real defect. Done means: the walkthrough is recorded as passing (or the defect found is filed as its own task).
```

**5. Employee Personal Page & Professional Development — decide and test the leave/CPD round-trip**
```
/opal-critical
Two Development Manager cards — "Employee Personal Page (My Profile Tab)" (83bb9988-52ba-4f8c-85ba-7b65aca189b2)
and "Professional Development" (37f4e057-ae96-4a9e-a576-5f808b7dc8fb) — point at the same code
(backend/profile-routes.js) and the same untested gap. First, decide in the tracker whether they should merge.
Then add an integration test exercising /api/profile/leave and /api/profile/cpd end to end (approve and
reject paths). docs/qa/BROWSER_QA_RESULTS.md row I ("Leave/CPD/documents", 2026-08-01) only confirms the tab
renders, not that the round trip works — it does not substitute for this test. Done means: the round trip has
a passing integration test; evidence label moves off built-untested.
```

## 5. Ideas without a start

No feature's START.md changed tonight — the codebase and the tracker are both unchanged from last night,
so every START.md's "Start here" step is still the right next step. Portal - Splose - Outlook's START.md
(last refreshed 2026-11-22) still correctly describes the Multi Calendar Rules checklist as the next step.

## 6. What changed since last audit

**Nothing.** Zero commits landed in `backend/` or `frontend/current/` between the last audit (2026-11-22
18:13 UTC) and tonight's run (2026-11-23 18:35 UTC) — the longest gap with no activity this audit has
recorded. `origin/develop`'s HEAD is still commit `403964c`, the same commit last night's audit checked.
No new migrations landed (still `093_trip_travel_hours.sql` as the latest, already applied). No subsystem
changed that lacks a tracker feature, because nothing changed at all.

## 7. Technical detail

**Setup.** PostgreSQL was down at the start of this run (`service postgresql status` → `down`) and was
started successfully (`service postgresql start`). `backend/node_modules/.bin/jest` was present — no install
needed. Tracker snapshot pulled via `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node
../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → `fetch-tracker: 13 features, 19 tasks ->
/tmp/tracker.json`. This run's `docs/qa/nightly/` history lives only on `claude/nightly-audit` (never merged
to `develop`, same as every prior night) — this run's bootstrap carried that history forward onto tonight's
`develop` checkout before writing anything new. Window start was taken from last night's own brief status
line (RAN 18:13 UTC 2026-11-22), not just the filename date.

**Test selection.** 129 unique unit test files and 43 unique integration test files were assembled by
carrying forward each feature's file list from last night's STATUS.md folders (locate did not need to
re-run from scratch since zero commits landed) and re-confirming with fresh greps that every "could not
locate" claim and every guard still holds. All 129 unit files and all 43 integration files were run fresh
tonight — none of tonight's pass/fail numbers were assumed from last night's brief.

**Unit run.** `npx jest` across the 129 targeted files: 127 suites clean, 1 known environment artifact
(`tests/onboarding-document-reader.test.js`), 1 suite (`tests/fca-wizard-behaviour.test.js`) that failed once
under the combined-run load and passed clean (58/58) on an immediate isolated re-run and again under a
second isolated JSON-reporter run — confirmed as timing-sensitive async-race flakiness under CPU contention
from running 129 files together, not a code defect (no commit touched this file tonight). 3,471 passed / 3,484
total (12 pending/skipped, all in `resource-ingestion.test.js`, matching last night exactly).

**Integration run.** `DB_NAME=therapy_scheduler_audit_<timestamp> DB_PASSWORD=audit npx jest --config
jest.integration.config.js --runInBand` across the 43 targeted files: 42 suites clean, 1
(`tests/integration/resource-library.itest.js`) failed with `error: deadlock detected` on a `TRUNCATE`
between suites; re-run alone immediately after on a freshly isolated `DB_NAME`: **53/53 pass, clean**. This
is the same class of test-isolation flakiness documented in the 2026-11-22 brief (a leaked async operation
from an earlier suite bleeding into the next suite's `TRUNCATE`), recurring tonight even in a 43-file
targeted subset rather than the full 81-file suite — **worth escalating the team's attention**: this is not
a one-off, it has now surfaced in two different nights under two different batch compositions. 711 passed /
712 total. The aggregate total (712) exactly matches the sum of every feature's integration count from last
night's brief, independently confirming that no integration test's behaviour changed on this unchanged
codebase.

**New finding tonight: a missed browser-QA row.** `docs/qa/BROWSER_QA_RESULTS.md` row I ("Leave/CPD/documents",
dated 2026-08-01, ✅ 3/3) names the exact tab Employee Personal Page and Professional Development cover, but
no prior audit night's STATUS.md cited it. On inspection it only confirms the My Profile tab's setup card and
profile sections render, and that *disabled* features honestly read "Coming soon"/"Preview only — not saved"
rather than faking success — it does not exercise the leave/CPD approval round trip, and it predates
whatever state `backend/profile-routes.js` is in today. Both feature folders now cite it with this caveat; it
does not change either evidence label.

**Correction to a prior night's claim.** The 2026-11-22 brief states `e2e/tests/portal.spec.js` has "zero
calendar/booking/travel/sync references." A plain `grep -ci` for that pattern tonight returns 23, because
`async` contains the substring `sync` — a methodology gap, not a code finding. Reading the actual matches:
two are genuinely Splose-related ("broad Splose data denied; unmapped practitioner fails closed", "Splose
write routes are blocked"), but both are RBAC/permission-boundary tests, not functional proof of the
calendar/booking/travel sync workflow. The underlying conclusion — no E2E coverage of this subsystem's actual
behaviour — is unchanged and re-confirmed; only the grep methodology improves tonight.

**Known environment artifact, confirmed again (ninth night running).** `tests/onboarding-document-reader.test.js`
fails with "Cannot find module '@tesseract.js-data/eng/package.json'". `@tesseract.js-data/eng` is declared in
`backend/package.json` but genuinely absent from `backend/node_modules` in this sandbox (checked directly
tonight). Not fixable from inside this audit (no `npm install` permitted). First seen 2026-11-15.

**Documentation mismatch (not a functional gap), confirmed again.** `CLAUDE.md`'s repository map names
`backend/service-agreement-routes.js`; that file does not exist in this checkout. Service agreements are
actually generated through `backend/templates-routes.js` + `backend/templates/service-agreement-map.js`.

**Nothing could not be located this run** beyond the two items already called out above (Automated Client
Appt Reminders has no code; the mobile app's own frontend is outside this repository).

**Write-back.** `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs
/tmp/writeback.json` → `post-tracker: 13 features posted, 0 already posted tonight, brief posted`.

**Open question for the team (carried forward, unchanged):** should "Employee Personal Page (My Profile Tab)"
and "Professional Development" be merged into one tracker card? Both point at the same code and the same test
gap, confirmed again tonight.
