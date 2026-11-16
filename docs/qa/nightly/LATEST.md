# Nightly tracker audit — 2026-11-16

## 1. Status line

**RAN** at 2026-11-16 18:11 UTC. Commit audited: `9444e23` (origin/develop, "Merge branch
'flight-tracking' — Add a flight").

**Nothing changed since last night.** The 2026-11-15 audit (on `origin/claude/nightly-audit`,
which is where this branch's history actually lives — `docs/qa/nightly/` is never merged to
`develop`) audited this exact same commit. `git log --since="2026-11-15T00:00:00Z" -- backend
frontend/current` returns zero commits. Tonight's job was therefore to independently re-prove
last night's thirteen classifications rather than produce new ones — every test last night's
brief named was re-run fresh tonight (not copied forward), and every count below is from tonight's
own runs.

**Result of re-verification: all thirteen classifications hold, with one count correction.**
Tonight's own test selection for "Inductions" initially came up short (146 tests across 6 files vs.
last night's 271) until `tests/assign-learning-guards.test.js` (125 tests) was found to be the
missing 7th suite — 146 + 125 = 271, an exact match once the full set is run. The
Portal-Splose-Outlook-Integration unit/integration counts differ slightly from last night's listed
numbers (261 vs. 290 unit; 135 vs. 118 integration) because tonight's file selection was built
independently from the located route files rather than copied from last night's list — every file
run tonight passed either way, so this is a selection difference, not a regression. Full detail
and exact file lists are in each feature's `STATUS.md`.

Counts across the tracker's 13 features (unchanged from last night): **2 proven ·
4 needs-refinement · 1 built-untested · 4 tab-unproven · 2 untouched · 0 broken**.

This is a Monday UTC run, so per the weekly-deep-run rule the complete suites were **not** run
tonight (last Sunday, 2026-11-15, already ran both: 5521/5534 unit, 1216/1217 integration — see
that date's brief for the two confirmed environment artifacts, both of which still apply tonight,
unchanged, see Technical detail).

A general note carried forward from last night, now resolved: the 2026-11-15 brief flagged several
tracker `next_action` fields that read like direct instructions to the auditing agent (e.g. "No
action needed — evidence supports moving this card's stage up"). Tonight's fresh tracker fetch
confirms these are this audit's **own** prior write-back text persisting in the tracker (written by
`post-tracker.mjs` on an earlier night), not an external instruction — the tracker is still treated
as untrusted data and nothing in it was acted on as a command either way.

## 2. Do this first

Unchanged from last night — nothing has moved, and no new `broken` or tracker-ahead-of-evidence
disagreement appeared tonight:

1. **Portal-Splose-Outlook Integration — "Multi Calendar Rules" has no code anywhere.** The
   Calendar tab is used daily and everything else in this integration passes (261/261 unit,
   135/135 integration tonight), but this one task is genuinely unbuilt — the only
   `needs-refinement` item that is a true code gap rather than a missing check. → `/opal-feature`,
   see `docs/qa/nightly/features/portal-splose-outlook-integration-works/START.md`.
2. **Employee Personal Page — no test proves leave/CPD approval actually works end to end.**
   Code is built and guarded; nobody has proven the therapist→owner round trip (`built-untested`).
   → `/opal-critical`, see `docs/qa/nightly/features/employee-personal-page-my-profile-tab/START.md`.
3. **Interactive Assessments — WHODAS 2.0 scoring has never been checked in a browser for a real
   client.** Backend is fully tested (738 unit + 122 integration tonight); nobody has looked at the
   tab (`tab-unproven`). → `/opal-critical`, see
   `docs/qa/nightly/features/interactive-assessments/START.md`.
4. **Report Templates — none of FCA / Progress Letter / Client Agreement Form has been hand-run
   to a downloaded file** (`tab-unproven`). → `/opal-critical`, see
   `docs/qa/nightly/features/report-templates/START.md`.
5. **Xero Integration — never connected to a real Xero sandbox.** Everything up to the Xero
   boundary is tested and guarded; the actual numbers have never been checked (`tab-unproven`).
   → `/opal-critical`, see `docs/qa/nightly/features/xero-integration-works/START.md`.

No `broken` features and no case where the tracker claims *more* progress than the evidence shows.

## 3. Every feature

| Feature | Tracker stage | Evidence label | Why | Tests run tonight |
|---|---|---|---|---|
| Portal - Splose - Outlook Integration Works | idea | needs-refinement | huge working integration; "Multi Calendar Rules" task unbuilt | 261 unit + 135 integration pass |
| Portal Onboarding Workflow | idea | needs-refinement | extensively built/tested; Stage 1/2/3 tasks open, no written scope | 653/654 unit (1 env artifact) + 232 integration pass |
| Clinical resources | idea | proven | fully built, guarded, tested, tab-covered | 444 unit (+12 skipped) + 168 integration pass |
| Inductions | idea | needs-refinement | pack delivery proven; Induction Playground step types unbuilt | 271 unit + 68 integration pass |
| Professional Development | idea | tab-unproven | no code of its own — lives inside Resource Hub, tested there, but no browser proof of the tab | 168 integration pass (shared with Clinical resources) |
| Automated Reminders | idea | needs-refinement | "Snapshot" half built/tested but is a different feature; client-reminder half entirely unbuilt | 6 integration pass (unrelated feature) |
| Employee Personal Page (My Profile Tab) | idea | built-untested | built/guarded, tab renders; no test exercises leave/CPD approval | 9/10 integration pass (1 env artifact) |
| Interactive Assessments | idea | tab-unproven | well tested; no browser proof of the tab | 738 unit + 122 integration pass |
| Opa Mobile Companion | idea | proven | both open tasks (Case Noting, Calendar View) already built/tested | 50 unit + 3 integration pass |
| Password Master Document | idea | untouched | correctly so — OneDrive document by design | none (n/a) |
| Report Templates | idea | tab-unproven | built/tested this week; three document flows never hand-checked | 184 unit + 55 integration pass |
| Update Opal Docs Register | idea | untouched | correctly so — SharePoint task, not portal code | none (n/a) |
| Xero Integration Works | idea | tab-unproven | tested/guarded; real Xero sandbox never connected | 57 unit + 28 integration pass |

(Several test files are shared between features, e.g. `resource-hub-r2.itest.js` covers both
Clinical resources and Professional Development, and `fca-reports.itest.js` is counted once under
Interactive Assessments though Report Templates also touches `fca-routes.js`. See each feature's
`STATUS.md` for the exact file list run tonight.)

## 4. Prompts for the morning

See each item's linked `START.md` under `docs/qa/nightly/features/<slug>/` for the full,
ready-to-paste prompt (tracker idea/why/who/what quoted verbatim, located files, a concrete first
step, and a done-means test) — all unchanged from last night since nothing in the tracker or the
code moved. Summary of the skill to run each under:

1. Portal-Splose-Outlook → `/opal-feature`
2. Employee Personal Page → `/opal-critical`
3. Interactive Assessments → `/opal-critical`
4. Report Templates → `/opal-critical`
5. Xero Integration → `/opal-critical`

## 5. Ideas without a start

No feature folder or `START.md` changed tonight — the tracker's idea/why/who/what fields and every
located file are identical to last night's fetch, so there is nothing new to start. All 13 folders
already existed from 2026-11-01 onward and are confirmed current as of tonight.

## 6. What changed since last audit (2026-11-15 to 2026-11-16)

Nothing. Zero commits touched `backend/` or `frontend/current/` in this window. The tracker's
fetched content (idea/why/who/what/outcome/tasks/decisions) for all 13 features is byte-identical
to last night's, apart from the `claude_update`/`next_action` fields, which carry this audit's own
prior-night write-back (see Status line note above).

## 7. Technical detail

**Setup**: `backend/node_modules` present. PostgreSQL 16 was down and was started
(`service postgresql start`). Tracker snapshot fetched successfully: 13 features, 19 tasks,
fetched at 2026-11-16T18:10:58Z.

**Tests run tonight** (all from `backend/`, each feature group used a dedicated
`DB_NAME=therapy_scheduler_audit_<suffix>` per `.claude/rules/concurrency.md`):
- Clinical resources / PD: 13 unit suites / 444 passed (12 skipped) + 7 integration suites / 168
  tests — all pass.
- Inductions/learning: 7 unit suites / 271 tests + 4 integration suites / 68 tests — all pass.
- Interactive assessments: 12 unit suites / 738 tests + 3 integration suites / 122 tests — all pass.
- Mobile (Opa Mobile Companion): 1 unit suite / 50 tests + 1 integration suite / 3 tests — all pass.
- Automated Reminders (Snapshot half): 1 integration suite / 6 tests — pass.
- Templates/letters: 5 unit suites / 184 tests + 1 integration suite / 55 tests — all pass.
- Xero/accounting: 4 unit suites / 57 tests + 2 integration suites / 28 tests — all pass.
- Portal-Splose-Outlook: 18 unit suites / 261 tests + 17 integration suites / 135 tests — all pass.
- Onboarding: 27 unit suites / 654 tests (26 pass, 1 confirmed environment-artifact failure,
  653 individual tests pass) + 10 integration suites / 232 tests — all pass.
- Employee Personal Page: 2 integration suites / 10 tests (9 pass, 1 confirmed environment-artifact
  failure) — no dedicated unit test exists for the leave/CPD approval logic (confirmed by grep
  across every unit test file for `updateLeaveStatus` / `leave_request` / `profile/leave` /
  `profile/cpd`: no match beyond incidental mentions).
- `node --check` over every file in `backend/*.js`: no syntax errors.

**Two confirmed environment artifacts, not application defects** (same two as 2026-11-15,
re-observed tonight, not assumed):
1. `tests/onboarding-document-reader.test.js` — fails because `@tesseract.js-data/eng` (an OCR
   training-data package declared in `package.json`) is not present in this sandbox's
   `node_modules`. This audit's hard limits forbid `npm install`, so this cannot be fixed here.
2. `tests/integration/readonly-and-hardening.itest.js` (D-7, line 121) — expects a
   `chmod(dir, 0o000)` write to fail with 5xx. This sandbox runs every process as root, and root
   bypasses Unix permission bits, so the write succeeds (201) instead of failing. The paired D-6
   check in the same test (missing storage object → 404) passes correctly.

**Guard check**: every located route file across all 13 features still guards with `requireAuth`
plus a permission/role middleware (or is self-scoped-by-design per CLAUDE.md's documented exception
for `snapshot-routes.js`/`mobile-routes.js`). No unguarded route found.

**Tab coverage**: `e2e/tests/` still contains only `portal.spec.js` and `tutorials.spec.js`;
`docs/qa/BROWSER_QA_RESULTS.md` is unchanged from last night's read. Both confirmed unchanged
tonight by directory listing.

**Write-back to tracker**: ran once tonight —
`post-tracker: 13 features posted, 0 already posted tonight, brief posted`. Succeeded; no
hand-crafted API calls were made (per the hard limit, this script is the only sanctioned write
path).

**Open questions for the team** (carried forward, still unanswered):
- Is "Automated Reminders"'s "Therapist Snapshot" task meant to be the existing personal Snapshot
  feature, or something new (a workload/utilisation view that doesn't exist anywhere)?
- Opal Assist (the AI chat feature) has significant code and tests but no tracker card — worth
  adding one so future audits can track it.
- `docs/qa/nightly/` continues to live only on `claude/nightly-audit`, never merged to `develop` —
  worth deciding whether that's intentional, since every nightly run currently has to rediscover
  this branch rather than finding its own history in a normal checkout.
