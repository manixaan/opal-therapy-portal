# Nightly tracker audit — 2026-11-24

## 1. Status line

**RAN** · 2026-11-24 18:29 UTC · commit `e4fa521` (origin/develop) · proven: 1, built-untested: 2,
needs-refinement: 5, broken: 0, untouched: 2, tab-unproven: 3 (13 features total).

**The quiet streak broke tonight.** Two commits landed in `backend/` between the last audit (2026-11-23
18:35 UTC, commit `403964c`) and tonight's run (2026-11-24 18:29 UTC, commit `e4fa521`), both at 21:42 UTC
2026-11-23 — just after last night's audit closed, so tonight is the first run to see them: a new
`POST /api/mobile/appointments/:id/move` drag-to-move endpoint for the Opa mobile app (`backend/mobile-routes.js`,
new `backend/mobile-calendar.js`), and a refactor that extracted the portal's own calendar-edit save path
into a new shared module, `backend/event-move.js`, so the phone's move and a portal drag now take exactly
the same road (`PATCH /api/outlook/events/:dbId` in `backend/routes.js` now delegates to it). No
`frontend/current/` changes. Both new backend files pass `node --check` clean, carry no TODO/FIXME, and are
genuinely guarded: the mobile route sits behind `requireAuth` (router-wide) plus an explicit
`requireAnyPermission('manage_own_schedule', 'manage_all_schedules')`, with every query scoped to
`user_id = req.user.id`; the extracted `event-move.js` is a plain service module with no route of its own,
and the callers that use it (the portal's existing PATCH, the new mobile POST) keep their own guards
unchanged. Every test that could prove the refactor preserved behaviour was re-run fresh tonight and all
pass: the five existing itests that pin the portal's save path (`calendar-local-first`, `splose-draft-sync`,
`event-times`, `splose-link-ignore`, `event-delete-cascade`), the new `mobile-move.itest.js`, and four new
unit files (`mobile-calendar.test.js`, `mobile-move.test.js`, `event-move.test.js`, plus the existing
`mobile-routes.test.js`) — 98 unit tests, 55 integration tests, zero failures. Beyond those two commits,
every other subsystem in the tracker was untouched tonight, and every one of their targeted tests was still
re-run fresh, not assumed: 2,474 + 967 = 3,441 unit tests across 132 files (1 known environment-artifact
failure, unchanged — see Technical detail), 712 integration tests across 43 files, all passing. No
classification changed from last night, and no `broken` feature was found anywhere in this run — no
unguarded routes, no `node --check` failures across every route/core file re-checked.

## 2. Do this first

1. **[/opal-critical] Portal - Splose - Outlook — the shared calendar-save path was just refactored; worth
   a careful look even though every pinning test is green.** `backend/event-move.js` is new tonight and now
   the single road both a portal drag and the phone's new drag-to-move take to save a calendar edit. All
   five of the itests that pin this behaviour pass, plus a new unit file — but this is exactly the kind of
   shared-path change where a test gap would hide a regression for both surfaces at once. The one tracker
   task, Multi Calendar Rules, is also still an open human checklist against the live portal — walking it
   now would double as acceptance-testing the refactor.
2. **[/opal-critical] Opa Mobile Companion — the Calendar View task gained a real write path tonight; the
   device walkthrough should cover it too.** `POST /api/mobile/appointments/:id/move` is new, guarded
   (`requireAuth` + `manage_own_schedule`/`manage_all_schedules`, own-rows-only), audited
   (`mobile_event_moved`), and tested (98 unit + 55 integration tests, all passing) — but nothing in this
   repository can prove the phone's drag gesture itself works. The existing Case Noting device walkthrough
   (dictate a note, confirm the AI-governed draft) is still open too; do both on the same device session.
3. **[/opal-feature] Automated Reminders — tracker ahead of the evidence, ten nights running.** The
   Therapist Snapshot task's own checklist still marks "Create minimise function on snapshot" as done, but
   no matching code exists in `frontend/current/reports.js` or anywhere else — only a narrower "Completed"
   sub-list collapse (`swCompletedCollapsed()`) and an unrelated minimise on the separate Opa AI chat
   widget. Confirmed again tonight, 2026-11-15 through 2026-11-24.
4. **[/opal-critical] Xero Integration Works — still never confirmed against a real Xero sandbox.**
   Unchanged tonight (no billing/invoicing/Xero commits landed) — 215 unit + 90 integration tests still
   pass, every one of them against a mocked Xero client. The live-sandbox-in-a-browser gap is unchanged.
5. **[/opal-critical] Employee Personal Page & Professional Development — the same untested gap,
   possibly the same card.** Neither tracker card has a test proving the leave/CPD approval round
   trip (`/api/profile/leave`, `/api/profile/cpd`). A stale browser-QA entry (row I, found 2026-11-23)
   confirms the tab renders but not that the round trip works. Still unresolved; worth deciding whether
   these are the same piece of work tracked twice.

No `broken` feature was found anywhere in this run — no unguarded routes, no `node --check` failures
across all core route files plus the two new modules. The one unit failure
(`tests/onboarding-document-reader.test.js`, a missing OCR package) is a tenth-night-running environment
artifact, not a code defect.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Unchanged tonight — every Xero call in every test is still mocked; a real sandbox connection is still never confirmed live. | 12u/215✓, 6i/90✓ |
| Update Opal Docs Register | idea | untouched | Organising/SharePoint task — no code expected. | none |
| Report Templates | idea | tab-unproven | FCA/Letter/Agreement generation built & tested (625 tests, no flake tonight); three document flows never hand-checked. | 14u/598✓, 1i/27✓ |
| Password Master Document | idea | untouched | Tracker says to keep this on OneDrive — no portal action. | none |
| Opa Mobile Companion | idea | needs-refinement | **Addressed tonight** — drag-to-move landed for Calendar View, guarded and tested; Case Noting's device walkthrough and now a drag-to-move device check are both still open. | 8u/219✓, 5i/17✓ |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0 built & tested (484 tests); no browser proof of the tab. | 6u/484✓, 2i/81✓ |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Built & guarded; no test proves the leave/CPD approval round trip. | 4u/94✓, 0i |
| Automated Reminders | idea | needs-refinement | Appt reminders: no code at all. Snapshot: built & tested but a checklist/code mismatch persists. | 0u, 1i/6✓ |
| Professional Development | idea | built-untested | Lives inside My Profile's CPD section; shares Employee Personal Page's code and its untested round trip. | 4u/94✓ (indirect), 0i |
| Inductions | idea | needs-refinement | Learner side proven by E2E; builder/AI-helper/photo-step work still open. | 3u/92✓, 2i/7✓, E2E✓ |
| Clinical resources | idea | proven | Built, guarded, fully tested, E2E-proven, no open task — tracker underclaims this one. | 12u/398✓, 7i/168✓, E2E✓ |
| Portal Onboarding Workflow | idea | needs-refinement | Extensively built/tested (653/654 tests); real gap is SharePoint storage for Stage 2. | 26u pass/1u env-artifact, 8i/208✓ |
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | **Addressed tonight** — shared calendar-save path refactored into event-move.js; all pinning tests green. The one open item is the Multi Calendar Rules human checklist. | 55u/974✓, 12i/112✓ |

## 4. Prompts for the morning

**1. Portal-Splose-Outlook — verify the refactored save path, then the Multi Calendar Rules checklist**
```
/opal-critical
backend/event-move.js is new (23 Nov 2026) — it is now the one save road for a calendar time/title/location
edit, used by both PATCH /api/outlook/events/:dbId (the portal's drag) and the mobile app's new
POST /api/mobile/appointments/:id/move. All five itests that pin this behaviour pass
(calendar-local-first, splose-draft-sync, event-times, splose-link-ignore, event-delete-cascade), plus a new
event-move.test.js (7 tests). Read backend/event-move.js and confirm its three-step order (local write →
Splose draft queue → Outlook mirror with graceful degradation) matches what the portal route did before the
extraction — the commit message claims the response is byte-for-byte unchanged. Then walk the Multi Calendar
Rules checklist against the live portal: book a session, confirm the "changes saved but not synced"
indicator, check travel-time calculation, confirm Portal/Splose match in both directions. Done means: the
refactor is confirmed behaviour-preserving and each checklist item is manually confirmed with no bug found.
```

**2. Opa Mobile Companion — device walkthrough, now including drag-to-move**
```
/opal-critical
On the test device: (1) dictate a case note through the Opa Mobile Companion app and confirm it reaches
backend/case-note-routes.js's generateGovernedDraft() (linked by voiceNoteId) and produces a usable draft
linked to the right client; (2) drag an appointment to a new time in the Calendar View and confirm it saves
correctly and that Outlook/Splose stay consistent afterward. The server side of (2) is new tonight
(backend/mobile-routes.js's POST /api/mobile/appointments/:id/move, backend/mobile-calendar.js) and is
guarded, audited and tested (98 unit + 55 integration tests) — but nothing proves the phone gesture itself
works yet. This is a manual walkthrough first — only write code if it finds a real defect. Done means: both
walkthroughs are recorded as passing (or the defect found is filed as its own task).
```

**3. Automated Reminders (tracker-ahead disagreement)**
```
/opal-feature
Check whether the Development Manager tracker's "Create minimise function on snapshot" checklist item under
the Therapist Snapshot task (feature 398a0b36-a12f-4190-83e4-b3a8932b3b46) has a real whole-panel implementation
anywhere in frontend/current/reports.js or its CSS. A narrower "Completed" sub-list collapse already exists
(swCompletedCollapsed()/swToggleCompleted()) but nothing minimises the whole Snapshot widget. Either build the
whole-panel minimise or un-tick the checklist item to match what exists. Done means: the checklist and the
code agree.
```

**4. Xero Integration Works — confirm a real sandbox connection**
```
/opal-critical
Confirm a real Xero sandbox connection live in a browser and record it in docs/qa/BROWSER_QA_RESULTS.md.
215 unit + 90 integration tests all pass, but every one of them mocks the Xero client
(backend/xero-api.js, backend/xero-payroll-connection.js). No test here can prove a real Xero call works; only
a browser session against a sandbox tenant can. Done means: a sandbox connection is confirmed working and
recorded.
```

**5. Employee Personal Page & Professional Development — decide and test the leave/CPD round-trip**
```
/opal-critical
Two Development Manager cards — "Employee Personal Page (My Profile Tab)" (83bb9988-52ba-4f8c-85ba-7b65aca189b2)
and "Professional Development" (37f4e057-ae96-4a9e-a576-5f808b7dc8fb) — point at the same code
(backend/profile-routes.js) and the same untested gap. First, decide in the tracker whether they should merge.
Then add an integration test exercising /api/profile/leave and /api/profile/cpd end to end (approve and
reject paths). Done means: the round trip has a passing integration test; evidence label moves off
built-untested.
```

## 5. Ideas without a start

Two feature folders' START.md changed tonight, both because the code they track actually grew:

- **Opa Mobile Companion** — added the new `mobile-calendar.js`/`event-move.js` files to "Where it lives
  today" and added a drag-to-move device check to "Start here" alongside the existing Case Noting
  walkthrough.
- **Portal - Splose - Outlook | Integration Works** — added `event-move.js` to "Where it lives today" and
  noted the 2026-11-23 save-path refactor in "Start here"; the Multi Calendar Rules checklist itself is
  unchanged as the next step.

No other feature's START.md changed — the other eleven features and the tracker's own words for them are
both unchanged from last night.

## 6. What changed since last audit

Two commits landed, both backend-only, both at 21:42 UTC 2026-11-23 (just after last night's 18:35 UTC
audit closed, so first seen tonight):

- `e4fa521` **feat(mobile): drag-to-move from Opa — POST /api/mobile/appointments/:id/move**
  (backend/mobile-calendar.js [new], backend/mobile-routes.js, plus tests/mobile-calendar.test.js,
  tests/mobile-move.test.js, tests/integration/mobile-move.itest.js [all new]) — **Opa Mobile Companion**
  (Calendar View task).
- `aed4298` **refactor(calendar): one save road for a calendar edit — event-move.js**
  (backend/event-move.js [new], backend/routes.js, plus tests/event-move.test.js [new]) — **Portal - Splose
  - Outlook | Integration Works** (the shared save path `PATCH /api/outlook/events/:dbId` now uses), also
  consumed by the mobile commit above.

No `frontend/current/` file changed. No new migration landed — the latest remains `093_trip_travel_hours.sql`,
already applied. Both subsystems touched already have tracker features; no orphan subsystem change to
report.

## 7. Technical detail

**Setup.** PostgreSQL was already running (`service postgresql status` → `16/main (port 5432): online`);
`backend/node_modules/.bin/jest` was present — no install needed. Tracker snapshot pulled via
`NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs
/tmp/tracker.json` → `fetch-tracker: 13 features, 19 tasks -> /tmp/tracker.json`. This run's
`docs/qa/nightly/` history lives only on `claude/nightly-audit` (never merged to `develop`) — bootstrap
carried that history forward onto tonight's `develop` checkout (`git checkout -B nightly-audit-work
origin/develop`) before writing anything new. Window start was taken from last night's own status line
(RAN 18:35 UTC 2026-11-23, commit `403964c`), confirmed as an ancestor of tonight's `origin/develop` HEAD
(`e4fa521`) with `git merge-base --is-ancestor`. Today (2026-11-24, UTC) is a Tuesday, not Sunday — no
complete-suite weekly deep run tonight, per the weekly rule.

**Locate.** `git log 403964c..origin/develop --stat -- backend frontend/current` showed exactly the two
commits above touching five backend files and four new test files; nothing under `frontend/current/`
changed. Both new/changed route-adjacent files (`mobile-calendar.js`, `mobile-routes.js`, `event-move.js`,
`routes.js`) passed `node --check` and a fresh grep found no `TODO`/`FIXME` in any of them.

**Guard check (tonight's two touched files).** `router.use('/api/mobile', requireAuth)` covers the whole
mobile prefix; `POST /api/mobile/appointments/:id/move` additionally requires
`requireAnyPermission('manage_own_schedule', 'manage_all_schedules')` and every query is scoped to
`user_id = req.user.id` (read and write) inside one transaction with an optimistic-lock check
(`start_time = $6 AND end_time = $7` in the `UPDATE`). The move is audited as `mobile_event_moved` with
ids and minutes only — no clinical or employee data in the metadata, consistent with the project's audit
rule. `backend/event-move.js` is a plain service module (no route, no guard of its own) — its header
comment states the caller owns the ownership check, and both callers (`routes.js`'s existing
`requireAuth`-guarded PATCH, the mobile POST above) already had guards before tonight; the refactor did not
touch either guard. AI-gateway boundary re-confirmed clean tonight
(`tests/ai-gateway-boundary.test.js`, `tests/ai-single-gateway-guards.test.js` — 30/30 pass) — neither new
file imports an AI SDK or touches `backend/ai/`.

**Test selection and execution.** Every feature's test-file list was carried forward from last night's
STATUS.md folders (the codebase is unchanged for eleven of the thirteen features) and every file was run
fresh tonight, not assumed:
- Mobile/event-move (new + shared-path): 4 new/changed unit files + `mobile-routes.test.js` = 98 tests,
  plus the 4 case-note unit files sharing Opa Mobile Companion's folder (121 tests) — run together as 8
  files / 219 tests, all pass. Integration: `mobile-move.itest.js` (new) alongside
  `calendar-local-first.itest.js`, `splose-draft-sync.itest.js`, `event-times.itest.js`,
  `splose-link-ignore.itest.js`, `event-delete-cascade.itest.js` (the five existing itests that pin the
  save path this refactor touches) — 6 files, all pass; the four case-note itests under Opa Mobile
  Companion's own folder (17 tests) were also re-run and pass.
- Portal-Splose-Outlook's full unit set: 54 files / 967 tests, plus `event-move.test.js` (7 tests) = 55
  files / 974 tests, all pass. Its 12-file integration set (`block-review`, `calendar-category-colours`,
  `calendar-local-first`, `event-travel-plan`, `events-sync`, `nf2f-timer`, `splose-connection`,
  `splose-draft-sync`, `splose-link-ignore`, `sync-settings`, `travel-outlook-sync`, `travel-overrides`) —
  112 tests, all pass, an exact match to last night's count on the now-refactored save path.
- The other eleven features' remaining unit files (78 files covering onboarding, resources, assessments,
  inductions, templates, FCA/letter, Xero/billing, and the profile-routes.js guards shared by Employee
  Personal Page/Professional Development): 2,474 passed, 1 known failure
  (`tests/onboarding-document-reader.test.js`), 12 skipped (all in `resource-ingestion.test.js`, matching
  every prior night).
- Their remaining integration files (31 files covering resources, onboarding, inductions, assessments,
  templates, Xero/accounting, the four case-note itests, and `snapshot.itest.js`): **600/600 pass** — the
  exact sum of every one of these features' integration counts from last night's brief (168 + 208 + 7 + 81
  + 27 + 90 + 13 + 6 = 600), independently confirming no integration test's behaviour changed on these
  unchanged subsystems.

No test flaked under load tonight (unlike 2026-11-23's `resource-library.itest.js` TRUNCATE deadlock and
`fca-wizard-behaviour.test.js` timing flake, both confirmed clean on isolated re-runs that night and not
repeated tonight).

**Known environment artifact, confirmed again (tenth night running).**
`tests/onboarding-document-reader.test.js` fails with "Cannot find module
'@tesseract.js-data/eng/package.json'". `@tesseract.js-data/eng` is declared in `backend/package.json` but
genuinely absent from `backend/node_modules` in this sandbox (checked directly tonight). Not fixable from
inside this audit (no `npm install` permitted). First seen 2026-11-15.

**Documentation mismatch (not a functional gap), confirmed again.** `CLAUDE.md`'s repository map names
`backend/service-agreement-routes.js`; that file does not exist in this checkout. Service agreements are
actually generated through `backend/templates-routes.js` + `backend/templates/service-agreement-map.js`.

**Nothing could not be located this run** beyond the two items already called out above (Automated Client
Appt Reminders has no code; the mobile app's own frontend is outside this repository, so neither tonight's
drag-to-move nor the existing Case Noting dictation flow can be proven from a device here).

**Write-back.** `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs
/tmp/writeback.json` → `post-tracker: 13 features posted, 0 already posted tonight, brief posted`.

**Open question for the team (carried forward, unchanged):** should "Employee Personal Page (My Profile Tab)"
and "Professional Development" be merged into one tracker card? Both point at the same code and the same
test gap, confirmed again tonight.
