# Nightly tracker audit — 2026-11-22

## 1. Status line

**RAN** · 2026-11-22 18:13 UTC · commit `403964c` (origin/develop) · proven: 1, built-untested: 2,
needs-refinement: 5, broken: 0, untouched: 2, tab-unproven: 3 (13 features total).

**A quiet night.** Only 7 commits landed in `backend/` and `frontend/current/` since the last audit
(2026-11-21 18:36 UTC) — all calendar/booking UI polish (a travel side-panel declutter, a right-click
context menu on empty calendar time, hiding empty NDIS-plan/Region cards until a client is picked, a
start-field typing fix, solid travel-leg fill, and late-week booking-sheet left-docking), plus one
unrelated cosmetic change (Settings now uses the shell's gear icon). All of tonight's work lands under
"Portal - Splose - Outlook | Integration Works". Every targeted unit and integration test for every one
of the 13 features was re-run fresh tonight (136 unit files / 3,592 passing, 1 known environment-artifact
failure; 43 integration files / 712 passing), and — this being a Sunday — the complete regression suites
were also run once: `npm test`
(215 suites: 214 passed, 1 known failure; 5,970 tests: 5,957 passed, 1 failed, 12 skipped) and
`npm run test:integration` (81 suites: 79 passed, 2 failed; 1,256 tests: 1,253 passed, 3 failed — both
failing suites are environment artifacts specific to this sandbox, not code defects; see Technical
detail). No classification changed from last night. No disagreement was resolved.

## 2. Do this first

1. **[/opal-feature] Automated Reminders — tracker ahead of the evidence, 8 nights running.** The
   Therapist Snapshot task's own checklist still marks "Create minimise function on snapshot" as
   done, but no matching code exists in `frontend/current/reports.js` or anywhere else — only a
   narrower "Completed" sub-list collapse (`swCompletedCollapsed()`) and an unrelated minimise on the
   separate Opa AI chat widget. Confirmed again tonight, 2026-11-15 through 2026-11-22.
2. **[/opal-critical] Portal - Splose - Outlook — one checklist item still open, after a quieter
   night.** Tonight's 7 commits are UI polish on top of last night's much larger landing; guards and
   all targeted tests pass fresh. The one tracker task, Multi Calendar Rules, remains a human checklist
   against the live portal; nothing tonight touched it.
3. **[/opal-critical] Xero Integration Works — still never confirmed against a real Xero sandbox.**
   Unchanged tonight (no billing/invoicing/Xero commits landed) — 215 unit + 90 integration tests still
   pass, every one of them against a mocked Xero client. The live-sandbox-in-a-browser gap is unchanged.
4. **[/opal-critical] Opa Mobile Companion — not actually proven.** Don't close its two tracker tasks
   on test counts alone (171 unit + 13 integration backend tests prove the API, not the device
   experience). Run the manual device walkthrough the task itself asks for.
5. **[/opal-critical] Employee Personal Page & Professional Development — the same untested gap,
   possibly the same card.** Neither tracker card has a test proving the leave/CPD approval round
   trip (`/api/profile/leave`, `/api/profile/cpd`). Still unresolved from last night's brief — worth
   deciding whether they are the same piece of work tracked twice.

No `broken` feature was found anywhere in this run — no unguarded routes, no `node --check` failures.
The one unit failure (`tests/onboarding-document-reader.test.js`, a missing OCR package) is an
eighth-night-running environment artifact, not a code defect. The Sunday full integration run surfaced
two more failures, investigated and confirmed as environment artifacts (not code defects) rather than
regressions — see Technical detail.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Unchanged tonight — every Xero call in every test is still mocked; a real sandbox connection is still never confirmed live. | 12u/215✓, 6i/90✓ |
| Update Opal Docs Register | idea | untouched | Organising/SharePoint task — no code expected. | none |
| Report Templates | idea | tab-unproven | FCA/Letter/Agreement generation built & tested (625 tests); three document flows never hand-checked. Unchanged tonight. | 14u/598✓, 1i/27✓ |
| Password Master Document | idea | untouched | Tracker says to keep this on OneDrive — no portal action. | none |
| Opa Mobile Companion | idea | needs-refinement | AI-governed case-note path built & tested; device walkthrough not yet done. | 5u/171✓, 4i/13✓ |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0 built & tested (484 tests); no browser proof of the tab. | 6u/484✓, 2i/81✓ |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Built & guarded; no test proves the leave/CPD approval round trip. | 4u/94✓, 0i |
| Automated Reminders | idea | needs-refinement | Appt reminders: no code at all. Snapshot: built & tested but a checklist/code mismatch persists. | 0u, 1i/6✓ |
| Professional Development | idea | built-untested | Lives inside My Profile's CPD section; shares Employee Personal Page's code and its untested round trip. | 4u/94✓ (indirect), 0i |
| Inductions | idea | needs-refinement | Learner side proven by E2E; builder/AI-helper/photo-step work still open. | 3u/92✓, 2i/7✓, E2E✓ |
| Clinical resources | idea | proven | Built, guarded, fully tested, E2E-proven, no open task — tracker underclaims this one. | 12u/398✓, 7i/168✓, E2E✓ |
| Portal Onboarding Workflow | idea | needs-refinement | Extensively built/tested (604/605 tests); real gap is SharePoint storage for Stage 2. | 24u pass/1u env-artifact, 8i/208✓ |
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | Tonight's 7 commits are UI polish (right-click menu, late-week booking-sheet docking) — guards and tests all pass; the one open item is the Multi Calendar Rules human checklist. | 55u/936✓, 12i/112✓ |

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
suite for this subsystem all pass fresh tonight. Done means: each checklist item is manually confirmed with
no bug found.
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
reject paths). Done means: the round trip has a passing integration test; evidence label moves off
built-untested.
```

## 5. Ideas without a start

- **Portal - Splose - Outlook | Integration Works** — START.md's "Start here" note was refreshed tonight to
  mention tonight's smaller landing (right-click context menu, late-week booking-sheet docking); the next
  step (walk the Multi Calendar Rules checklist) is unchanged.

No other feature's START.md changed tonight — none of the other 12 crossed into or out of `proven`, and none
had a location correction.

## 6. What changed since last audit

7 commits landed in `backend/` and `frontend/current/` between 18:36 UTC 2026-11-21 and tonight, all under
"Portal - Splose - Outlook | Integration Works" except one:

- **Calendar / booking / travel UI polish (6 commits)** — the travel side panel dropped its repeated grey
  explanatory sub-text; right-click on empty calendar time now opens the portal's own menu ("Book at
  &lt;time&gt;", "Open &lt;day&gt; in Day view") instead of the browser's; the booking view hides the empty
  NDIS-plan/Region cards until a client is picked; typing a start time is no longer snapped back mid-keystroke
  and travel legs now use a solid fill; and the booking sheet always docks left for Fri/Sat/Sun in multi-day
  views (two commits: the initial "docks left for late-week days" feature, then a follow-up fix).
- **Cosmetic, no tracker card (1 commit)** — Settings now uses the shell's own gear icon in both the header
  button and the Settings tab, replacing a sunburst icon. Pure UI chrome; no card covers it, same as prior
  nights' uncarded tech-debt/polish commits.

No new migrations landed this window.

## 7. Technical detail

**Setup.** PostgreSQL was down at the start of this run (`service postgresql status` → `down`) and was started
successfully (`service postgresql start`). `backend/node_modules/.bin/jest` was present — no install needed.
Tracker snapshot pulled via `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node
../scripts/nightly-audit/fetch-tracker.mjs /tmp/tracker.json` → `fetch-tracker: 13 features, 19 tasks ->
/tmp/tracker.json`. Window start taken from the 2026-11-21 brief's own status line (RAN 18:36 UTC), not just
the filename date — that brief lives only on `claude/nightly-audit` (never merged to `develop`), so this run's
bootstrap first carried that history forward onto tonight's `develop` snapshot before writing anything new.

**Sunday weekly deep run.** `npm test` → 215 suites (214 passed, 1 known failure), 5,970 tests (5,957
passed, 1 failed, 12 skipped) — the one failure is the known OCR-package artifact, below.
`DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit npm run test:integration` → 81 suites (79 passed, 2
failed), 1,256 tests (1,253 passed, 3 failed), 1,132 s. Both failing suites were investigated and
re-run in isolation:
- `tests/integration/readonly-and-hardening.itest.js` — the D-6/D-7 storage-failure test makes a
  directory unwritable (`fs.chmodSync(dir, 0o000)`) and expects the next write to fail with a 5xx. This
  sandbox runs every process as `root` (confirmed: `whoami` → `root`), and root bypasses Unix
  permission checks, so the write silently succeeds (201) instead of failing. Re-run in isolation: same
  result, confirming it is a sandbox/environment property (tests assume a non-root process), not a
  defect in the actual document-storage write-failure handling. **New environment artifact, first
  confirmed tonight** — not fixable from inside this audit (no way to drop root inside the sandbox).
- `tests/integration/resource-library.itest.js` — 2 of its tests failed with `deadlock detected` on
  `TRUNCATE` during the full run only. Re-run in isolation immediately before it: `Cannot log after
  tests are done... Cannot use a pool after calling end on the pool` warnings from
  `backend/splose-draft-sync.js`'s auto-sync logger, fired by a prior suite, landed mid-way through this
  suite's setup — a leaked timer/async operation from an earlier test's auto-sync path, not torn down
  before the next suite's `TRUNCATE`. Re-run resource-library.itest.js alone: **53/53 pass, clean**,
  confirming the suite itself is correct and this is full-run test-isolation flakiness, not a code
  defect. **Recommendation for the team:** `backend/splose-draft-sync.js`'s auto-sync scheduler should
  have its timer explicitly cleared in whichever test leaves it running — worth a small test-hygiene fix
  so the full suite stops being occasionally flaky, though it does not affect the "Portal - Splose -
  Outlook" feature's evidence label (its own targeted integration run tonight was clean, 12/12 files).

Neither failure changes any feature's evidence label — Clinical resources (which owns
resource-library.itest.js) stays `proven`; the document-storage code involved in readonly-and-hardening
is not among Employee Personal Page's tracked tests and that card's `built-untested` label is unaffected.

**Known environment artifact, confirmed again (eighth night running).** `tests/onboarding-document-reader.test.js`
fails with "Cannot find module '@tesseract.js-data/eng/package.json'". `@tesseract.js-data/eng` is declared in
`backend/package.json` but genuinely absent from `backend/node_modules` in this sandbox (checked directly
tonight). Not fixable from inside this audit — no `npm install` is permitted. First seen 2026-11-15.

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
