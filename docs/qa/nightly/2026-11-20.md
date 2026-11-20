# Nightly tracker audit — 2026-11-20

## 1. Status line

**RAN** · 2026-11-20 18:52 UTC · commit `0f14780` (origin/develop) · proven: 1, built-untested: 2,
needs-refinement: 5, broken: 0, untouched: 2, tab-unproven: 3 (13 features total).

**Zero commits have touched `backend/` or `frontend/current/` since the last audit** (2026-11-19
18:39 UTC). `develop` is still at `0f14780` — the same commit the 2026-11-19 audit checked. Every
one of tonight's six classification changes from recent nights carries forward unchanged, and this
audit still re-ran every unit and integration test fresh tonight rather than copying numbers
forward: 101 unit test files (3,508 tests) and 41 integration test files (675 tests) were all
executed again against a throwaway database (`therapy_scheduler_audit`), and every single number —
down to the individual per-file test count — came back identical to the 2026-11-19 run. No
classification changed. No new disagreement was found. No disagreement was resolved.

## 2. Do this first

1. **[/opal-feature] Automated Reminders — tracker ahead of the evidence.** The Therapist Snapshot
   task's own checklist still marks "Create minimise function on snapshot" as done, but no matching
   code exists in `frontend/current/reports.js` or anywhere else (only an unrelated minimise on the
   separate Opa AI chat widget) — confirmed again tonight, six nights running (2026-11-15 through
   2026-11-20).
2. **[/opal-critical] Portal - Splose - Outlook — a large subsystem, one checklist item still open.**
   Last night's 10-commit landing (relocate-before-block booking, server-saved side-panel notes, the
   wrong-event fix, a redesigned three-tab Sync popup with its outside-events review queue) stands
   unchanged tonight — still guarded, still fully tested (456 unit + 126 integration tests,
   re-confirmed fresh). The one tracker task, Multi Calendar Rules, remains a human checklist against
   the live portal; nothing in the quiet night touched it.
3. **[/opal-critical] Opa Mobile Companion — not actually proven.** Don't close its two tracker tasks
   on test counts alone (171 unit + 13 integration backend tests prove the API, not the device
   experience). Run the manual device walkthrough the task itself asks for.
4. **[/opal-critical] Employee Personal Page & Professional Development — the same untested gap,
   possibly the same card.** Neither tracker card has a test proving the leave/CPD approval round
   trip (`/api/profile/leave`, `/api/profile/cpd`). These two cards point at the exact same
   `backend/profile-routes.js` and the same test gap — worth deciding whether they are the same piece
   of work tracked twice.
5. **[/opal-critical] Portal Onboarding Workflow — the tracker's own checklists are stale against the
   code, six nights running.** Stage 1's Letter-of-Offer flow and Stage 2's dynamic employee contract
   already exist; the one real gap is SharePoint document storage, confirmed absent again by a
   repo-wide grep.

No `broken` feature was found anywhere in this run — no unguarded routes, no `node --check`
failures. The one failing test (`tests/onboarding-document-reader.test.js`, a missing OCR package) is
a six-night-running environment artifact, not a code defect — see Technical detail.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Reason | Tests run |
|---|---|---|---|---|
| Xero Integration Works | idea | tab-unproven | Built & tested (144 tests); real Xero sandbox connection never confirmed in a browser. | 7u/81✓, 5i/63✓ |
| Update Opal Docs Register | idea | untouched | Organising/SharePoint task — no code expected. | none |
| Report Templates | idea | tab-unproven | FCA/Letter/Agreement generation built & tested (625 tests); three document flows never hand-checked. | 14u/598✓, 1i/27✓ |
| Password Master Document | idea | untouched | Tracker says to keep this on OneDrive — no portal action. | none |
| Opa Mobile Companion | idea | needs-refinement | AI-governed case-note path built & tested; device walkthrough not yet done. | 5u/171✓, 4i/13✓ |
| Interactive Assessments | idea | tab-unproven | WHODAS 2.0 built & tested (563 tests); no browser proof of the tab. | 6u/482✓, 2i/81✓ |
| Employee Personal Page (My Profile Tab) | idea | built-untested | Built & guarded; no test proves the leave/CPD approval round trip. | 4u/94✓, 0i |
| Automated Reminders | idea | needs-refinement | Appt reminders: no code at all. Snapshot: built & tested but a checklist/code mismatch persists. | 0u, 1i/6✓ |
| Professional Development | idea | built-untested | Lives inside My Profile's CPD section; shares Employee Personal Page's code and its untested round trip. | 4u/94✓ (indirect), 0i |
| Inductions | idea | needs-refinement | Learner side proven by E2E; builder/AI-helper/photo-step work still open. | 3u/92✓, 2i/7✓, E2E✓ |
| Clinical resources | idea | proven | Built, guarded, fully tested, E2E-proven, no open task — tracker underclaims this one. | 12u/398✓, 7i/168✓, E2E✓ |
| Portal Onboarding Workflow | idea | needs-refinement | Extensively built/tested (812/813 tests); real gap is SharePoint storage for Stage 2. | 24u pass/1u env-artifact, 8i/208✓ |
| Portal - Splose - Outlook \| Integration Works | idea | needs-refinement | Not addressed tonight (zero commits); still the same large, heavily tested subsystem with one open human checklist (Multi Calendar Rules). | 19u/456✓, 12i/126✓ |

## 4. Prompts for the morning

**1. Automated Reminders (tracker-ahead disagreement)**
```
/opal-feature
Check whether the Development Manager tracker's "Create minimise function on snapshot" checklist item under
the Therapist Snapshot task (feature 398a0b36-a12f-4190-83e4-b3a8932b3b46) has a real implementation anywhere
in frontend/current/reports.js or its CSS. If it does, note where; if not, either build it or un-tick the
checklist item. Done means: the checklist and the code agree.
```

**2. Portal-Splose-Outlook — Multi Calendar Rules checklist**
```
/opal-critical
Walk the Multi Calendar Rules checklist against the live portal: book a session, confirm the "changes saved
but not synced" indicator, check travel-time calculation, and confirm Portal/Splose match in both directions.
This subsystem is large (456 unit + 126 integration tests, all re-confirmed passing) — this is a verification
pass against the live portal, not a build task. Done means: each checklist item is manually confirmed with no
bug found.
```

**3. Opa Mobile Companion — device walkthrough**
```
/opal-critical
On the test device, dictate a case note through the Opa Mobile Companion app and confirm it reaches
backend/case-note-routes.js's generateGovernedDraft() (linked by voiceNoteId) and produces a usable draft
linked to the right client. This is a manual walkthrough first — only write code if the walkthrough finds a
real defect. Done means: the walkthrough is recorded as passing (or the defect found is filed as its own task).
```

**4. Employee Personal Page & Professional Development — decide and test the leave/CPD round-trip**
```
/opal-critical
Two Development Manager cards — "Employee Personal Page (My Profile Tab)" (83bb9988-52ba-4f8c-85ba-7b65aca189b2)
and "Professional Development" (37f4e057-ae96-4a9e-a576-5f808b7dc8fb) — point at the same code
(backend/profile-routes.js) and the same untested gap. First, decide in the tracker whether they should merge.
Then add an integration test (follow the pattern in tests/integration/case-note-approval-edit.itest.js) that
submits a leave request via backend/profile-routes.js as a therapist, approves it as an owner, and asserts the
therapist sees the approved status; do the same for one CPD item. Done means: the merge decision is recorded
and the new test file passes.
```

**5. Portal Onboarding Workflow — SharePoint storage for Stage 2**
```
/opal-critical
Re-tick the Stage 1/2 checklists in backend/onboarding-employee-routes.js and onboarding-pack-routes.js
against the running code — most items are further along than the checklist shows — then add SharePoint
storage for Stage 2 documents, confirmed absent by a repo-wide grep for the sixth night running. Done means:
Stage 2 documents land in SharePoint and the checklist matches reality.
```

## 5. Ideas without a start

No feature folder was created or changed in substance tonight. All 13 `START.md` files stand
unchanged from 2026-11-19 — the evidence behind every one of them was re-confirmed fresh tonight
(fresh `node --check`, fresh guard greps, fresh unit/integration runs), not merely left alone.
`clinical-resources/START.md` stays in its two-line *proven* form. No feature moved toward or away
from `proven` tonight.

## 6. What changed since last audit

**Since the last audit (2026-11-19 18:39 UTC to 2026-11-20 18:52 UTC): zero commits.** `develop`
remains at `0f14780`, the same commit the 2026-11-19 audit checked. This is the first fully quiet
night since the 10-commit calendar/booking/travel/notes/sync landing on 2026-11-19 (which itself
followed four quiet nights, 2026-11-14 through 2026-11-18).

For orientation: the 10 commits that landed on 2026-11-19 (Smart Booking relocate-before-block,
side-panel day change from the Change button, server-saved side-panel notes fixing real data loss, a
fixed wrong-event bug, a new-booking top-scroll fix, no forced trip-home, no 15-minute rounding, and
a redesigned three-tab Sync popup with a new outside-events block-review queue) all feed the
**Portal - Splose - Outlook | Integration Works** tracker card and are unchanged tonight. The 31
commits before that (2026-11-04 through 2026-11-14) covered Calendar/booking/travel, Case notes,
Inductions, Clinical letter templates, Opal Assist/"Opa" AI chat, Learning, and Walkthroughs —
likewise unchanged.

**Subsystems that changed but have no tracker feature card at all:** unchanged from recent nights —
Opal Assist/"Opa" AI chat and Flights/Travel remain without cards.

## 7. Technical detail

**Commands run** (all from `backend/`, targeted per feature — no complete suite run; this is not a
Sunday):

- `node --check` on every `.js` file under `backend/` (excluding `node_modules` and any archive
  directory) — clean, no syntax errors anywhere.
- Guard check: a grep for `requireAuth|requirePermission|requireRole|requireClinicalRead|
  requireClinicalWrite|requireTemplateRead|requireTemplateWrite|denyReadOnly|ownerOnly|canApprove`
  across every route file located for any feature tonight — every file had at least one guard hit,
  re-confirming last night's guard findings file by file.
- Unit tests: 101 files run in a single `jest` invocation (`npx jest <101 files> --json`).
  **100 suites passed, 1 failed, 3,495 of 3,508 tests passed, 12 skipped.** The one failure —
  `tests/onboarding-document-reader.test.js` → `Cannot find module
  '@tesseract.js-data/eng/package.json'` — is the SAME environment/install artifact independently
  confirmed on 2026-11-15 through 2026-11-19 (six nights running). The package is declared in
  `backend/package.json` but genuinely absent from `backend/node_modules` in this sandbox. Not
  fixable from inside this audit — the hard limit against `npm install` stands. Every per-file test
  count was compared against the 2026-11-19 run and found identical, file for file.
- Integration tests: 41 `.itest.js` files run in a single `jest` invocation against
  `therapy_scheduler_audit_test` (`DB_NAME=therapy_scheduler_audit DB_PASSWORD=audit`, `--runInBand
  --json`, `globalSetup.js` creating the database and applying migrations cleanly). **41 of 41 suites
  passed, 675 of 675 tests passed.** Expected "Xero offline in test" warnings surfaced in
  `finance-routes.itest.js` — correct fail-closed behaviour, not failures. Every per-file test count
  was compared against the 2026-11-19 run and found identical, file for file.
- Spot-checks re-run fresh tonight, all confirming unchanged findings: `backend/service-agreement-routes.js`
  still does not exist (CLAUDE.md documentation mismatch persists); no appointment-reminder send code
  anywhere in `backend/`; no snapshot-specific minimise function (only the unrelated one in
  `frontend/current/opa.js`); no `'photo'` induction step type; `e2e/tests/tutorials.spec.js` and
  `e2e/tests/portal.spec.js` both still present and unchanged; no integration test exercises
  `/api/profile/leave` or `/api/profile/cpd` (the only hit remains the unrelated incidental
  `leave_requests` insert in `scheduler-availability.itest.js`); `docs/qa/BROWSER_QA_RESULTS.md` is
  still dated 2026-08-01.
- Tracker fetch: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/fetch-tracker.mjs
  /tmp/tracker.json` — succeeded, 13 features / 19 tasks, all still at tracker stage `idea`.
- Tracker write-back: `NODE_USE_ENV_PROXY=1 SUPABASE_URL="$SUPABASE_URL" node ../scripts/nightly-audit/post-tracker.mjs
  /tmp/writeback.json` — `post-tracker: 13 features posted, 0 already posted tonight, brief posted`. Verified by
  re-fetching the tracker afterwards: the Portal-Splose-Outlook card's `claude_update`/`next_action` read back
  exactly as written, with a fresh `updated_at` timestamp (`2026-11-20T18:54:15Z`).

**Could not locate (unchanged from recent nights):**
- Any code for Automated Client Appt Reminders (no SMS/email send path, no 24-hour-before scheduler).
- A snapshot-specific "minimise" implementation matching the Therapist Snapshot checklist's ticked item.
- A frontend tab banner specifically for Assessments or for Report Templates (FCA/Letter/Agreement) — these
  appear to live inside wizards/modals reached from elsewhere rather than their own `TAB` banner.
- `backend/service-agreement-routes.js`, which CLAUDE.md's own repo map names — it does not exist. Service
  agreements are actually handled through `templates-routes.js` + `backend/templates/service-agreement-map.js`.
  This is a documentation mismatch to report to whoever maintains CLAUDE.md, not a functional gap.
- A standalone "Professional Development" tab or page — it lives inside My Profile's CPD section instead.

**Staleness flag (unchanged):** `docs/qa/BROWSER_QA_RESULTS.md` is dated 2026-08-01 and predates most of the
2026-11 window's work. Treat every citation of that document in this brief and in the feature folders as "a
browser check happened once, a while ago," not as current proof.

**Open questions for the team (unchanged):**
- Should "Employee Personal Page (My Profile Tab)" and "Professional Development" be merged into one
  tracker card? Both point at the exact same code (`backend/profile-routes.js`) and share the exact same
  untested-round-trip gap.
- Should Opal Assist and Flights get their own tracker cards? Both are substantial, actively developed
  features with zero presence in the Development Manager right now.
